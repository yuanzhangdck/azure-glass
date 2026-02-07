const API_BASE = '/api';

// Toast Notification
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
        toast.className = `fixed top-6 left-1/2 -translate-x-1/2 bg-red-500/90 backdrop-blur-xl text-white px-6 py-3 rounded-full shadow-2xl transition-all duration-300 z-50 border border-white/20 flex items-center gap-3 min-w-[300px] justify-center shadow-red-500/30 cursor-pointer`;
        // Errors do NOT auto-hide. Click to dismiss.
        if(toastTimer) clearTimeout(toastTimer);
        toast.onclick = hideToast;
        console.error('[Toast Error]', msg); 
    } else {
        toast.className = `fixed top-6 left-1/2 -translate-x-1/2 bg-black/80 backdrop-blur-xl text-white px-6 py-3 rounded-full shadow-2xl transition-all duration-300 z-50 border border-white/10 flex items-center gap-3 min-w-[300px] justify-center`;
        // Success messages auto-hide
        if(toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(hideToast, 4000);
        toast.onclick = hideToast;
    }
    toast.classList.remove('-translate-y-24', 'opacity-0');
}
function hideToast() { document.getElementById('toast').classList.add('-translate-y-24', 'opacity-0'); }

// Modal Logic
function showMessage(title, html) {
    const modal = document.getElementById('message-modal');
    const content = document.getElementById('message-content');
    document.getElementById('msg-title').innerText = title;
    document.getElementById('msg-body').innerHTML = html;
    
    modal.classList.remove('hidden');
    setTimeout(() => {
        modal.classList.remove('opacity-0');
        content.classList.remove('scale-95');
        content.classList.add('scale-100');
    }, 10);
}

function closeMessage() {
    const modal = document.getElementById('message-modal');
    const content = document.getElementById('message-content');
    
    modal.classList.add('opacity-0');
    content.classList.remove('scale-100');
    content.classList.add('scale-95');
    setTimeout(() => { modal.classList.add('hidden'); }, 300);
}

// Copy Helper (HTTP compatible)
function copyText(text) {
    if (!text || text === 'None' || text === 'Fetching...' || text === 'Allocating...') return;
    
    // Try modern API if secure
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(() => showToast('✅ Copied!'))
            .catch(() => fallbackCopy(text));
    } else {
        fallbackCopy(text);
    }
}

function fallbackCopy(text) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    try {
        document.execCommand('copy');
        showToast('✅ Copied!');
    } catch (err) {
        prompt("Copy manually:", text);
    }
    document.body.removeChild(textArea);
}

// Custom Confirm Modal (Promise-based)
let confirmResolver = null;

function showConfirm(msg) {
    return new Promise((resolve) => {
        confirmResolver = resolve;
        document.getElementById('confirm-body').innerText = msg;
        const modal = document.getElementById('confirm-modal');
        const content = document.getElementById('confirm-content');
        
        modal.classList.remove('hidden');
        setTimeout(() => {
            modal.classList.remove('opacity-0');
            content.classList.remove('scale-95');
            content.classList.add('scale-100');
        }, 10);
    });
}

function closeConfirm(result) {
    const modal = document.getElementById('confirm-modal');
    const content = document.getElementById('confirm-content');
    
    modal.classList.add('opacity-0');
    content.classList.remove('scale-100');
    content.classList.add('scale-95');
    setTimeout(() => { modal.classList.add('hidden'); }, 300);
    
    if (confirmResolver) {
        confirmResolver(result);
        confirmResolver = null;
    }
}

// Init
document.addEventListener('DOMContentLoaded', () => {
    // Auth Check
    if (!document.cookie.includes('azure_auth=valid')) {
        window.location.href = '/login.html';
        return;
    }
    
    // Bind Buttons
    const createBtn = document.querySelector('#create-form .btn-primary');
    if(createBtn) createBtn.onclick = createInstance;

    // Check Backend Status
    checkStatus();

    // Global Delegated Listener for Change IP buttons
    document.body.addEventListener('click', (e) => {
        const btn = e.target.closest('.change-ip-btn');
        if (!btn) return;
        const type = btn.dataset.type;
        const name = btn.dataset.name;
        const rg = btn.dataset.rg;
        console.log('Change IP Clicked:', type, name, rg);
        changeIp(type, name, rg);
    });
});

// Close modals on clicking outside
window.onclick = function(event) {
    const msgModal = document.getElementById('message-modal');
    if (event.target == msgModal) closeMessage();
    
    const setModal = document.getElementById('settings-modal');
    if (event.target == setModal) toggleSettings();
}

async function checkStatus() {
    try {
        const res = await fetch(`${API_BASE}/status`);
        const data = await res.json();
        if (data.ready) {
            document.getElementById('sub-id').innerText = data.subscriptionId;
            loadInstances(false); // Default to cache
        } else {
            document.getElementById('sub-id').innerText = 'NOT CONNECTED';
            const settingsModal = document.getElementById('settings-modal');
            if(settingsModal) settingsModal.classList.remove('hidden');
        }
    } catch (e) { console.error(e); }
}

async function loadInstances(force = false) {
    const container = document.querySelector('.xl\\:col-span-3 .glass-panel');
    const CACHE_KEY = 'azure_instances_cache';
    const CACHE_DURATION = 5 * 60 * 1000; // 5 Minutes

    // Try load from cache first
    if (!force) {
        const cached = localStorage.getItem(CACHE_KEY);
        if (cached) {
            try {
                const { timestamp, data } = JSON.parse(cached);
                if (Date.now() - timestamp < CACHE_DURATION) {
                    console.log('Using Cached Instances');
                    renderInstances(data, timestamp);
                    return;
                }
            } catch(e) { console.error('Cache parse error', e); }
        }
    }

    // If no cache or force refresh, fetch API
    
    // Inject Table Structure (Loader)
    container.innerHTML = getTableSkeleton('Loading...');

    try {
        const res = await fetch(`${API_BASE}/instances`);
        const data = await res.json();
        
        if (data.success) {
            // Save to cache
            localStorage.setItem(CACHE_KEY, JSON.stringify({
                timestamp: Date.now(),
                data: data.instances
            }));
            renderInstances(data.instances, Date.now());
        }
    } catch (e) {
        showToast('❌ Failed to load instances', true);
        console.error(e);
        container.innerHTML = getTableSkeleton('Failed to load.');
    }
}

function renderInstances(instances, timestamp) {
    const container = document.querySelector('.xl\\:col-span-3 .glass-panel');
    const timeStr = new Date(timestamp).toLocaleTimeString();
    const isCached = (Date.now() - timestamp) > 1000; // Just to detect if it's not fresh right now
    const cacheLabel = isCached ? `<span class="text-[10px] text-slate-500 font-normal ml-2 opacity-60">(Cached: ${timeStr})</span>` : '';

    let tableHTML = `
        <div class="px-6 py-5 border-b border-white/5 flex justify-between items-center bg-white/5">
            <h2 class="text-lg font-semibold text-white flex items-center">Instances ${cacheLabel}</h2>
            <span id="instance-count" class="bg-white/10 text-white text-xs font-bold px-2 py-1 rounded-md border border-white/5">${instances.length}</span>
        </div>
        <div class="overflow-x-auto">
            <table class="w-full text-left text-sm text-slate-400">
                <thead class="text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-white/5">
                    <tr>
                        <th class="px-6 py-4">Instance</th>
                        <th class="px-6 py-4">Location</th>
                        <th class="px-6 py-4">Status</th>
                        <th class="px-6 py-4">IP Address</th>
                        <th class="px-6 py-4 text-right">Actions</th>
                    </tr>
                </thead>
                <tbody id="instance-list" class="divide-y divide-white/5">
                    ${instances.length === 0 ? '<tr><td colspan="5" class="px-6 py-12 text-center text-slate-500">No active VMs found.</td></tr>' : ''}
                </tbody>
            </table>
        </div>`;
    
    container.innerHTML = tableHTML;
    if (instances.length === 0) return;

    const tbody = document.getElementById('instance-list');
    tbody.innerHTML = instances.map(vm => {
        const isRun = vm.provisioningState === 'Succeeded';
        const statusClass = isRun ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-red-500/20 text-red-400 border-red-500/30';
        
        return `
        <tr class="hover:bg-white/5 transition duration-200 group">
            <td class="px-6 py-4 font-medium text-white align-middle">
                <div class="flex items-center gap-3">
                    <div class="w-10 h-10 rounded-xl bg-gradient-to-br from-white/10 to-white/5 border border-white/10 flex items-center justify-center shadow-inner">
                        <svg class="w-5 h-5 text-blue-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01"></path></svg>
                    </div>
                    <div>
                        <div class="font-semibold tracking-tight">${vm.name}</div>
                        <div class="text-[10px] text-slate-500 font-mono uppercase tracking-wider mt-0.5">${vm.size}</div>
                    </div>
                </div>
            </td>
            <td class="px-6 py-4 text-slate-300">${vm.location}</td>
            <td class="px-6 py-4">
                <span class="${statusClass} text-[10px] font-bold border px-2.5 py-1 rounded-full uppercase tracking-wide inline-flex items-center gap-1.5 shadow-sm">
                    <span class="w-1.5 h-1.5 rounded-full ${isRun ? 'bg-green-400 animate-pulse' : 'bg-current'}"></span>
                    ${vm.provisioningState}
                </span>
            </td>
            <td class="px-6 py-4 font-mono text-xs text-slate-300">
                <div class="flex items-center gap-2 group/ip">
                    <span class="text-slate-500 font-bold w-6">v4:</span>
                    <span class="text-white select-all cursor-pointer hover:text-blue-300 transition" onclick="copyText(this.innerText)">${vm.publicIp}</span>
                    <button class="change-ip-btn opacity-0 group-hover/ip:opacity-100 px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 border border-blue-500/30 text-[9px] font-bold uppercase tracking-wider transition ml-auto" data-type="v4" data-name="${vm.name}" data-rg="${vm.resourceGroup}" title="Change IPv4">Swap</button>
                </div>
                <div class="flex items-center gap-2 mt-1.5 group/ipv6">
                    <span class="text-slate-500 font-bold w-6">v6:</span>
                    <span class="text-slate-300 select-all cursor-pointer hover:text-blue-300 transition text-[10px]" onclick="copyText(this.innerText)">${vm.publicIpV6 || 'Allocating...'}</span>
                    ${vm.publicIpV6 !== 'None' ? `<button class="change-ip-btn opacity-0 group-hover/ipv6:opacity-100 px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 border border-purple-500/30 text-[9px] font-bold uppercase tracking-wider transition ml-auto" data-type="v6" data-name="${vm.name}" data-rg="${vm.resourceGroup}" title="Change IPv6">Swap</button>` : ''}
                </div>
            </td>
            <td class="px-6 py-4 text-right">
                <div class="flex items-center justify-end gap-2">
                    <button onclick="action('stop', '${vm.name}', '${vm.resourceGroup}')" class="px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 text-xs font-medium transition">Stop</button>
                    <button onclick="action('start', '${vm.name}', '${vm.resourceGroup}')" class="px-3 py-1.5 rounded-lg bg-green-500/10 text-green-400 hover:bg-green-500/20 border border-green-500/20 text-xs font-medium transition">Start</button>
                    <button onclick="action('delete', '${vm.name}', '${vm.resourceGroup}')" class="p-1.5 rounded-lg hover:bg-red-500/20 text-slate-500 hover:text-red-400 transition" title="Delete">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                    </button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

function getTableSkeleton(msg) {
    return `
        <div class="px-6 py-5 border-b border-white/5 flex justify-between items-center bg-white/5">
            <h2 class="text-lg font-semibold text-white">Instances</h2>
            <span id="instance-count" class="bg-white/10 text-white text-xs font-bold px-2 py-1 rounded-md border border-white/5">...</span>
        </div>
        <div class="overflow-x-auto">
            <table class="w-full text-left text-sm text-slate-400">
                <thead class="text-xs font-bold uppercase tracking-wider text-slate-500 border-b border-white/5">
                    <tr>
                        <th class="px-6 py-4">Instance</th>
                        <th class="px-6 py-4">Location</th>
                        <th class="px-6 py-4">Status</th>
                        <th class="px-6 py-4">IP Address</th>
                        <th class="px-6 py-4 text-right">Actions</th>
                    </tr>
                </thead>
                <tbody id="instance-list" class="divide-y divide-white/5">
                    <tr><td colspan="5" class="px-6 py-12 text-center text-slate-500"><div class="inline-block animate-spin mr-2">⟳</div>${msg}</td></tr>
                </tbody>
            </table>
        </div>`;
}

async function action(act, name, rg) {
    if(!(await showConfirm(`Confirm ${act} on ${name}?`))) return;
    showToast(`Sending ${act} command...`);
    try {
        const res = await fetch(`${API_BASE}/instances/${act}`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ name, resourceGroup: rg })
        });
        const data = await res.json();
        if (data.success) {
            showToast('✅ Command sent!');
        } else {
            showToast(`❌ Error: ${data.error}`, true);
        }
    } catch(e) { showToast('❌ Network Error', true); }
}

async function changeIp(type, name, rg) {
    const label = type === 'v4' ? 'IPv4' : 'IPv6';
    // Prevent event bubbling if clicked inside row
    // if(event) event.stopPropagation(); // Removed as we use delegation now
    
    if(!(await showConfirm(`Are you sure you want to change ${label} for ${name}?\n\n⚠️ This will disconnect current SSH sessions!`))) return;
    
    showToast(`🔄 Changing ${label}... (Wait ~30s)`);
    try {
        const res = await fetch(`${API_BASE}/instances/change-ip${type}`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ name, resourceGroup: rg })
        });
        const data = await res.json();
        if (data.success) {
            showToast(`✅ New ${label}: ${data.newIp}`);
            setTimeout(loadInstances, 2000); 
        } else {
            showToast(`❌ Error: ${data.error}`, true);
        }
    } catch(e) { showToast('❌ Network Error', true); }
}

async function createInstance() {
    const btn = document.querySelector('#create-form .btn-primary');
    const name = document.querySelector('#create-form input[placeholder="e.g. web-server-01"]').value;
    const regionSelect = document.getElementById('region-select');
    const sizeSelect = document.getElementById('size-select');
    
    const location = regionSelect.value;
    const size = sizeSelect.value;
    const isSpot = false; 
    const enableIPv6 = document.getElementById('ipv6-toggle').checked;
    
    // Image Map
    const imageMap = {
        'debian12': {
            publisher: 'Debian',
            offer: 'debian-12',
            sku: '12',
            version: 'latest'
        },
        'ubuntu22': {
            publisher: 'Canonical',
            offer: '0001-com-ubuntu-server-jammy',
            sku: '22_04-lts-gen2',
            version: 'latest'
        },
        'ubuntu20': {
            publisher: 'Canonical',
            offer: '0001-com-ubuntu-server-focal',
            sku: '20_04-lts-gen2',
            version: 'latest'
        }
    };
    
    const imageSelect = document.getElementById('image-select');
    const selectedImageKey = imageSelect ? imageSelect.value : 'debian12';
    const selectedImage = imageMap[selectedImageKey];

    const userVal = document.getElementById('vm-user').value;
    const passVal = document.getElementById('vm-pass').value;

    if (!name) return showToast('❌ Missing VM Name', true);
    if (!passVal || passVal.length < 12) return showToast('❌ Password too short (min 12)', true);

    btn.disabled = true;
    btn.innerText = 'Deploying...';
    btn.classList.add('opacity-70');
    showToast('🚀 Deploying VM... (This takes ~2 mins)');

    try {
        const res = await fetch(`${API_BASE}/instances/create`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ 
                name, location, size, spot: isSpot,
                username: userVal || 'azureuser', 
                password: passVal,
                ipv6: enableIPv6,
                image: selectedImage
            })
        });
        const data = await res.json();
        
        if (data.success) {
            const successHtml = `
                <div class="space-y-4">
                    <div class="flex items-center gap-3 text-green-400 bg-green-500/10 p-3 rounded-xl border border-green-500/20">
                        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                        <span class="font-semibold">Deployment Task Started!</span>
                    </div>
                    <p>Your VM is being created in the background. It may take 1-3 minutes.</p>
                    
                    <div class="bg-black/40 rounded-xl p-4 border border-white/5 space-y-2">
                        <div class="flex justify-between items-center border-b border-white/5 pb-2 mb-2">
                            <span class="text-xs font-bold text-slate-500 uppercase">Credentials</span>
                            <span class="text-[10px] text-slate-600">Click to copy</span>
                        </div>
                        <div class="grid grid-cols-[60px_1fr] gap-2 items-center">
                            <span class="text-slate-400 text-xs text-right">User:</span>
                            <code class="font-mono text-blue-300 bg-blue-500/10 px-2 py-1 rounded cursor-pointer hover:bg-blue-500/20 transition" onclick="copyText('${userVal || 'azureuser'}')">${userVal || 'azureuser'}</code>
                            
                            <span class="text-slate-400 text-xs text-right">Pass:</span>
                            <code class="font-mono text-green-300 bg-green-500/10 px-2 py-1 rounded cursor-pointer hover:bg-green-500/20 transition break-all" onclick="copyText('${passVal}')">${passVal}</code>
                        </div>
                    </div>
                    
                    <p class="text-xs text-slate-500 text-center">Please save these credentials now!</p>
                </div>
            `;
            showMessage('🚀 Launch Initiated', successHtml);
            document.querySelector('#create-form input[placeholder="e.g. web-server-01"]').value = '';
        } else {
            showToast(`❌ Error: ${data.error}`, true);
        }
    } catch (e) { 
        showToast('❌ Network Error', true);
        console.error(e);
    } 
    finally {
        btn.disabled = false;
        btn.innerText = 'Deploy Instance';
        btn.classList.remove('opacity-70');
    }
}

async function saveKey() {
    const key = document.getElementById('azure-key').value;
    try {
        const res = await fetch(`${API_BASE}/setup/key`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ key })
        });
        const data = await res.json();
        if (data.success) {
            showToast('✅ Key Saved! Reloading...');
            setTimeout(() => location.reload(), 1500);
        } else {
            showToast('❌ Error: ' + data.error, true);
        }
    } catch (e) { showToast('❌ Network Error', true); }
}

async function nukeAll() {
    // Using custom modal for safety
    if (!(await showConfirm('⚠️ DANGER: DELETE ALL RESOURCES?\n\nThis will permanently destroy every Resource Group, VM, Disk, and IP in your subscription.\n\nThis action cannot be undone.'))) return;
    
    showToast(`☢️ Cleanup started...`);
    // UI Feedback
    const nukeStatus = document.getElementById('nuke-status');
    const nukeCount = document.getElementById('nuke-count');
    const nukeLast = document.getElementById('nuke-last');
    if(nukeStatus) nukeStatus.classList.remove('hidden');
    
    try {
        const res = await fetch(`${API_BASE}/nuke`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            showMessage('Cleanup Started', `<div class="text-center"><div class="text-red-400 font-bold text-lg mb-2">Deletion in Progress</div><p class="text-slate-300">Resources are being deleted in the background.</p><p class="text-slate-400 text-xs mt-2">Check Azure Portal for verification.</p></div>`);
            // Clear instance list locally
            document.getElementById('instance-list').innerHTML = '';
            document.getElementById('instance-count').innerText = '0';
        } else {
            showToast(`❌ Error: ${data.error}`, true);
        }
    } catch(e) { showToast('❌ Network Error', true); }
}
