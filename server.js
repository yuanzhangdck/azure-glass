const express = require('express');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const { ClientSecretCredential } = require('@azure/identity');
const { ComputeManagementClient } = require('@azure/arm-compute');
const { NetworkManagementClient } = require('@azure/arm-network');
const { ResourceManagementClient } = require('@azure/arm-resources');
const { SubscriptionClient } = require('@azure/arm-subscriptions');
const path = require('path');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000; // Honor platform-provided port if present

app.use(bodyParser.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// --- Config & Data ---
const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const KEY_PATH = path.join(DATA_DIR, 'azure-key.json');
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

function readNukeStatus() {
    if (!fs.existsSync(NUKE_STATUS_PATH)) {
        return { running: false };
    }
    try {
        return JSON.parse(fs.readFileSync(NUKE_STATUS_PATH, 'utf8'));
    } catch {
        return { running: false };
    }
}

function writeNukeStatus(status) {
    fs.writeFileSync(NUKE_STATUS_PATH, JSON.stringify(status, null, 2));
}

let nukeInProgress = false;
async function runNuke(resources) {
    if (nukeInProgress) return;
    nukeInProgress = true;

    const startedAt = new Date().toISOString();
    let deleted = 0;
    let lastRg = null;
    let error = null;

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
        writeNukeStatus({
            running: false,
            startedAt,
            finishedAt: new Date().toISOString(),
            deleted,
            lastRg,
            error
        });
    }
}

// --- Azure Clients ---
let _clients = null;

function getClients() {
    if (_clients && _clients.subscriptionId) return _clients;
    if (!fs.existsSync(KEY_PATH)) return null;

    try {
        const key = JSON.parse(fs.readFileSync(KEY_PATH, 'utf8'));
        // Standard SP structure
        const credential = new ClientSecretCredential(key.tenantId, key.clientId, key.clientSecret);
        const subId = key.subscriptionId;

        _clients = {
            subscriptionId: subId,
            compute: new ComputeManagementClient(credential, subId),
            network: new NetworkManagementClient(credential, subId),
            resources: new ResourceManagementClient(credential, subId),
            subscriptions: new SubscriptionClient(credential),
            credential // needed for some specialized clients
        };
        return _clients;
    } catch (e) {
        console.error('Failed to load Azure clients:', e.message);
        return null;
    }
}

function resetClients() { _clients = null; }

// --- Middleware ---
const AUTH_COOKIE_NAME = 'azure_auth';

// Login
app.post('/api/login', (req, res) => {
    const { password } = req.body;
    const config = getConfig();
    if (password === config.password) {
        // Set Cookie for 30 days
        res.cookie(AUTH_COOKIE_NAME, 'valid', { httpOnly: false, maxAge: 30 * 24 * 60 * 60 * 1000 });
        res.json({ success: true });
    } else {
        res.json({ success: false, error: 'Password Incorrect' });
    }
});

// Auth Check
app.use('/api', (req, res, next) => {
    if (req.path === '/login') return next();
    if (req.cookies[AUTH_COOKIE_NAME] === 'valid') return next();
    res.status(401).json({ error: 'Unauthorized' });
});

// Require Azure Ready
function requireAzure(req, res, next) {
    const clients = getClients();
    if (!clients) return res.status(503).json({ error: 'Azure Credentials not configured' });
    req.azure = clients;
    next();
}

// --- System API ---
app.get('/api/status', (req, res) => {
    const clients = getClients();
    res.json({ ready: !!clients, subscriptionId: clients ? clients.subscriptionId : null });
});

app.post('/api/setup/key', (req, res) => {
    try {
        const keyObj = JSON.parse(req.body.key);
        // Basic validation
        if (!keyObj.clientId || !keyObj.clientSecret || !keyObj.tenantId || !keyObj.subscriptionId) {
            throw new Error('Missing fields. Required: clientId, clientSecret, tenantId, subscriptionId');
        }
        fs.writeFileSync(KEY_PATH, JSON.stringify(keyObj, null, 2));
        resetClients();
        res.json({ success: true });
    } catch (e) {
        res.status(400).json({ success: false, error: e.message });
    }
});

app.post('/api/setup/password', (req, res) => {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 5) return res.status(400).json({ error: 'Too short' });
    saveConfig({ password: newPassword });
    res.json({ success: true });
});

// --- Azure API Implementation ---

// 1. List VMs
app.get('/api/instances', requireAzure, async (req, res) => {
    try {
        const { compute, network } = req.azure;
        const vms = [];
        
        // List all VMs in subscription (across all RGs)
        for await (const vm of compute.virtualMachines.listAll()) {
            // Get IP info (requires fetching NIC)
            let publicIp = 'Fetching...';
            let publicIpV6 = 'None';
            
            if (vm.networkProfile && vm.networkProfile.networkInterfaces.length > 0) {
                const nicRef = vm.networkProfile.networkInterfaces[0];
                const rgName = nicRef.id.split('/')[4];
                const nicName = nicRef.id.split('/').pop();
                
                try {
                    const nic = await network.networkInterfaces.get(rgName, nicName);
                    
                    if (nic.ipConfigurations) {
                        for (const config of nic.ipConfigurations) {
                            if (config.publicIPAddress) {
                                // Fetch PIP
                                const pipId = config.publicIPAddress.id;
                                const pipName = pipId.split('/').pop();
                                const pipRg = pipId.split('/')[4];
                                const pip = await network.publicIPAddresses.get(pipRg, pipName);
                                
                                console.log(`[DEBUG] Found PIP ${pipName}, Version: ${pip?.publicIPAddressVersion}`);
                                
                                // Loose check for IPv6
                                if ((pip.publicIPAddressVersion && pip.publicIPAddressVersion.toLowerCase() === 'ipv6') || 
                                    (pip.sku && pip.sku.name === 'Standard' && pipName.includes('v6'))) {
                                    publicIpV6 = pip.ipAddress || 'Allocating...';
                                } else if (!pip.publicIPAddressVersion || pip.publicIPAddressVersion.toLowerCase() === 'ipv4') {
                                    publicIp = pip.ipAddress || 'Allocating...';
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.warn(`Failed to fetch NIC ${nicName}`, e.message);
                }
            }

            vms.push({
                name: vm.name,
                location: vm.location,
                // ... other fields
                publicIp,
                publicIpV6, // Send v6
                privateIp: 'Hidden', // Don't need private anymore
                provisioningState: vm.provisioningState,
                size: vm.hardwareProfile?.vmSize,
                resourceGroup: vm.id.split('/')[4]
            });
        }
        
        res.json({ success: true, instances: vms });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// 2. List SKUs (Quota Radar)
app.get('/api/skus', requireAzure, async (req, res) => {
    try {
        const { compute, subscriptionId } = req.azure;
        // This is a heavy call, lists ALL SKUs for the sub. Should cache in prod.
        const skus = [];
        // Target specific sizes to save bandwidth processing
        const requestedSize = (req.query.size || '').toString().trim();
        const targetSizes = requestedSize
            ? [requestedSize.toLowerCase()]
            : ['standard_b1s', 'standard_b2s', 'standard_b2pts_v2', 'standard_b2ats_v2'];
        
        console.log('[DEBUG] Starting SKU list...');
        let count = 0;
        for await (const sku of compute.resourceSkus.list()) {
            if (sku.resourceType === 'virtualMachines' && targetSizes.includes(sku.name.toLowerCase())) {
                count++;
                
                const restrictedLocs = [];
                if (sku.restrictions) {
                    for (const r of sku.restrictions) {
                        if (r.type === 'Location') {
                            restrictedLocs.push(...(r.values || []));
                        }
                    }
                }

                skus.push({
                    name: sku.name, 
                    locations: sku.locations, 
                    restrictedLocations: restrictedLocs,
                    tier: sku.tier
                });
            }
        }
        console.log(`[DEBUG] Found ${count} SKU entries matching targets.`);
        res.json({ success: true, skus });
    } catch (e) {
        console.error('[DEBUG] SKU List Error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// --- Helpers ---

// Auto-build Infrastructure (RG, VNet, Subnet, NSG)
async function ensureInfrastructure(azure, location, enableIPv6 = false) {
    const { resources, network } = azure;
    const rgName = 'AzurePanel-RG';
    const vnetName = `vnet-${location}`;
    const subnetName = 'default';
    const nsgName = `nsg-${location}`;

    try {
        // 1. Ensure Resource Group
        if (!(await resources.resourceGroups.checkExistence(rgName)).body) {
            console.log(`Creating RG: ${rgName}`);
            await resources.resourceGroups.createOrUpdate(rgName, { location });
        }

        // 2. Ensure NSG (Firewall)
        console.log(`Ensuring NSG: ${nsgName}`);
        const nsgParams = {
            location,
            securityRules: [
                {
                    name: 'Allow-All-Inbound',
                    protocol: '*',
                    sourcePortRange: '*',
                    destinationPortRange: '*',
                    sourceAddressPrefix: '*',
                    destinationAddressPrefix: '*',
                    access: 'Allow',
                    priority: 1000,
                    direction: 'Inbound'
                },
                {
                    name: 'Allow-All-Inbound-v6',
                    protocol: '*',
                    sourcePortRange: '*',
                    destinationPortRange: '*',
                    sourceAddressPrefix: '*', // In v6 rules this means any
                    destinationAddressPrefix: '*',
                    access: 'Allow',
                    priority: 1001,
                    direction: 'Inbound'
                }
            ]
        };
        const nsgPoller = await network.networkSecurityGroups.beginCreateOrUpdate(rgName, nsgName, nsgParams);
        const nsg = await nsgPoller.pollUntilDone();

        // 3. Ensure VNet & Subnet
        // We need to fetch existing VNet to see if we need to update for IPv6
        let vnetParams = {
            location,
            addressSpace: { addressPrefixes: ['10.0.0.0/16'] },
            subnets: [{
                name: subnetName,
                addressPrefix: '10.0.0.0/24',
                networkSecurityGroup: { id: nsg.id }
            }]
        };

        if (enableIPv6) {
            // Add IPv6 range
            vnetParams.addressSpace.addressPrefixes.push('ace:cab:deca::/48');
            vnetParams.subnets[0].addressPrefixes = ['10.0.0.0/24', 'ace:cab:deca::/64'];
            delete vnetParams.subnets[0].addressPrefix; // Use addressPrefixes for dual stack
        }

        console.log(`Ensuring VNet: ${vnetName} (IPv6: ${enableIPv6})`);
        const vnetPoller = await network.virtualNetworks.beginCreateOrUpdate(rgName, vnetName, vnetParams);
        await vnetPoller.pollUntilDone();

        return {
            rgName,
            subnetId: `/subscriptions/${azure.subscriptionId}/resourceGroups/${rgName}/providers/Microsoft.Network/virtualNetworks/${vnetName}/subnets/${subnetName}`,
            location
        };

    } catch (e) {
        console.error('Infrastructure Error:', e);
        throw new Error(`Infra failed: ${e.message}`);
    }
}

// Create Instance
app.post('/api/instances/create', requireAzure, async (req, res) => {
    const { name, location, size, image, username, password, spot, ipv6 } = req.body;
    const { compute, network } = req.azure;

    if (!name || !location) return res.status(400).json({ error: 'Missing name/location' });

    try {
        // 1. Prepare Infrastructure
        const infra = await ensureInfrastructure(req.azure, location, ipv6);
        
        // 2. Create Public IP (v4)
        const pipName = `${name}-pip`;
        const pipPoller = await network.publicIPAddresses.beginCreateOrUpdate(infra.rgName, pipName, {
            location,
            publicIPAllocationMethod: 'Static',
            sku: { name: 'Standard' }
        });
        const pip = await pipPoller.pollUntilDone();

        // 2b. Create Public IP (v6) if requested
        let pipV6 = null;
        if (ipv6) {
            const pipV6Name = `${name}-pip-v6`;
            const pipV6Poller = await network.publicIPAddresses.beginCreateOrUpdate(infra.rgName, pipV6Name, {
                location,
                publicIPAllocationMethod: 'Static',
                publicIPAddressVersion: 'IPv6',
                sku: { name: 'Standard' }
            });
            pipV6 = await pipV6Poller.pollUntilDone();
        }

        // 3. Create NIC
        const nicName = `${name}-nic`;
        const nicParams = {
            location,
            ipConfigurations: [{
                name: 'ipconfig1',
                subnet: { id: infra.subnetId },
                publicIPAddress: { id: pip.id },
                privateIPAllocationMethod: 'Dynamic',
                primary: true
            }]
        };

        if (pipV6) {
            nicParams.ipConfigurations.push({
                name: 'ipconfig-v6',
                subnet: { id: infra.subnetId },
                publicIPAddress: { id: pipV6.id },
                privateIPAddressVersion: 'IPv6',
                privateIPAllocationMethod: 'Dynamic'
            });
        }

        const nicPoller = await network.networkInterfaces.beginCreateOrUpdate(infra.rgName, nicName, nicParams);
        const nic = await nicPoller.pollUntilDone();

        // 4. Create VM
        // Default to Ubuntu 20 if no image provided
        const defaultImage = {
            publisher: 'Canonical',
            offer: '0001-com-ubuntu-server-focal',
            sku: '20_04-lts-gen2',
            version: 'latest'
        };

        const vmParams = {
            location,
            hardwareProfile: { vmSize: size || 'Standard_B1s' },
            storageProfile: {
                imageReference: image || defaultImage,
                osDisk: {
                    createOption: 'FromImage',
                    managedDisk: { storageAccountType: 'StandardSSD_LRS' },
                    diskSizeGB: 64, // Explicitly set to 64GB
                    deleteOption: 'Delete'
                }
            },
            osProfile: {
                computerName: name,
                adminUsername: username || 'azureuser',
                adminPassword: password, // Must be provided
            },
            networkProfile: {
                networkInterfaces: [{ id: nic.id, deleteOption: 'Delete' }] // Auto-delete NIC with VM
            },
            priority: spot ? 'Spot' : 'Regular',
            evictionPolicy: spot ? 'Deallocate' : undefined,
            billingProfile: spot ? { maxPrice: -1 } : undefined // -1 means current price
        };

        const vmPoller = await compute.virtualMachines.beginCreateOrUpdate(infra.rgName, name, vmParams);
        
        // Return immediately, let it run
        res.json({ success: true, message: 'Creating VM...', operation: 'create' });

    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// 3. List Resource Groups
app.get('/api/resourceGroups', requireAzure, async (req, res) => {
    try {
        const { resources } = req.azure;
        const rgs = [];
        for await (const rg of resources.resourceGroups.list()) {
            rgs.push({
                name: rg.name,
                location: rg.location,
                tags: rg.tags
            });
        }
        res.json({ success: true, resourceGroups: rgs });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Delete Resource Group
app.delete('/api/resourceGroups/:name', requireAzure, async (req, res) => {
    const { name } = req.params;
    const { resources } = req.azure;
    try {
        await resources.resourceGroups.beginDelete(name);
        res.json({ success: true, message: 'Resource Group deletion started' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Nuke All Resources
app.delete('/api/nuke', requireAzure, async (req, res) => {
    const { resources } = req.azure;
    try {
        if (nukeInProgress) {
            const status = readNukeStatus();
            return res.json({ success: true, message: 'NUKE already running.', status });
        }
        // Kick off background job (do not await)
        runNuke(resources);
        res.json({ success: true, message: 'NUKE started in background.' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/api/nuke/status', requireAzure, async (req, res) => {
    try {
        const status = readNukeStatus();
        res.json({ success: true, status });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Start/Stop/Delete/ChangeIP
app.post('/api/instances/:action', requireAzure, async (req, res) => {
    const { action } = req.params; // start, stop, delete, change-ip
    const { name, resourceGroup } = req.body;
    const { compute, network } = req.azure;

    if (!name || !resourceGroup) return res.status(400).json({ error: 'Missing name or RG' });

    try {
        let poller;
        if (action === 'start') {
            poller = await compute.virtualMachines.beginStart(resourceGroup, name);
        } else if (action === 'stop') {
            // Use Deallocate to stop billing
            poller = await compute.virtualMachines.beginDeallocate(resourceGroup, name);
        } else if (action === 'delete') {
            poller = await compute.virtualMachines.beginDelete(resourceGroup, name);
        } else if (action === 'change-ipv4') {
            // Change IPv4
            console.log(`[ChangeIP] Processing IPv4 swap for ${name}...`);

            // 1. Get VM -> NIC
            const vm = await compute.virtualMachines.get(resourceGroup, name);
            if (!vm.networkProfile || !vm.networkProfile.networkInterfaces[0]) throw new Error('VM has no NIC');
            const nicId = vm.networkProfile.networkInterfaces[0].id;
            const nicName = nicId.split('/').pop();
            const nic = await network.networkInterfaces.get(resourceGroup, nicName);

            // 2. Find v4 Config
            const ipConfig = nic.ipConfigurations.find(c => !c.privateIPAddressVersion || c.privateIPAddressVersion === 'IPv4');
            if (!ipConfig) throw new Error('No IPv4 config found');

            const oldPipId = ipConfig.publicIPAddress ? ipConfig.publicIPAddress.id : null;

            // 3. Create NEW v4 PIP
            const newPipName = `${name}-pip-${Date.now().toString().slice(-4)}`;
            const pipPoller = await network.publicIPAddresses.beginCreateOrUpdate(resourceGroup, newPipName, {
                location: vm.location,
                publicIPAllocationMethod: 'Static',
                sku: { name: 'Standard' }
            });
            const newPip = await pipPoller.pollUntilDone();

            // 4. Update NIC
            ipConfig.publicIPAddress = { id: newPip.id };
            const nicPoller = await network.networkInterfaces.beginCreateOrUpdate(resourceGroup, nicName, nic);
            await nicPoller.pollUntilDone();

            // 5. Cleanup
            if (oldPipId) network.publicIPAddresses.beginDelete(resourceGroup, oldPipId.split('/').pop()).catch(e => console.error(e));

            return res.json({ success: true, message: `IPv4 Changed: ${newPip.ipAddress}`, newIp: newPip.ipAddress });

        } else if (action === 'change-ipv6') {
            // Change IPv6
            console.log(`[ChangeIP] Processing IPv6 swap for ${name}...`);

            // 1. Get VM -> NIC
            const vm = await compute.virtualMachines.get(resourceGroup, name);
            if (!vm.networkProfile || !vm.networkProfile.networkInterfaces[0]) throw new Error('VM has no NIC');
            const nicId = vm.networkProfile.networkInterfaces[0].id;
            const nicName = nicId.split('/').pop();
            const nic = await network.networkInterfaces.get(resourceGroup, nicName);

            // 2. Find v6 Config
            const ipConfig = nic.ipConfigurations.find(c => c.privateIPAddressVersion === 'IPv6');
            if (!ipConfig) throw new Error('No IPv6 config found (Did you enable IPv6 when creating?)');

            const oldPipId = ipConfig.publicIPAddress ? ipConfig.publicIPAddress.id : null;

            // 3. Create NEW v6 PIP
            const newPipName = `${name}-pip-v6-${Date.now().toString().slice(-4)}`;
            const pipPoller = await network.publicIPAddresses.beginCreateOrUpdate(resourceGroup, newPipName, {
                location: vm.location,
                publicIPAllocationMethod: 'Static',
                publicIPAddressVersion: 'IPv6',
                sku: { name: 'Standard' }
            });
            const newPip = await pipPoller.pollUntilDone();

            // 4. Update NIC
            ipConfig.publicIPAddress = { id: newPip.id };
            const nicPoller = await network.networkInterfaces.beginCreateOrUpdate(resourceGroup, nicName, nic);
            await nicPoller.pollUntilDone();

            // 5. Cleanup
            if (oldPipId) network.publicIPAddresses.beginDelete(resourceGroup, oldPipId.split('/').pop()).catch(e => console.error(e));

            return res.json({ success: true, message: `IPv6 Changed: ${newPip.ipAddress}`, newIp: newPip.ipAddress });

        } else {
            return res.status(400).json({ error: 'Unknown action' });
        }
        
        // Don't await result for long-running ops (except change-ip which we waited for to return IP)
        if (!action.includes('change-ip')) {
            res.json({ success: true, message: `${action} command sent` });
        }
    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Global Error Handlers (Prevent Crash)
process.on('uncaughtException', (err) => {
    console.error('[CRITICAL] Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('[CRITICAL] Unhandled Rejection:', reason);
});

const server = app.listen(port, '0.0.0.0', () => {
    console.log(`Azure Panel running at http://localhost:${port}`);
});
server.on('error', (err) => {
    console.error('[CRITICAL] Server listen error:', err);
});
