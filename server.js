const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const { ClientSecretCredential } = require('@azure/identity');
const { ComputeManagementClient } = require('@azure/arm-compute');
const { NetworkManagementClient } = require('@azure/arm-network');
const { ResourceManagementClient } = require('@azure/arm-resources');
const { SubscriptionClient } = require('@azure/arm-subscriptions');
const { CognitiveServicesManagementClient } = require('@azure/arm-cognitiveservices');
const { SocksProxyAgent } = require('socks-proxy-agent');
const path = require('path');
const fs = require('fs');
const https = require('https');

const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// --- Config & Data ---
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const ACCOUNTS_PATH = path.join(DATA_DIR, 'accounts.json');
const NUKE_STATUS_PATH = path.join(DATA_DIR, 'nuke-status.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

function getConfig() {
    if (!fs.existsSync(CONFIG_PATH)) {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify({ password: 'password' }));
    }
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function saveConfig(newConfig) {
    const current = getConfig();
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ ...current, ...newConfig }, null, 2));
}

// --- Multi-Account Management ---
function getAccounts() {
    if (!fs.existsSync(ACCOUNTS_PATH)) {
        fs.writeFileSync(ACCOUNTS_PATH, JSON.stringify([]));
    }
    return JSON.parse(fs.readFileSync(ACCOUNTS_PATH, 'utf8'));
}

function saveAccounts(accounts) {
    fs.writeFileSync(ACCOUNTS_PATH, JSON.stringify(accounts, null, 2));
}

// --- Nuke ---
function readNukeStatus() {
    if (!fs.existsSync(NUKE_STATUS_PATH)) return { running: false };
    try { return JSON.parse(fs.readFileSync(NUKE_STATUS_PATH, 'utf8')); } catch { return { running: false }; }
}

function writeNukeStatus(status) {
    fs.writeFileSync(NUKE_STATUS_PATH, JSON.stringify(status, null, 2));
}

let nukeInProgress = false;
async function runNuke(resources) {
    if (nukeInProgress) return;
    nukeInProgress = true;
    const startedAt = new Date().toISOString();
    let deleted = 0, lastRg = null, error = null;
    writeNukeStatus({ running: true, startedAt, deleted, lastRg, error });
    try {
        for await (const rg of resources.resourceGroups.list()) {
            lastRg = rg.name;
            writeNukeStatus({ running: true, startedAt, deleted, lastRg, error });
            console.log(`[NUKE] Deleting RG: ${rg.name}`);
            await resources.resourceGroups.beginDelete(rg.name);
            deleted++;
            writeNukeStatus({ running: true, startedAt, deleted, lastRg, error });
        }
    } catch (e) {
        error = e.message || String(e);
        console.error('[NUKE] Error:', e);
    } finally {
        nukeInProgress = false;
        writeNukeStatus({ running: false, startedAt, finishedAt: new Date().toISOString(), deleted, lastRg, error });
    }
}

// --- Azure Clients (per account) ---
const _clientsCache = {};

function buildProxyAgent(socks5Url) {
    if (!socks5Url) return undefined;
    const agent = new SocksProxyAgent(socks5Url);
    return {
        httpAgent: agent,
        httpsAgent: agent,
        proxyOptions: {
            customAgent: agent
        }
    };
}

function getClientsForAccount(account) {
    if (!account || !account.credentials) return null;
    const cacheKey = account.id;

    // Invalidate cache if socks5 changed
    if (_clientsCache[cacheKey] && _clientsCache[cacheKey]._socks5 !== (account.socks5 || '')) {
        delete _clientsCache[cacheKey];
    }

    if (_clientsCache[cacheKey]) return _clientsCache[cacheKey];

    try {
        const key = account.credentials;
        const proxyParts = buildProxyAgent(account.socks5);

        const credentialOptions = {};
        const clientOptions = {};

        if (proxyParts) {
            const proxyPolicy = {
                name: 'socksProxyPolicy',
                sendRequest: (request, next) => {
                    request.agent = proxyParts.httpAgent;
                    return next(request);
                }
            };
            clientOptions.additionalPolicies = [{ policy: proxyPolicy, position: 'perCall' }];
            credentialOptions.additionalPolicies = [{ policy: proxyPolicy, position: 'perCall' }];
        }

        const credential = new ClientSecretCredential(key.tenantId, key.clientId, key.clientSecret, credentialOptions);
        const subId = key.subscriptionId;

        // Clear empty proxy env vars that confuse Azure SDK
        for (const k of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy']) {
            if (process.env[k] === '') delete process.env[k];
        }

        _clientsCache[cacheKey] = {
            _socks5: account.socks5 || '',
            subscriptionId: subId,
            compute: new ComputeManagementClient(credential, subId, clientOptions),
            network: new NetworkManagementClient(credential, subId, clientOptions),
            resources: new ResourceManagementClient(credential, subId, clientOptions),
            subscriptions: new SubscriptionClient(credential, clientOptions),
            cognitive: new CognitiveServicesManagementClient(credential, subId, clientOptions),
            credential
        };
        return _clientsCache[cacheKey];
    } catch (e) {
        console.error('Failed to load Azure clients for account:', account.name, e.message);
        return null;
    }
}

function invalidateClientCache(accountId) {
    delete _clientsCache[accountId];
}

// --- Middleware ---
const AUTH_COOKIE_NAME = 'azure_auth';

app.post('/api/login', (req, res) => {
    const { password } = req.body;
    const config = getConfig();
    if (password === config.password) {
        res.cookie(AUTH_COOKIE_NAME, 'valid', { httpOnly: false, maxAge: 30 * 24 * 60 * 60 * 1000 });
        res.json({ success: true });
    } else {
        res.json({ success: false, error: 'Password Incorrect' });
    }
});

app.use('/api', (req, res, next) => {
    if (req.path === '/login') return next();
    if (req.cookies[AUTH_COOKIE_NAME] === 'valid') return next();
    res.status(401).json({ error: 'Unauthorized' });
});

// Resolve current account from header
function resolveAccount(req) {
    const accountId = req.headers['x-account-id'];
    if (!accountId) return null;
    const accounts = getAccounts();
    return accounts.find(a => a.id === accountId) || null;
}

function requireAzure(req, res, next) {
    const account = resolveAccount(req);
    if (!account) return res.status(400).json({ error: 'No account selected. Please select an account first.' });
    const clients = getClientsForAccount(account);
    if (!clients) return res.status(503).json({ error: 'Azure Credentials invalid for this account.' });
    req.azure = clients;
    req.account = account;
    next();
}

// ==================== Account API ====================

app.get('/api/accounts', (req, res) => {
    const accounts = getAccounts();
    // Don't expose credentials to frontend
    const safe = accounts.map(a => ({
        id: a.id,
        name: a.name,
        remark: a.remark || '',
        socks5: a.socks5 || '',
        subscriptionId: a.credentials?.subscriptionId || '',
        createdAt: a.createdAt
    }));
    res.json({ success: true, accounts: safe });
});

app.get('/api/accounts/:id', (req, res) => {
    const accounts = getAccounts();
    const a = accounts.find(x => x.id === req.params.id);
    if (!a) return res.status(404).json({ error: 'Account not found' });
    res.json({ success: true, account: { id: a.id, name: a.name, remark: a.remark || '', socks5: a.socks5 || '', credentials: JSON.stringify(a.credentials, null, 2) } });
});

app.post('/api/accounts', (req, res) => {
    const { name, remark, credentials, socks5 } = req.body;
    if (!name) return res.status(400).json({ error: 'Account name is required' });

    let parsedCreds;
    try {
        parsedCreds = typeof credentials === 'string' ? JSON.parse(credentials) : credentials;
        if (!parsedCreds.clientId || !parsedCreds.clientSecret || !parsedCreds.tenantId || !parsedCreds.subscriptionId) {
            throw new Error('Missing fields');
        }
    } catch (e) {
        return res.status(400).json({ error: 'Invalid credentials: ' + e.message });
    }

    const accounts = getAccounts();
    const account = {
        id: Date.now().toString(),
        name,
        remark: remark || '',
        credentials: parsedCreds,
        socks5: socks5 || '',
        createdAt: new Date().toISOString()
    };
    accounts.push(account);
    saveAccounts(accounts);
    res.json({ success: true, account: { id: account.id, name: account.name, remark: account.remark, socks5: account.socks5, subscriptionId: parsedCreds.subscriptionId, createdAt: account.createdAt } });
});

app.put('/api/accounts/:id', (req, res) => {
    const accounts = getAccounts();
    const idx = accounts.findIndex(a => a.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Account not found' });

    const { name, remark, credentials, socks5 } = req.body;
    if (name !== undefined) accounts[idx].name = name;
    if (remark !== undefined) accounts[idx].remark = remark;
    if (socks5 !== undefined) accounts[idx].socks5 = socks5;
    if (credentials) {
        try {
            const parsed = typeof credentials === 'string' ? JSON.parse(credentials) : credentials;
            if (!parsed.clientId || !parsed.clientSecret || !parsed.tenantId || !parsed.subscriptionId) throw new Error('Missing fields');
            accounts[idx].credentials = parsed;
        } catch (e) {
            return res.status(400).json({ error: 'Invalid credentials: ' + e.message });
        }
    }

    invalidateClientCache(req.params.id);
    saveAccounts(accounts);
    res.json({ success: true });
});

app.delete('/api/accounts/:id', (req, res) => {
    let accounts = getAccounts();
    accounts = accounts.filter(a => a.id !== req.params.id);
    invalidateClientCache(req.params.id);
    saveAccounts(accounts);
    res.json({ success: true });
});

// Test account connectivity (with socks5 proxy)
// Test SOCKS5 proxy - returns the proxy's outbound IP
app.post('/api/socks5/test', async (req, res) => {
    const { socks5 } = req.body;
    if (!socks5) return res.status(400).json({ error: 'No SOCKS5 URL provided' });
    try {
        const agent = new SocksProxyAgent(socks5);
        const resp = await new Promise((resolve, reject) => {
            https.get('https://api.ipify.org?format=json', { agent }, (r) => {
                let data = '';
                r.on('data', c => data += c);
                r.on('end', () => resolve(data));
            }).on('error', reject);
        });
        const { ip } = JSON.parse(resp);
        res.json({ success: true, ip });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// ==================== System API ====================

app.get('/api/status', (req, res) => {
    const account = resolveAccount(req);
    if (!account) {
        const accounts = getAccounts();
        return res.json({ ready: false, subscriptionId: null, accountCount: accounts.length });
    }
    const clients = getClientsForAccount(account);
    res.json({ ready: !!clients, subscriptionId: clients ? clients.subscriptionId : null });
});

app.post('/api/setup/password', (req, res) => {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 5) return res.status(400).json({ error: 'Too short' });
    saveConfig({ password: newPassword });
    res.json({ success: true });
});

// ==================== Azure Instance API ====================

app.get('/api/instances', requireAzure, async (req, res) => {
    try {
        const { compute, network } = req.azure;
        const vms = [];
        for await (const vm of compute.virtualMachines.listAll()) {
            let publicIp = 'Fetching...', publicIpV6 = 'None';
            if (vm.networkProfile && vm.networkProfile.networkInterfaces.length > 0) {
                const nicRef = vm.networkProfile.networkInterfaces[0];
                const rgName = nicRef.id.split('/')[4];
                const nicName = nicRef.id.split('/').pop();
                try {
                    const nic = await network.networkInterfaces.get(rgName, nicName);
                    if (nic.ipConfigurations) {
                        for (const config of nic.ipConfigurations) {
                            if (config.publicIPAddress) {
                                const pipId = config.publicIPAddress.id;
                                const pipName = pipId.split('/').pop();
                                const pipRg = pipId.split('/')[4];
                                const pip = await network.publicIPAddresses.get(pipRg, pipName);
                                if ((pip.publicIPAddressVersion && pip.publicIPAddressVersion.toLowerCase() === 'ipv6') ||
                                    (pip.sku && pip.sku.name === 'Standard' && pipName.includes('v6'))) {
                                    publicIpV6 = pip.ipAddress || 'Allocating...';
                                } else if (!pip.publicIPAddressVersion || pip.publicIPAddressVersion.toLowerCase() === 'ipv4') {
                                    publicIp = pip.ipAddress || 'Allocating...';
                                }
                            }
                        }
                    }
                } catch (e) { console.warn(`Failed to fetch NIC ${nicName}`, e.message); }
            }
            vms.push({
                name: vm.name, location: vm.location, publicIp, publicIpV6,
                privateIp: 'Hidden', provisioningState: vm.provisioningState,
                size: vm.hardwareProfile?.vmSize, resourceGroup: vm.id.split('/')[4]
            });
        }
        res.json({ success: true, instances: vms });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

async function ensureInfrastructure(azure, location, enableIPv6 = false) {
    const { resources, network } = azure;
    const rgName = 'AzurePanel-RG';
    const vnetName = `vnet-${location}`;
    const subnetName = 'default';
    const nsgName = `nsg-${location}`;
    try {
        if (!(await resources.resourceGroups.checkExistence(rgName)).body) {
            await resources.resourceGroups.createOrUpdate(rgName, { location });
        }
        const nsgParams = {
            location,
            securityRules: [
                { name: 'Allow-All-Inbound', protocol: '*', sourcePortRange: '*', destinationPortRange: '*', sourceAddressPrefix: '*', destinationAddressPrefix: '*', access: 'Allow', priority: 1000, direction: 'Inbound' },
                { name: 'Allow-All-Inbound-v6', protocol: '*', sourcePortRange: '*', destinationPortRange: '*', sourceAddressPrefix: '*', destinationAddressPrefix: '*', access: 'Allow', priority: 1001, direction: 'Inbound' }
            ]
        };
        const nsgPoller = await network.networkSecurityGroups.beginCreateOrUpdate(rgName, nsgName, nsgParams);
        const nsg = await nsgPoller.pollUntilDone();
        let vnetParams = {
            location,
            addressSpace: { addressPrefixes: ['10.0.0.0/16'] },
            subnets: [{ name: subnetName, addressPrefix: '10.0.0.0/24', networkSecurityGroup: { id: nsg.id } }]
        };
        if (enableIPv6) {
            vnetParams.addressSpace.addressPrefixes.push('ace:cab:deca::/48');
            vnetParams.subnets[0].addressPrefixes = ['10.0.0.0/24', 'ace:cab:deca::/64'];
            delete vnetParams.subnets[0].addressPrefix;
        }
        const vnetPoller = await network.virtualNetworks.beginCreateOrUpdate(rgName, vnetName, vnetParams);
        await vnetPoller.pollUntilDone();
        return { rgName, subnetId: `/subscriptions/${azure.subscriptionId}/resourceGroups/${rgName}/providers/Microsoft.Network/virtualNetworks/${vnetName}/subnets/${subnetName}`, location };
    } catch (e) { throw new Error(`Infra failed: ${e.message}`); }
}

app.post('/api/instances/create', requireAzure, async (req, res) => {
    const { name, location, size, image, username, password, spot, ipv6 } = req.body;
    const { compute, network } = req.azure;
    if (!name || !location) return res.status(400).json({ error: 'Missing name/location' });
    try {
        const infra = await ensureInfrastructure(req.azure, location, ipv6);
        const pipName = `${name}-pip`;
        const pipPoller = await network.publicIPAddresses.beginCreateOrUpdate(infra.rgName, pipName, { location, publicIPAllocationMethod: 'Static', sku: { name: 'Standard' } });
        const pip = await pipPoller.pollUntilDone();
        let pipV6 = null;
        if (ipv6) {
            const pipV6Poller = await network.publicIPAddresses.beginCreateOrUpdate(infra.rgName, `${name}-pip-v6`, { location, publicIPAllocationMethod: 'Static', publicIPAddressVersion: 'IPv6', sku: { name: 'Standard' } });
            pipV6 = await pipV6Poller.pollUntilDone();
        }
        const nicName = `${name}-nic`;
        const nicParams = { location, ipConfigurations: [{ name: 'ipconfig1', subnet: { id: infra.subnetId }, publicIPAddress: { id: pip.id }, privateIPAllocationMethod: 'Dynamic', primary: true }] };
        if (pipV6) {
            nicParams.ipConfigurations.push({ name: 'ipconfig-v6', subnet: { id: infra.subnetId }, publicIPAddress: { id: pipV6.id }, privateIPAddressVersion: 'IPv6', privateIPAllocationMethod: 'Dynamic' });
        }
        const nicPoller = await network.networkInterfaces.beginCreateOrUpdate(infra.rgName, nicName, nicParams);
        const nic = await nicPoller.pollUntilDone();
        const defaultImage = { publisher: 'Canonical', offer: '0001-com-ubuntu-server-focal', sku: '20_04-lts-gen2', version: 'latest' };
        const vmParams = {
            location,
            hardwareProfile: { vmSize: size || 'Standard_B1s' },
            storageProfile: { imageReference: image || defaultImage, osDisk: { createOption: 'FromImage', managedDisk: { storageAccountType: 'StandardSSD_LRS' }, diskSizeGB: 64, deleteOption: 'Delete' } },
            osProfile: { computerName: name, adminUsername: username || 'azureuser', adminPassword: password },
            networkProfile: { networkInterfaces: [{ id: nic.id, deleteOption: 'Delete' }] },
            priority: spot ? 'Spot' : 'Regular',
            evictionPolicy: spot ? 'Deallocate' : undefined,
            billingProfile: spot ? { maxPrice: -1 } : undefined
        };
        await compute.virtualMachines.beginCreateOrUpdate(infra.rgName, name, vmParams);
        res.json({ success: true, message: 'Creating VM...', operation: 'create' });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.delete('/api/nuke', requireAzure, async (req, res) => {
    try {
        if (nukeInProgress) { return res.json({ success: true, message: 'NUKE already running.', status: readNukeStatus() }); }
        runNuke(req.azure.resources);
        res.json({ success: true, message: 'NUKE started in background.' });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/instances/:action', requireAzure, async (req, res) => {
    const { action } = req.params;
    const { name, resourceGroup } = req.body;
    const { compute, network } = req.azure;
    if (!name || !resourceGroup) return res.status(400).json({ error: 'Missing name or RG' });
    try {
        if (action === 'start') {
            await compute.virtualMachines.beginStart(resourceGroup, name);
        } else if (action === 'stop') {
            await compute.virtualMachines.beginDeallocate(resourceGroup, name);
        } else if (action === 'delete') {
            await compute.virtualMachines.beginDelete(resourceGroup, name);
        } else if (action === 'change-ipv4' || action === 'change-ipv6') {
            const isV6 = action === 'change-ipv6';
            const vm = await compute.virtualMachines.get(resourceGroup, name);
            if (!vm.networkProfile || !vm.networkProfile.networkInterfaces[0]) throw new Error('VM has no NIC');
            const nicId = vm.networkProfile.networkInterfaces[0].id;
            const nicName = nicId.split('/').pop();
            const nic = await network.networkInterfaces.get(resourceGroup, nicName);
            const ipConfig = isV6
                ? nic.ipConfigurations.find(c => c.privateIPAddressVersion === 'IPv6')
                : nic.ipConfigurations.find(c => !c.privateIPAddressVersion || c.privateIPAddressVersion === 'IPv4');
            if (!ipConfig) throw new Error(`No ${isV6 ? 'IPv6' : 'IPv4'} config found`);
            const oldPipId = ipConfig.publicIPAddress ? ipConfig.publicIPAddress.id : null;
            const newPipName = `${name}-pip${isV6 ? '-v6' : ''}-${Date.now().toString().slice(-4)}`;
            const pipParams = { location: vm.location, publicIPAllocationMethod: 'Static', sku: { name: 'Standard' } };
            if (isV6) pipParams.publicIPAddressVersion = 'IPv6';
            const pipPoller = await network.publicIPAddresses.beginCreateOrUpdate(resourceGroup, newPipName, pipParams);
            const newPip = await pipPoller.pollUntilDone();
            ipConfig.publicIPAddress = { id: newPip.id };
            const nicPoller = await network.networkInterfaces.beginCreateOrUpdate(resourceGroup, nicName, nic);
            await nicPoller.pollUntilDone();
            if (oldPipId) network.publicIPAddresses.beginDelete(resourceGroup, oldPipId.split('/').pop()).catch(e => console.error(e));
            return res.json({ success: true, message: `${isV6 ? 'IPv6' : 'IPv4'} Changed: ${newPip.ipAddress}`, newIp: newPip.ipAddress });
        } else {
            return res.status(400).json({ error: 'Unknown action' });
        }
        if (!action.includes('change-ip')) {
            res.json({ success: true, message: `${action} command sent` });
        }
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ==================== Azure AI Foundry API ====================

// List all AI Foundry/CognitiveServices accounts
app.get('/api/openai/accounts', requireAzure, async (req, res) => {
    try {
        const { cognitive } = req.azure;
        const accounts = [];
        for await (const acct of cognitive.accounts.list()) {
            accounts.push({
                id: acct.id,
                name: acct.name,
                kind: acct.kind,
                location: acct.location,
                sku: acct.sku?.name,
                endpoint: acct.properties?.endpoint,
                provisioningState: acct.properties?.provisioningState,
                resourceGroup: acct.id.split('/')[4]
            });
        }
        res.json({ success: true, accounts });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Create AI Foundry resource (REST API — SDK poll is unreliable for AIServices)
app.post('/api/openai/accounts', requireAzure, async (req, res) => {
    const { name, location, resourceGroup } = req.body;
    if (!name || !location) return res.status(400).json({ error: 'Missing name or location' });
    const { resources, credential, subscriptionId } = req.azure;
    const rgName = resourceGroup || 'AzurePanel-RG';
    try {
        if (!(await resources.resourceGroups.checkExistence(rgName)).body) {
            await resources.resourceGroups.createOrUpdate(rgName, { location });
        }
        const token = await credential.getToken('https://management.azure.com/.default');
        const url = `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${rgName}/providers/Microsoft.CognitiveServices/accounts/${name}?api-version=2024-10-01`;
        const resp = await fetch(url, {
            method: 'PUT',
            headers: { 'Authorization': 'Bearer ' + token.token, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                kind: 'AIServices',
                sku: { name: 'S0' },
                location,
                properties: { customSubDomainName: name, publicNetworkAccess: 'Enabled' }
            })
        });
        const data = await resp.json();
        if (data.error) return res.status(500).json({ success: false, error: data.error.message });
        // Poll until Succeeded (up to 30s)
        for (let i = 0; i < 6; i++) {
            await new Promise(r => setTimeout(r, 5000));
            const check = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token.token } });
            const acct = await check.json();
            if (acct.properties?.provisioningState === 'Succeeded') {
                return res.json({ success: true, message: `AI Foundry resource "${name}" created.` });
            }
        }
        res.json({ success: true, message: `AI Foundry resource "${name}" creation started. Please refresh to check.` });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Delete AI Foundry resource (auto-delete nested projects first, cleanup empty RG)
app.delete('/api/openai/accounts/:rg/:name', requireAzure, async (req, res) => {
    try {
        const { rg, name } = req.params;
        const resClient = req.azure.resources;
        // Get location before deletion for purge
        let location;
        try { const acct = await req.azure.cognitive.accounts.get(rg, name); location = acct.location; } catch (_) {}
        // Delete nested projects first (required for Foundry resources)
        try {
            const parentId = `/subscriptions/${req.azure.subscriptionId}/resourceGroups/${rg}/providers/Microsoft.CognitiveServices/accounts/${name}`;
            for await (const r of resClient.resources.listByResourceGroup(rg)) {
                if (r.id && r.id.startsWith(parentId + '/') && r.type?.includes('/projects')) {
                    await resClient.resources.beginDeleteById(r.id, '2025-06-01').then(p => p.pollUntilDone());
                }
            }
        } catch (_) {}
        const poller = await req.azure.cognitive.accounts.beginDelete(rg, name);
        await poller.pollUntilDone();
        // Purge soft-deleted resource to free quota
        if (location) {
            try {
                const token = await req.azure.credential.getToken('https://management.azure.com/.default');
                await fetch(`https://management.azure.com/subscriptions/${req.azure.subscriptionId}/providers/Microsoft.CognitiveServices/locations/${location}/resourceGroups/${rg}/deletedAccounts/${name}?api-version=2024-10-01`, {
                    method: 'DELETE', headers: { 'Authorization': 'Bearer ' + token.token }
                });
            } catch (_) {}
        }
        // Cleanup: delete RG if empty
        try {
            let hasResources = false;
            for await (const _ of resClient.resources.listByResourceGroup(rg)) { hasResources = true; break; }
            if (!hasResources) await resClient.resourceGroups.beginDelete(rg).then(p => p.pollUntilDone());
        } catch (_) {}
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Get API Keys
app.get('/api/openai/accounts/:rg/:name/keys', requireAzure, async (req, res) => {
    try {
        const keys = await req.azure.cognitive.accounts.listKeys(req.params.rg, req.params.name);
        res.json({ success: true, key1: keys.key1, key2: keys.key2 });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// List deployments (models) for an AI Foundry resource
app.get('/api/openai/accounts/:rg/:name/deployments', requireAzure, async (req, res) => {
    try {
        const account = await req.azure.cognitive.accounts.get(req.params.rg, req.params.name);
        const base = (account.properties?.endpoint || '').replace(/\/+$/, '');
        const responsesEndpoint = `${base}/openai/responses?api-version=2025-04-01-preview`;
        const deployments = [];
        for await (const d of req.azure.cognitive.deployments.list(req.params.rg, req.params.name)) {
            deployments.push({
                name: d.name,
                model: d.properties?.model?.format + '/' + d.properties?.model?.name,
                modelVersion: d.properties?.model?.version,
                scaleType: d.sku?.name,
                capacity: d.sku?.capacity,
                provisioningState: d.properties?.provisioningState,
                endpoint: responsesEndpoint
            });
        }
        res.json({ success: true, deployments });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Deploy a model
app.post('/api/openai/accounts/:rg/:name/deployments', requireAzure, async (req, res) => {
    const { deploymentName, modelName, modelVersion, capacity, skuName } = req.body;
    if (!deploymentName || !modelName) return res.status(400).json({ error: 'Missing deploymentName or modelName' });
    try {
        let version = modelVersion;
        if (!version) {
            // Auto-resolve latest version from resource location
            const account = await req.azure.cognitive.accounts.get(req.params.rg, req.params.name);
            const location = account.location;
            const token = await req.azure.credential.getToken('https://management.azure.com/.default');
            const resp = await fetch(`https://management.azure.com/subscriptions/${req.azure.subscriptionId}/providers/Microsoft.CognitiveServices/locations/${location}/models?api-version=2025-06-01`, { headers: { Authorization: 'Bearer ' + token.token } });
            const data = await resp.json();
            const matches = (data.value || []).filter(m => m.model?.name === modelName).sort((a, b) => (b.model?.version || '').localeCompare(a.model?.version || ''));
            version = matches[0]?.model?.version || '';
        }
        const poller = await req.azure.cognitive.deployments.beginCreateOrUpdate(req.params.rg, req.params.name, deploymentName, {
            sku: { name: skuName || 'Standard', capacity: capacity || 1 },
            properties: {
                model: { format: 'OpenAI', name: modelName, version }
            }
        });
        await poller.pollUntilDone();
        res.json({ success: true, message: `Model "${modelName}" deployed as "${deploymentName}".` });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Delete deployment
app.delete('/api/openai/accounts/:rg/:name/deployments/:dname', requireAzure, async (req, res) => {
    try {
        const poller = await req.azure.cognitive.deployments.beginDelete(req.params.rg, req.params.name, req.params.dname);
        await poller.pollUntilDone();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// List quotas/usages for a location
app.get('/api/openai/quotas/:location', requireAzure, async (req, res) => {
    try {
        const token = await req.azure.credential.getToken('https://management.azure.com/.default');
        const baseUrl = `https://management.azure.com/subscriptions/${req.azure.subscriptionId}/providers/Microsoft.CognitiveServices/locations/${req.params.location}/usages?api-version=2024-10-01`;
        let all = [], url = baseUrl;
        while (url) {
            const resp = await fetch(url, { headers: { Authorization: 'Bearer ' + token.token } });
            const data = await resp.json();
            if (data.error) return res.status(500).json({ success: false, error: data.error.message });
            all = all.concat(data.value || []);
            url = data.nextLink || null;
        }
        const quotas = all
            .filter(q => (q.limit > 0 || q.currentValue > 0) && q.name?.localizedValue?.includes('Tokens Per Minute'))
            .map(q => {
                // Parse SKU and model from name like "OpenAI.GlobalStandard.gpt-4o"
                const parts = q.name?.value?.split('.') || [];
                const sku = parts[1] || 'Standard';
                const model = parts.slice(2).join('.') || parts[parts.length - 1] || 'unknown';
                return { model, sku, used: q.currentValue, limit: q.limit };
            });
        res.json({ success: true, quotas });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Subscription info
app.get('/api/subscription', requireAzure, async (req, res) => {
    try {
        const token = await req.azure.credential.getToken('https://management.azure.com/.default');
        const headers = { Authorization: 'Bearer ' + token.token, 'Content-Type': 'application/json' };
        const sub = await (await fetch(`https://management.azure.com/subscriptions/${req.azure.subscriptionId}?api-version=2022-12-01`, { headers })).json();
        const costResp = await fetch(`https://management.azure.com/subscriptions/${req.azure.subscriptionId}/providers/Microsoft.CostManagement/query?api-version=2023-11-01`, {
            method: 'POST', headers,
            body: JSON.stringify({ type: 'ActualCost', timeframe: 'BillingMonthToDate', dataset: { granularity: 'None', aggregation: { totalCost: { name: 'Cost', function: 'Sum' } } } })
        });
        const costData = await costResp.json();
        const monthCost = costData.properties?.rows?.[0]?.[0] || 0;
        const currency = costData.properties?.rows?.[0]?.[1] || 'USD';
        const promo = sub.promotions?.[0];
        const quotaId = sub.subscriptionPolicies?.quotaId || '';
        let totalCredit = '';
        if (quotaId.includes('Students')) totalCredit = '$100';
        else if (quotaId.includes('FreeTrial')) totalCredit = '$200';
        res.json({
            success: true,
            name: sub.displayName,
            state: sub.state,
            spendingLimit: sub.subscriptionPolicies?.spendingLimit,
            totalCredit,
            expiresAt: promo?.endDateTime || '',
            monthCost: Math.round(monthCost * 100) / 100,
            currency
        });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

process.on('uncaughtException', (err) => { console.error('[CRITICAL] Uncaught Exception:', err); });
process.on('unhandledRejection', (reason) => { console.error('[CRITICAL] Unhandled Rejection:', reason); });

const server = app.listen(port, '0.0.0.0', () => {
    console.log(`Azure Panel running at http://localhost:${port}`);
});
server.on('error', (err) => { console.error('[CRITICAL] Server listen error:', err); });
