import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

// تسجيل Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(err => console.log('SW registration failed', err));
    });
}

const firebaseConfig = {
    apiKey: "AIzaSyBcFdnGgYs8dAbp_fF2Xy9jOa5_avE0l9o",
    authDomain: "kjjkj-21259.firebaseapp.com",
    projectId: "kjjkj-21259",
    storageBucket: "kjjkj-21259.firebasestorage.app",
    messagingSenderId: "424983926852",
    appId: "1:424983926852:web:0e2dfc9d1f0fa2a0564411"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let currentLoggedTowerCode = "";
let currentLoggedTowerName = "";
let editCustomerId = null;
let allTowersData = [];
let allCustomersData = [];
let isSyncing = false;

async function saveLoginState() {
    await localforage.setItem('savedTowerLogin', { towerCode: currentLoggedTowerCode, towerName: currentLoggedTowerName });
}

async function clearLoginState() {
    await localforage.removeItem('savedTowerLogin');
}

function goToDashboardDirect() {
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('login-section').style.display = 'none';
    document.getElementById('greeting-section').style.display = 'none';
    document.getElementById('dashboard-section').style.display = 'block';
    if (currentLoggedTowerName) {
        document.getElementById('greeting-text').innerText = currentLoggedTowerName;
    }
    window.renderCustomers();
    updateSearchAvailability();
}


function calculateEndDateFromStartDate(startDate) {
    if (!startDate) return "";
    let start = new Date(startDate);
    let endDate = new Date(start);
    endDate.setDate(start.getDate() + 30);
    return endDate.toISOString().split('T')[0];
}

function updateEndDateFromStartDate() {
    let startDate = document.getElementById('startDate').value;
    document.getElementById('endDate').value = calculateEndDateFromStartDate(startDate);
}

// تحديث حالة توفر البحث (تم تعديلها ليكون البحث متاحاً دائماً)
function updateSearchAvailability() {
    const searchInput = document.getElementById('searchInput');
    const searchBtn = document.getElementById('searchBtn');
    if (!searchInput || !searchBtn) return;

    searchInput.disabled = false;
    searchBtn.disabled = false;
}

// إدارة حالة الاتصال والمزامنة (بالمؤشر الصغير)
function updateNetworkStatus(status) {
    const banner = document.getElementById('network-status');
    const bannerText = document.getElementById('network-status-text');
    if (!banner || !bannerText) return;

    banner.className = 'status-badge ' + status;
    if (status === 'online') {
        banner.style.display = 'block';
        bannerText.innerText = 'مباشر';
        setTimeout(() => { banner.style.display = 'none'; }, 2000);
    } else if (status === 'offline') {
        banner.style.display = 'block';
        bannerText.innerText = 'غير متصل';
    } else if (status === 'syncing') {
        banner.style.display = 'block';
        bannerText.innerText = 'جاري المزامنة...';
    }
    updateSearchAvailability();
}

window.addEventListener('online', () => {
    updateNetworkStatus('online');
    processSyncQueue();
});

window.addEventListener('offline', () => {
    updateNetworkStatus('offline');
});

if (!navigator.onLine) {
    updateNetworkStatus('offline');
}

window.addEventListener('load', () => {
    updateSearchAvailability();
    if (navigator.onLine) processSyncQueue();
});

window.addEventListener('focus', () => {
    if (navigator.onLine) processSyncQueue();
});

// مهم للموبايل: عند العودة للتطبيق بعد تبديل التطبيقات
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        updateSearchAvailability();
        if (navigator.onLine) processSyncQueue();
    }
});

// فحص دوري كل 15 ثانية - إذا كان هناك طابور ولم تتم مزامنته، حاول من جديد
setInterval(async () => {
    if (navigator.onLine && !isSyncing) {
        let queue = await localforage.getItem('syncQueue') || [];
        if (queue.length > 0) {
            processSyncQueue();
        }
    }
}, 15000);

// نظام طابور المزامنة (Sync Queue) لمنع التكرار والحفظ للأوفلاين
async function saveOperationToQueue(action, id, customerData) {
    let queue = await localforage.getItem('syncQueue') || [];
    
    if (action === 'delete') {
        queue = queue.filter(op => op.id !== id);
        queue.push({ action: 'delete', id: id });
    } else if (action === 'edit') {
        let existingIdx = queue.findIndex(op => op.id === id);
        if (existingIdx !== -1) {
            queue[existingIdx].customer = customerData;
        } else {
            queue.push({ action: 'edit', id: id, customer: customerData });
        }
    } else if (action === 'add') {
        queue.push({ action: 'add', id: id, customer: customerData });
    }
    
    await localforage.setItem('syncQueue', queue);
}

async function processSyncQueue() {
    if (isSyncing) return; // منع التزامن المتوازي
    if (!navigator.onLine) return;

    let queue = await localforage.getItem('syncQueue') || [];
    if (queue.length === 0) return;

    isSyncing = true;
    updateNetworkStatus('syncing');
    
    try {
        const docRef = doc(db, "data", "customers");
        const docSnap = await getDoc(docRef);
        let latestData = docSnap.exists() ? docSnap.data().customersData || [] : [];

        for (let op of queue) {
            if (op.action === 'add') {
                let exists = latestData.find(c => c.id === op.customer.id);
                if (!exists) latestData.push(op.customer);
            } else if (op.action === 'edit') {
                let idx = latestData.findIndex(c => c.id === op.id);
                if (idx !== -1) {
                     latestData[idx] = op.customer;
                } else {
                     latestData.push(op.customer);
                }
            } else if (op.action === 'delete') {
                latestData = latestData.filter(c => c.id !== op.id);
            }
        }

        await setDoc(docRef, { customersData: latestData });
        allCustomersData = latestData;
        await localforage.setItem('cachedCustomers', allCustomersData);
        await localforage.setItem('syncQueue', []);
        if (currentLoggedTowerCode) window.renderCustomers();
        isSyncing = false;
        updateNetworkStatus('online');
    } catch (error) {
        console.error("Sync failed", error);
        isSyncing = false;
        updateNetworkStatus('offline');
    }
}

let unsubTowers = null;
let unsubCustomers = null;

// تحميل البيانات مبدئياً من المحلي (Offline First)
async function initData() {
    let cachedCustomers = await localforage.getItem('cachedCustomers');
    if (cachedCustomers) {
        allCustomersData = cachedCustomers;
        if (currentLoggedTowerCode) window.renderCustomers();
    }

    let cachedTowers = await localforage.getItem('cachedTowers');
    if (cachedTowers) {
        allTowersData = cachedTowers;
    }
}
initData();

function startFirestoreListeners() {
    if (!unsubTowers) {
        unsubTowers = onSnapshot(doc(db, "data", "towers"), async (docSnap) => {
            if (docSnap.exists()) {
                allTowersData = docSnap.data().towersArray || [];
                await localforage.setItem('cachedTowers', allTowersData);
            }
        });
    }

    if (!unsubCustomers) {
        unsubCustomers = onSnapshot(doc(db, "data", "customers"), async (docSnap) => {
            if (docSnap.exists()) {
                let queue = await localforage.getItem('syncQueue') || [];
                if (queue.length === 0) {
                    allCustomersData = docSnap.data().customersData || [];
                    await localforage.setItem('cachedCustomers', allCustomersData);
                    if (currentLoggedTowerCode) window.renderCustomers();
                } else if (navigator.onLine && !isSyncing) {
                    // البيانات جاءت من Firestore لكن عندنا طابور ينتظر - عالج الطابور الآن
                    processSyncQueue();
                }
            }
        });
    }

    if (navigator.onLine) {
        processSyncQueue();
    }
}

function stopFirestoreListeners() {
    if (unsubTowers) { unsubTowers(); unsubTowers = null; }
    if (unsubCustomers) { unsubCustomers(); unsubCustomers = null; }
}

function sendWhatsAppMessage(phone, text) {
    if (!phone) return;
    let formattedPhone = phone;
    // تنظيف الرقم من المسافات
    formattedPhone = formattedPhone.replace(/\D/g, '');
    // إضافة كود العراق للضمان في حال ادخال الرقم بصيغة 07
    if (formattedPhone.startsWith('07')) {
        formattedPhone = '964' + formattedPhone.substring(1);
    }
    let url = `https://wa.me/${formattedPhone}?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
}

window.loginWithGoogle = function() {
    setPersistence(auth, browserLocalPersistence).then(() => {
        const provider = new GoogleAuthProvider();
        return signInWithPopup(auth, provider);
    }).catch(error => {
        alert("خطأ: " + error.message);
    });
};

onAuthStateChanged(auth, async (user) => {
    if(user) {
        document.getElementById('auth-screen').style.display = 'none';
        
        startFirestoreListeners();

        const savedLogin = await localforage.getItem('savedTowerLogin');
        if (savedLogin && savedLogin.towerCode) {
            currentLoggedTowerCode = savedLogin.towerCode;
            currentLoggedTowerName = savedLogin.towerName || "";
            goToDashboardDirect();
            if (navigator.onLine) processSyncQueue();
        } else if (!currentLoggedTowerCode) {
            document.getElementById('login-section').style.display = 'block';
        }
    } else {
        stopFirestoreListeners();
        document.getElementById('auth-screen').style.display = 'flex';
        document.getElementById('login-section').style.display = 'none';
        document.getElementById('dashboard-section').style.display = 'none';
        document.getElementById('greeting-section').style.display = 'none';
    }
});

window.showModal = function(msg, type, onConfirmCallback) {
    document.getElementById('customModal').style.display = 'flex';
    document.getElementById('modalMsg').innerText = msg;
    let actions = document.getElementById('modalActions');
    actions.innerHTML = "";

    if (type === 'alert') {
        let btn = document.createElement('button');
        btn.className = 'modal-btn btn-confirm';
        btn.innerText = 'حسناً';
        btn.onclick = () => { document.getElementById('customModal').style.display = 'none'; };
        actions.appendChild(btn);
    } else if (type === 'confirm') {
        let btnYes = document.createElement('button');
        btnYes.className = 'modal-btn btn-confirm';
        btnYes.innerText = 'نعم';
        btnYes.onclick = () => { 
            document.getElementById('customModal').style.display = 'none'; 
            if (onConfirmCallback) onConfirmCallback();
        };
        let btnNo = document.createElement('button');
        btnNo.className = 'modal-btn btn-cancel';
        btnNo.innerText = 'إلغاء';
        btnNo.onclick = () => { document.getElementById('customModal').style.display = 'none'; };
        actions.appendChild(btnYes);
        actions.appendChild(btnNo);
    }
}

window.showInputModal = function(msg, onConfirmCallback) {
    document.getElementById('inputModal').style.display = 'flex';
    document.getElementById('inputModalMsg').innerText = msg;
    document.getElementById('inputModalValue').value = "";
    let actions = document.getElementById('inputModalActions');
    actions.innerHTML = "";

    let btnYes = document.createElement('button');
        btnYes.className = 'modal-btn btn-confirm';
    btnYes.innerText = 'تأكيد';
    btnYes.onclick = () => { 
        let val = document.getElementById('inputModalValue').value;
        document.getElementById('inputModal').style.display = 'none'; 
        if (onConfirmCallback) onConfirmCallback(val);
    };
    let btnNo = document.createElement('button');
    btnNo.className = 'modal-btn btn-cancel';
    btnNo.innerText = 'إلغاء';
    btnNo.onclick = () => { document.getElementById('inputModal').style.display = 'none'; };
    
    actions.appendChild(btnYes);
    actions.appendChild(btnNo);
}

window.showNoteModal = function(msg, onConfirmCallback) {
    document.getElementById('noteModal').style.display = 'flex';
    document.getElementById('noteModalMsg').innerText = msg;
    document.getElementById('noteModalValue').value = "";
    let actions = document.getElementById('noteModalActions');
    actions.innerHTML = "";

    let btnYes = document.createElement('button');
    btnYes.className = 'modal-btn btn-confirm';
    btnYes.innerText = 'تأكيد';
    btnYes.onclick = () => { 
        let val = document.getElementById('noteModalValue').value;
        document.getElementById('noteModal').style.display = 'none'; 
        if (onConfirmCallback) onConfirmCallback(val);
    };
    let btnNo = document.createElement('button');
    btnNo.className = 'modal-btn btn-cancel';
    btnNo.innerText = 'إلغاء';
    btnNo.onclick = () => { document.getElementById('noteModal').style.display = 'none'; };
    
    actions.appendChild(btnYes);
    actions.appendChild(btnNo);
}

window.checkCode = function() {
    let enteredCode = document.getElementById('enteredCode').value;
    let errorMsg = document.getElementById('error-msg');
    
    if (allTowersData.length === 0) { 
        errorMsg.innerText = "لا توجد أبراج مسجلة! تأكد من إنشائها في موقع الإدارة أولاً."; 
        return; 
    }

    let foundTower = null;

    for (let i = 0; i < allTowersData.length; i++) {
        if (allTowersData[i].towerCode === enteredCode) { 
            foundTower = allTowersData[i]; 
            break; 
        }
    }

    if (foundTower) {
        errorMsg.innerText = ""; 
        currentLoggedTowerCode = foundTower.towerCode; 
        currentLoggedTowerName = foundTower.towerName || "";
        
        document.getElementById('greeting-text').innerText = currentLoggedTowerName;
        document.getElementById('login-section').style.display = 'none';
        document.getElementById('greeting-section').style.display = 'flex';
    } else {
        errorMsg.innerText = "كلمة السر (الرمز) غير صحيحة، يرجى المحاولة مرة أخرى.";
    }
}

window.confirmIdentity = async function() {
    document.getElementById('greeting-section').style.display = 'none';
    document.getElementById('dashboard-section').style.display = 'block';
    await saveLoginState();
    if (navigator.onLine) processSyncQueue();
    window.renderCustomers(); 
    updateSearchAvailability();
}

window.cancelLogin = async function() {
    document.getElementById('greeting-section').style.display = 'none';
    document.getElementById('login-section').style.display = 'block';
    document.getElementById('enteredCode').value = "";
    currentLoggedTowerCode = ""; 
    currentLoggedTowerName = "";
    await clearLoginState();
}

window.switchAccount = async function() {
    document.getElementById('dashboard-section').style.display = 'none';
    document.getElementById('greeting-section').style.display = 'none';
    document.getElementById('login-section').style.display = 'block';
    document.getElementById('enteredCode').value = "";
    currentLoggedTowerCode = "";
    currentLoggedTowerName = "";
    await clearLoginState();
}

window.switchCustomerTab = function(tab) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.customer-tab-content').forEach(content => content.classList.remove('active'));

    if(tab === 'all') {
        document.querySelector('.tab-btn:nth-child(1)').classList.add('active');
        document.getElementById('all-customers-tab').classList.add('active');
    } else if (tab === 'expired') {
        document.querySelector('.tab-btn:nth-child(2)').classList.add('active');
        document.getElementById('expired-customers-tab').classList.add('active');
    } else if (tab === 'pdf') {
        document.querySelector('.tab-btn:nth-child(3)').classList.add('active');
        document.getElementById('pdf-customers-tab').classList.add('active');
    }
}

window.toggleAddForm = function() {
    let formSection = document.getElementById('addCustomerSection');
    if (formSection.style.display === 'none') {
        formSection.style.display = 'block';
        if (editCustomerId === null) {
            let today = new Date();
            document.getElementById('startDate').value = today.toISOString().split('T')[0];
            updateEndDateFromStartDate();
        }
    } else {
        formSection.style.display = 'none';
        window.resetForm();
    }
}

window.resetForm = function() {
    document.getElementById('customerName').value = "";
    document.getElementById('customerPhone').value = "";
    document.getElementById('customerPrice').value = "";
    document.getElementById('startDate').value = "";
    document.getElementById('endDate').value = "";
    editCustomerId = null;
    document.getElementById('saveCustomerBtn').innerText = "حفظ بيانات الزبون";
}

window.addCustomer = async function() {
    let name = document.getElementById('customerName').value;
    let phone = document.getElementById('customerPhone').value;
    let price = document.getElementById('customerPrice').value;
    let startDateInput = document.getElementById('startDate').value;

    if (name === "" || price === "" || startDateInput === "") { 
        window.showModal("الرجاء تعبئة جميع البيانات!", "alert"); 
        return; 
    }

    if (editCustomerId === null) {
        let finalStartDate, finalEndDate;
        let todayStr = new Date().toISOString().split('T')[0];
        
        if (startDateInput === todayStr) {
            let now = new Date();
            finalStartDate = now.toISOString();
            let end = new Date(now);
            end.setDate(end.getDate() + 30);
            finalEndDate = end.toISOString();
        } else {
            finalStartDate = startDateInput;
            finalEndDate = calculateEndDateFromStartDate(startDateInput);
        }

        let newCustomer = {
            id: Date.now(),
            towerCode: currentLoggedTowerCode,
            name: name,
            phone: phone,
            price: price,
            startDate: finalStartDate,
            endDate: finalEndDate,
            paid: 0,
            debts: 0,
            history: [{date: new Date().toISOString().split('T')[0], action: 'تسجيل اشتراك', amount: parseFloat(price)}],
            isPaid: false
        };
        allCustomersData.push(newCustomer);
        await saveOperationToQueue('add', newCustomer.id, newCustomer);
        window.showModal("تمت إضافة الزبون بنجاح!", "alert");
    } else {
        let updatedCustomer;
        for (let i = 0; i < allCustomersData.length; i++) {
            if (allCustomersData[i].id === editCustomerId) {
                allCustomersData[i].name = name;
                allCustomersData[i].phone = phone;
                allCustomersData[i].price = price;
                
                let oldStartDateStr = allCustomersData[i].startDate ? allCustomersData[i].startDate.split('T')[0] : "";
                
                if (startDateInput !== oldStartDateStr) {
                    allCustomersData[i].startDate = startDateInput;
                    allCustomersData[i].endDate = calculateEndDateFromStartDate(startDateInput);
                }
                
                updatedCustomer = allCustomersData[i];
                break;
            }
        }
        await saveOperationToQueue('edit', editCustomerId, updatedCustomer);
        window.showModal("تم التعديل بنجاح!", "alert");
    }

    await localforage.setItem('cachedCustomers', allCustomersData);
    window.resetForm();
    document.getElementById('addCustomerSection').style.display = 'none';
    window.renderCustomers();

    if (navigator.onLine) processSyncQueue();
}

window.searchCustomers = function() {
    let input = document.getElementById('searchInput').value.toLowerCase();
    let items = document.querySelectorAll('.customer-item');
    items.forEach(item => {
        let name = item.querySelector('.customer-header span').innerText.toLowerCase();
        if (name.includes(input)) {
            item.style.display = '';
        } else {
            item.style.display = 'none';
        }
    });
}

function formatDateTimeUI(isoString) {
    if (!isoString) return "";
    let d = new Date(isoString);
    if (isNaN(d.getTime())) return isoString;
    
    let year = d.getFullYear();
    let month = String(d.getMonth() + 1).padStart(2, '0');
    let day = String(d.getDate()).padStart(2, '0');
    
    if (isoString.length <= 10) {
        return `${year}/${month}/${day}`;
    }

    let hours = d.getHours();
    let minutes = String(d.getMinutes()).padStart(2, '0');
    let ampm = hours >= 12 ? 'PM' : 'AM';
    
    hours = hours % 12;
    hours = hours ? hours : 12; 
    let hoursStr = String(hours).padStart(2, '0');

    return `${year}/${month}/${day} (${hoursStr}:${minutes} ${ampm})`;
}

window.renderCustomers = function() {
    let listContainer = document.getElementById('customersList');
    let expiredContainer = document.getElementById('expiredList');
    listContainer.innerHTML = ""; 
    expiredContainer.innerHTML = "";

    let towerCustomers = allCustomersData.filter(cust => cust.towerCode === currentLoggedTowerCode);

    towerCustomers.sort((a, b) => {
        let getRemainingMs = (dateString) => {
            if (!dateString) return 0;
            let end = new Date(dateString);
            if (dateString.length <= 10) {
                end.setHours(23, 59, 59, 999);
            }
            return end - new Date();
        };
        return getRemainingMs(a.endDate) - getRemainingMs(b.endDate);
    });

    let towerDebt = 0;
    towerCustomers.forEach(cust => {
        let cDebts = cust.debts || 0;
        let cPaid = cust.paid || 0;
        let cTotal = parseFloat(cust.price || 0) + parseFloat(cDebts);
        let rem = cTotal - cPaid;
        if (rem > 0) {
            towerDebt += rem;
        }
    });
    
    document.getElementById('towerSubscribers').innerText = towerCustomers.length;
    document.getElementById('towerDebt').innerText = towerDebt;

    if (towerCustomers.length === 0) {
        listContainer.innerHTML = "<p style='text-align:center; color:#7f8c8d;'>لا يوجد زبائن حالياً في هذا البرج.</p>";
        expiredContainer.innerHTML = "<p style='text-align:center; color:#7f8c8d;'>لا يوجد زبائن منتهية اشتراكاتهم.</p>";
        return;
    }

    towerCustomers.forEach(customer => {
        // حساب موحد للانتهاء والمدة المتبقية
        let diffMs = 0;
        let isExpired = true;
        let remainingDays = 0;
        
        if (customer.endDate) {
            let endDateTime = new Date(customer.endDate);
            if (customer.endDate.length <= 10) {
                endDateTime.setHours(23, 59, 59, 999);
            }
            let now = new Date();
            diffMs = endDateTime - now;
            isExpired = diffMs <= 0;
            remainingDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        }
        
        // التعديل الثاني: تعيين صنف اللون حسب الأيام المتبقية
        let bgClass = "status-good";
        if (isExpired) {
            bgClass = "status-expired";
        } else if (remainingDays <= 3) {
            bgClass = "status-warning";
        }

        let cDebts = customer.debts || 0;
        let cPaid = customer.paid || 0;
        let originalPrice = parseFloat(customer.price || 0) + parseFloat(cDebts);
        let currentTotal = originalPrice - cPaid;
        let remaining = currentTotal;
        let currentDebt = Math.max(remaining, 0);

        let itemDiv = document.createElement('div');
        itemDiv.className = 'customer-item ' + bgClass; // إضافة كلاس اللون للبطاقة
        
        itemDiv.onclick = function(e) {
            if (e.target.tagName.toLowerCase() === 'button' || e.target.tagName.toLowerCase() === 'textarea') return;
            let details = document.getElementById('details-' + customer.id);
            if (details.classList.contains('show')) {
                details.classList.remove('show');
            } else {
                details.classList.add('show');
            }
        };

        let paymentHTML = "";
        if (remaining <= 0) {
            paymentHTML = `<span class="paid-badge">✔ تم التسديد</span>`;
        } else {
            paymentHTML = `<button class="pay-btn" onclick="paySubscription(${customer.id})">تسديد</button>`;
        }

        let remainingText = 'منتهي';
        if (!isExpired) {
            let totalMinutes = Math.floor(diffMs / (1000 * 60));
            let totalHours = Math.floor(totalMinutes / 60);
            let displayDays = Math.floor(totalHours / 24);
            let displayHours = totalHours % 24;
            let displayMinutes = totalMinutes % 60;

            if (displayDays > 0) {
                remainingText = displayDays + ' يوم ' + displayHours + ' ساعة';
            } else if (displayHours > 0) {
                remainingText = displayHours + ' ساعة ' + displayMinutes + ' دقيقة';
            } else {
                remainingText = displayMinutes + ' دقيقة';
            }
        }

        let displayStartDate = formatDateTimeUI(customer.startDate);
        let displayEndDate = formatDateTimeUI(customer.endDate);

        let safeNote = (customer.note || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");

        itemDiv.innerHTML = `
            <div class="customer-header">
                <div class="customer-name-wrap">
                    <span>${customer.name}</span>
                    <span class="customer-debt-inline">الدين: ${currentDebt} الف</span>
                </div>
                <span style="font-size: 0.9rem; color: ${isExpired ? '#e74c3c' : '#27ae60'}">${remainingText}</span>
            </div>
            <div class="customer-details" id="details-${customer.id}">
                <div class="top-note-section" style="margin-bottom: 15px; padding: 10px; background: rgba(255,255,255,0.6); border-radius: 8px;">
                    <button class="note-btn" onclick="toggleInlineNote(event)" style="margin-bottom: 0;">ملاحظات خاصة</button>
                    <div class="inline-note-container" style="display: none; margin-top: 10px;">
                        <textarea class="inline-note-text" style="width: 100%; min-height: 80px; padding: 10px; border: 1px solid #bdc3c7; border-radius: 5px; outline: none; font-size: 1rem; resize: none; overflow: hidden; font-family: inherit;" onclick="event.stopPropagation()" oninput="this.style.height = ''; this.style.height = this.scrollHeight + 'px'">${safeNote}</textarea>
                        <button class="primary-btn" style="width: 100%; margin-top: 10px; padding: 10px; font-size: 1.1rem; margin-bottom: 0;" onclick="saveInlineNote(${customer.id}, event)">حفظ الملاحظة</button>
                    </div>
                </div>
                <div class="customer-info">
                    <p><strong>الدين:</strong> <span style="color:#e74c3c; font-weight:bold;">${currentDebt} الف</span></p>
                    <p><strong>تاريخ البدء:</strong> ${displayStartDate}</p>
                    <p><strong>تاريخ الانتهاء:</strong> ${displayEndDate}</p>
                </div>
                <div class="payment-action" style="margin-top: 15px;">
                    <button class="renew-btn" onclick="renewSubscription(${customer.id})">تجديد الاشتراك</button>
                    <button class="add-debt-btn" onclick="addDebt(${customer.id})">إضافة دين</button>
                    ${paymentHTML}
                    <button class="edit-btn" onclick="editCustomer(${customer.id})">تعديل</button>
                    <button class="history-btn" onclick="showHistory(${customer.id})">سجل كامل</button>
                    <button class="delete-btn" onclick="deleteCustomer(${customer.id})">حذف</button>
                </div>
            </div>
        `;

        listContainer.appendChild(itemDiv);

        if (isExpired) {
            let expDiv = itemDiv.cloneNode(true);
            expDiv.innerHTML = itemDiv.innerHTML.replace(`id="details-${customer.id}"`, `id="details-exp-${customer.id}"`);
            expDiv.onclick = function(e) {
                if (e.target.tagName.toLowerCase() === 'button' || e.target.tagName.toLowerCase() === 'textarea') return;
                let details = document.getElementById('details-exp-' + customer.id);
                if (details.classList.contains('show')) details.classList.remove('show');
                else details.classList.add('show');
            };
            expiredContainer.appendChild(expDiv);
        }
    });

    if (expiredContainer.innerHTML === "") {
        expiredContainer.innerHTML = "<p style='text-align:center; color:#7f8c8d;'>لا يوجد زبائن منتهية اشتراكاتهم.</p>";
    }
}

window.paySubscription = function(id) {
    window.showInputModal("أدخل المبلغ المراد تسديده:", async (amount) => {
        if(!amount || isNaN(amount) || amount <= 0) {
            window.showModal("الرجاء إدخال مبلغ صحيح!", "alert");
            return;
        }
        let customer = allCustomersData.find(c => c.id === id);
        if (customer) {
            customer.paid = (customer.paid || 0) + parseFloat(amount);
            customer.history = customer.history || [];
            let today = new Date().toISOString().split('T')[0];
            customer.history.push({date: today, action: `تسديد مبلغ`, amount: parseFloat(amount)});
            
            await saveOperationToQueue('edit', id, customer);
            await localforage.setItem('cachedCustomers', allCustomersData);
            window.renderCustomers();
            if (navigator.onLine) processSyncQueue();

            if (customer.phone) {
                let displayStartDate = formatDateTimeUI(customer.startDate);
                let displayEndDate = formatDateTimeUI(customer.endDate);
                let originalPrice = parseFloat(customer.price || 0) + parseFloat(customer.debts || 0);
                let remaining = originalPrice - (customer.paid || 0);
                let currentDebt = Math.max(remaining, 0);
                
                let msg = `تم تسديد مبلغ: ${amount} الف\nالباقي: ${currentDebt} الف\nتاريخ بدء الاشتراك: ${displayStartDate}\nتاريخ انتهاء الاشتراك: ${displayEndDate}`;
                
                window.showModal("تم التسديد بنجاح! هل تود إرسال إشعار للزبون عبر الواتساب؟", "confirm", () => {
                    sendWhatsAppMessage(customer.phone, msg);
                });
            } else {
                window.showModal("تم التسديد بنجاح!", "alert");
            }
        }
    });
}

window.renewSubscription = function(id) {
    window.showInputModal("أدخل مبلغ التجديد:", async (amount) => {
        if(!amount || isNaN(amount) || amount <= 0) {
            window.showModal("الرجاء إدخال مبلغ صحيح!", "alert");
            return;
        }
        let customer = allCustomersData.find(c => c.id === id);
        if (customer) {
            customer.debts = (customer.debts || 0) + parseFloat(amount);
            
            let start = new Date();
            customer.startDate = start.toISOString();
            let end = new Date(start);
            end.setDate(end.getDate() + 30);
            customer.endDate = end.toISOString();

            customer.history = customer.history || [];
            let todayStr = new Date().toISOString().split('T')[0];
            customer.history.push({date: todayStr, action: `تجديد الاشتراك`, amount: parseFloat(amount)});
            
            await saveOperationToQueue('edit', id, customer);
            await localforage.setItem('cachedCustomers', allCustomersData);
            window.renderCustomers();
            if (navigator.onLine) processSyncQueue();

            if (customer.phone) {
                let displayStartDate = formatDateTimeUI(customer.startDate);
                let displayEndDate = formatDateTimeUI(customer.endDate);
                
                let msg = `تم تجديد الاشتراك بنجاح\nالحساب (المبلغ المضاف): ${amount} الف\nتاريخ بدء الاشتراك: ${displayStartDate}\nتاريخ انتهاء الاشتراك: ${displayEndDate}`;
                
                window.showModal("تم تجديد الاشتراك بنجاح! هل تود إرسال إشعار للزبون عبر الواتساب؟", "confirm", () => {
                    sendWhatsAppMessage(customer.phone, msg);
                });
            } else {
                window.showModal("تم تجديد الاشتراك بنجاح!", "alert");
            }
        }
    });
}

window.addDebt = function(id) {
    window.showInputModal("أدخل مبلغ الدين المضاف:", async (amount) => {
        if(!amount || isNaN(amount) || amount <= 0) {
            window.showModal("الرجاء إدخال مبلغ صحيح!", "alert");
            return;
        }
        let customer = allCustomersData.find(c => c.id === id);
        if (customer) {
            customer.debts = (customer.debts || 0) + parseFloat(amount);
            customer.history = customer.history || [];
            let today = new Date().toISOString().split('T')[0];
            customer.history.push({date: today, action: `إضافة دين`, amount: parseFloat(amount)});
            
            await saveOperationToQueue('edit', id, customer);
            await localforage.setItem('cachedCustomers', allCustomersData);
            window.showModal("تمت إضافة الدين بنجاح!", "alert");
            window.renderCustomers();
            if (navigator.onLine) processSyncQueue();
        }
    });
}

window.addNote = function(id) {
    window.showNoteModal("أدخل الملاحظة:", async (note) => {
        if(!note || note.trim() === "") {
            return;
        }
        let customer = allCustomersData.find(c => c.id === id);
        if (customer) {
            customer.history = customer.history || [];
            let today = new Date().toISOString().split('T')[0];
            customer.history.push({date: today, action: `ملاحظة: ${note}`, amount: ""});
            
            await saveOperationToQueue('edit', id, customer);
            await localforage.setItem('cachedCustomers', allCustomersData);
            window.showModal("تمت إضافة الملاحظة بنجاح!", "alert");
            window.renderCustomers();
            if (navigator.onLine) processSyncQueue();
        }
    });
}

window.showHistory = function(id) {
    let customer = allCustomersData.find(c => c.id === id);
    if (customer) {
        let historyHTML = "";
        let historyArr = customer.history || [];
        if (historyArr.length === 0) {
            historyHTML = "<p style='text-align:center; color:#7f8c8d;'>لا يوجد سجل متاح.</p>";
        } else {
            historyHTML = historyArr.map(h => `<div class='history-item'><strong>${h.date}:</strong> ${h.action} ${h.amount !== "" ? '(' + h.amount + ' الف)' : ''}</div>`).join('');
        }
        document.getElementById('historyContent').innerHTML = historyHTML;
        document.getElementById('historyModal').style.display = 'flex';
    }
}

window.editCustomer = function(id) {
    let customer = allCustomersData.find(c => c.id === id);
    if (customer) {
        document.getElementById('customerName').value = customer.name;
        document.getElementById('customerPhone').value = customer.phone || "";
        document.getElementById('customerPrice').value = customer.price;
        document.getElementById('startDate').value = customer.startDate ? customer.startDate.split('T')[0] : "";
        document.getElementById('endDate').value = customer.endDate ? customer.endDate.split('T')[0] : "";

        editCustomerId = id;
        document.getElementById('saveCustomerBtn').innerText = "تحديث بيانات الزبون";
        
        document.getElementById('addCustomerSection').style.display = 'block';
        window.scrollTo(0, 0);
    }
}

document.getElementById('startDate').addEventListener('change', updateEndDateFromStartDate);

window.toggleInlineNote = function(e) {
    e.stopPropagation();
    let container = e.target.nextElementSibling;
    if(container.style.display === 'none') {
        container.style.display = 'block';
        let textarea = container.querySelector('textarea');
        if(textarea) {
            textarea.style.height = ''; 
            textarea.style.height = textarea.scrollHeight + 'px';
            textarea.focus();
        }
    } else {
        container.style.display = 'none';
    }
}

window.saveInlineNote = async function(id, e) {
    e.stopPropagation();
    let textarea = e.target.previousElementSibling;
    let newNote = textarea.value;
    
    let customer = allCustomersData.find(c => c.id === id);
    if(customer) {
        customer.note = newNote;
        await saveOperationToQueue('edit', id, customer);
        await localforage.setItem('cachedCustomers', allCustomersData);
        window.showModal("تم حفظ الملاحظة بنجاح!", "alert");
        window.renderCustomers();
        if (navigator.onLine) processSyncQueue();
    }
}

window.deleteCustomer = function(id) {
    window.showModal("هل تود الحذف بالتأكيد؟", "confirm", async () => {
        allCustomersData = allCustomersData.filter(c => c.id !== id);
        await saveOperationToQueue('delete', id, null);
        await localforage.setItem('cachedCustomers', allCustomersData);
        window.showModal("تم الحذف بنجاح!", "alert");
        window.renderCustomers();
        if (navigator.onLine) processSyncQueue();
    });
}

window.exportToPDF = function() {
    let towerCustomers = allCustomersData.filter(cust => cust.towerCode === currentLoggedTowerCode);
    if (towerCustomers.length === 0) {
        window.showModal("لا يوجد زبائن حالياً للطباعة!", "alert");
        return;
    }
    
    let printWindow = window.open('', '_blank');
    let html = `
    <html dir="rtl">
    <head>
        <title>تصدير المشتركين والديون - ${currentLoggedTowerName}</title>
        <style>
            body { font-family: 'Segoe UI', Tahoma, sans-serif; padding: 20px; direction: rtl; }
            h2, h3 { text-align: center; color: #2c3e50; margin-bottom: 10px; }
            table { width: 100%; border-collapse: collapse; margin-top: 20px; }
            th, td { border: 1px solid #bdc3c7; padding: 10px; text-align: center; }
            th { background-color: #ecf0f1; color: #2c3e50; }
        </style>
    </head>
    <body onload="window.print();">
        <h2>قائمة المشتركين والديون</h2>
        <h3>البرج: ${currentLoggedTowerName}</h3>
        <table>
            <tr>
                <th>اسم المشترك</th>
                <th>الحساب (الدين)</th>
            </tr>`;
    
    towerCustomers.forEach(c => {
        let cDebts = c.debts || 0;
        let cPaid = c.paid || 0;
        let originalPrice = parseFloat(c.price || 0) + parseFloat(cDebts);
        let currentDebt = Math.max(originalPrice - cPaid, 0);
        html += `
            <tr>
                <td>${c.name}</td>
                <td>${currentDebt} الف</td>
            </tr>`;
    });
    
    html += `
        </table>
    </body>
    </html>`;
    
    printWindow.document.write(html);
    printWindow.document.close();
}
