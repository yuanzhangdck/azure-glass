const API_BASE = '/api';
let currentAccountId = localStorage.getItem('currentAccountId') || null;

function getHeaders() {
    const h = {'Content-Type': 'application/json'};
    if (currentAccountId) h['X-Account-Id'] = currentAccountId;
    return h;
}

// Toast
let toastTimer;
function showToast(msg, isError = false) {
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toast-msg');
    const icon = document.getElementById('toast-icon');
    if (msg.includes('✅')) icon.innerText = '✅';
    else if (msg.includes('❌') || isError) icon.innerText = '🚨';
    else icon.innerText = '✨';
    toastMsg.innerText = msg.replace(/^[✅❌]\s*/, '');
    if (isError) {
        toast.className = 'fixed top-6 left-1/2 -translate-x-1/2 bg-red-500/90 backdrop-blur-xl text-white px-6 py-3 rounded-full shadow-2xl transition-all duration-300 z-50 border border-white/20 flex items-center gap-3 min-w-[300px] justify-center shadow-red-500/30 cursor-pointer';
        if(toastTimer) clearTimeout(toastTimer);
        toast.onclick = hideToast;
    } else {
        toast.className = 'fixed top-6 left-1/2 -translate-x-1/2 bg-black/80 backdrop-blur-xl text-white px-6 py-3 rounded-full shadow-2xl transition-all duration-300 z-50 border border-white/10 flex items-center gap-3 min-w-[300px] justify-center';
        if(toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(hideToast, 4000);
        toast.onclick = hideToast;
    }
    toast.classList.remove('-translate-y-24', 'opacity-0');
}
function hideToast() { document.getElementById('toast').classList.add('-translate-y-24', 'opacity-0'); }

// Modal
function showMessage(title, html) {
    const modal = document.getElementById('message-modal');
    const content = document.getElementById('message-content');
    document.getElementById('msg-title').innerText = title;
    document.getElementById('msg-body').innerHTML = html;
    modal.classList.remove('hidden');
    setTimeout(() => { modal.classList.remove('opacity-0'); content.classList.remove('scale-95'); content.classList.add('scale-100'); }, 10);
}
function closeMessage() {
    const modal = document.getElementById('message-modal');
    const content = document.getElementById('message-content');
    modal.classList.add('opacity-0'); content.classList.remove('scale-100'); content.classList.add('scale-95');
    setTimeout(() => { modal.classList.add('hidden'); }, 300);
}

// Copy
function copyText(text) {
    if (!text || text === 'None' || text === 'Fetching...' || text === 'Allocating...') return;
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(() => showToast('✅ Copied!')).catch(() => fallbackCopy(text));
    } else { fallbackCopy(text); }
}
function fallbackCopy(text) {
    const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed";
    document.body.appendChild(ta); ta.focus(); ta.select();
    try { document.execCommand('copy'); showToast('✅ Copied!'); } catch(e) { prompt("Copy:", text); }
    document.body.removeChild(ta);
}

// Confirm
let confirmResolver = null;
function showConfirm(msg) {
    return new Promise((resolve) => {
        confirmResolver = resolve;
        document.getElementById('confirm-body').innerText = msg;
        const modal = document.getElementById('confirm-modal');
        const content = document.getElementById('confirm-content');
        modal.classList.remove('hidden');
        setTimeout(() => { modal.classList.remove('opacity-0'); content.classList.remove('scale-95'); content.classList.add('scale-100'); }, 10);
    });
}
function closeConfirm(result) {
    const modal = document.getElementById('confirm-modal');
    const content = document.getElementById('confirm-content');
    modal.classList.add('opacity-0'); content.classList.remove('scale-100'); content.classList.add('scale-95');
    setTimeout(() => { modal.classList.add('hidden'); }, 300);
    if (confirmResolver) { confirmResolver(result); confirmResolver = null; }
}

// ==================== Account Management ====================
let allAccounts = [];

async function loadAccounts() {
    try {
        const res = await fetch(`${API_BASE}/accounts`);
        const data = await res.json();
        if (data.success) {
            allAccounts = data.accounts;
            renderAccountSwitcher();
            renderAccountList();
            // Auto-select first if none selected
            if (!currentAccountId && allAccounts.length > 0) {
                switchAccount(allAccounts[0].id);
            } else if (currentAccountId) {
                // Verify current still exists
                if (!allAccounts.find(a => a.id === currentAccountId)) {
                    currentAccountId = allAccounts.length > 0 ? allAccounts[0].id : null;
                    localStorage.setItem('currentAccountId', currentAccountId || '');
                }
                if (currentAccountId) checkStatus();
            }
        }
    } catch(e) { console.error('Failed to load accounts', e); }
}

function switchAccount(id) {
    currentAccountId = id;
    localStorage.setItem('currentAccountId', id);
    // Clear instance cache when switching
    localStorage.removeItem('azure_instances_cache');
    localStorage.removeItem('azure_foundry_cache');
    renderAccountSwitcher();
    checkStatus();
}

function renderAccountSwitcher() {
    const el = document.getElementById('account-switcher');
    if (!el) return;
    const current = allAccounts.find(a => a.id === currentAccountId);
    if (!current) {
        el.innerHTML = '<span class="text-slate-500 text-xs">No Account</span>';
        return;
    }
    let opts = allAccounts.map(a => `<option value="${a.id}" ${a.id === currentAccountId ? 'selected' : ''}>${a.name}${a.remark ? ' (' + a.remark + ')' : ''}</option>`).join('');
    el.innerHTML = `<select onchange="switchAccount(this.value)" class="glass-input rounded-lg px-2 py-1.5 text-xs appearance-none pr-6 max-w-[200px]">${opts}</select>`;
}

function renderAccountList() {
    const el = document.getElementById('account-list');
    if (!el) return;
    if (allAccounts.length === 0) {
        el.innerHTML = '<div class="text-center text-slate-500 py-6 text-sm">No accounts yet.</div>';
        return;
    }
    el.innerHTML = allAccounts.map(a => {
        const isActive = a.id === currentAccountId;
        const borderClass = isActive ? 'border-white/10 bg-white/5' : 'border-white/5 hover:border-white/10';
        const socks5Badge = '';
        return `<div class="flex items-center justify-between p-3 rounded-xl border ${borderClass} transition-all mb-2 cursor-pointer" onclick="switchAccount('${a.id}')">
            <div class="flex items-center gap-2 min-w-0">
                ${isActive ? '<span class="w-2 h-2 rounded-full bg-green-400 animate-pulse shrink-0"></span>' : '<span class="w-2 h-2 rounded-full bg-green-600 shrink-0"></span>'}
                <span class="text-sm text-white truncate">${a.name}</span>
            </div>
            <button onclick="event.stopPropagation();editAccount('${a.id}')" class="p-1.5 rounded-lg hover:bg-white/10 text-red-400 transition shrink-0" title="Edit">
                <svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M21.731 2.269a2.625 2.625 0 00-3.712 0l-1.157 1.157 3.712 3.712 1.157-1.157a2.625 2.625 0 000-3.712zM19.513 8.199l-3.712-3.712-9.563 9.563a4.5 4.5 0 00-1.11 1.775l-.97 2.907a.75.75 0 00.95.95l2.907-.97a4.5 4.5 0 001.775-1.11l9.563-9.563z"/></svg>
            </button>
        </div>`;
    }).join('');
}

function showAddAccount() {
    document.getElementById('acc-modal-title').innerText = 'Add Account';
    document.getElementById('acc-id').value = '';
    document.getElementById('acc-name').value = '';
    document.getElementById('acc-remark').value = '';
    document.getElementById('acc-key').value = '';
    document.getElementById('acc-socks5').value = '';
    toggleAccountModal(true);
}

async function editAccount(id) {
    document.getElementById('acc-modal-title').innerText = 'Edit Account';
    document.getElementById('acc-id').value = id;
    document.getElementById('acc-key').value = 'Loading...';
    toggleAccountModal(true);
    try {
        const res = await fetch(`${API_BASE}/accounts/${id}`, { headers: getHeaders() });
        const data = await res.json();
        if (data.success) {
            const a = data.account;
            document.getElementById('acc-name').value = a.name;
            document.getElementById('acc-remark').value = a.remark || '';
            document.getElementById('acc-key').value = a.credentials || '';
            document.getElementById('acc-socks5').value = a.socks5 || '';
        }
    } catch(e) { showToast('❌ Failed to load account', true); }
}

async function saveAccount() {
    const id = document.getElementById('acc-id').value;
    const name = document.getElementById('acc-name').value;
    const remark = document.getElementById('acc-remark').value;
    const key = document.getElementById('acc-key').value;
    const socks5 = document.getElementById('acc-socks5').value;
    if (!name) return showToast('❌ Name is required', true);

    try {
        let res;
        if (id) {
            // Edit
            const body = { name, remark, socks5 };
            if (key.trim()) body.credentials = key;
            res = await fetch(`${API_BASE}/accounts/${id}`, { method: 'PUT', headers: getHeaders(), body: JSON.stringify(body) });
        } else {
            // Add
            if (!key.trim()) return showToast('❌ Azure credentials required', true);
            res = await fetch(`${API_BASE}/accounts`, { method: 'POST', headers: getHeaders(), body: JSON.stringify({ name, remark, credentials: key, socks5 }) });
        }
        const data = await res.json();
        if (data.success || data.account) {
            showToast('✅ Account saved!');
            toggleAccountModal(false);
            await loadAccounts();
            if (!id && data.account) switchAccount(data.account.id);
        } else {
            showToast('❌ ' + (data.error || 'Failed'), true);
        }
    } catch(e) { showToast('❌ Network Error', true); }
}

async function deleteAccount(id, name) {
    if (!(await showConfirm(`Delete account "${name}"?`))) return;
    try {
        const res = await fetch(`${API_BASE}/accounts/${id}`, { method: 'DELETE', headers: getHeaders() });
        const data = await res.json();
        if (data.success) {
            showToast('✅ Account deleted');
            if (currentAccountId === id) { currentAccountId = null; localStorage.removeItem('currentAccountId'); }
            await loadAccounts();
        }
    } catch(e) { showToast('❌ Network Error', true); }
}

// ==================== Init & Core ====================
document.addEventListener('DOMContentLoaded', () => {
    if (!document.cookie.includes('azure_auth=valid')) { window.location.href = '/login.html'; return; }
    const createBtn = document.querySelector('#create-form .btn-primary');
    if(createBtn) createBtn.onclick = createInstance;
    loadAccounts();
    document.body.addEventListener('click', (e) => {
        const btn = e.target.closest('.change-ip-btn');
        if (!btn) return;
        changeIp(btn.dataset.type, btn.dataset.name, btn.dataset.rg);
    });
});

window.onclick = function(event) {
    const msgModal = document.getElementById('message-modal');
    if (event.target == msgModal) closeMessage();
    const setModal = document.getElementById('settings-modal');
    if (event.target == setModal) toggleSettings();
    const accModal = document.getElementById('account-modal');
    if (event.target == accModal) toggleAccountModal(false);
}

async function checkStatus() {
    try {
        const res = await fetch(`${API_BASE}/status`, { headers: getHeaders() });
        const data = await res.json();
        if (data.ready) {
            document.getElementById('sub-id').innerText = data.subscriptionId;
            loadInstances(false);
            loadOpenAI();
            loadSubscriptionInfo();
        } else {
            document.getElementById('sub-id').innerText = currentAccountId ? 'NOT CONNECTED' : 'SELECT ACCOUNT';
        }
    } catch (e) { console.error(e); }
}

async function doRefreshOAI() {
    const btn = document.getElementById('oai-refresh-btn');
    const svg = btn.querySelector('svg');
    svg.classList.add('animate-spin');
    btn.disabled = true;
    try { await loadOpenAI(true); } catch(_) {}
    svg.classList.remove('animate-spin');
    btn.disabled = false;
    showToast('✅ Refreshed');
}

async function doRefresh() {
    const btn = document.getElementById('refresh-btn');
    const svg = btn.querySelector('svg');
    svg.classList.add('animate-spin');
    btn.disabled = true;
    try { await Promise.all([loadInstances(true), loadOpenAI(true)]); } catch(_) {}
    svg.classList.remove('animate-spin');
    btn.disabled = false;
    showToast('✅ Refreshed');
}

async function loadInstances(force = false) {
    const container = document.querySelector('.xl\\:col-span-3 .glass-panel');
    const CACHE_KEY = 'azure_instances_cache';
    const CACHE_DURATION = 30 * 60 * 1000;
    if (!force) {
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
            try {
                const { timestamp, data, accountId } = JSON.parse(cached);
                if (accountId === currentAccountId && Date.now() - timestamp < CACHE_DURATION) {
                    renderInstances(data, timestamp); return;
                }
            } catch(e) {}
        }
    }
    container.innerHTML = getTableSkeleton('Loading...');
    try {
        const res = await fetch(`${API_BASE}/instances`, { headers: getHeaders() });
        const data = await res.json();
        if (data.success) {
            localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data: data.instances, accountId: currentAccountId }));
            renderInstances(data.instances, Date.now());
        }
    } catch (e) {
        showToast('❌ Failed to load instances', true);
        container.innerHTML = getTableSkeleton('Failed to load.');
    }
}

let instancePage = 0;
const INSTANCES_PER_PAGE = 4;

function renderInstances(instances, timestamp) {
    const container = document.querySelector('.xl\\:col-span-3 .glass-panel');
    const timeStr = new Date(timestamp).toLocaleTimeString();
    const isCached = (Date.now() - timestamp) > 1000;
    const cacheLabel = isCached ? `<span class="text-[10px] text-slate-500 font-normal ml-2 opacity-60">(Cached: ${timeStr})</span>` : '';
    let tableHTML = `<div class="px-6 py-5 border-b border-white/5 flex justify-between items-center bg-white/5">
        <h2 class="text-lg font-semibold text-white flex items-center">Instances ${cacheLabel}</h2>
        <span id="instance-count" class="bg-white/10 text-white text-xs font-bold px-2 py-1 rounded-md border border-white/5">${instances.length}</span>
    </div><div class="overflow-x-auto"><table class="w-full text-left text-sm text-slate-400">
        <thead class="text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-white/5"><tr>
            <th class="px-6 py-4">Instance</th><th class="px-6 py-4">Location</th><th class="px-6 py-4">Status</th><th class="px-6 py-4">IP Address</th><th class="px-6 py-4 text-right">Actions</th>
        </tr></thead><tbody id="instance-list" class="divide-y divide-white/5">
            ${instances.length === 0 ? '<tr><td colspan="5" class="px-6 py-12 text-center text-slate-500">No active VMs found.</td></tr>' : ''}
        </tbody></table></div>`;
    container.innerHTML = tableHTML;
    if (instances.length === 0) return;
    window._allInstances = instances;
    window._instanceTimestamp = timestamp;
    renderInstancePage();
}

function renderInstancePage() {
    const instances = window._allInstances || [];
    const totalPages = Math.ceil(instances.length / INSTANCES_PER_PAGE);
    if (instancePage >= totalPages) instancePage = totalPages - 1;
    if (instancePage < 0) instancePage = 0;
    const page = instances.slice(instancePage * INSTANCES_PER_PAGE, (instancePage + 1) * INSTANCES_PER_PAGE);
    const tbody = document.getElementById('instance-list');
    tbody.innerHTML = page.map(vm => {
        const isRun = vm.provisioningState === 'Succeeded';
        const sc = isRun ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-red-500/20 text-red-400 border-red-500/30';
        return `<tr class="hover:bg-white/5 transition duration-200 group">
            <td class="px-6 py-4 font-medium text-white align-middle"><div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-white/10 to-white/5 border border-white/10 flex items-center justify-center shadow-inner">
                    <svg class="w-5 h-5 text-blue-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01"></path></svg>
                </div><div><div class="font-semibold tracking-tight">${vm.name}</div><div class="text-[10px] text-slate-500 font-mono uppercase tracking-wider mt-0.5">${vm.size}</div></div>
            </div></td>
            <td class="px-6 py-4 text-slate-300">${vm.location}</td>
            <td class="px-6 py-4"><span class="${sc} text-[10px] font-bold border px-2.5 py-1 rounded-full uppercase tracking-wide inline-flex items-center gap-1.5 shadow-sm">
                <span class="w-1.5 h-1.5 rounded-full ${isRun ? 'bg-green-400 animate-pulse' : 'bg-current'}"></span>${vm.provisioningState}</span></td>
            <td class="px-6 py-4 font-mono text-xs text-slate-300">
                <div class="flex items-center gap-2 group/ip"><span class="text-slate-500 font-bold w-6">v4:</span>
                    <span class="text-white select-all cursor-pointer hover:text-blue-300 transition" onclick="copyText(this.innerText)">${vm.publicIp}</span>
                    <button class="change-ip-btn opacity-0 group-hover/ip:opacity-100 px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 border border-blue-500/30 text-[9px] font-bold uppercase tracking-wider transition ml-auto" data-type="v4" data-name="${vm.name}" data-rg="${vm.resourceGroup}">Swap</button>
                </div>
                <div class="flex items-center gap-2 mt-1.5 group/ipv6"><span class="text-slate-500 font-bold w-6">v6:</span>
                    <span class="text-slate-300 select-all cursor-pointer hover:text-blue-300 transition text-[10px]" onclick="copyText(this.innerText)">${vm.publicIpV6 || 'Allocating...'}</span>
                    ${vm.publicIpV6 !== 'None' ? `<button class="change-ip-btn opacity-0 group-hover/ipv6:opacity-100 px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 border border-purple-500/30 text-[9px] font-bold uppercase tracking-wider transition ml-auto" data-type="v6" data-name="${vm.name}" data-rg="${vm.resourceGroup}">Swap</button>` : ''}
                </div>
            </td>
            <td class="px-6 py-4 text-right"><div class="flex items-center justify-end gap-2">
                <button onclick="action('stop','${vm.name}','${vm.resourceGroup}')" class="px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 text-xs font-medium transition">Stop</button>
                <button onclick="action('start','${vm.name}','${vm.resourceGroup}')" class="px-3 py-1.5 rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500/20 border border-green-500/20 text-xs font-medium transition">Start</button>
                <button onclick="action('delete','${vm.name}','${vm.resourceGroup}')" class="p-1.5 rounded-lg hover:bg-red-500/20 text-slate-500 hover:text-red-400 transition" title="Delete">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                </button>
            </div></td></tr>`;
    }).join('');
    // Pagination
    if (totalPages > 1) {
        const pager = document.createElement('div');
        pager.className = 'flex items-center justify-center gap-3 px-6 py-3 border-t border-white/5';
        pager.innerHTML = `
            <button onclick="instancePage--;renderInstancePage()" class="text-slate-400 hover:text-white text-xs ${instancePage === 0 ? 'opacity-30 pointer-events-none' : ''}">&larr; Prev</button>
            <span class="text-[10px] text-slate-500">${instancePage + 1} / ${totalPages}</span>
            <button onclick="instancePage++;renderInstancePage()" class="text-slate-400 hover:text-white text-xs ${instancePage >= totalPages - 1 ? 'opacity-30 pointer-events-none' : ''}">Next &rarr;</button>`;
        tbody.closest('table').parentElement.after(pager);
    }
}

function getTableSkeleton(msg) {
    return `<div class="px-6 py-5 border-b border-white/5 flex justify-between items-center bg-white/5">
        <h2 class="text-lg font-semibold text-white">Instances</h2>
        <span class="bg-white/10 text-white text-xs font-bold px-2 py-1 rounded-md border border-white/5">...</span>
    </div><div class="overflow-x-auto"><table class="w-full text-left text-sm text-slate-400">
        <thead class="text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-white/5"><tr>
            <th class="px-6 py-4">Instance</th><th class="px-6 py-4">Location</th><th class="px-6 py-4">Status</th><th class="px-6 py-4">IP Address</th><th class="px-6 py-4 text-right">Actions</th>
        </tr></thead><tbody><tr><td colspan="5" class="px-6 py-12 text-center text-slate-500"><div class="inline-block animate-spin mr-2">⟳</div>${msg}</td></tr></tbody></table></div>`;
}

async function action(act, name, rg) {
    if(!(await showConfirm(`Confirm ${act} on ${name}?`))) return;
    showToast(`Sending ${act} command...`);
    try {
        const res = await fetch(`${API_BASE}/instances/${act}`, { method: 'POST', headers: getHeaders(), body: JSON.stringify({ name, resourceGroup: rg }) });
        const data = await res.json();
        if (data.success) showToast('✅ Command sent!');
        else showToast(`❌ Error: ${data.error}`, true);
    } catch(e) { showToast('❌ Network Error', true); }
}

async function changeIp(type, name, rg) {
    const label = type === 'v4' ? 'IPv4' : 'IPv6';
    if(!(await showConfirm(`Change ${label} for ${name}?\n\n⚠️ This will disconnect current SSH sessions!`))) return;
    showToast(`🔄 Changing ${label}... (Wait ~30s)`);
    try {
        const res = await fetch(`${API_BASE}/instances/change-ip${type}`, { method: 'POST', headers: getHeaders(), body: JSON.stringify({ name, resourceGroup: rg }) });
        const data = await res.json();
        if (data.success) { showToast(`✅ New ${label}: ${data.newIp}`); setTimeout(loadInstances, 2000); }
        else showToast(`❌ Error: ${data.error}`, true);
    } catch(e) { showToast('❌ Network Error', true); }
}

async function createInstance() {
    const btn = document.querySelector('#create-form .btn-primary');
    const name = document.querySelector('#create-form input[placeholder="e.g. web-server-01"]').value;
    const location = document.getElementById('region-select').value;
    const size = document.getElementById('size-select').value;
    const enableIPv6 = document.getElementById('ipv6-toggle').checked;
    const imageMap = {
        'debian12': { publisher: 'Debian', offer: 'debian-12', sku: '12', version: 'latest' },
        'ubuntu22': { publisher: 'Canonical', offer: '0001-com-ubuntu-server-jammy', sku: '22_04-lts-gen2', version: 'latest' },
        'ubuntu20': { publisher: 'Canonical', offer: '0001-com-ubuntu-server-focal', sku: '20_04-lts-gen2', version: 'latest' }
    };
    const selectedImage = imageMap[document.getElementById('image-select')?.value || 'debian12'];
    const userVal = document.getElementById('vm-user').value;
    const passVal = document.getElementById('vm-pass').value;
    if (!name) return showToast('❌ Missing VM Name', true);
    if (!passVal || passVal.length < 12) return showToast('❌ Password too short (min 12)', true);
    if (!currentAccountId) return showToast('❌ Please select an account first', true);
    btn.disabled = true; btn.innerText = 'Deploying...'; btn.classList.add('opacity-70');
    showToast('🚀 Deploying VM... (This takes ~2 mins)');
    try {
        const res = await fetch(`${API_BASE}/instances/create`, { method: 'POST', headers: getHeaders(),
            body: JSON.stringify({ name, location, size, spot: false, username: userVal || 'azureuser', password: passVal, ipv6: enableIPv6, image: selectedImage })
        });
        const data = await res.json();
        if (data.success) {
            showMessage('🚀 Launch Initiated', `<div class="space-y-4">
                <div class="flex items-center gap-3 text-green-400 bg-green-500/10 p-3 rounded-xl border border-green-500/20">
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    <span class="font-semibold">Deployment Task Started!</span></div>
                <p>Your VM is being created in the background. It may take 1-3 minutes.</p>
                <div class="bg-black/40 rounded-xl p-4 border border-white/5 space-y-2">
                    <div class="flex justify-between items-center border-b border-white/5 pb-2 mb-2"><span class="text-xs font-bold text-slate-500 uppercase">Credentials</span></div>
                    <div class="grid grid-cols-[60px_1fr] gap-2 items-center">
                        <span class="text-slate-400 text-xs text-right">User:</span>
                        <code class="font-mono text-blue-300 bg-blue-500/10 px-2 py-1 rounded cursor-pointer hover:bg-blue-500/20 transition" onclick="copyText('${userVal || 'azureuser'}')">${userVal || 'azureuser'}</code>
                        <span class="text-slate-400 text-xs text-right">Pass:</span>
                        <code class="font-mono text-green-300 bg-green-500/10 px-2 py-1 rounded cursor-pointer hover:bg-green-500/20 transition break-all" onclick="copyText('${passVal}')">${passVal}</code>
                    </div></div></div>`);
            document.querySelector('#create-form input[placeholder="e.g. web-server-01"]').value = '';
        } else showToast(`❌ Error: ${data.error}`, true);
    } catch(e) { showToast('❌ Network Error', true); }
    finally { btn.disabled = false; btn.innerText = 'Deploy Instance'; btn.classList.remove('opacity-70'); }
}

async function nukeAll() {
    if (!(await showConfirm('⚠️ DANGER: DELETE ALL RESOURCES?\n\nThis will permanently destroy every Resource Group, VM, Disk, and IP in your subscription.\n\nThis action cannot be undone.'))) return;
    showToast('☢️ Cleanup started...');
    try {
        const res = await fetch(`${API_BASE}/nuke`, { method: 'DELETE', headers: getHeaders() });
        const data = await res.json();
        if (data.success) {
            showMessage('Cleanup Started', '<div class="text-center"><div class="text-red-400 font-bold text-lg mb-2">Deletion in Progress</div><p class="text-slate-300">Resources are being deleted in the background.</p></div>');
            const il = document.getElementById('instance-list');
            const ic = document.getElementById('instance-count');
            if(il) il.innerHTML = '';
            if(ic) ic.innerText = '0';
        } else showToast(`❌ Error: ${data.error}`, true);
    } catch(e) { showToast('❌ Network Error', true); }
}

async function savePassword() {
    const pw = document.getElementById('new-password').value;
    if (!pw || pw.length < 5) return showToast('❌ Password too short', true);
    try {
        const res = await fetch(`${API_BASE}/setup/password`, { method: 'POST', headers: getHeaders(), body: JSON.stringify({ newPassword: pw }) });
        const data = await res.json();
        if (data.success) showToast('✅ Password changed!');
        else showToast('❌ ' + data.error, true);
    } catch(e) { showToast('❌ Network Error', true); }
}

async function testSocks5() {
    const socks5 = document.getElementById('acc-socks5').value.trim();
    const result = document.getElementById('socks5-result');
    if (!socks5) { result.innerText = '⚠️ Please enter a SOCKS5 URL first.'; result.className = 'text-[10px] text-yellow-400 mt-1'; return; }
    result.innerText = '⏳ Testing...'; result.className = 'text-[10px] text-slate-400 mt-1';
    try {
        const res = await fetch(`${API_BASE}/socks5/test`, { method: 'POST', headers: getHeaders(), body: JSON.stringify({ socks5 }) });
        const data = await res.json();
        if (data.success) { result.innerText = '✅ Proxy IP: ' + data.ip; result.className = 'text-[10px] text-green-400 mt-1'; }
        else { result.innerText = '❌ Failed: ' + data.error; result.className = 'text-[10px] text-red-400 mt-1'; }
    } catch(e) { result.innerText = '❌ Network Error'; result.className = 'text-[10px] text-red-400 mt-1'; }
}

// ==================== AI Foundry Management ====================

function toggleModal(modalId, contentId, show) {
    const modal = document.getElementById(modalId);
    const content = document.getElementById(contentId);
    if (show) { modal.classList.remove('hidden'); setTimeout(() => { modal.classList.remove('opacity-0'); content.classList.remove('scale-95'); content.classList.add('scale-100'); }, 10); }
    else { modal.classList.add('opacity-0'); content.classList.remove('scale-100'); content.classList.add('scale-95'); setTimeout(() => { modal.classList.add('hidden'); }, 300); }
}

function toggleOpenAICreate(show) { toggleModal('openai-create-modal', 'openai-create-content', show); }
function toggleAccountModal(show) { toggleModal('account-modal', 'account-modal-content', show); }

function showCreateOpenAI() { document.getElementById('oai-name').value = ''; toggleOpenAICreate(true); }

async function loadSubscriptionInfo(force = false) {
    const cacheKey = 'sub_info_' + currentAccountId;
    if (!force) {
        const cached = localStorage.getItem(cacheKey);
        if (cached) { renderSubInfo(JSON.parse(cached)); return; }
    }
    try {
        const res = await fetch(`${API_BASE}/subscription`, { headers: getHeaders() });
        const d = await res.json();
        if (!d.success) return;
        localStorage.setItem(cacheKey, JSON.stringify(d));
        renderSubInfo(d);
    } catch(e) {}
}
function renderSubInfo(d) {
    const el = document.getElementById('subscription-details');
    const exp = d.expiresAt ? new Date(d.expiresAt).toLocaleDateString() : 'N/A';
    el.innerHTML = `
        <div class="flex items-center justify-between gap-4">
            <div class="flex items-center gap-1"><span class="text-[11px] text-white">Type</span><span class="text-[11px] text-green-400 ml-1">${d.name}</span></div>
            <div class="flex items-center gap-1"><span class="text-[11px] text-white">Credit</span><span class="text-[11px] text-green-400 ml-1">${d.totalCredit || 'N/A'}</span></div>
            <div class="flex items-center gap-1"><span class="text-[11px] text-white">Expires</span><span class="text-[11px] text-green-400 ml-1">${exp}</span></div>
            <div class="flex items-center gap-1"><span class="text-[11px] text-white">This Month</span><span class="text-[11px] text-yellow-400 ml-1">${d.monthCost} ${d.currency}</span></div>
            <button onclick="refreshSubInfo(this)" class="text-white hover:text-green-400 transition" title="Refresh"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg></button>
        </div>`;
}
async function refreshSubInfo(btn) {
    const svg = btn.querySelector('svg');
    svg.classList.add('animate-spin');
    await loadSubscriptionInfo(true);
    svg.classList.remove('animate-spin');
}

async function loadOpenAI(force = false) {
    if (!currentAccountId) return;
    const el = document.getElementById('openai-list');
    const OAI_CACHE_KEY = 'azure_foundry_cache';
    const CACHE_DURATION = 30 * 60 * 1000;

    if (!force) {
        const cached = localStorage.getItem(OAI_CACHE_KEY);
        if (cached) {
            try {
                const { timestamp, data, accountId } = JSON.parse(cached);
                if (accountId === currentAccountId && Date.now() - timestamp < CACHE_DURATION) {
                    renderOpenAI(data, el); return;
                }
            } catch(e) {}
        }
    }

    el.innerHTML = '<div class="text-center text-slate-500 py-6"><div class="inline-block animate-spin mr-2">⟳</div>Loading...</div>';
    try {
        const res = await fetch(`${API_BASE}/openai/accounts`, { headers: getHeaders() });
        const data = await res.json();
        if (!data.success) { el.innerHTML = `<div class="text-center text-red-400 py-6 text-sm">${data.error}</div>`; return; }
        localStorage.setItem(OAI_CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data: data.accounts, accountId: currentAccountId }));
        renderOpenAI(data.accounts, el);
    } catch(e) { el.innerHTML = '<div class="text-center text-red-400 py-6 text-sm">Failed to load.</div>'; }
}

function renderOpenAI(accounts, el) {
    if (accounts.length === 0) { el.innerHTML = '<div class="text-center text-slate-500 py-6 text-sm">No AI Foundry resources found.</div>'; return; }
    el.innerHTML = accounts.map(a => `
        <div class="border border-white/5 rounded-xl p-4 mb-3 hover:border-green-500/20 transition">
            <div class="flex items-center justify-between mb-2">
                <div class="flex items-center gap-2">
                    <span class="w-2 h-2 rounded-full bg-green-400 shrink-0"></span>
                    <span class="font-semibold text-white text-sm cursor-pointer hover:text-green-400 transition" onclick="showDeployments('${a.resourceGroup}','${a.name}')">${a.name}</span>
                    <span class="text-[10px] text-slate-500">${a.location}</span>
                    <span class="text-[10px] px-1.5 py-0.5 rounded ${a.kind === 'AIServices' ? 'bg-green-500/15 text-green-400' : 'bg-yellow-500/15 text-yellow-400'}">${a.kind === 'AIServices' ? 'AI Foundry' : a.kind}</span>
                </div>
                <div class="flex items-center gap-1">
                    <button onclick="showKeys('${a.resourceGroup}','${a.name}')" class="px-2 py-1 rounded-lg bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20 border border-yellow-500/20 text-[10px] font-bold" title="API Keys">🔑 Keys</button>
                    <button onclick="showResourceQuotas('${a.resourceGroup}','${a.name}','${a.location}')" class="px-2 py-1 rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 border border-blue-500/20 text-[10px] font-bold">📊 Quotas</button>
                    <button onclick="deleteOpenAI('${a.resourceGroup}','${a.name}')" class="p-1.5 rounded-lg hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition" title="Delete">
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                    </button>
                </div>
                </div>
            </div>
        `).join('');
}

async function showDeployments(rg, name) {
    showMessage('📦 Deployments - ' + name, '<div class="text-center text-slate-400 py-4"><div class="inline-block animate-spin mr-2">⟳</div>Loading...</div>');
    try {
        const res = await fetch(`${API_BASE}/openai/accounts/${rg}/${name}/deployments`, { headers: getHeaders() });
        const data = await res.json();
        if (!data.success) { showMessage('❌ Error', data.error); return; }
        if (data.deployments.length === 0) { showMessage('📦 Deployments - ' + name, '<div class="text-slate-500 text-sm text-center py-4">No models deployed</div>'); return; }
        const endpoint = data.deployments[0]?.endpoint || '';
        const html = `<div class="text-[11px] text-slate-500 font-mono truncate cursor-pointer hover:text-slate-300 mb-3 p-2 rounded-lg bg-white/5" onclick="navigator.clipboard.writeText(this.textContent.trim());showToast('📋 Copied!')" title="Click to copy">${endpoint}</div>` +
            data.deployments.map(d => `
            <div class="border border-white/5 rounded-lg p-3 mb-2">
                <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                        <span class="text-sm text-white font-medium">${d.name}</span>
                        <span class="text-[10px] text-slate-500">${d.model} v${d.modelVersion||''}</span>
                        <span class="text-[10px] ${d.provisioningState === 'Succeeded' ? 'text-green-400' : 'text-yellow-400'}">${d.provisioningState}</span>
                    </div>
                    <button onclick="deleteDeployment('${rg}','${name}','${d.name}');closeMessage()" class="text-slate-500 hover:text-red-400 transition" title="Delete">
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
                    </button>
                </div>
            </div>`).join('');
        showMessage('📦 Deployments - ' + name, html);
    } catch(e) { showMessage('❌ Error', 'Failed to load deployments'); }
}

async function createOpenAI() {
    const name = document.getElementById('oai-name').value.trim();
    const location = document.getElementById('oai-location').value;
    if (!name) return showToast('❌ Name required', true);
    toggleOpenAICreate(false);
    showToast('⏳ Creating AI Foundry resource...');
    try {
        const res = await fetch(`${API_BASE}/openai/accounts`, { method: 'POST', headers: getHeaders(), body: JSON.stringify({ name, location }) });
        const data = await res.json();
        if (data.success) { showToast('✅ ' + data.message); loadOpenAI(true); }
        else showToast('❌ ' + data.error, true);
    } catch(e) { showToast('❌ Network Error', true); }
}

async function deleteOpenAI(rg, name) {
    if (!(await showConfirm(`Delete AI Foundry resource "${name}"?`))) return;
    showToast('Deleting...');
    try {
        const res = await fetch(`${API_BASE}/openai/accounts/${rg}/${name}`, { method: 'DELETE', headers: getHeaders() });
        const data = await res.json();
        if (data.success) { showToast('✅ Deleted'); loadOpenAI(true); }
        else showToast('❌ ' + data.error, true);
    } catch(e) { showToast('❌ Network Error', true); }
}

async function showKeys(rg, name) {
    try {
        const res = await fetch(`${API_BASE}/openai/accounts/${rg}/${name}/keys`, { headers: getHeaders() });
        const data = await res.json();
        if (data.success) {
            showMessage('🔑 API Keys - ' + name, `
                <div class="space-y-3">
                    <div><label class="text-[10px] text-slate-500 uppercase font-bold block mb-1">Key 1</label>
                        <code class="block bg-black/40 rounded-lg p-2 text-xs font-mono text-green-300 break-all cursor-pointer hover:bg-black/60 transition" onclick="copyText(this.innerText)">${data.key1}</code></div>
                    <div><label class="text-[10px] text-slate-500 uppercase font-bold block mb-1">Key 2</label>
                        <code class="block bg-black/40 rounded-lg p-2 text-xs font-mono text-green-300 break-all cursor-pointer hover:bg-black/60 transition" onclick="copyText(this.innerText)">${data.key2}</code></div>
                    <p class="text-[10px] text-slate-500 text-center">Click to copy</p>
                </div>`);
        } else showToast('❌ ' + data.error, true);
    } catch(e) { showToast('❌ Network Error', true); }
}

async function showQuotas() {
    const locations = ['eastus','eastus2','westus','westus3','southcentralus','northcentralus','westeurope','northeurope','uksouth','francecentral','swedencentral','switzerlandnorth','japaneast','australiaeast','canadaeast','koreacentral'];
    const cached = localStorage.getItem('azure_foundry_cache');
    let defaultLoc = 'eastus';
    if (cached) { try { const { data } = JSON.parse(cached); if (data?.[0]?.location) defaultLoc = data[0].location; } catch(_) {} }
    const locOpts = locations.map(l => `<option value="${l}" ${l === defaultLoc ? 'selected' : ''}>${l}</option>`).join('');
    showMessage('📊 Global Quotas (TPM)', `
        <div class="mb-4 flex items-center gap-2">
            <label class="text-xs text-slate-400">Region:</label>
            <select id="quota-region" onchange="loadQuotaData(this.value)" class="glass-input rounded-lg px-3 py-1.5 text-sm appearance-none">${locOpts}</select>
        </div>
        <div id="quota-list"><div class="text-center text-slate-500 py-4">Loading...</div></div>`);
    loadQuotaData(defaultLoc);
}

async function loadQuotaData(location, elId, deployTarget) {
    const el = document.getElementById(elId || 'quota-list');
    if (!el) return;
    el.innerHTML = '<div class="text-center text-slate-500 py-4"><div class="inline-block animate-spin mr-2">⟳</div>Loading...</div>';
    try {
        const res = await fetch(`${API_BASE}/openai/quotas/${location}`, { headers: getHeaders() });
        const data = await res.json();
        if (!data.success) { el.innerHTML = `<div class="text-center text-red-400 py-4 text-sm">${data.error}</div>`; return; }
        if (data.quotas.length === 0) { el.innerHTML = '<div class="text-center text-slate-500 py-4">No TPM quotas in this region.</div>'; return; }
        el.innerHTML = '<div class="max-h-[400px] overflow-y-auto">' + data.quotas.map(q => {
            const pct = q.limit > 0 ? Math.round(q.used / q.limit * 100) : 0;
            const color = pct >= 90 ? 'bg-red-500' : pct >= 50 ? 'bg-yellow-500' : 'bg-green-500';
            const available = q.limit - q.used;
            let deployBtn = '';
            if (deployTarget && available > 0) {
                deployBtn = `<button onclick="quickDeploy('${q.model}','${q.sku}','${deployTarget}',${q.limit})" class="px-2 py-1 rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500/20 border border-green-500/20 text-[10px] font-bold shrink-0">Deploy</button>`;
            } else if (deployTarget && available <= 0) {
                deployBtn = `<span class="text-[10px] text-red-400 w-14 text-center shrink-0">No quota</span>`;
            }
            return `<div class="flex items-center justify-between py-2 border-b border-white/5">
                <div class="flex items-center gap-2 min-w-0 max-w-[40%]">
                    <span class="text-xs text-white truncate">${q.model}</span>
                    <span class="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-slate-400 shrink-0">${q.sku}</span>
                </div>
                <div class="flex items-center gap-3">
                    <div class="w-16 h-1.5 bg-white/10 rounded-full overflow-hidden"><div class="${color} h-full rounded-full" style="width:${pct}%"></div></div>
                    <span class="text-[10px] text-slate-400 font-mono w-24 text-right">${q.used}K / ${q.limit}K</span>
                    ${deployBtn}
                </div>
            </div>`;
        }).join('') + '</div>';
    } catch(e) { el.innerHTML = '<div class="text-center text-red-400 py-4 text-sm">Failed to load.</div>'; }
}

function showResourceQuotas(rg, name, location) {
    showMessage(`📊 Quotas - ${name} (${location})`, `
        <div id="resource-quota-list"><div class="text-center text-slate-500 py-4">Loading...</div></div>`);
    loadQuotaData(location, 'resource-quota-list', `${rg}|${name}`);
}

async function quickDeploy(model, sku, target, maxCapacity) {
    const [rg, account] = target.split('|');
    const deploymentName = model.replace(/[^a-z0-9-]/gi, '-');
    const capacity = maxCapacity || 1;
    if (!(await showConfirm(`Deploy "${model}" (${sku}) capacity=${capacity}K TPM to ${account}?`))) return;
    closeMessage();
    showToast('⏳ Deploying model...');
    try {
        const skuName = sku.includes('Global') ? 'GlobalStandard' : 'Standard';
        const res = await fetch(`${API_BASE}/openai/accounts/${rg}/${account}/deployments`, {
            method: 'POST', headers: getHeaders(),
            body: JSON.stringify({ deploymentName, modelName: model, modelVersion: '', capacity, skuName })
        });
        const data = await res.json();
        if (data.success) { showToast('✅ ' + data.message); loadOpenAI(true); }
        else showToast('❌ ' + data.error, true);
    } catch(e) { showToast('❌ Network Error', true); }
}

async function deleteDeployment(rg, account, dname) {
    if (!(await showConfirm(`Delete deployment "${dname}"?`))) return;
    showToast('Deleting deployment...');
    try {
        const res = await fetch(`${API_BASE}/openai/accounts/${rg}/${account}/deployments/${dname}`, { method: 'DELETE', headers: getHeaders() });
        const data = await res.json();
        if (data.success) { showToast('✅ Deleted'); loadOpenAI(true); }
        else showToast('❌ ' + data.error, true);
    } catch(e) { showToast('❌ Network Error', true); }
}
