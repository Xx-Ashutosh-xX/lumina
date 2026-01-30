/* -------------------------------------------------------------------------- */
/* CONFIGURATION                               */
/* -------------------------------------------------------------------------- */
// REPLACE THESE WITH YOUR GOOGLE CLOUD CREDENTIALS
const CLIENT_ID = '604202083198-v42ureir7mk74qk6u634haavjs9cq7o0.apps.googleusercontent.com';
const API_KEY = 'AIzaSyCfX175p6v9TTF4PLaDO2o3UOa4sQWiLzg';

const DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';
const SCOPES = 'https://www.googleapis.com/auth/drive.file';
const DB_FILE_NAME = 'lumina_db.json';

/* -------------------------------------------------------------------------- */
/* STATE & INIT                                */
/* -------------------------------------------------------------------------- */
let tokenClient;
let gapiInited = false;
let gisInited = false;
let driveFileId = null; 

const state = {
    currentDate: new Date(),
    selectedDate: new Date(),
    view: 'dashboard',
    categories: [],
    transactions: [],
    modal: { type: 'expense', selectedCatId: null }
};

const defaultCategories = [
    { id: 1, name: 'Food', icon: '🍔', color: '#FFB74D', limit: 600 },
    { id: 2, name: 'Home', icon: '🏠', color: '#64B5F6', limit: 1000 },
    { id: 3, name: 'Shopping', icon: '🛍️', color: '#F06292', limit: 400 },
    { id: 4, name: 'Health', icon: '💊', color: '#4DB6AC', limit: 200 },
    { id: 99, name: 'Salary', icon: '💰', color: '#00B894', limit: 0, type: 'income' }
];

document.addEventListener('DOMContentLoaded', () => {
    // 1. Load LocalStorage first (Instant load)
    loadLocalData();
    initApp();

    // 2. Load Google Scripts Manually to ensure correct timing
    loadGoogleScripts();
});

function loadGoogleScripts() {
    // Load GAPI
    const scriptGapi = document.createElement('script');
    scriptGapi.src = "https://apis.google.com/js/api.js";
    scriptGapi.async = true;
    scriptGapi.defer = true;
    scriptGapi.onload = () => gapi.load('client', initializeGapiClient);
    document.body.appendChild(scriptGapi);

    // Load GIS
    const scriptGis = document.createElement('script');
    scriptGis.src = "https://accounts.google.com/gsi/client";
    scriptGis.async = true;
    scriptGis.defer = true;
    scriptGis.onload = initializeGisClient;
    document.body.appendChild(scriptGis);
}

/* -------------------------------------------------------------------------- */
/* GOOGLE DRIVE LOGIC                              */
/* -------------------------------------------------------------------------- */

async function initializeGapiClient() {
    await gapi.client.init({ apiKey: API_KEY, discoveryDocs: [DISCOVERY_DOC] });
    gapiInited = true;
    checkAuth();
}

function initializeGisClient() {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: async (resp) => {
            if (resp.error) throw resp;
            updateSyncStatus("Syncing...");
            await findOrCreateDriveFile();
        },
    });
    gisInited = true;
    checkAuth();
}

function checkAuth() {
    if (gapiInited && gisInited) {
        document.getElementById('authorize_button').style.display = 'block';
    }
}

function handleAuthClick() {
    // SAFETY CHECK: Prevents crash if clicked too early
    if (!tokenClient) {
        alert("Google services are still loading. Please wait a few seconds.");
        return;
    }
    
    if (tokenClient.callback) {
        tokenClient.requestAccessToken({ prompt: 'consent' });
    }
}

async function findOrCreateDriveFile() {
    try {
        const response = await gapi.client.drive.files.list({
            q: `name = '${DB_FILE_NAME}' and trashed = false`,
            fields: 'files(id, name)',
        });
        const files = response.result.files;
        
        if (files && files.length > 0) {
            driveFileId = files[0].id;
            console.log('Found existing DB file:', driveFileId);
            await downloadDriveData();
        } else {
            console.log('Creating new DB file...');
            await createDriveFile();
        }
        
        document.getElementById('authorize_button').innerHTML = "✅ Connected";
        document.getElementById('authorize_button').style.background = "#e6fffa";
        updateSyncStatus("Synced");
    } catch (err) {
        console.error('Error finding file:', err);
        updateSyncStatus("Error connecting");
    }
}

async function downloadDriveData() {
    try {
        const response = await gapi.client.drive.files.get({
            fileId: driveFileId,
            alt: 'media',
        });
        
        const data = response.result;
        if (data && data.categories) {
            state.categories = data.categories;
            state.transactions = data.transactions;
            saveLocalData(); // Sync to local storage
            renderAll();
            updateSyncStatus("Loaded from Drive");
        }
    } catch (err) {
        console.error('Error downloading:', err);
    }
}

async function saveToDrive() {
    // Save to LocalStorage immediately
    saveLocalData(); 
    renderAll();

    // If not connected to Drive, just stop here
    if (!driveFileId) return;

    updateSyncStatus("Saving to Drive...");
    
    const fileContent = JSON.stringify({
        categories: state.categories,
        transactions: state.transactions
    });

    try {
        // Update existing file
        await gapi.client.request({
            path: `/upload/drive/v3/files/${driveFileId}`,
            method: 'PATCH',
            params: { uploadType: 'media' },
            body: fileContent
        });
        updateSyncStatus("All changes saved");
    } catch (err) {
        console.error('Error saving:', err);
        updateSyncStatus("Save failed");
    }
}

async function createDriveFile() {
    const fileContent = JSON.stringify({
        categories: state.categories,
        transactions: state.transactions
    });

    const metadata = {
        name: DB_FILE_NAME,
        mimeType: 'application/json'
    };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', new Blob([fileContent], { type: 'application/json' }));

    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: new Headers({ 'Authorization': 'Bearer ' + gapi.client.getToken().access_token }),
        body: form
    });
    
    const val = await response.json();
    driveFileId = val.id;
}

function updateSyncStatus(msg) {
    document.getElementById('sync_status').textContent = msg;
}

/* -------------------------------------------------------------------------- */
/* APP LOGIC                              */
/* -------------------------------------------------------------------------- */
function initApp() {
    document.getElementById('currentDateDisplay').textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' });
    document.getElementById('inputDate').valueAsDate = new Date();
    renderAll();
}

function saveLocalData() {
    localStorage.setItem('luminaBudget_data', JSON.stringify({
        categories: state.categories,
        transactions: state.transactions
    }));
}

function loadLocalData() {
    const stored = localStorage.getItem('luminaBudget_data');
    if (stored) {
        const data = JSON.parse(stored);
        state.categories = data.categories;
        state.transactions = data.transactions;
    } else {
        state.categories = [...defaultCategories];
        state.transactions = [];
    }
}

function deleteTransaction(id) {
    if(confirm("Delete transaction?")) {
        state.transactions = state.transactions.filter(t => t.id !== id);
        saveToDrive();
    }
}

function deleteCategory(id) {
    if(confirm("Delete category?")) {
        state.categories = state.categories.filter(c => c.id !== id);
        saveToDrive();
    }
}

function submitTransaction() {
    const amt = parseFloat(document.getElementById('inputAmount').value);
    const desc = document.getElementById('inputDesc').value;
    const dateVal = document.getElementById('inputDate').valueAsDate;
    
    if(!amt || !state.modal.selectedCatId || !dateVal) {
        alert("Please fill required fields");
        return;
    }

    state.transactions.push({
        id: Date.now(),
        catId: state.modal.selectedCatId,
        amount: amt,
        desc: desc,
        type: state.modal.type,
        date: dateVal.toISOString()
    });

    closeModal('transModal');
    saveToDrive();
}

function submitCategory() {
    const name = document.getElementById('newCatName').value;
    const limit = parseFloat(document.getElementById('newCatLimit').value) || 0;
    const color = document.getElementById('newCatColor').value;
    
    if(!name) return;

    state.categories.push({
        id: Date.now(),
        name: name,
        icon: name.charAt(0).toUpperCase(),
        color: color,
        limit: limit,
        type: 'expense'
    });

    closeModal('catModal');
    saveToDrive();
}

/* RENDER */
function renderAll() {
    updateHeader();
    renderDashboard();
    renderHistory();
    renderCalendar();
    renderManageCategories();
}

function switchView(viewName, btnElement) {
    document.querySelectorAll('.view-section').forEach(el => el.style.display = 'none');
    document.getElementById(`view-${viewName}`).style.display = 'block';
    
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.mob-nav-item').forEach(el => el.classList.remove('active'));

    if(btnElement) btnElement.classList.add('active');
    
    if(viewName === 'dashboard') {
        document.querySelectorAll('.nav-item')[0]?.classList.add('active');
        document.querySelectorAll('.mob-nav-item')[0]?.classList.add('active');
    }

    state.view = viewName;
    const titles = { 'dashboard': 'Overview', 'history': 'History', 'calendar': 'Calendar', 'categories': 'Budget Management' };
    document.getElementById('pageTitle').textContent = titles[viewName];
    renderAll();
}

function changeMonth(offset) {
    state.currentDate.setMonth(state.currentDate.getMonth() + offset);
    renderAll();
}

function updateHeader() {
    const options = { month: 'long', year: 'numeric' };
    document.getElementById('currentMonthYear').textContent = state.currentDate.toLocaleDateString('en-US', options);
}

function renderDashboard() {
    const { income, expense, balance, monthlyTrans } = getMonthStats();
    document.getElementById('totalIncome').textContent = formatCurrency(income);
    document.getElementById('totalExpense').textContent = formatCurrency(expense);
    document.getElementById('totalBalance').textContent = formatCurrency(balance);

    const listEl = document.getElementById('dashboardTransList');
    listEl.innerHTML = '';
    monthlyTrans.sort((a,b) => new Date(b.date) - new Date(a.date)).slice(0, 5).forEach(t => {
        listEl.appendChild(createTransactionEl(t, false));
    });

    if(monthlyTrans.length === 0) listEl.innerHTML = '<div style="text-align:center; padding:20px; color:#aaa">No activity.</div>';

    const budgetGrid = document.getElementById('dashboardBudgetGrid');
    budgetGrid.innerHTML = '';
    
    state.categories.filter(c => c.type !== 'income').forEach(cat => {
        const spent = monthlyTrans.filter(t => t.catId === cat.id && t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
        const limit = cat.limit || 1;
        const remaining = limit - spent;
        const percent = Math.min(100, Math.max(0, (remaining / limit) * 100));
        
        const r = 36; const c = 2 * Math.PI * r; const offset = c - (percent / 100) * c;
        const color = percent < 20 ? 'var(--danger)' : cat.color;

        const div = document.createElement('div');
        div.className = 'budget-item';
        div.innerHTML = `
            <div class="donut-chart">
                <svg><circle cx="40" cy="40" r="${r}" stroke="#eee"></circle><circle cx="40" cy="40" r="${r}" stroke="${color}" stroke-dasharray="${c}" stroke-dashoffset="${offset}"></circle></svg>
            </div>
            <div>
                <strong style="display:block; font-size:1rem">${cat.name}</strong>
                <span style="font-size:0.9rem; color:#888">${formatCurrency(remaining)} left</span>
            </div>
        `;
        budgetGrid.appendChild(div);
    });
}

function renderHistory() {
    const listEl = document.getElementById('fullHistoryList');
    listEl.innerHTML = '';
    const allTrans = [...state.transactions].sort((a,b) => new Date(b.date) - new Date(a.date));
    allTrans.forEach(t => listEl.appendChild(createTransactionEl(t, true)));
    if(allTrans.length === 0) listEl.innerHTML = '<div style="text-align:center; padding:30px; color:#aaa">No history.</div>';
}

function renderCalendar() {
    const grid = document.getElementById('calendarGrid');
    grid.innerHTML = '';
    const year = state.currentDate.getFullYear();
    const month = state.currentDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for(let i=0; i<firstDay; i++) { grid.appendChild(document.createElement('div')); }

    for(let i=1; i<=daysInMonth; i++) {
        const dateStr = new Date(year, month, i).toDateString();
        const dayTrans = state.transactions.filter(t => new Date(t.date).toDateString() === dateStr);
        
        const cell = document.createElement('div');
        cell.className = 'cal-cell';
        if(dateStr === new Date().toDateString()) cell.classList.add('today');
        if(dateStr === state.selectedDate.toDateString()) cell.classList.add('selected');
        
        let dots = '<div class="day-dots">';
        dayTrans.slice(0,5).forEach(t => dots += `<div class="dot ${t.type}"></div>`);
        dots += '</div>';

        cell.innerHTML = `<span class="day-number">${i}</span> ${dots}`;
        cell.onclick = () => {
            state.selectedDate = new Date(year, month, i);
            renderCalendar();
            renderCalendarDetails();
        };

        grid.appendChild(cell);
    }
    renderCalendarDetails();
}

function renderCalendarDetails() {
    const list = document.getElementById('calTransList');
    list.innerHTML = '';
    document.getElementById('calSelectedDate').textContent = state.selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric'});
    const dateStr = state.selectedDate.toDateString();
    const dayTrans = state.transactions.filter(t => new Date(t.date).toDateString() === dateStr);
    dayTrans.forEach(t => list.appendChild(createTransactionEl(t, false)));
    if(dayTrans.length === 0) list.innerHTML = '<div style="color:#aaa; font-style:italic; padding:20px;">No transactions.</div>';
}

function renderManageCategories() {
    const list = document.getElementById('allCatsList');
    list.innerHTML = '';
    state.categories.forEach(cat => {
        const item = document.createElement('div');
        item.className = 'cat-manage-item';
        const deleteBtn = (cat.id === 99) ? '' : `<button class="delete-btn" onclick="deleteCategory(${cat.id})">🗑️</button>`;
        item.innerHTML = `
            <div class="cat-manage-left">
                <div class="cat-circle" style="background:${cat.color}">${cat.icon}</div>
                <div>
                    <strong style="font-size:1.2rem; display:block;">${cat.name}</strong>
                    <span style="font-size:1rem; color:#888;">Limit: ${cat.limit ? formatCurrency(cat.limit) : 'None'}</span>
                </div>
            </div>
            ${deleteBtn}
        `;
        list.appendChild(item);
    });
}

function openModal() { document.getElementById('transModal').style.display = 'flex'; setTransType('expense'); }
function openCatModal() { document.getElementById('catModal').style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }
function setTransType(type) {
    state.modal.type = type;
    document.getElementById('typeExpense').classList.toggle('active', type === 'expense');
    document.getElementById('typeIncome').classList.toggle('active', type === 'income');
    renderModalCategories();
}
function renderModalCategories() {
    const grid = document.getElementById('modalCatGrid');
    grid.innerHTML = '';
    const relevantCats = state.categories.filter(c => state.modal.type === 'income' ? c.type === 'income' : c.type !== 'income');
    relevantCats.forEach(cat => {
        const el = document.createElement('div');
        el.className = `cat-option ${state.modal.selectedCatId === cat.id ? 'selected' : ''}`;
        el.onclick = () => { state.modal.selectedCatId = cat.id; renderModalCategories(); };
        el.innerHTML = `<div class="cat-circle" style="background:${cat.color}">${cat.icon}</div><span class="cat-label">${cat.name}</span>`;
        grid.appendChild(el);
    });
}
function getMonthStats() {
    const year = state.currentDate.getFullYear();
    const month = state.currentDate.getMonth();
    const monthlyTrans = state.transactions.filter(t => { const d = new Date(t.date); return d.getFullYear() === year && d.getMonth() === month; });
    const income = monthlyTrans.filter(t => t.type === 'income').reduce((sum,t) => sum+t.amount, 0);
    const expense = monthlyTrans.filter(t => t.type === 'expense').reduce((sum,t) => sum+t.amount, 0);
    return { income, expense, balance: income - expense, monthlyTrans };
}
function formatCurrency(num) { return '$' + num.toLocaleString('en-US', {minimumFractionDigits: 0, maximumFractionDigits: 0}); }
function createTransactionEl(t, isHistoryRow) {
    const cat = state.categories.find(c => c.id === t.catId) || { name: 'Deleted', icon: '❓', color: '#ccc' };
    const dateStr = new Date(t.date).toLocaleDateString();
    const mainTitle = t.desc ? t.desc : cat.name;
    const subText = t.desc ? `${cat.name} • ${dateStr}` : dateStr;
    const div = document.createElement('div');
    div.className = isHistoryRow ? 'trans-item history-row' : 'trans-item';
    
    if(isHistoryRow) {
        div.innerHTML = `
            <div class="trans-left">
                <div class="trans-icon" style="background:${cat.color}">${cat.icon}</div>
                <div class="trans-info"><h4>${mainTitle}</h4><span>${t.desc ? cat.name : ''}</span></div>
            </div>
            <div style="font-weight:600; color:#888;">${dateStr}</div>
            <div class="trans-amount ${t.type === 'income' ? 'pos' : 'neg'}">
                ${t.type === 'income' ? '+' : '-'}${formatCurrency(t.amount)}
            </div>
            <div style="display:flex; justify-content:flex-end;">
                <button class="delete-btn" onclick="deleteTransaction(${t.id})">🗑️</button>
            </div>
        `;
    } else {
        div.innerHTML = `
            <div class="trans-left">
                <div class="trans-icon" style="background:${cat.color}">${cat.icon}</div>
                <div class="trans-info"><h4>${mainTitle}</h4><span>${subText}</span></div>
            </div>
            <div class="trans-amount ${t.type === 'income' ? 'pos' : 'neg'}">
                ${t.type === 'income' ? '+' : '-'}${formatCurrency(t.amount)}
            </div>
        `;
    }
    return div;
}