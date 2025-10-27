import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import {
    getAuth,
    onAuthStateChanged,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import {
    getFirestore,
    doc,
    addDoc,
    setDoc,
    updateDoc,
    deleteDoc,
    onSnapshot,
    collection,
    getDocs
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// 🔥 ДОБАВЛЯЕМ ИМПОРТЫ ДЛЯ FIREBASE STORAGE
import {
    getStorage,
    ref,
    uploadBytes,
    getDownloadURL,
    deleteObject // опционально
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js";

// =================================================================
// ✅ ВАША РЕАЛЬНАЯ КОНФИГУРАЦИЯ FIREBASE
// =================================================================
const firebaseConfig = {
    // ВСТАВЛЕНЫ ВАШИ КЛЮЧИ:
    apiKey: "AIzaSyBRh4hOexYttvkts5AcOxi4bg3Yp7-2d90",
    authDomain: "training-diary-51f0f.firebaseapp.com",
    projectId: "training-diary-51f0f",
    storageBucket: "training-diary-51f0f.firebasestorage.app",
    messagingSenderId: "332026731208",
    appId: "1:332026731208:web:3fa953b94700d00349e3fd"
};

// 🔥 ВСТАВЬТЕ СКОПИРОВАННОЕ ИМЯ ЗДЕСЬ (например, 'oqsxplh6x')

const CLOUDINARY_CLOUD_NAME = 'dck5p8h6x';
const CLOUDINARY_UPLOAD_PRESET = 'training_diary';


// Используем projectId в качестве уникального ID приложения для структуры базы
const appId = firebaseConfig.projectId;
const initialAuthToken = null;
// =================================================================

if (!firebaseConfig || Object.keys(firebaseConfig).length === 0) {
    console.error("Firebase config is missing. Please provide it for the app to work correctly.");
}

// Инициализация Firebase

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app); // 🔥 ЭТА СТРОКА ДОЛЖНА БЫТЬ ЗДЕСЬ
let userId = null;


// 🔥 НОВОЕ: Переменные для хранения функций отписки от слушателей Firebase
let programsUnsubscribe = () => {};
let journalUnsubscribe = () => {};
let clientsUnsubscribe = () => {};
let cyclesUnsubscribe = () => {};
// 🔥 ДОБАВЛЕНО: Слушатели для БАДОВ и ОТЧЕТОВ
let supplementsUnsubscribe = () => {};
let reportsUnsubscribe = () => {};


// --- УПРАВЛЕНИЕ СОСТОЯНИЕМ ---
let state = {
    currentMode: null,
    currentPage: 'modeSelect',
    previousPage: 'programs',
    lastProgramsPage: 'programs', // or 'programsInCycle' or 'programDetails'

    cycles: [],
    selectedCycleId: null,
    programs: [],
    journal: [],
    clients: [],
    selectedClientId: null,
    selectedProgramIdForDetails: null,
    expandedExerciseId: null,
    editingSetId: null,

    // Журнал
    selectedJournalCategory: '',
    selectedJournalProgram: '',

    // БАДы (План приема)
    supplementPlan: null, // Будет содержать текущий план для selectedCycleId

    // Отчеты
    reports: [],
    selectedReportId: null, // Для редактирования

    // чтобы запомнить, какую программу мы хотим открыть после загрузки данных.
    openProgramAfterLoad: null,
};

if (state.calendarYear === undefined) {
    const today = new Date();
    state.calendarYear = today.getFullYear();
    state.calendarMonth = today.getMonth();
}



// =================================================================
// 🌟 НОВАЯ ФУНКЦИЯ: DEBOUNCE (Устранение потери фокуса при вводе)
// =================================================================
function debounce(func, delay) {
    let timeout;
    return function(...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), delay);
    };
}


function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast-message';
    toast.innerText = message;
    document.body.append(toast);

    setTimeout(() => {
        toast.classList.add('show');
    }, 100);

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 500);
    }, 3000);
}

// 🔥 Управление видимостью трех основных экранов
function toggleAppVisibility(isAuthenticated) {
    const authScreen = document.getElementById('auth-screen');
    const modeSelectScreen = document.getElementById('mode-select-screen');
    const container = document.querySelector('.container');
    const bottomNav = document.querySelector('.navigation');

    // Сброс всех экранов
    if (authScreen) authScreen.style.display = 'none';
    if (modeSelectScreen) modeSelectScreen.style.display = 'none';
    if (container) container.style.display = 'none';
    if (bottomNav) bottomNav.style.display = 'none';

    if (!isAuthenticated) {
        // 1. Не авторизован -> Показываем Auth
        if (authScreen) authScreen.style.display = 'flex';
        state.currentPage = 'auth';
    } else if (isAuthenticated && state.currentMode === null) {
        // 2. Авторизован, но режим не выбран -> Показываем Mode Select
        if (modeSelectScreen) modeSelectScreen.style.display = 'flex';
        state.currentPage = 'modeSelect';
    } else {
        // 3. Авторизован и режим выбран -> Показываем App Container
        if (container) container.style.display = 'block';
        if (bottomNav) bottomNav.style.display = 'flex';
    }
}


// --- ФУНКЦИИ FIREBASE ДЛЯ КОЛЛЕКЦИЙ ---


// ✅ ЦИКЛЫ
function getUserCyclesCollection() {
    if (state.currentMode === 'own') {
        return collection(db, `artifacts/${appId}/users/${userId}/cycles`);
    } else if (state.currentMode === 'personal' && state.selectedClientId) {
        return collection(db, `artifacts/${appId}/users/${userId}/clients/${state.selectedClientId}/cycles`);
    }
    return null;
}

// ✅ ПРОГРАММЫ
function getUserProgramsCollection() {
    if (!state.selectedCycleId) return null;

    if (state.currentMode === 'own') {
        return collection(db, `artifacts/${appId}/users/${userId}/cycles/${state.selectedCycleId}/programs`);
    } else if (state.currentMode === 'personal' && state.selectedClientId) {
        return collection(db, `artifacts/${appId}/users/${userId}/clients/${state.selectedClientId}/cycles/${state.selectedCycleId}/programs`);
    }
    return null;
}

// ✅ ДНЕВНИК
function getUserJournalCollection() {
    if (state.currentMode === 'own') {
        return collection(db, `artifacts/${appId}/users/${userId}/journal`);
    } else if (state.currentMode === 'personal' && state.selectedClientId) {
        return collection(db, `artifacts/${appId}/users/${userId}/clients/${state.selectedClientId}/journal`);
    }
    return null;
}

// ✅ КЛИЕНТЫ
function getClientsCollection() {
    return collection(db, `artifacts/${appId}/users/${userId}/clients`);
}








// 🔥 ДОБАВЛЕНО: Коллекция для планов БАДов
function getSupplementPlanDocRef() {
    if (!state.selectedCycleId) return null;

    let path;
    if (state.currentMode === 'own') {
        path = `artifacts/${appId}/users/${userId}/cycles/${state.selectedCycleId}`;
    } else if (state.currentMode === 'personal' && state.selectedClientId) {
        path = `artifacts/${appId}/users/${userId}/clients/${state.selectedClientId}/cycles/${state.selectedCycleId}`;
    }
    return path ? doc(db, path) : null;
}

// 🔥 Коллекция для Отчетов, привязанная к циклу
function getReportsCollection() {
    if (!state.selectedCycleId) return null;

    if (state.currentMode === 'own') {
        return collection(db, `artifacts/${appId}/users/${userId}/cycles/${state.selectedCycleId}/reports`);
    } else if (state.currentMode === 'personal' && state.selectedClientId) {
        return collection(db,
            `artifacts/${appId}/users/${userId}/clients/${state.selectedClientId}/cycles/${state.selectedCycleId}/reports`
        );
    }
    return null;
}






// --- БАЗОВЫЕ ФУНКЦИИ РЕНДЕРИНГА ---
function createElement(tag, classes, innerText = '') {
    const el = document.createElement(tag);
    if (classes) {
        el.className = classes;
    }
    el.innerText = innerText;
    return el;
}

// =================================================================
// 🔥 НОВЫЕ/ИЗМЕНЕННЫЕ ФУНКЦИИ: УТИЛИТЫ ДЛЯ ДАТ
// =================================================================

// Функция для получения дня недели на русском языке
function getDayOfWeek(dateString) {
    const [day, month, year] = dateString.split('.');
    // Создаем дату в формате ГГГГ-ММ-ДД для корректной работы new Date
    const date = new Date(`${year}-${month}-${day}`);
    const days = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
    return days[date.getDay()];
}

// Функция для генерации массива дат (например, на 7 или 14 дней)
function generateDates(startDateString, numberOfDays) {
    const [startDay, startMonth, startYear] = startDateString.split('.');
    const startDate = new Date(`${startYear}-${startMonth}-${startDay}`);
    const dates = [];

    for (let i = 0; i < numberOfDays; i++) {
        const currentDate = new Date(startDate);
        currentDate.setDate(startDate.getDate() + i);

        const day = String(currentDate.getDate()).padStart(2, '0');
        const month = String(currentDate.getMonth() + 1).padStart(2, '0');
        const year = currentDate.getFullYear();
        const dateString = `${day}.${month}.${year}`;

        dates.push({
            date: dateString,
            dayOfWeek: getDayOfWeek(dateString)
        });
    }
    return dates;
}

// Функция для форматирования даты (ДД.ММ)
function formatDayAndMonth(dateString) {
    const [day, month] = dateString.split('.');
    // Возвращаем ДД.ММ
    return `${day}.${month}`;
}

// Функция для получения сегодняшней даты в формате ДД.ММ.ГГГГ
function getTodayDateString() {
    const today = new Date();
    const day = String(today.getDate()).padStart(2, '0');
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const year = today.getFullYear();
    return `${day}.${month}.${year}`;
}

// 🔥 НОВАЯ ФУНКЦИЯ: Преобразование ДД.ММ.ГГГГ в ГГГГ-ММ-ДД (для input type="date")
function dateToInputFormat(dateString) {
    if (!dateString) return '';
    // Проверка, что формат уже не ГГГГ-ММ-ДД
    if (dateString.includes('-')) return dateString;

    const parts = dateString.split('.');
    if (parts.length === 3) {
        const [d, m, y] = parts;
        return `${y}-${m}-${d}`;
    }
    return '';
}




// =================================================================
// 🌟 РЕНДЕР: КНОПКА СМЕНЫ РЕЖИМА
// =================================================================
function renderModeChangeButton(contentContainer) {
    const logoutWrapper = createElement('div', 'logout-wrapper');

    const changeModeBtn = createElement('button', 'btn change-mode-btn', 'Сменить режим');
    changeModeBtn.addEventListener('click', () => {
        state.currentMode = null;
        state.selectedClientId = null;
        state.selectedCycleId = null;
        state.selectedProgramIdForDetails = null;
        setupDynamicListeners(); // Отключаем старые слушатели
        toggleAppVisibility(true); // Переключаем на экран выбора режима
    });

    const logoutBtn = createElement('button', 'btn back-btn logout-btn', 'Выход');
    logoutBtn.addEventListener('click', async () => {
        try {
            await signOut(auth);
            state.currentMode = null; // Сброс режима при выходе
            showToast('Вы вышли из системы.');
        } catch (error) {
            console.error("Ошибка при выходе:", error);
            showToast('Ошибка при выходе.');
        }
    });

    logoutWrapper.append(changeModeBtn, logoutBtn);
    contentContainer.append(logoutWrapper);
}

// =================================================================
// 🌟 ЛОГИКА СТРАНИЦЫ КЛИЕНТОВ (ClientList)
// =================================================================
function renderClientsPage() {
    const contentContainer = document.createElement('div');
    contentContainer.id = 'clients-content';
    contentContainer.className = 'clients-list-page';



    const header = createElement('h3', null, 'список клиентов');
    contentContainer.append(header);

    // -----------------------------------------------------------
    // СПИСОК КЛИЕНТОВ
    // -----------------------------------------------------------
    const clientsList = createElement('div', 'clients-list list-section');

    if (state.clients.length === 0) {
        clientsList.append(createElement('div', 'muted', 'Нет клиентов. Добавьте первого!'));
    } else {
        state.clients.forEach(client => {
            const clientItem = createElement('div', 'list-item client-item');
            clientItem.dataset.id = client.id;

            clientItem.innerHTML = `
                <div>${client.name}</div>
                <div>
                    <button class="btn menu-btn">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                            <circle cx="5" cy="12" r="2"/>
                            <circle cx="12" cy="12" r="2"/>
                            <circle cx="19" cy="12" r="2"/>
                        </svg>
                    </button>
                </div>`;

            // Кнопка ⋯ (меню)
            const menuBtn = clientItem.querySelector('.menu-btn');
            menuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openClientMenuModal(client);
            });

            // Клик по карточке → переход к циклам клиента
            clientItem.addEventListener('click', (e) => {
                if (!e.target.closest('.menu-btn')) {
                    state.selectedClientId = client.id;
                    state.currentPage = 'programs';
                    state.selectedCycleId = null;
                    state.selectedProgramIdForDetails = null;
                    state.expandedExerciseId = null;
                    state.editingSetId = null;

                    setupDynamicListeners();
                    render();
                }
            });

            clientsList.append(clientItem);
        });
    }

    // -----------------------------------------------------------
    // Кнопка "Добавить клиента"
    // -----------------------------------------------------------
    const addClientBtn = createElement('button', 'btn btn-primary add-client-btn', '+');
    addClientBtn.style.margin = '12px';
    addClientBtn.addEventListener('click', () => {
        openAddClientModal(async (name) => {
            const newClient = {
                name: name,
                createdAt: Date.now()
            };
            try {
                await addDoc(getClientsCollection(), newClient);
            } catch (error) {
                console.error("Ошибка при добавлении клиента:", error);
                showToast('Ошибка сохранения. Проверьте правила Firebase!');
            }
        });
    });
    clientsList.append(addClientBtn);

    contentContainer.append(clientsList);
    root.append(contentContainer);
}

// =================================================================
// 🔥 МОДАЛКА МЕНЮ КЛИЕНТА (Редактировать / Удалить)
// =================================================================
function openClientMenuModal(client) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay-remove-edit';

    const modalContent = document.createElement('div');
    modalContent.className = 'modal-remove-edit';

    // Редактировать
    const editBtn = createElement('button', 'btn btn-primary');
    editBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><title>Pen-to-square SVG Icon</title><path fill="currentColor" d="M471.6 21.7c-21.9-21.9-57.3-21.9-79.2 0l-30.1 30l97.9 97.9l30.1-30.1c21.9-21.9 21.9-57.3 0-79.2zm-299.2 220c-6.1 6.1-10.8 13.6-13.5 21.9l-29.6 88.8c-2.9 8.6-.6 18.1 5.8 24.6s15.9 8.7 24.6 5.8l88.8-29.6c8.2-2.7 15.7-7.4 21.9-13.5l167.3-167.4l-98-98zM96 64c-53 0-96 43-96 96v256c0 53 43 96 96 96h256c53 0 96-43 96-96v-96c0-17.7-14.3-32-32-32s-32 14.3-32 32v96c0 17.7-14.3 32-32 32H96c-17.7 0-32-14.3-32-32V160c0-17.7 14.3-32 32-32h96c17.7 0 32-14.3 32-32s-14.3-32-32-32z"/></svg>';
    editBtn.addEventListener('click', () => {
        document.body.removeChild(modal);
        openEditClientModal(client);
    });

    // Удалить
    const deleteBtn = createElement('button', 'btn cancel-btn');
    deleteBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><title>Trash3-fill SVG Icon</title><path fill="currentColor" d="M11 1.5v1h3.5a.5.5 0 0 1 0 1h-.538l-.853 10.66A2 2 0 0 1 11.115 16h-6.23a2 2 0 0 1-1.994-1.84L2.038 3.5H1.5a.5.5 0 0 1 0-1H5v-1A1.5 1.5 0 0 1 6.5 0h3A1.5 1.5 0 0 1 11 1.5m-5 0v1h4v-1a.5.5 0 0 0-.5-.5h-3a.5.5 0 0 0-.5.5M4.5 5.029l.5 8.5a.5.5 0 1 0 .998-.06l-.5-8.5a.5.5 0 1 0-.998.06m6.53-.528a.5.5 0 0 0-.528.47l-.5 8.5a.5.5 0 0 0 .998.058l.5-8.5a.5.5 0 0 0-.47-.528M8 4.5a.5.5 0 0 0-.5.5v8.5a.5.5 0 0 0 1 0V5a.5.5 0 0 0-.5-.5"></path></svg>';
    deleteBtn.addEventListener('click', async () => {
        document.body.removeChild(modal);
        openConfirmModal("Удалить этого клиента?", async () => {
            await deleteDoc(doc(getClientsCollection(), client.id));
            if (state.selectedClientId === client.id) {
                state.selectedClientId = null;
            }
        });
    });

    modalContent.append(editBtn, deleteBtn);
    modal.append(modalContent);
    document.body.appendChild(modal);

    // Закрыть при клике мимо
    modal.addEventListener('click', (e) => {
        if (e.target === modal) document.body.removeChild(modal);
    });
}

// =================================================================
// 🔥 МОДАЛКА РЕДАКТИРОВАНИЯ КЛИЕНТА
// =================================================================
function openEditClientModal(client) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay-edit';

    const modalContent = document.createElement('div');
    modalContent.className = 'modal-edit';

    const title = document.createElement('h3');
    title.textContent = 'Редактировать клиента';

    const input = document.createElement('input');
    input.type = 'text';
    input.value = client.name;
    input.className = 'modal-input';

    const btnGroup = document.createElement('div');
    btnGroup.className = 'modal-buttons';

    const saveBtn = createElement('button', 'btn btn-primary', 'изменить');

    saveBtn.addEventListener('click', async () => {
        const newName = input.value.trim();
        if (!newName) {
            showToast('Введите имя клиента!');
            return;
        }
        try {
            await updateDoc(doc(getClientsCollection(), client.id), { name: newName });
            document.body.removeChild(modal);
        } catch (error) {
            console.error("Ошибка при обновлении клиента:", error);
            showToast('Ошибка сохранения');
        }
    });

    btnGroup.append(saveBtn);
    modalContent.append( input, btnGroup);
    modal.append(modalContent);
    document.body.appendChild(modal);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) document.body.removeChild(modal);
    });

    input.focus();
}

// =================================================================
// 🌟 МОДАЛКА: ДОБАВЛЕНИЕ КЛИЕНТА
// =================================================================
function openAddClientModal(onConfirm) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay-cicle';

    const modalContent = document.createElement('div');
    modalContent.className = 'modal-cicle';

    const title = document.createElement('h3');
    title.textContent = 'Добавление клиента';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Введите имя клиента...';
    input.className = 'modal-input';

    const btnGroup = document.createElement('div');
    btnGroup.className = 'modal-buttons';

    const cancelBtn = createElement('button', 'btn cancel-btn', 'Отмена');
    const confirmBtn = createElement('button', 'btn btn-primary', 'добавить');

    cancelBtn.addEventListener('click', () => document.body.removeChild(modal));
    confirmBtn.addEventListener('click', async () => {
        const name = input.value.trim();
        if (!name) {
            showToast('Введите имя клиента!');
            return;
        }
        await onConfirm(name);
        document.body.removeChild(modal);
    });

    btnGroup.append( confirmBtn);
    modalContent.append( input, btnGroup);
    modal.append(modalContent);
    document.body.appendChild(modal);

    // Закрытие при клике вне модалки
    modal.addEventListener('click', (e) => {
        if (e.target === modal) document.body.removeChild(modal);
    });

    input.focus();
}

// =================================================================
// 🔥 ФУНКЦИЯ: Отображение списка Тренировочных ЦИКЛОВ
// =================================================================
function renderCyclesPage() {

    state.lastProgramsPage = 'programs';

    if (state.currentMode === 'personal' && state.selectedClientId === null) {
        renderClientsPage();
        return;
    }

    const contentContainer = document.createElement('div');
    contentContainer.id = 'cycles-content';
    contentContainer.className = 'programs-list-page';



    const headerText = state.currentMode === 'own' ? 'Личные циклы' :
        `Циклы клиента: ${state.clients.find(c => c.id === state.selectedClientId)?.name || 'Неизвестно'}`;
    const header = createElement('h3', null, headerText);
    contentContainer.append(header);

    // -----------------------------------------------------------
    // СПИСОК ЦИКЛОВ
    // -----------------------------------------------------------
    const cyclesList = createElement('div', 'programs-list list-section');

    if (state.cycles.length === 0) {
        cyclesList.append(createElement('div', 'muted', 'Нет циклов. Создайте первый!'));
    } else {
        state.cycles.forEach(cycle => {
            const cycleItem = createElement('div', 'list-item program-item');
            cycleItem.dataset.id = cycle.id;

            // карточка с кнопкой ⋮
            cycleItem.innerHTML = `
                <div>${cycle.name} <small class="muted">(${cycle.startDateString})</small></div>
                <div>
                    <button class="btn menu-btn"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="5" cy="12" r="2"/>
    <circle cx="12" cy="12" r="2"/>
    <circle cx="19" cy="12" r="2"/></button>
                </div>`;

            // Открываем меню (редактировать / удалить)
            const menuBtn = cycleItem.querySelector('.menu-btn');
            menuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openCycleMenuModal(cycle);
            });

            // Клик по карточке → открыть программы в цикле
            cycleItem.addEventListener('click', (e) => {
                if (!e.target.closest('.menu-btn')) {
                    state.selectedCycleId = cycle.id;
                    state.currentPage = 'programsInCycle';
                    state.selectedProgramIdForDetails = null;
                    state.expandedExerciseId = null;
                    state.editingSetId = null;
                    state.supplementPlan = null;
                    setupDynamicListeners();
                    render();
                }
            });

            cyclesList.append(cycleItem);
        });
    }

    // -----------------------------------------------------------
    // Кнопка "Добавить цикл"
    // -----------------------------------------------------------
    const addCycleBtn = createElement('button', 'btn btn-primary add-cycle-btn', '+');
    addCycleBtn.style.margin = '12px';
    addCycleBtn.addEventListener('click', () => {
        openAddCycleModal(async (name) => {
            const newCycle = {
                name: name,
                startDate: Date.now(),
                startDateString: new Date().toLocaleDateString('ru-RU'),
                supplementPlan: { supplements: [], data: [] }
            };
            try {
                await addDoc(getUserCyclesCollection(), newCycle);
            } catch (error) {
                console.error("Ошибка при добавлении цикла:", error);
                showToast('Ошибка сохранения. Проверьте правила Firebase!');
            }
        });
    });
    cyclesList.append(addCycleBtn);

    contentContainer.append(cyclesList);
    root.append(contentContainer);
}

// =================================================================
// 🔥 МОДАЛКА МЕНЮ ЦИКЛА (Редактировать / Удалить)
// =================================================================
function openCycleMenuModal(cycle) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay-remove-edit';

    const modalContent = document.createElement('div');
    modalContent.className = 'modal-remove-edit';



    // Кнопка "Редактировать"
    const editBtn = createElement('button', 'btn btn-primary');
    editBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><title>Pen-to-square SVG Icon</title><path fill="currentColor" d="M471.6 21.7c-21.9-21.9-57.3-21.9-79.2 0l-30.1 30l97.9 97.9l30.1-30.1c21.9-21.9 21.9-57.3 0-79.2zm-299.2 220c-6.1 6.1-10.8 13.6-13.5 21.9l-29.6 88.8c-2.9 8.6-.6 18.1 5.8 24.6s15.9 8.7 24.6 5.8l88.8-29.6c8.2-2.7 15.7-7.4 21.9-13.5l167.3-167.4l-98-98zM96 64c-53 0-96 43-96 96v256c0 53 43 96 96 96h256c53 0 96-43 96-96v-96c0-17.7-14.3-32-32-32s-32 14.3-32 32v96c0 17.7-14.3 32-32 32H96c-17.7 0-32-14.3-32-32V160c0-17.7 14.3-32 32-32h96c17.7 0 32-14.3 32-32s-14.3-32-32-32z"/></svg>';
    editBtn.addEventListener('click', () => {
        document.body.removeChild(modal);
        openEditCycleModal(cycle);
    });

    // Кнопка "Удалить"
    const deleteBtn = createElement('button', 'btn cancel-btn');
    deleteBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><title>Trash3-fill SVG Icon</title><path fill="currentColor" d="M11 1.5v1h3.5a.5.5 0 0 1 0 1h-.538l-.853 10.66A2 2 0 0 1 11.115 16h-6.23a2 2 0 0 1-1.994-1.84L2.038 3.5H1.5a.5.5 0 0 1 0-1H5v-1A1.5 1.5 0 0 1 6.5 0h3A1.5 1.5 0 0 1 11 1.5m-5 0v1h4v-1a.5.5 0 0 0-.5-.5h-3a.5.5 0 0 0-.5.5M4.5 5.029l.5 8.5a.5.5 0 1 0 .998-.06l-.5-8.5a.5.5 0 1 0-.998.06m6.53-.528a.5.5 0 0 0-.528.47l-.5 8.5a.5.5 0 0 0 .998.058l.5-8.5a.5.5 0 0 0-.47-.528M8 4.5a.5.5 0 0 0-.5.5v8.5a.5.5 0 0 0 1 0V5a.5.5 0 0 0-.5-.5"></path></svg>';
    deleteBtn.addEventListener('click', () => {
        document.body.removeChild(modal);
        openConfirmModal("Удалить этот цикл?", async () => {
            await deleteDoc(doc(getUserCyclesCollection(), cycle.id));
        });
    });

    modalContent.append( editBtn, deleteBtn);
    modal.append(modalContent);
    document.body.appendChild(modal);

    // Закрытие при клике вне модалки
    modal.addEventListener('click', (e) => {
        if (e.target === modal) document.body.removeChild(modal);
    });
}

// =================================================================
// 🔥 МОДАЛКА РЕДАКТИРОВАНИЯ НАЗВАНИЯ ЦИКЛА
// =================================================================
function openEditCycleModal(cycle) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay-edit';

    const modalContent = document.createElement('div');
    modalContent.className = 'modal-edit';

    const title = document.createElement('h3');
    title.textContent = 'Редактировать цикл';

    const input = document.createElement('input');
    input.type = 'text';
    input.value = cycle.name;
    input.className = 'modal-input';

    const btnGroup = document.createElement('div');
    btnGroup.className = 'modal-buttons';

    const saveBtn = createElement('button', 'btn btn-primary', 'изменить');

    saveBtn.addEventListener('click', async () => {
        const newName = input.value.trim();
        if (!newName) {
            showToast('Введите название!');
            return;
        }
        try {
            await updateDoc(doc(getUserCyclesCollection(), cycle.id), { name: newName });
            document.body.removeChild(modal);
        } catch (error) {
            console.error("Ошибка при обновлении цикла:", error);
            showToast('Ошибка сохранения');
        }
    });

    btnGroup.append(saveBtn);
    modalContent.append( input, btnGroup);
    modal.append(modalContent);
    document.body.appendChild(modal);

    // Закрытие при клике вне модалки
    modal.addEventListener('click', (e) => {
        if (e.target === modal) document.body.removeChild(modal);
    });

    input.focus();
}


// =================================================================
// 🌟 МОДАЛКА: ДОБАВЛЕНИЕ ЦИКЛА
// =================================================================
function openAddCycleModal(onConfirm) {
    console.log('Модалка должна открыться'); // проверка
    const modal = document.createElement('div');
    modal.className = 'modal-overlay-cicle';

    const modalContent = document.createElement('div');
    modalContent.className = 'modal-cicle';

    const title = document.createElement('h3');
    title.textContent = 'Создание нового цикла';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Введите название цикла...';
    input.className = 'modal-input';

    const btnGroup = document.createElement('div');
    btnGroup.className = 'modal-buttons';


    const confirmBtn = createElement('button', 'btn btn-primary', 'добавить');


    confirmBtn.addEventListener('click', async () => {
        const name = input.value.trim();
        if (!name) {
            showToast('Введите название цикла!');
            return;
        }
        await onConfirm(name);
        document.body.removeChild(modal);
    });

    btnGroup.append( confirmBtn);
    modalContent.append( input, btnGroup);
    modal.append(modalContent);
    document.body.appendChild(modal);


    // Закрытие при клике вне модалки
    modal.addEventListener('click', (e) => {
        if (e.target === modal) document.body.removeChild(modal);
    });

    input.focus();
}





// =================================================================
// 🔥 ФУНКЦИЯ: Отображение программ внутри выбранного цикла
// =================================================================
function renderProgramsInCyclePage() {
    state.lastProgramsPage = 'programsInCycle';

    const currentCycle = state.cycles.find(c => c.id === state.selectedCycleId);

    if (!currentCycle) {
        state.currentPage = 'programs';
        state.selectedCycleId = null;
        render();
        return;
    }

    const contentContainer = document.createElement('div');
    contentContainer.id = 'programs-content';
    contentContainer.className = 'programs-list-page';



    // Заголовок
    const header = createElement('h3', null, `${currentCycle.name} - программы`);
    contentContainer.append(header);

    // -----------------------------------------------------------
    // СПИСОК ПРОГРАММ
    // -----------------------------------------------------------
    const programsList = createElement('div', 'programs-list list-section');

    if (state.programs.length === 0) {
        programsList.append(createElement('div', 'muted', 'Нет программ. Создайте новую!'));
    } else {
        state.programs.forEach(program => {
            const programItem = createElement('div', 'list-item program-item');
            programItem.dataset.id = program.id;

            programItem.innerHTML = `
                <div>${program.name}</div>
                <div>
                    <button class="btn menu-btn">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                            <circle cx="5" cy="12" r="2"/>
                            <circle cx="12" cy="12" r="2"/>
                            <circle cx="19" cy="12" r="2"/>
                        </svg>
                    </button>
                </div>`;

            // Кнопка ⋯ (меню)
            const menuBtn = programItem.querySelector('.menu-btn');
            menuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openProgramMenuModal(program);
            });

            // Клик по карточке → открыть детали
            programItem.addEventListener('click', (e) => {
                if (!e.target.closest('.menu-btn')) {
                    state.selectedProgramIdForDetails = program.id;
                    state.currentPage = 'programDetails';
                    state.expandedExerciseId = null;
                    state.editingSetId = null;
                    render();
                }
            });

            programsList.append(programItem);
        });
    }

    // -----------------------------------------------------------
    // Кнопка "Добавить программу"
    // -----------------------------------------------------------
    const addProgramBtn = createElement('button', 'btn btn-primary add-program-btn', '+');
    addProgramBtn.style.margin = '12px';
    addProgramBtn.addEventListener('click', () => {
        openAddProgramModal(async (name) => {
            const newProgram = {
                name: name,
                exercises: [],
                trainingNote: ''
            };
            try {
                await addDoc(getUserProgramsCollection(), newProgram);
            } catch (error) {
                console.error("Ошибка при добавлении программы:", error);
                showToast('Ошибка сохранения. Проверьте правила Firebase!');
            }
        });
    });
    programsList.append(addProgramBtn);

    contentContainer.append(programsList);
    root.append(contentContainer);
}

// =================================================================
// 🔥 МОДАЛКА МЕНЮ ПРОГРАММЫ (Редактировать / Удалить)
// =================================================================
function openProgramMenuModal(program) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay-remove-edit';

    const modalContent = document.createElement('div');
    modalContent.className = 'modal-remove-edit';

    // Редактировать
    const editBtn = createElement('button', 'btn btn-primary');
    editBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><title>Pen-to-square SVG Icon</title><path fill="currentColor" d="M471.6 21.7c-21.9-21.9-57.3-21.9-79.2 0l-30.1 30l97.9 97.9l30.1-30.1c21.9-21.9 21.9-57.3 0-79.2zm-299.2 220c-6.1 6.1-10.8 13.6-13.5 21.9l-29.6 88.8c-2.9 8.6-.6 18.1 5.8 24.6s15.9 8.7 24.6 5.8l88.8-29.6c8.2-2.7 15.7-7.4 21.9-13.5l167.3-167.4l-98-98zM96 64c-53 0-96 43-96 96v256c0 53 43 96 96 96h256c53 0 96-43 96-96v-96c0-17.7-14.3-32-32-32s-32 14.3-32 32v96c0 17.7-14.3 32-32 32H96c-17.7 0-32-14.3-32-32V160c0-17.7 14.3-32 32-32h96c17.7 0 32-14.3 32-32s-14.3-32-32-32z"/></svg>';
    editBtn.addEventListener('click', () => {
        document.body.removeChild(modal);
        openEditProgramModal(program);
    });

    // Удалить
    const deleteBtn = createElement('button', 'btn cancel-btn');
    deleteBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><title>Trash3-fill SVG Icon</title><path fill="currentColor" d="M11 1.5v1h3.5a.5.5 0 0 1 0 1h-.538l-.853 10.66A2 2 0 0 1 11.115 16h-6.23a2 2 0 0 1-1.994-1.84L2.038 3.5H1.5a.5.5 0 0 1 0-1H5v-1A1.5 1.5 0 0 1 6.5 0h3A1.5 1.5 0 0 1 11 1.5m-5 0v1h4v-1a.5.5 0 0 0-.5-.5h-3a.5.5 0 0 0-.5.5M4.5 5.029l.5 8.5a.5.5 0 1 0 .998-.06l-.5-8.5a.5.5 0 1 0-.998.06m6.53-.528a.5.5 0 0 0-.528.47l-.5 8.5a.5.5 0 0 0 .998.058l.5-8.5a.5.5 0 0 0-.47-.528M8 4.5a.5.5 0 0 0-.5.5v8.5a.5.5 0 0 0 1 0V5a.5.5 0 0 0-.5-.5"></path></svg>';
    deleteBtn.addEventListener('click', () => {
        document.body.removeChild(modal);
        openConfirmModal("Удалить эту программу?", async () => {
            await deleteDoc(doc(getUserProgramsCollection(), program.id));
            if (state.selectedProgramIdForDetails === program.id) {
                state.selectedProgramIdForDetails = null;
            }
        });
    });

    modalContent.append(editBtn, deleteBtn);
    modal.append(modalContent);
    document.body.appendChild(modal);

    // Закрыть при клике мимо
    modal.addEventListener('click', (e) => {
        if (e.target === modal) document.body.removeChild(modal);
    });
}

// =================================================================
// 🔥 МОДАЛКА РЕДАКТИРОВАНИЯ ПРОГРАММЫ
// =================================================================
function openEditProgramModal(program) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay-edit';

    const modalContent = document.createElement('div');
    modalContent.className = 'modal-edit';

    const title = document.createElement('h3');
    title.textContent = 'Редактировать программу';

    const input = document.createElement('input');
    input.type = 'text';
    input.value = program.name;
    input.className = 'modal-input';

    const btnGroup = document.createElement('div');
    btnGroup.className = 'modal-buttons';

    const saveBtn = createElement('button', 'btn btn-primary', 'изменить');

    saveBtn.addEventListener('click', async () => {
        const newName = input.value.trim();
        if (!newName) {
            showToast('Введите название!');
            return;
        }
        try {
            await updateDoc(doc(getUserProgramsCollection(), program.id), { name: newName });
            document.body.removeChild(modal);
        } catch (error) {
            console.error("Ошибка при обновлении программы:", error);
            showToast('Ошибка сохранения');
        }
    });

    btnGroup.append(saveBtn);
    modalContent.append( input, btnGroup);
    modal.append(modalContent);
    document.body.appendChild(modal);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) document.body.removeChild(modal);
    });

    input.focus();
}

// =================================================================
// 🌟 МОДАЛКА: ДОБАВЛЕНИЕ ПРОГРАММЫ
// =================================================================
function openAddProgramModal(onConfirm) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay-cicle';

    const modalContent = document.createElement('div');
    modalContent.className = 'modal-cicle';

    const title = document.createElement('h3');
    title.textContent = 'Создание новой программы';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Введите название программы...';
    input.className = 'modal-input';

    const btnGroup = document.createElement('div');
    btnGroup.className = 'modal-buttons';

    const confirmBtn = createElement('button', 'btn btn-primary', 'добавить');


    confirmBtn.addEventListener('click', async () => {
        const name = input.value.trim();
        if (!name) {
            showToast('Введите название программы!');
            return;
        }
        await onConfirm(name);
        document.body.removeChild(modal);
    });

    btnGroup.append(confirmBtn);
    modalContent.append(input, btnGroup);
    modal.append(modalContent);
    document.body.appendChild(modal);

    // Закрытие при клике вне модалки
    modal.addEventListener('click', (e) => {
        if (e.target === modal) document.body.removeChild(modal);
    });

    input.focus();
}


// =================================================================
// 🌟 Модалка для редактирования подхода
// =================================================================
function openEditSetModal(programId, exerciseId, setIndex, currentSet) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'modal-set';

    const title = createElement('h3', null, ` ${setIndex + 1} .подход`);

    // Поле ввода веса
    const weightInput = createElement('input');
    weightInput.type = 'number';
    weightInput.placeholder = 'Вес';
    weightInput.value = currentSet.weight || '';

    // "x"
    const SpanX = createElement('span', 'SpanX', ' x');

    // Поле ввода повторений
    const repsInput = createElement('input');
    repsInput.type = 'number';
    repsInput.placeholder = 'Повт';
    repsInput.value = currentSet.reps || '';

    // ✅ Кастомный чекбокс "рабочий подход"
    const checkboxWrapper = createElement('label', 'checkbox-wrapper');

    const isMainCheckbox = createElement('input', 'checkbox-input');
    isMainCheckbox.type = 'checkbox';
    isMainCheckbox.checked = !!currentSet.isMain; // Сохранение текущего состояния

    const customCheckbox = createElement('span', 'checkbox-custom');
    const checkboxLabel = createElement('span', 'checkbox-text', ' рабочий');

    checkboxWrapper.append(isMainCheckbox, customCheckbox, checkboxLabel);

    // Кнопка OK
    const btnOk = createElement('button', 'btn btn-primary', 'ОК');
    btnOk.addEventListener('click', async () => {
        const newWeight = weightInput.value.trim();
        const newReps = repsInput.value.trim();

        const program = state.programs.find(p => p.id === programId);
        if (program) {
            const exercise = program.exercises.find(ex => ex.id === exerciseId);
            if (exercise) {
                // Обновляем значения подхода
                exercise.sets[setIndex].weight = newWeight;
                exercise.sets[setIndex].reps = newReps;
                exercise.sets[setIndex].isMain = isMainCheckbox.checked; // Save checkbox state

                await updateDoc(doc(getUserProgramsCollection(), program.id), {
                    exercises: program.exercises
                });

                render();
            }
        }
        document.body.removeChild(overlay);
    });

    // Добавляем элементы в модалку
    modal.append(title, weightInput, SpanX, repsInput, btnOk, checkboxWrapper);
    overlay.append(modal);
    document.body.append(overlay);

    // Закрытие при клике по фону
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            document.body.removeChild(overlay);
        }
    });
}


// =================================================================
// 🌟 МОДАЛКА: Комментарий с поддержкой фото/видео (Cloudinary)
// =================================================================
function openCommentModal(exerciseId, currentNote, titleText, onSave) {
    const overlay = createElement('div', 'modal-overlay');
    const modal = createElement('div', 'modal-content modal-compact comExer');

    // Заголовок
    const title = createElement('h3');
    title.innerHTML = titleText || 'Комментарий';

    // Поле ввода текста
    const textarea = createElement('textarea', 'comment-input');
    textarea.placeholder = 'Введите комментарий...';
    textarea.value = currentNote || '';

    // Контейнер медиа
    const mediaContainer = createElement('div', 'media-container');

    // Загружаем существующие медиа (учитываем тренировку ИЛИ упражнение)
    let media = [];
    const program = state.programs?.find(p => p.id === state.selectedProgramIdForDetails);
    if (program) {
        if (exerciseId === program.id) {
            // это комментарий к тренировке
            media = program.trainingMedia ? [...program.trainingMedia] : [];
        } else {
            // это комментарий к упражнению
            const exercise = program.exercises.find(ex => ex.id === exerciseId);
            if (exercise && exercise.media) {
                media = [...exercise.media];
            }
        }
    }
    renderMediaPreview(mediaContainer, media);



    // Скрытое file-input поле
    const fileInput = createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*,video/*';
    fileInput.style.display = 'none';

   // Кнопка "Медиа" с SVG вместо текста 📎
   const addMediaBtn = createElement('button', 'btn btn-secondary');
   addMediaBtn.innerHTML = `
       <svg xmlns="http://www.w3.org/2000/svg"  viewBox="0 0 24 24"><title>Add-a-photo-rounded SVG Icon</title><path fill="currentColor" d="M20 7q-.425 0-.712-.288T19 6V5h-1q-.425 0-.712-.288T17 4t.288-.712T18 3h1V2q0-.425.288-.712T20 1t.713.288T21 2v1h1q.425 0 .713.288T23 4t-.288.713T22 5h-1v1q0 .425-.288.713T20 7m-9 10.5q1.875 0 3.188-1.312T15.5 13t-1.312-3.187T11 8.5T7.813 9.813T6.5 13t1.313 3.188T11 17.5m0-2q-1.05 0-1.775-.725T8.5 13t.725-1.775T11 10.5t1.775.725T13.5 13t-.725 1.775T11 15.5M3 21q-.825 0-1.412-.587T1 19V7q0-.825.588-1.412T3 5h3.15L7.4 3.65q.275-.3.663-.475T8.875 3H14q.425 0 .713.288T15 4v1.5q0 .625.438 1.063T16.5 7h.5v.5q0 .625.438 1.063T18.5 9H20q.425 0 .713.288T21 10v9q0 .825-.587 1.413T19 21z"/></svg>
   `;
   addMediaBtn.addEventListener('click', () => fileInput.click());


    // Обработка выбора файла
    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Прогресс-бар
        const progressBar = createElement('div', 'upload-progress-bar');
        progressBar.style.width = '0%';
        progressBar.style.height = '4px';
        progressBar.style.background = '#4caf50';
        progressBar.style.marginTop = '5px';
        progressBar.style.borderRadius = '4px';
        mediaContainer.append(progressBar);

        try {
            // Загрузка в Cloudinary с прогрессом
            const url = await uploadFileToCloudinaryWithProgress(file, (percent) => {
                progressBar.style.width = percent + '%';
            });

            const type = file.type.startsWith('video') ? 'video' : 'photo';
            media.push({ url, type });

            renderMediaPreview(mediaContainer, media);
            showToast('Медиа загружено!', 'success');
        } catch (err) {
            console.error(err);
            showToast('❌ Ошибка загрузки!', 'error');
        }
    });

// ✅ Только кнопка "Сохранить"
const controls = createElement('div', 'modal-controls');
const saveBtn = createElement('button', 'btn btn-primary', 'Сохранить');
controls.append(saveBtn);

// ✅ Закрытие модалки по клику на фон (overlay)
overlay.addEventListener('click', () => overlay.remove());

// ❗ Чтобы клик по модалке не закрывал её
modal.addEventListener('click', (e) => e.stopPropagation());

// ✅ Сохранение данных
saveBtn.addEventListener('click', () => {
    onSave(textarea.value.trim(), media);
    overlay.remove();
});
    controls.append( saveBtn);

    modal.append(title, textarea, mediaContainer, addMediaBtn, fileInput, controls);
    overlay.append(modal);
    document.body.append(overlay);
}
// =================================================================
// МОДАЛКА ДОБАВЛЕНИЯ ПОДХОДА
// =================================================================


function openDuplicateSetModal(message, onYes, onNo) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'modal-content duplicate-modal'; // 👈 отдельный стиль

    modal.innerHTML = `
        <p class="duplicate-text">${message}</p>
        <div class="modal-controls duplicate-controls">
            <button class="btn btn-primary dup-yes">Да</button>
            <button class="btn btn-secondary dup-no">Нет</button>
        </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // закрытие при клике вне
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });

    modal.querySelector('.dup-yes').addEventListener('click', () => {
        onYes && onYes();
        overlay.remove();
    });

    modal.querySelector('.dup-no').addEventListener('click', () => {
        onNo && onNo();
        overlay.remove();
    });
}

// =================================================================
// ✅ Вспомогательная функция предпросмотра медиа с превью фото и видео
// =================================================================
function renderMediaPreview(container, media) {
    container.innerHTML = ''; // Очистить контейнер

    media.forEach((file, index) => {
        const mediaItem = createElement('div', 'media-item');
        mediaItem.style.position = 'relative';
        mediaItem.style.display = 'inline-block';
        mediaItem.style.marginRight = '12px';

        // === Если фото ===
        if (file.type === 'photo') {
            const img = createElement('img');
            img.src = file.url;
            img.className = 'media-thumb';
            img.style.width = '60px';
            img.style.height = '60px';
            img.style.objectFit = 'cover';
            img.style.borderRadius = '6px';
            img.style.cursor = 'pointer';
            img.onclick = () => openMediaFullScreen(file.url, 'photo');
            mediaItem.append(img);
        }

        // === Если видео — показываем миниплеер ===
        if (file.type === 'video') {
            const video = createElement('video');
            video.src = file.url;
            video.className = 'media-thumb';
            video.muted = true;
            video.playsInline = true; // чтобы не развернулось в полный экран на iPhone
            video.style.width = '60px';
            video.style.height = '60px';
            video.style.objectFit = 'cover';
            video.style.borderRadius = '6px';
            video.style.cursor = 'pointer';
            video.onclick = () => openMediaFullScreen(file.url, 'video');
            mediaItem.append(video);
        }

        // ❌ Кнопка удаления
        const delBtn = createElement('button', 'btn delete-media-btn', '✖');


        delBtn.addEventListener('click', () => {
            media.splice(index, 1);      // Удаляем из массива
            renderMediaPreview(container, media); // Перерисовываем
        });

        mediaItem.append(delBtn);
        container.append(mediaItem);
    });
}

// =================================================================
// 🌟 ФУНКЦИЯ: Сохранение комментария к тренировке
// =================================================================
async function saveTrainingNote(programId, note, media = []) {
    const program = state.programs.find(p => p.id === programId);
    if (!program) return;

    program.trainingNote = note;
    program.trainingMedia = media;

    try {
        await updateDoc(doc(getUserProgramsCollection(), programId), {
            trainingNote: note,
            trainingMedia: media
        });
        showToast('Комментарий к тренировке сохранён!');
    } catch (err) {
        console.error(err);
        showToast('Ошибка сохранения комментария', 'error');
    }
}


// =================================================================
// 🌟 ФУНКЦИЯ: Сохранение комментария + медиа к упражнению
// =================================================================
async function saveExerciseNote(programId, exerciseId, note, media = []) {
    const program = state.programs.find(p => p.id === programId);
    if (!program) return;

    const exercise = program.exercises.find(ex => ex.id === exerciseId);
    if (!exercise) return;

    exercise.note = note;

    // ✅ сохраняем медиа (если передается)
    if (media) {
        exercise.media = media.map(m => ({
            url: m.url,
            type: m.type || (m.url.endsWith('.mp4') ? 'video' : 'photo'),
            addedAt: Date.now()
        }));
    }

    // ✅ глубокая копия чтобы Firestore принял
    const cleanedExercises = JSON.parse(JSON.stringify(program.exercises));

    try {
        await updateDoc(doc(getUserProgramsCollection(), programId), {
            exercises: cleanedExercises
        });
        showToast('Комментарий сохранён');
    } catch (err) {
        console.error(err);
        showToast('Ошибка сохранения', 'error');
    }
}



// =================================================================
// 🌟 ФУНКЦИЯ: Отображение деталей программы с упражнениями (исправлено)
// =================================================================
function renderProgramDetailsPage() {

    state.lastProgramsPage = 'programDetails';

    const selectedProgram = state.programs.find(p => p.id === state.selectedProgramIdForDetails);

    if (!selectedProgram) {
        state.currentPage = 'programsInCycle';
        state.selectedProgramIdForDetails = null;
        render();
        return;
    }

    const contentContainer = createElement('div', 'program-details-page');
    contentContainer.id = 'program-details-content';



    // Заголовок
    contentContainer.append(createElement('h3', null, selectedProgram.name));

    // -----------------------------
    // Список упражнений
    // -----------------------------
    if (!selectedProgram.exercises || selectedProgram.exercises.length === 0) {
        contentContainer.append(createElement('div', 'muted', 'Нет упражнений. Добавьте первое!'));
    } else {
        const exercisesListSection = createElement('div', 'list-section');

        selectedProgram.exercises.forEach((exercise, index) => {
            const isExpanded = state.expandedExerciseId === exercise.id;
            const hasNote = exercise.note && exercise.note.trim() !== '';

            const exerciseItem = createElement('div', 'exercise-item');

            // Header упражнения
            const exerciseHeader = createElement('div', `exercise-header ${isExpanded ? 'expanded' : ''}`);

            const exerciseTitle = createElement('div', 'exercise-title');
            const exerciseNumber = createElement('span', 'exercise-number', `${index + 1}.`);
            const exerciseName = createElement('span', 'exercise-name', exercise.name);
            exerciseTitle.append(exerciseNumber, exerciseName);

            const controlButtons = createElement('div', 'control-buttons');

            // Кнопка меню (⋮)
            const menuBtn = createElement('button', 'btn menu-btn');
            menuBtn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">\n' +
                                '    <circle cx="5" cy="12" r="2"></circle>\n' +
                                '    <circle cx="12" cy="12" r="2"></circle>\n' +
                                '    <circle cx="19" cy="12" r="2"></circle></svg>`;
            menuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openExerciseMenuModal(selectedProgram, exercise);
            });

            controlButtons.append(menuBtn);
            exerciseHeader.append(exerciseTitle, controlButtons);

            // Клик по заголовку → раскрыть / свернуть подходы
            exerciseHeader.addEventListener('click', () => {
                state.expandedExerciseId = (state.expandedExerciseId === exercise.id ? null : exercise.id);
                render();
            });

            // Контейнер для подходов
            const setsContainer = createElement('div', `sets-container ${isExpanded ? 'expanded' : ''}`);

            // Свернутый краткий вид подходов (чипсы)
            const summarySetsContainer = createElement('div', `summary-sets-container ${!isExpanded ? 'visible' : ''}`);
            const summarySets = (exercise.sets || []).filter(set => (set.weight && set.weight.trim() !== '') || (set.reps && set.reps.trim() !== ''));
            summarySets.forEach((set) => {
                const summarySpan = createElement('span', set.isMain ? 'main-set' : '', `${set.weight || '0'}x${set.reps || '0'}`);
                summarySetsContainer.append(summarySpan);
            });

            // Полный список подходов
            if (Array.isArray(exercise.sets)) {
                exercise.sets.forEach((set, setIndex) => {
                    const setRow = createElement('div', `set-row ${set.isMain ? 'main-set' : ''}`);

                    const setNumberLabel = createElement('span', 'set-label', `${setIndex + 1}.`);
                    setRow.append(setNumberLabel);

                    const setText = createElement('span', 'set-display');
                    const displayWeight = set.weight || '...';
                    const displayReps = set.reps || '...';
                    setText.innerHTML = `${displayWeight} <small>кг</small> x ${displayReps} <small>пов</small>`;
                    setRow.append(setText);

                    // Клик для редактирования подхода
                    setRow.addEventListener('click', (e) => {
                        e.stopPropagation();
                        openEditSetModal(selectedProgram.id, exercise.id, setIndex, set);
                    });

                    // Удаление подхода (крестик)
                    const deleteSetBtn = createElement('button', 'btn delete-set-btn');
                    deleteSetBtn.innerHTML = `
                        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24">
                          <path fill="currentColor" d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59L7.11 5.7A1 1 0 1 0 5.7 7.11L10.59 12L5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4z"/>
                        </svg>`;
                    deleteSetBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        openConfirmModal('Удалить этот подход?', async () => {
                            exercise.sets.splice(setIndex, 1);

                            // Если подходов не осталось — удаляем упражнение
                            if (exercise.sets.length === 0) {
                                const currentProgram = state.programs.find(p => p.id === selectedProgram.id);
                                if (currentProgram) {
                                    currentProgram.exercises = currentProgram.exercises.filter(ex => ex.id !== exercise.id);
                                }
                            }

                            await updateDoc(doc(getUserProgramsCollection(), selectedProgram.id), {
                                exercises: selectedProgram.exercises
                            });
                            render();
                        });
                    });
                    setRow.append(deleteSetBtn);

                    setsContainer.append(setRow);
                });
            }

            // Кнопки под подходами (добавить подход, комментарий к упражнению + индикаторы медиа)
            const addSetBtn = createElement('button', 'add-set-btn', '+');
            addSetBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const currentExercise = selectedProgram.exercises.find(ex => ex.id === exercise.id);
                currentExercise.sets = currentExercise.sets || [];

                if (currentExercise.sets.length === 0) {
                    currentExercise.sets.push({ weight: '', reps: '', isMain: false });
                    updateDoc(doc(getUserProgramsCollection(), selectedProgram.id), { exercises: selectedProgram.exercises }).then(render);
                    return;
                }

                // ✅ используем новую, красивую модалку
                openDuplicateSetModal("Дублировать предыдущий подход?", async () => {
                    const lastSet = currentExercise.sets[currentExercise.sets.length - 1];
                    currentExercise.sets.push({
                        weight: lastSet.weight || '',
                        reps: lastSet.reps || '',
                        isMain: lastSet.isMain || false
                    });
                    await updateDoc(doc(getUserProgramsCollection(), selectedProgram.id), { exercises: selectedProgram.exercises });
                    render();
                }, async () => {
                    currentExercise.sets.push({ weight: '', reps: '', isMain: false });
                    await updateDoc(doc(getUserProgramsCollection(), selectedProgram.id), { exercises: selectedProgram.exercises });
                    render();
                });
            });


            const editNoteBtn = createElement('button', `btn edit-note-btn ${hasNote ? 'has-note' : ''}`);
            // карандаш
            editNoteBtn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg"  viewBox="0 0 512 512"><title>Pen-to-square SVG Icon</title><path fill="currentColor" d="M471.6 21.7c-21.9-21.9-57.3-21.9-79.2 0l-30.1 30l97.9 97.9l30.1-30.1c21.9-21.9 21.9-57.3 0-79.2zm-299.2 220c-6.1 6.1-10.8 13.6-13.5 21.9l-29.6 88.8c-2.9 8.6-.6 18.1 5.8 24.6s15.9 8.7 24.6 5.8l88.8-29.6c8.2-2.7 15.7-7.4 21.9-13.5l167.3-167.4l-98-98zM96 64c-53 0-96 43-96 96v256c0 53 43 96 96 96h256c53 0 96-43 96-96v-96c0-17.7-14.3-32-32-32s-32 14.3-32 32v96c0 17.7-14.3 32-32 32H96c-17.7 0-32-14.3-32-32V160c0-17.7 14.3-32 32-32h96c17.7 0 32-14.3 32-32s-14.3-32-32-32z"/></svg>`;
            editNoteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openCommentModal(
                    exercise.id,
                    exercise.note,
                    `Комментарий к <span class="exercise-name-span">- ${exercise.name}</span>`,
                    (newNote, media) => saveExerciseNote(selectedProgram.id, exercise.id, newNote, media)
                );
            });



            const bottomButtons = createElement('div', 'exercise-bottom-buttons');
            bottomButtons.style.display = 'flex';
            bottomButtons.style.gap = '6px';
            bottomButtons.append(addSetBtn, editNoteBtn);
            setsContainer.append(bottomButtons);

            // Отображение комментария под подходами (в раскрытом виде)
// ✅ Отображение комментария И медиа (фото/видео)
if (isExpanded && (exercise.note || (exercise.media && exercise.media.length > 0))) {

    const exerciseNoteContainer = createElement('div', 'exercise-note-display');

    // 1. Текст комментария
    if (exercise.note && exercise.note.trim() !== '') {
        const noteText = createElement('p', 'comment-text', exercise.note);
        exerciseNoteContainer.append(noteText);
    }

    // 2. Фото / Видео (иконки или миниатюры)
    if (exercise.media && exercise.media.length > 0) {
        const mediaContainer = createElement('div', 'note-media-preview');
        mediaContainer.style.display = 'flex';
        mediaContainer.style.gap = '8px';
        mediaContainer.style.marginTop = '5px';

        exercise.media.forEach(file => {
            // Если фото → показываем мини-превью
            if (file.type === 'photo') {
                const img = createElement('img');
                img.src = file.url;
                img.className = 'note-media-image';
                img.style.width = '40px';
                img.style.height = '40px';
                img.style.objectFit = 'cover';
                img.style.borderRadius = '5px';
                img.style.cursor = 'pointer';
                img.onclick = () => openPhotoFullScreen(file.url);
                mediaContainer.append(img);
            }

            // Если видео → иконка 🎥
           if (file.type === 'video') {
               const videoThumb = createElement('video');
               videoThumb.src = file.url;
               videoThumb.className = 'note-media-video-thumb';
               videoThumb.muted = true;           // чтобы не играл звук
               videoThumb.playsInline = true;     // чтобы не открывался фулл-скрин на телефоне
               videoThumb.style.width = '40px';
               videoThumb.style.height = '40px';
               videoThumb.style.objectFit = 'cover';
               videoThumb.style.borderRadius = '5px';
               videoThumb.style.cursor = 'pointer';

               // При клике — открыть полноэкранный просмотр
               videoThumb.onclick = () => openMediaFullScreen(file.url, 'video');

               mediaContainer.append(videoThumb);
           }
        });

        exerciseNoteContainer.append(mediaContainer);
    }

    // Вставляем в DOM под подходами
    setsContainer.append(exerciseNoteContainer);
}


            exerciseItem.append(exerciseHeader, summarySetsContainer, setsContainer);

            // ✅ Показывать комментарий под summarySets, даже если упражнение закрыто
            if (!isExpanded && (exercise.note || (exercise.media && exercise.media.length > 0))) {
                const collapsedNote = createElement('div', 'exercise-note-collapsed');

                // только текст комментария
                if (exercise.note && exercise.note.trim() !== '') {
                    const noteText = createElement('p', 'comment-text-collapsed', exercise.note);
                    collapsedNote.append(noteText);
                }

                // иконки медиа (если есть)
                if (exercise.media && exercise.media.length > 0) {
                    const icons = createElement('span', 'media-icons-inline');

                    // SVG для фото
                    const photoSVG = `
                        <svg xmlns="http://www.w3.org/2000/svg"  viewBox="0 0 24 24"><title>Camera-photo-solid SVG Icon</title><path fill="currentColor" fill-rule="evenodd" d="M7.5 4.586A2 2 0 0 1 8.914 4h6.172a2 2 0 0 1 1.414.586L17.914 6H19a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h1.086zM10 12a2 2 0 1 1 4 0a2 2 0 0 1-4 0m2-4a4 4 0 1 0 0 8a4 4 0 0 0 0-8" clip-rule="evenodd"/></svg>
                    `;

                    // SVG для видео
                    const videoSVG = `
                        <svg xmlns="http://www.w3.org/2000/svg"  viewBox="0 0 16 16"><title>Video-camera-16-solid SVG Icon</title><path fill="currentColor" d="M3 4a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h5a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm12 .75a.75.75 0 0 0-1.28-.53l-2 2a.75.75 0 0 0-.22.53v2.5c0 .199.079.39.22.53l2 2a.75.75 0 0 0 1.28-.53z"/></svg>
                    `;

                    // Проверяем наличие фото
                    const hasPhoto = exercise.media.some(m => m.type === 'photo' || /\.(jpg|jpeg|png|webp)$/i.test(m.url));
                    if (hasPhoto) {
                        const span = createElement('span', 'icon-photo');
                        span.innerHTML = photoSVG;
                        icons.append(span);
                    }

                    // Проверяем наличие видео
                    const hasVideo = exercise.media.some(m => m.type === 'video' || /\.(mp4|mov|avi|webm)$/i.test(m.url));
                    if (hasVideo) {
                        const span = createElement('span', 'icon-video');
                        span.innerHTML = videoSVG;
                        icons.append(span);
                    }

                    collapsedNote.append(icons);
                }


                exerciseItem.append(collapsedNote);
            }


            exercisesListSection.append(exerciseItem);
        });

        contentContainer.append(exercisesListSection);
    }

    // -----------------------------
    // Кнопка "Добавить упражнение"
    // -----------------------------
    const addExerciseBtn = createElement('button', 'btn btn-primary add-exercise-btn', 'добавить упражнение');
    addExerciseBtn.addEventListener('click', () => {
        openAddExerciseModal(selectedProgram);
    });
    contentContainer.append(addExerciseBtn);

    // -----------------------------
    // Комментарий к тренировке
    // -----------------------------
    const hasTrainingNote = selectedProgram.trainingNote && selectedProgram.trainingNote.trim() !== '';
    const commentWrapper = createElement('div', 'comment-wrapper');

    const commentBtn = createElement('button', `btn comment-toggle-btn ${hasTrainingNote ? 'has-note' : ''}`);
    commentBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg"  viewBox="0 0 512 512"><title>Pen-to-square SVG Icon</title><path fill="currentColor" d="M471.6 21.7c-21.9-21.9-57.3-21.9-79.2 0l-30.1 30l97.9 97.9l30.1-30.1c21.9-21.9 21.9-57.3 0-79.2zm-299.2 220c-6.1 6.1-10.8 13.6-13.5 21.9l-29.6 88.8c-2.9 8.6-.6 18.1 5.8 24.6s15.9 8.7 24.6 5.8l88.8-29.6c8.2-2.7 15.7-7.4 21.9-13.5l167.3-167.4l-98-98zM96 64c-53 0-96 43-96 96v256c0 53 43 96 96 96h256c53 0 96-43 96-96v-96c0-17.7-14.3-32-32-32s-32 14.3-32 32v96c0 17.7-14.3 32-32 32H96c-17.7 0-32-14.3-32-32V160c0-17.7 14.3-32 32-32h96c17.7 0 32-14.3 32-32s-14.3-32-32-32z"/></svg>`;
    commentBtn.title = 'Комментарий к тренировке';
    commentBtn.addEventListener('click', () => {
        openCommentModal(
            selectedProgram.id,
            selectedProgram.trainingNote,
            'Комментарий к тренировке',
            (newNote, media) => saveTrainingNote(selectedProgram.id, newNote, media)
        );
    });

    // Есть ли текст комментария или медиа к тренировке


    if (hasTrainingNote) {
        const noteContainer = createElement('div', 'training-note-display');

        // 1. Текст комментария
        if (selectedProgram.trainingNote && selectedProgram.trainingNote.trim() !== '') {
            const noteText = createElement('p', 'comment-text-display', selectedProgram.trainingNote);
            noteContainer.append(noteText);
        }

        // 2. Превью медиа (если есть)
        if (selectedProgram.trainingMedia && selectedProgram.trainingMedia.length > 0) {
            const mediaContainer = createElement('div', 'training-media-preview');
            mediaContainer.style.display = 'flex';
            mediaContainer.style.gap = '8px';
            mediaContainer.style.marginTop = '5px';

            selectedProgram.trainingMedia.forEach(file => {
                if (file.type === 'photo') {
                    // Фото → миниатюра
                    const img = createElement('img');
                    img.src = file.url;
                    img.style.width = '40px';
                    img.style.height = '40px';
                    img.style.objectFit = 'cover';
                    img.style.borderRadius = '5px';
                    img.style.cursor = 'pointer';
                    img.onclick = () => openPhotoFullScreen(file.url);
                    mediaContainer.append(img);
                } else if (file.type === 'video') {
                    // Видео → постер (или иконка 🎥)
                    const videoThumb = createElement('video');
                    videoThumb.src = file.url;
                    videoThumb.style.width = '40px';
                    videoThumb.style.height = '40px';
                    videoThumb.style.objectFit = 'cover';
                    videoThumb.style.borderRadius = '5px';
                    videoThumb.muted = true;
                    videoThumb.addEventListener('click', () => {
                        window.open(file.url, '_blank');
                    });
                    mediaContainer.append(videoThumb);
                }
            });

            noteContainer.append(mediaContainer);
        }

        commentWrapper.append(noteContainer);
    }

    commentWrapper.prepend(commentBtn);
    contentContainer.append(commentWrapper);


    // -----------------------------
    // Кнопка "Завершить тренировку"
    // -----------------------------
    const completeTrainingBtn = createElement('button', 'btn complete-training-btn', 'Завершить тренировку');
    completeTrainingBtn.addEventListener('click', () => {
        openConfirmModal('Завершить и сохранить тренировку в дневник?', async () => {
            const exercisesToSave = (selectedProgram.exercises || [])
                .filter(ex => ex.note || (ex.sets && ex.sets.some(set => set.weight || set.reps)))
                .map(ex => ({ ...ex }));

            if (exercisesToSave.length === 0 && !selectedProgram.trainingNote) {
                showToast('Нечего сохранять!');
                return;
            }

            const currentCycle = state.cycles.find(c => c.id === state.selectedCycleId);
            const trainingRecord = {
                date: new Date().toLocaleDateString('ru-RU'),
                time: new Date().toLocaleTimeString('ru-RU'),
                programName: selectedProgram.name,
                category: currentCycle ? currentCycle.name : selectedProgram.name,
                cycleName: currentCycle ? currentCycle.name : 'Без цикла',
                comment: selectedProgram.trainingNote || '',
                exercises: exercisesToSave
            };

            try {
                const journalCollection = (state.currentMode === 'personal' && state.selectedClientId)
                    ? getClientJournalCollection()
                    : getUserJournalCollection();

                await addDoc(journalCollection, trainingRecord);

                showToast('Тренировка сохранена в дневнике!');
                state.currentPage = 'programsInCycle';
                state.selectedProgramIdForDetails = null;
                state.expandedExerciseId = null;
                render();
            } catch (error) {
                console.error("Ошибка при сохранении тренировки:", error);
                showToast('Ошибка сохранения записи дневника.');
            }
        });
    });
    contentContainer.append(completeTrainingBtn);

    // Итог
    root.append(contentContainer);
}

// =================================================================
// Добавляем универсальную функцию full-screen просмотра
// =================================================================


// ✅ Универсальная функция full-screen медиа (фото или видео)
function openMediaFullScreen(url, type = 'photo') {
    const overlay = document.createElement('div');
    overlay.className = 'media-fullscreen-overlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.backgroundColor = 'rgba(0,0,0,0.9)';
    overlay.style.display = 'flex';
    overlay.style.justifyContent = 'center';
    overlay.style.alignItems = 'center';
    overlay.style.zIndex = '9999';

    // Если фото
    if (type === 'photo') {
        const img = document.createElement('img');
        img.src = url;
        img.style.maxWidth = '90%';
        img.style.maxHeight = '90%';
        img.style.borderRadius = '10px';
        img.style.boxShadow = '0 0 20px rgba(255,255,255,0.2)';
        overlay.appendChild(img);
    }

    // Если видео
    if (type === 'video') {
        const video = document.createElement('video');
        video.src = url;
        video.controls = true;
        video.autoplay = true;
        video.style.maxWidth = '90%';
        video.style.maxHeight = '90%';
        overlay.appendChild(video);
    }

    // Закрыть по клику на фон
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });

    document.body.appendChild(overlay);
}





// =================================================================
// 🌟 МОДАЛКА: Добавление нового упражнения
// =================================================================
function openAddExerciseModal(program) {
    const modal = createElement('div', 'modal-overlay program-details');
    const modalContent = createElement('div', 'modal-content');

    const title = createElement('h3', null);
    const input = createElement('input', 'modal-input');
    input.placeholder = 'Название упражнения';

    const btnGroup = createElement('div', 'modal-buttons');

    const saveBtn = createElement('button', 'btn btn-primary', 'добавить');


    saveBtn.addEventListener('click', async () => {
        const name = input.value.trim();
        if (!name) return showToast('Введите название упражнения!');

        const newExercise = { id: Date.now().toString(), name, sets: [{ weight: '', reps: '' }], note: '' };
        program.exercises = program.exercises || [];
        program.exercises.push(newExercise);

        await updateDoc(doc(getUserProgramsCollection(), program.id), { exercises: program.exercises });
        document.body.removeChild(modal);
        render();
    });

    btnGroup.append(saveBtn);
    modalContent.append(title, input, btnGroup);
    modal.append(modalContent);
    document.body.append(modal);
    input.focus();

    // Закрытие при клике вне модалки
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    });
}


// =================================================================
// 🌟 МОДАЛКА: Меню упражнения (Редактировать / Удалить)
// =================================================================
function openExerciseMenuModal(program, exercise) {
    if (!program || !exercise) return;

    // Создаём оверлей
    const modal = document.createElement('div');
    modal.className = 'modal-overlay-remove-edit';

    // Контент модалки
    const modalContent = document.createElement('div');
    modalContent.className = 'modal-remove-edit';

    // Кнопка Редактировать
    const editBtn = createElement('button', 'btn btn-primary');

// SVG-код для иконки редактирования (карандаша)
    const editSvgIcon = `
 <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 512 512"><title>Pen-to-square SVG Icon</title><path fill="currentColor" d="M471.6 21.7c-21.9-21.9-57.3-21.9-79.2 0l-30.1 30l97.9 97.9l30.1-30.1c21.9-21.9 21.9-57.3 0-79.2zm-299.2 220c-6.1 6.1-10.8 13.6-13.5 21.9l-29.6 88.8c-2.9 8.6-.6 18.1 5.8 24.6s15.9 8.7 24.6 5.8l88.8-29.6c8.2-2.7 15.7-7.4 21.9-13.5l167.3-167.4l-98-98zM96 64c-53 0-96 43-96 96v256c0 53 43 96 96 96h256c53 0 96-43 96-96v-96c0-17.7-14.3-32-32-32s-32 14.3-32 32v96c0 17.7-14.3 32-32 32H96c-17.7 0-32-14.3-32-32V160c0-17.7 14.3-32 32-32h96c17.7 0 32-14.3 32-32s-14.3-32-32-32z"/></svg>
`;

// Вставляем SVG, а затем добавляем текст
    editBtn.innerHTML = editSvgIcon + '';

    editBtn.addEventListener('click', () => {
        document.body.removeChild(modal);
        openEditExerciseModal(program, exercise); // передаём программу и упражнение
    });

    // Кнопка Удалить
    const deleteBtn = createElement('button', 'btn cancel-btn');
    const deleteSvgIcon = `
<svg xmlns="http://www.w3.org/2000/svg"  viewBox="0 0 16 16"><title>Trash3-fill SVG Icon</title><path fill="currentColor" d="M11 1.5v1h3.5a.5.5 0 0 1 0 1h-.538l-.853 10.66A2 2 0 0 1 11.115 16h-6.23a2 2 0 0 1-1.994-1.84L2.038 3.5H1.5a.5.5 0 0 1 0-1H5v-1A1.5 1.5 0 0 1 6.5 0h3A1.5 1.5 0 0 1 11 1.5m-5 0v1h4v-1a.5.5 0 0 0-.5-.5h-3a.5.5 0 0 0-.5.5M4.5 5.029l.5 8.5a.5.5 0 1 0 .998-.06l-.5-8.5a.5.5 0 1 0-.998.06m6.53-.528a.5.5 0 0 0-.528.47l-.5 8.5a.5.5 0 0 0 .998.058l.5-8.5a.5.5 0 0 0-.47-.528M8 4.5a.5.5 0 0 0-.5.5v8.5a.5.5 0 0 0 1 0V5a.5.5 0 0 0-.5-.5"/></svg>
`;
    // Вставляем SVG, а затем добавляем текст
    deleteBtn.innerHTML = deleteSvgIcon + '';


    deleteBtn.addEventListener('click', () => {
        document.body.removeChild(modal);
        openConfirmModal("Удалить это упражнение?", async () => {
            program.exercises = (program.exercises || []).filter(ex => ex.id !== exercise.id);
            state.expandedExerciseId = null;
            state.editingSetId = null;
            await updateDoc(doc(getUserProgramsCollection(), program.id), { exercises: program.exercises });
            render(); // рендерим после удаления
        });
    });

    // Добавляем кнопки в модалку
    modalContent.append(editBtn, deleteBtn);
    modal.append(modalContent);
    document.body.append(modal);

    // Закрытие при клике вне модалки
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    });
}

//// =================================================================
  // ✏️ Модалка редактирования упражнения: имя + позиция
  // =================================================================
  function openEditExerciseModal(selectedProgram, exercise) {
      const overlay = createElement('div', 'modal-overlay');
      overlay.addEventListener('click', (e) => {
          if (e.target === overlay) document.body.removeChild(overlay);
      });

      const modal = createElement('div', 'modal-content modal-compact');

      // === Поле Названия ===
      const nameInput = createElement('input');
      nameInput.type = 'text';
      nameInput.value = exercise.name;

      // === Горизонтальный Wheel Picker (позиции) ===
      const total = selectedProgram.exercises.length;
      let currentIndex = selectedProgram.exercises.findIndex(ex => ex.id === exercise.id); // 0-based

      // Обёртка (label + колёсико в одну строку)
      const posLine = createElement('div', 'h-wheel-line'); // <--- новая обёртка строки

      const label = createElement('span', 'h-wheel-label', 'Сделать №');

      const posWrapper = createElement('div', 'h-wheel-wrapper');
      const leftBtn = createElement('button', 'h-wheel-arrow', '◀');
      const rightBtn = createElement('button', 'h-wheel-arrow', '▶');
      const wheel = createElement('div', 'h-wheel');

      // Добавляем пустой слева
      wheel.append(createElement('div', 'h-wheel-item empty', ''));

      // Основные номера
      for (let i = 1; i <= total; i++) {
          const item = createElement('div', 'h-wheel-item', i.toString());
          wheel.append(item);
      }

      // Пустой справа
      wheel.append(createElement('div', 'h-wheel-item empty', ''));

      // Центрирование
      function updateWheelPosition() {
          const items = wheel.querySelectorAll('.h-wheel-item');
          const itemWidth = items[1].offsetWidth;
          wheel.scrollTo({
              left: (currentIndex + 1) * itemWidth - wheel.offsetWidth / 2 + itemWidth / 2,
              behavior: 'smooth'
          });
          items.forEach((el, idx) => {
              el.classList.toggle('active', idx === currentIndex + 1);
          });
      }

      leftBtn.addEventListener('click', () => {
          if (currentIndex > 0) { currentIndex--; updateWheelPosition(); }
      });
      rightBtn.addEventListener('click', () => {
          if (currentIndex < total - 1) { currentIndex++; updateWheelPosition(); }
      });

      wheel.addEventListener('scroll', () => {
          const items = wheel.querySelectorAll('.h-wheel-item');
          const itemWidth = items[1].offsetWidth;
          const center = wheel.scrollLeft + wheel.offsetWidth / 2;
          let idx = Math.round((center - itemWidth / 2) / itemWidth) - 1;
          if (idx >= 0 && idx < total) {
              currentIndex = idx;
              items.forEach((el, i) => el.classList.toggle('active', i === currentIndex + 1));
          }
      });

      posWrapper.append(leftBtn, wheel, rightBtn);

      // ✅ Добавляем на одну строку: "Сделать №" + колесо
      posLine.append(label, posWrapper);
      setTimeout(updateWheelPosition, 100);

      // === Кнопки ===
      const controls = createElement('div', 'modal-controls');
      const save = createElement('button', 'btn btn-primary', 'Сохранить');

      save.addEventListener('click', async () => {
          exercise.name = nameInput.value.trim() || exercise.name;
          const toIndex = currentIndex;
          const fromIndex = selectedProgram.exercises.findIndex(ex => ex.id === exercise.id);
          if (fromIndex !== toIndex) {
              const moved = selectedProgram.exercises.splice(fromIndex, 1)[0];
              selectedProgram.exercises.splice(toIndex, 0, moved);
          }
          await updateDoc(doc(getUserProgramsCollection(), selectedProgram.id), { exercises: selectedProgram.exercises });
          showToast('Обновлено');
          document.body.removeChild(overlay);
          render();
      });

      controls.append(save);
      modal.append(posLine, nameInput, controls);
      overlay.appendChild(modal);
      document.body.appendChild(overlay);
  }

// =================================================================
// 🌟 ЛОГИКА СТРАНИЦЫ ДНЕВНИКА
// =================================================================
function renderJournalPage() {
    const contentContainer = document.createElement('div');

    if (state.currentMode === 'personal' && !state.selectedClientId) {
        const msg = createElement('div', 'muted', 'Выберите клиента, чтобы просмотреть календарь.');
        root.append(msg);
        return;
}

    // ✅ Автовыбор последнего цикла, если ничего не выбрано
    if (!state.selectedJournalCategory && state.journal.length > 0) {
        const lastRecord = [...state.journal].sort((a, b) => {
            const [dA, mA, yA] = a.date.split('.').map(Number);
            const [dB, mB, yB] = b.date.split('.').map(Number);
            return new Date(yB, mB - 1, dB) - new Date(yA, mA - 1, dA);
        })[0];
        state.selectedJournalCategory = lastRecord.cycleName || 'Без цикла';
    }

    // ✅ Если выбран цикл в селекте — сразу делаем его активным
    if (state.selectedJournalCategory) {
        const currentCycle = state.cycles.find(c => c.name === state.selectedJournalCategory);
        if (currentCycle && state.selectedCycleId !== currentCycle.id) {
            state.selectedCycleId = currentCycle.id;
            console.log('✅ Цикл активирован автоматически:', currentCycle.name, currentCycle.id);

            // Обновляем подписку на программы и дневник
            setupDynamicListeners();
        }
    }

    contentContainer.id = 'journal-content';

        // ✅ Если выбрана конкретная запись — показываем детальный просмотр
        if (state.selectedJournalRecord) {
            renderJournalRecordDetails(contentContainer);
            root.append(contentContainer);
            return;
        }

    contentContainer.className = 'journal-page';




    const header = createElement('h3', null, 'Дневник тренировок');
    contentContainer.append(header);


 // Контейнер под календарь
    const calendarContainer = createElement('div', 'calendar-container');
    contentContainer.append(calendarContainer);

    // После добавления calendarContainer
    let calendarRecords = state.journal;

    // фильтр по циклу
    if (state.selectedJournalCategory) {
        calendarRecords = calendarRecords.filter(r => r.cycleName === state.selectedJournalCategory);
    }

    // фильтр по программе
    if (state.selectedJournalProgram) {
        calendarRecords = calendarRecords.filter(r => r.programName === state.selectedJournalProgram);
    }

    renderCalendar(calendarContainer, calendarRecords);




// ✅ 1. КАСТОМНЫЙ SELECT ДЛЯ ЦИКЛОВ
const filterWrapper = createElement('div', 'journal-filters');
const cycleBlock = createElement('div', 'filter-block');

console.log("Циклы для селекта:", state.cycles);

const cycleSelectWrapper = createElement('div', 'custom-select');
const cycleSelectDisplay = createElement('div', 'select-display', state.selectedJournalCategory || 'Выберите цикл');
const cycleArrow = createElement('span', 'select-arrow', '▾');
cycleSelectDisplay.append(cycleArrow);

const cycleOptionsList = createElement('ul', 'select-options');
// ✅ 1. Получаем корректный список категорий (циклов) в зависимости от режима
const allCategories = [
    ...new Set(
        state.cycles
            .filter(c => {
                if (state.currentMode === 'own') return true;            // Личные циклы
                if (state.currentMode === 'personal') return c.clientId === state.selectedClientId; // Только циклы клиента
            })
            .map(c => c.name)
    )
];


allCategories.forEach(category => {
    const li = createElement('li', 'select-option', category);
    if (state.selectedJournalCategory === category) {
        li.classList.add('selected');
        cycleSelectDisplay.childNodes[0].textContent = category;
    }
    li.addEventListener('click', () => {
        state.selectedJournalCategory = category;
        state.selectedJournalProgram = '';

        // ✅ Найти цикл по имени и сразу установить его как выбранный
        const foundCycle = state.cycles.find(c => c.name === category);
        if (foundCycle) {
            state.selectedCycleId = foundCycle.id;
            console.log('✅ Цикл выбран из дневника:', foundCycle.name, foundCycle.id);
        } else {
            console.warn('⚠ Цикл не найден в state.cycles, но есть в journal', category);
        }

        // ✅ После выбора цепляем слушатели Firestore для программ этого цикла
        setupDynamicListeners();

        render();
    });
    cycleOptionsList.append(li);
});

cycleSelectDisplay.addEventListener('click', (e) => {
    e.stopPropagation();

    const rect = cycleSelectWrapper.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;

    cycleOptionsList.style.maxHeight = "200px"; // высота списка

    if (spaceBelow < 200 && spaceAbove > spaceBelow) {
        cycleOptionsList.classList.add('open-up');
    } else {
        cycleOptionsList.classList.remove('open-up');
    }

    cycleOptionsList.classList.toggle('open');
    cycleArrow.classList.toggle('open');
});

document.addEventListener('click', () => {
    cycleOptionsList.classList.remove('open');
    cycleArrow.classList.remove('open');
});

cycleSelectWrapper.append(cycleSelectDisplay, cycleOptionsList);
cycleBlock.append(cycleSelectWrapper);
filterWrapper.append(cycleBlock);


// ✅ 2. ЧЕКБОКС "ПОКАЗАТЬ ПРОГРАММЫ"
const checkboxBlock = createElement('div', 'filter-block');
checkboxBlock.innerHTML = `
    <label class="checkbox-container">
        <input type="checkbox" id="showPrograms" ${state.showPrograms ? 'checked' : ''}>
        <span class="checkmark"></span>
        Показать программы
    </label>
`;
checkboxBlock.querySelector('input').addEventListener('change', e => {
    state.showPrograms = e.target.checked;
    if (!state.showPrograms) state.selectedJournalProgram = '';
    render();
});
filterWrapper.append(checkboxBlock);


// ✅ 3. КАСТОМНЫЙ SELECT ДЛЯ ПРОГРАММ
const programBlock = createElement('div', 'filter-block');
programBlock.style.display = state.showPrograms ? 'block' : 'none';

const programSelectWrapper = createElement('div', 'custom-select');
const programSelectDisplay = createElement('div', 'select-display', state.selectedJournalProgram || 'Выберите программу');
const programArrow = createElement('span', 'select-arrow', '▾');
programSelectDisplay.append(programArrow);

const programOptionsList = createElement('ul', 'select-options');

if (state.selectedJournalCategory) {
    const programs = [...new Set(
        state.journal.filter(r => r.cycleName === state.selectedJournalCategory)
                     .map(r => r.programName)
    )];
    programs.forEach(prog => {
        const li = createElement('li', 'select-option', prog);
        if (state.selectedJournalProgram === prog) {
            li.classList.add('selected');
            programSelectDisplay.childNodes[0].textContent = prog;
        }
        li.addEventListener('click', () => {
            state.selectedJournalProgram = prog;
            render();
        });
        programOptionsList.append(li);
    });
}

programSelectDisplay.addEventListener('click', e => {
    e.stopPropagation();

    const rect = programSelectWrapper.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;

    programOptionsList.style.maxHeight = "200px";

    if (spaceBelow < 200 && spaceAbove > spaceBelow) {
        programOptionsList.classList.add('open-up');
    } else {
        programOptionsList.classList.remove('open-up');
    }

    programOptionsList.classList.toggle('open');
    programArrow.classList.toggle('open');
});

document.addEventListener('click', () => {
    programOptionsList.classList.remove('open');
    programArrow.classList.remove('open');
});

programSelectWrapper.append(programSelectDisplay, programOptionsList);
programBlock.append(programSelectWrapper);
filterWrapper.append(programBlock);

// ✅ Добавляем в DOM
contentContainer.append(filterWrapper);

root.append(contentContainer);
}

// ------------------------------------------------
// 📅 ГЛАВНАЯ ФУНКЦИЯ — РЕНДЕР КАЛЕНДАРЯ
// ------------------------------------------------
function renderCalendar(container, journalRecords) {
    container.innerHTML = '';

    if (state.calendarYear === undefined) {
        state.calendarYear = new Date().getFullYear();
        state.calendarMonth = new Date().getMonth();
    }

    const year = state.calendarYear;
    const month = state.calendarMonth;

    // ------------------ ШАПКА КАЛЕНДАРЯ (месяц, стрелки) ------------------
    const calendarHeader = createElement('div', 'calendar-header');

    const prevBtn = createElement('button', 'calendar-nav-btn');
    prevBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M13.83 19a1 1 0 0 1-.78-.37l-4.83-6a1 1 0 0 1 0-1.27l5-6a1 1 0 0 1 1.54 1.28L10.29 12l4.32 5.36a1 1 0 0 1-.78 1.64"/></svg>`;
    prevBtn.addEventListener('click', () => {
        state.calendarMonth--;
        if (state.calendarMonth < 0) {
            state.calendarMonth = 11;
            state.calendarYear--;
        }
        render();
    });

    const nextBtn = createElement('button', 'calendar-nav-btn');
    nextBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M10 19a1 1 0 0 1-.64-.23a1 1 0 0 1-.13-1.41L13.71 12L9.39 6.63a1 1 0 0 1 .15-1.41a1 1 0 0 1 1.46.15l4.83 6a1 1 0 0 1 0 1.27l-5 6A1 1 0 0 1 10 19"/></svg>`;
    nextBtn.addEventListener('click', () => {
        state.calendarMonth++;
        if (state.calendarMonth > 11) {
            state.calendarMonth = 0;
            state.calendarYear++;
        }
        render();
    });

    const monthNames = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
    const title = createElement('div', 'calendar-title', `${monthNames[month]} ${year}`);

    calendarHeader.append(prevBtn, title, nextBtn);
    container.append(calendarHeader);

    // ------------------ ДНИ НЕДЕЛИ ------------------
    const daysOfWeek = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
    const headerRow = createElement('div', 'calendar-row header');
    daysOfWeek.forEach(d => headerRow.append(createElement('div', 'calendar-cell header-cell', d)));
    container.append(headerRow);

    // ------------------ СЕТКА ДНЕЙ ------------------
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startOffset = (firstDay.getDay() + 6) % 7;
    const totalDays = lastDay.getDate();

    const grid = createElement('div', 'calendar-grid');
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(7, 1fr)';

    // Пустые ячейки в начале
    for (let i = 0; i < startOffset; i++) {
        grid.append(createElement('div', 'calendar-cell empty'));
    }

    // ------------------ Основной рендер дней ------------------
    for (let day = 1; day <= totalDays; day++) {
        const dateStr = `${String(day).padStart(2, '0')}.${String(month + 1).padStart(2, '0')}.${year}`;
        const dayRecords = journalRecords.filter(r => r.date === dateStr);

        const cell = createElement('div', 'calendar-cell');
        cell.innerHTML = `<div class="day-number">${day}</div>`;

        // ✅ Сегодняшний день
        const now = new Date();
        if (day === now.getDate() && month === now.getMonth() && year === now.getFullYear()) {
            cell.classList.add('today');
        }

        // ✅ Есть тренировки (завершённые / плановые)
        if (dayRecords.length > 0) {
            if (dayRecords.some(r => r.isPlanned)) cell.classList.add('planned');
            if (dayRecords.some(r => !r.isPlanned)) cell.classList.add('has-training');

            const label = createElement('div', 'training-label', dayRecords.map(r => r.programName).join(', '));
            cell.append(label);

            cell.addEventListener('click', (e) => {
                e.stopPropagation();
                const old = document.querySelector('.training-dropdown');
                if (old) old.remove();

                if (dayRecords.length === 1 && !dayRecords[0].isPlanned) {
                    state.selectedJournalRecord = dayRecords[0].id;
                    render();
                    return;
                }

                openTrainingDropdown(cell, dayRecords);
            });
        } else {
            // ✅ Пустая ячейка — планирование
            cell.addEventListener('click', () => {
                openPlanTrainingDropdown(cell, dateStr);
            });
        }

        grid.append(cell);
    }

    container.append(grid);

    // ✅ Закрываем меню по клику вне
    document.addEventListener('click', () => {
        const menu = document.querySelector('.training-dropdown');
        if (menu) menu.remove();
    }, { once: true });
}

// ------------------------------------------------
// 📌 Меню планирования тренировки в пустой ячейке
// ------------------------------------------------

function openPlanTrainingDropdown(cell, dateStr) {
    // Убираем старое меню
    const old = document.querySelector('.training-dropdown');
    if (old) old.remove();

    // 1️⃣ Определяем выбранный цикл (по названию из select-display)
    let currentCycleName = state.selectedJournalCategory;
    let currentCycle = state.cycles.find(c => c.name === currentCycleName);

    // 2️⃣ Если цикл найден — используем его id
    if (currentCycle) {
        state.selectedCycleId = currentCycle.id;
    }

    // 3️⃣ Если всё ещё нет ID → предупреждаем
    if (!state.selectedCycleId) {
        showToast('Сначала выберите цикл');
        return;
    }

    // ✅ Тянем программы из Firestore для этого цикла:
    getDocs(getUserProgramsCollection()).then(programsSnap => {
        const programList = programsSnap.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        if (programList.length === 0) {
            showToast('В этом цикле нет программ. Добавьте их в разделе "Программы".');
            return;
        }

        const dropdown = document.createElement('ul');
        dropdown.className = 'training-dropdown';

        programList.forEach(program => {
            const li = document.createElement('li');
            li.className = 'training-dropdown-item';
            li.textContent = program.name;
            li.addEventListener('click', async () => {
                await addDoc(getUserJournalCollection(), {
                    date: dateStr,
                    cycleName: currentCycleName,
                    programName: program.name,
                    isPlanned: true,
                    exercises: []
                });
                dropdown.remove();
                showToast('Тренировка запланирована!');
            });
            dropdown.append(li);
        });

        document.body.append(dropdown);
         // ✅ 4. Умное позиционирование (вниз/вверх если не помещается)
            smartPositionDropdown(dropdown, cell);

            // ✅ 5. Закрытие при клике вне меню
            setTimeout(() => {
                document.addEventListener('click', function handler(e) {
                    if (!dropdown.contains(e.target)) {
                        dropdown.remove();
                        document.removeEventListener('click', handler);
                    }
                });
            }, 10);

        const rect = cell.getBoundingClientRect();
        dropdown.style.left = rect.left + 'px';
        dropdown.style.top = rect.bottom + 'px';

        // ✅ После вставки — проверяем границы
        requestAnimationFrame(() => {
            const menuRect = dropdown.getBoundingClientRect();

            // 👉 Если вылезает вправо — сдвигаем влево
            if (menuRect.right > window.innerWidth) {
                dropdown.style.left = Math.max(5, rect.right - menuRect.width) + 'px';
            }

            // 👉 Если вылезает вниз — переносим вверх
            if (menuRect.bottom > window.innerHeight) {
                dropdown.style.top = Math.max(5, rect.top - menuRect.height) + 'px';
            }
        });



    });
}

// ------------------------------------------------
// // 📌 Меню выбора тренировки в занятой ячейке (запланированные или завершённые)
// ------------------------------------------------

function openTrainingDropdown(cell, dayRecords) {
    // Удаляем старое меню
    const old = document.querySelector('.training-dropdown');
    if (old) old.remove();

    const dropdown = document.createElement('ul');
    dropdown.className = 'training-dropdown';

    dayRecords.forEach(record => {
        const li = document.createElement('li');
        li.className = 'training-dropdown-item';
        li.textContent = record.programName + (record.isPlanned ? ' (заплан.)' : '');

        if (!record.isPlanned) {
            // ✅ ЗАВЕРШЕННАЯ ТРЕНИРОВКА — ОТКРЫВАЕМ ЖУРНАЛ
            li.addEventListener('click', () => {
                state.selectedJournalRecord = record.id;  // это id записи дневника!
                state.currentPage = 'journal';
                render();
            });
        } else {
            // ✅ ЗАПЛАНИРОВАННАЯ — ОТКРЫВАЕМ ПРОГРАММУ
            li.addEventListener('click', () => {
                const cycle = state.cycles.find(c => c.name === record.cycleName);
                if (!cycle) {
                    showToast('Цикл не найден, откройте его вручную.');
                    return;
                }
                state.selectedCycleId = cycle.id;
                state.currentPage = 'programsInCycle';

                setTimeout(() => {
                    const program = state.programs.find(p => p.name === record.programName);
                    if (program) {
                        state.selectedProgramIdForDetails = program.id;
                        state.currentPage = 'programDetails';
                    }
                    render();
                }, 300);
            });
        }

        dropdown.append(li);
    });

    // Кнопка удаления только для запланированных
    if (dayRecords.some(r => r.isPlanned)) {
        const deleteLi = document.createElement('li');
        deleteLi.className = 'training-dropdown-item delete';
        deleteLi.textContent = '🗑 Удалить план';
        deleteLi.addEventListener('click', async () => {
            if (confirm('Удалить запланированную тренировку?')) {
                for (const rec of dayRecords.filter(r => r.isPlanned)) {
                    await deleteDoc(doc(getUserJournalCollection(), rec.id));
                }
                showToast('План удалён');
                dropdown.remove();
            }
        });
        dropdown.append(deleteLi);
    }

    // Показываем в DOM
    document.body.append(dropdown);

    // Позиция
    const rect = cell.getBoundingClientRect();
    dropdown.style.left = rect.left + 'px';
    dropdown.style.top = rect.bottom + 'px';

    // ✅ После вставки — проверяем границы
    requestAnimationFrame(() => {
        const menuRect = dropdown.getBoundingClientRect();

        // 👉 Если вылезает вправо — сдвигаем влево
        if (menuRect.right > window.innerWidth) {
            dropdown.style.left = Math.max(5, rect.right - menuRect.width) + 'px';
        }

        // 👉 Если вылезает вниз — переносим вверх
        if (menuRect.bottom > window.innerHeight) {
            dropdown.style.top = Math.max(5, rect.top - menuRect.height) + 'px';
        }
    });

    // Закрытие при клике вне
    setTimeout(() => {
        document.addEventListener('click', function handler(e) {
            if (!dropdown.contains(e.target)) {
                dropdown.remove();
                document.removeEventListener('click', handler);
            }
        });
    }, 10);
}

// =================================================================
// 🔥 Универсальная функция позиционирования dropdown
// =================================================================


function smartPositionDropdown(dropdown, anchorElement) {
    const rect = anchorElement.getBoundingClientRect();
    const menuRect = dropdown.getBoundingClientRect();

    let top = rect.bottom;
    let left = rect.left;

    // Если не помещается вниз — открываем вверх
    if (rect.bottom + menuRect.height > window.innerHeight) {
        top = rect.top - menuRect.height;
    }

    // Если dropdown вылезает справа — смещаем влево
    if (left + menuRect.width > window.innerWidth) {
        left = window.innerWidth - menuRect.width - 10;
    }

    // Если dropdown уходит влево за экран
    if (left < 0) left = 10;

    dropdown.style.top = top + 'px';
    dropdown.style.left = left + 'px';
    dropdown.style.opacity = 1;   // для плавного появления
}
// =================================================================
// 🔥 новая страница с завершенными тренировками
// =================================================================
function renderJournalRecordDetails(container) {
        root.innerHTML = '';

    const record = state.journal.find(r => r.id === state.selectedJournalRecord);
    if (!record) {
        state.selectedJournalRecord = null;
        render();
        return;
    }

    const backBtn = createElement('button', 'btn back-btn', '← Назад');
    backBtn.addEventListener('click', () => {
        state.selectedJournalRecord = null;
        render();
    });

    container.append(backBtn);

    // Заголовок
// 🔹 Заголовок с редактированием даты
const titleWrapper = createElement('div', 'record-header');

let dateElement = createElement('span', 'record-date', `${record.date}  — ${record.programName}`);
const editBtn = createElement('button', 'edit-date-btn', '✏️');

titleWrapper.append(dateElement, editBtn);
container.append(titleWrapper);

// 📌 Редактирование даты
editBtn.addEventListener('click', () => {
    // Преобразуем дату в формат YYYY-MM-DD для input type="date"
    const [d, m, y] = record.date.split('.');
    const input = createElement('input', 'date-input');
    input.type = 'date';
    input.value = `${y}-${m}-${d}`;

    const saveBtn = createElement('button', 'btn save-date-btn', '✅');
    const cancelBtn = createElement('button', 'btn cancel-btn', '❌');

    titleWrapper.innerHTML = '';
    titleWrapper.append(input, saveBtn, cancelBtn);

    cancelBtn.addEventListener('click', () => {
        titleWrapper.innerHTML = '';
        titleWrapper.append(dateElement, editBtn);
    });

    saveBtn.addEventListener('click', async () => {
        const newDate = input.value; // формата YYYY-MM-DD
        const [year, month, day] = newDate.split('-');
        const formatted = `${day}.${month}.${year}`;

        try {
            await updateDoc(doc(getUserJournalCollection(), record.id), { date: formatted });
            showToast('✅ Дата обновлена!');
            render(); // обновляем экран
        } catch (e) {
            console.error(e);
            showToast('❌ Ошибка обновления даты');
        }
    });
});


// 🔥 Кнопка удаления тренировки
const deleteBtn = createElement('button', 'btn delete-record-btn', '🗑 Удалить тренировку');
deleteBtn.addEventListener('click', () => {
    openConfirmModal('Удалить эту тренировку?', async () => {
        try {
            await deleteDoc(doc(getUserJournalCollection(), record.id));
            showToast('✅ Тренировка удалена');
            state.selectedJournalRecord = null;
            render();
        } catch (error) {
            console.error(error);
            showToast('❌ Ошибка удаления');
        }
    });
});

container.append(deleteBtn);

    // 🔹 Комментарий к тренировке + медиа
    if (record.comment || (record.trainingMedia?.length > 0)) {
        const commentBlock = createElement('div', 'training-comment-block');

        if (record.comment) {
            const commentText = createElement('p', 'comment-text', record.comment);
            commentBlock.append(commentText);
        }
        if (record.trainingMedia && record.trainingMedia.length > 0) {
            const mediaWrap = createElement('div', 'media-wrap');
            record.trainingMedia.forEach(file => {
                if (file.type === 'photo') {
                    const img = createElement('img', 'media-thumb');
                    img.src = file.url;
                    img.onclick = () => openPhotoFullScreen(file.url);
                    mediaWrap.append(img);
                } else {
                    const video = createElement('video', 'media-thumb');
                    video.src = file.url;
                    video.controls = true;
                    mediaWrap.append(video);
                }
            });
            commentBlock.append(mediaWrap);
        }

        container.append(commentBlock);
    }

    // 🔹 Упражнения
    record.exercises.forEach((exercise, index) => {
        const block = createElement('div', 'exercise-block');
        const exTitle = createElement('h4', null, `${index + 1}. ${exercise.name}`);
        block.append(exTitle);

        const sets = createElement('div', 'sets-line');
        (exercise.sets || []).forEach(s => {
            if (s.weight || s.reps) {
                const span = createElement('span', null, `${s.weight || 0}x${s.reps || 0}`);
                sets.append(span);
            }
        });
        block.append(sets);

        if (exercise.note) {
            const note = createElement('p', 'exercise-note', exercise.note);
            block.append(note);
        }

        if (exercise.media && exercise.media.length > 0) {
            const mediaWrap = createElement('div', 'media-wrap');
            exercise.media.forEach(file => {
                if (file.type === 'photo') {
                    const img = createElement('img', 'media-thumb');
                    img.src = file.url;
                    img.onclick = () => openPhotoFullScreen(file.url);
                    mediaWrap.append(img);
                } else {
                    const video = createElement('video', 'media-thumb');
                    video.src = file.url;
                    video.controls = true;
                    mediaWrap.append(video);
                }
            });
            block.append(mediaWrap);
        }

        container.append(block);
    });



    root.append(container);
}



// =================================================================
// 🔥 НОВАЯ ФУНКЦИЯ FIREBASE: Обновление плана добавок
// =================================================================
async function updateSupplementPlanInFirestore(newPlan) {
    const docRef = getSupplementPlanDocRef();
    if (!docRef) {
        showToast('Ошибка: Не выбран цикл для сохранения плана добавок.');
        return;
    }

    try {
        await updateDoc(docRef, { supplementPlan: newPlan });
        // showToast('План добавок сохранен!'); // Убрали, чтобы не спамить при вводе
    } catch (error) {
        console.error("Ошибка при сохранении плана добавок:", error);
        showToast('Ошибка сохранения плана добавок. Проверьте правила Firebase!');
    }
}

// 🔥 НОВАЯ ЛОГИКА: Добавление препарата (Минимальная версия)
async function addSupplement(supplementName) {
    if (!state.supplementPlan) return;

    const newPlan = JSON.parse(JSON.stringify(state.supplementPlan));

    if (newPlan.supplements.includes(supplementName)) {
        showToast('Этот препарат уже добавлен!');
        return;
    }

    newPlan.supplements.push(supplementName);

    // Добавляем пустые поля для нового препарата во все существующие записи
    newPlan.data = newPlan.data.map(dayRecord => {
        dayRecord.doses = dayRecord.doses || {};
        dayRecord.doses[supplementName] = '';
        return dayRecord;
    });

    await updateSupplementPlanInFirestore(newPlan);
    showToast(`Препарат "${supplementName}" добавлен!`);
}

// 🔥 НОВАЯ ЛОГИКА: Добавление недели (7 дней)
async function addWeek() {
    const currentCycle = state.cycles.find(c => c.id === state.selectedCycleId);
    if (!currentCycle || !state.supplementPlan) return;

    const newPlan = JSON.parse(JSON.stringify(state.supplementPlan));
    const currentLength = newPlan.data.length;

    let nextStartDateString;
    if (currentLength > 0) {
        // Берем последнюю дату и сдвигаем на 1 день вперед
        const lastDateString = newPlan.data[currentLength - 1].date;
        const [startDay, startMonth, startYear] = lastDateString.split('.');
        const lastDate = new Date(`${startYear}-${startMonth}-${startDay}`);
        const nextStartDate = new Date(lastDate);
        nextStartDate.setDate(lastDate.getDate() + 1);

        const day = String(nextStartDate.getDate()).padStart(2, '0');
        const month = String(nextStartDate.getMonth() + 1).padStart(2, '0');
        const year = nextStartDate.getFullYear();
        nextStartDateString = `${day}.${month}.${year}`;
    } else {
        // Если план пустой, начинаем с даты начала цикла
        nextStartDateString = currentCycle.startDateString;
    }

    const newDates = generateDates(nextStartDateString, 7);
    const newRecords = newDates.map(dateInfo => {
        const doseMap = {};
        // Заполняем пустые дозировки для всех существующих препаратов
        newPlan.supplements.forEach(supName => {
            doseMap[supName] = '';
        });

        return {
            date: dateInfo.date,
            dayOfWeek: dateInfo.dayOfWeek,
            doses: doseMap
        };
    });

    newPlan.data.push(...newRecords);

    // Если план был пустой, нам нужно обновить state.supplementPlan перед сохранением
    // чтобы onSnapshot не пропустил инициализацию, но в данном случае лучше просто сохранить.
    await updateSupplementPlanInFirestore(newPlan);
}

// Отложенное сохранение дозировки
const debouncedSaveDoseData = debounce(async (supName, dayIndex, value) => {
    const newPlan = JSON.parse(JSON.stringify(state.supplementPlan));

    if (newPlan && newPlan.data[dayIndex]) {
        // Убедимся, что doses существует
        newPlan.data[dayIndex].doses = newPlan.data[dayIndex].doses || {};
        newPlan.data[dayIndex].doses[supName] = value;
        await updateSupplementPlanInFirestore(newPlan);
    }
}, 700);

// 🔥 НОВАЯ ЛОГИКА: Удаление последней недели (7 дней)
async function removeLastWeek() {
    if (!state.supplementPlan || state.supplementPlan.data.length === 0) {
        showToast('Нет данных для удаления.');
        return;
    }

    const newPlan = JSON.parse(JSON.stringify(state.supplementPlan));

    // Удаляем последние 7 записей
    newPlan.data.splice(Math.max(0, newPlan.data.length - 7));

    await updateSupplementPlanInFirestore(newPlan);
    showToast('Последняя неделя удалена.');
}


// =================================================================
// 🔄 ГЕНЕРАЦИЯ ПОЛНОГО HTML-КОНТЕНТА ОТЧЕТА (С ФИЛЬТРАЦИЕЙ ПРОГРАММ)
// =================================================================
function generateCycleReportHtml(
    currentCycle,
    startDateString,
    endDateString
) {
    const planData = state.supplementPlan || { supplements: [], data: [] };

    // 1. ФИЛЬТРАЦИЯ ПЛАНА ДОБАВОК ПО ДАТАМ
    const parseDate = (dateString) => new Date(dateString.split('.').reverse().join('-'));
    const start = parseDate(startDateString);
    const end = parseDate(endDateString);
    end.setHours(23, 59, 59, 999);

    const filteredSupplementsData = planData.data.filter(dayRecord => {
        const recordDate = parseDate(dayRecord.date);
        return recordDate >= start && recordDate <= end;
    });

    // 2. ПРОВЕРКА НАЛИЧИЯ ДАННЫХ
    if (filteredSupplementsData.length === 0) {
        showToast('В выбранном диапазоне нет данных по добавкам.');
        return null;
    }

    // -----------------------------------------------------------
    // 3. СОЗДАНИЕ HTML-КОНТЕНТА (ТОЛЬКО БАДЫ)
    // -----------------------------------------------------------

    let contentHtml = `
        <h1 style="color: #333; border-bottom: 3px solid #007bff; padding-bottom: 10px; font-size: 1.5em; text-align: center;">Отчет по добавкам: ${currentCycle.name}</h1>
        <p class="pdf-date-range" style="font-size: 1em; margin-bottom: 30px; text-align: center;">Период: ${startDateString} — ${endDateString}</p>
    `;

    // БЛОК БАДОВ (КАЛЕНДАРЬ)
    contentHtml += createSupplementsCalendarHtml(planData, filteredSupplementsData);

    // 🔥 Оборачиваем в полный HTML-документ (Остальная часть функции остается без изменений)
// 🔥 Оборачиваем в полный HTML-документ и **вставляем мобильные стили**
    const fullHtml = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Отчет: ${currentCycle.name}</title>
            <style>
                /* Стили для печати (взяты из наших предыдущих исправлений для мобильной адаптации) */
                body {
                    margin: 0;
                    padding: 10px;
                    font-family: Arial, sans-serif;
                    background-color: #fff;
                    width: 100%;
                    box-sizing: border-box;
                    font-size: 11px;
                    line-height: 1.3;
                }
                .pdf-report-container { width: 100%; margin: 0 auto; }
                h1, h2, h3, h4 { page-break-after: avoid; margin-top: 10px; margin-bottom: 5px; }
                h1 { font-size: 1.6em; }
                h3 { font-size: 1.2em; color: #333; border-bottom: 2px solid #007bff; padding-bottom: 5px; }
                h4 { font-size: 1em; color: #007bff; margin: 0 0 5px 0; }

                table { width: 100%; border-collapse: collapse; margin-top: 5px; table-layout: auto; }
                th, td { border: 1px solid #ccc; padding: 3px; text-align: center; vertical-align: top; box-sizing: border-box; }
                th { background-color: #e9ecef; font-weight: 600; }

                /* Стили для таблицы добавок */
                .pdf-calendar-table { font-size: 0.7em; }
                .pdf-calendar-table th, .pdf-calendar-table td {
                    padding: 2px; min-width: 40px; max-width: 60px; word-break: break-word; line-height: 1.1;
                }
                .pdf-calendar-table th:first-child, .pdf-calendar-table td:first-child {
                    min-width: 50px; max-width: 50px; font-size: 0.8em; padding: 3px 1px;
                }
                .pdf-calendar-table th:nth-child(2), .pdf-calendar-table td:nth-child(2) {
                    min-width: 30px; max-width: 30px; font-weight: bold;
                }
                .supplement-table-wrapper:not(:first-child) { margin-top: 15px; page-break-before: auto; }

                /* Стили для дневника и программ */
                .journal-record-block, .program-block { page-break-inside: avoid; margin-top: 15px; border: 1px solid #ddd; border-radius: 5px; padding: 5px; }
                .report-journal-table th, .report-journal-table td,
                .report-program-table th, .report-program-table td {
                    font-size: 0.8em; padding: 4px;
                }
                .report-journal-table td:nth-child(1) { width: 55%; text-align: left; }
                .report-journal-table td:nth-child(2) { width: 45%; white-space: pre-wrap; }
                .report-program-table td:nth-child(1) { width: 70%; text-align: left; }
                .report-program-table td:nth-child(2) { width: 30%; }

                .journal-comment { font-size: 0.8em; color: #555; margin: 5px 0 0 0; padding-left: 10px; border-left: 3px solid #007aff; }

                /* ПЕЧАТЬ (PDF) */
                @media print {
                    body { font-size: 9pt; padding: 0; }
                    .pdf-calendar-table th, .pdf-calendar-table td { font-size: 7pt; padding: 1pt; }
                    .report-journal-table th, .report-journal-table td,
                    .report-program-table th, .report-program-table td { font-size: 8pt; padding: 2pt; }
                    .journal-comment { font-size: 8pt; }
                    .pdf-report-container > h1 { margin-top: 0; }
                }
            </style>
        </head>
        <body>
            <div class="pdf-report-container">
                ${contentHtml}
            </div>
        </body>
        </html>
    `;

    return fullHtml;
}
// =================================================================
// ⚙️ МОДАЛЬНОЕ ОКНО ОПЦИЙ ОТЧЕТА ПО БАДАМ (С ВЫБОРОМ ПРОГРАММ)
// =================================================================

function openSupplementsPdfOptionsModal(cycleId, planData) {
    const root = document.getElementById('root');
    const overlay = createElement('div', 'modal-overlay', '');
    overlay.classList.add('active'); // Показываем оверлей сразу

    // Получаем программы текущего цикла для динамического рендера
    const programsInCycle = planData.programsInCycle || [];

    const modalContent = createElement('div', 'modal-content modal-compact');

    // --- ЗАГОЛОВОК ---
    modalContent.appendChild(createElement('div', 'modal-title', 'Параметры Отчета по БАДам'));

    // --- 1. ОПЦИЯ ВКЛЮЧЕНИЯ/ИСКЛЮЧЕНИЯ ТРЕНИРОВОК ---
    const programsToggleGroup = createElement('div', 'checkbox-group');
    programsToggleGroup.style.marginBottom = '15px';
    programsToggleGroup.innerHTML = `
        <label style="display: flex; align-items: center; justify-content: space-between; font-size: 16px;">
            Включить тренировки в отчет
            <input type="checkbox" id="include-programs-toggle" checked style="width: 18px; height: 18px;">
        </label>
    `;
    modalContent.appendChild(programsToggleGroup);

    // --- 2. КОНТЕЙНЕР ДЛЯ ВЫБОРА КОНКРЕТНЫХ ПРОГРАММ ---
    const programsSelectionContainer = createElement('div', 'programs-selection-container');
    programsSelectionContainer.style.borderTop = '1px solid #ccc';
    programsSelectionContainer.style.paddingTop = '10px';
    programsSelectionContainer.style.maxHeight = '200px'; // Ограничение высоты для скролла
    programsSelectionContainer.style.overflowY = 'auto';


    // 2.1. ЧЕКБОКС "ВЫБРАТЬ ВСЕ"
    if (programsInCycle.length > 0) {
        programsSelectionContainer.innerHTML = `
            <label style="display: flex; align-items: center; margin-bottom: 8px; font-weight: 600;">
                <input type="checkbox" id="select-all-programs" checked style="width: 16px; height: 16px; margin-right: 10px;">
                Выбрать все программы
            </label>
        `;
    }

    // 2.2. СПИСОК ПРОГРАММ
    programsInCycle.forEach(program => {
        const checkboxId = `program-checkbox-${program.id}`;
        const programItem = createElement('div', null, `
            <label style="display: flex; align-items: center; margin-left: 20px; margin-bottom: 5px;">
                <input type="checkbox" class="program-select-checkbox" data-program-id="${program.id}" checked style="width: 16px; height: 16px; margin-right: 10px;">
                ${program.name}
            </label>
        `);
        programsSelectionContainer.appendChild(programItem);
    });

    if (programsInCycle.length === 0) {
        programsSelectionContainer.innerHTML = '<p style="font-size: 14px; color: #888;">Нет программ в текущем цикле.</p>';
    }

    modalContent.appendChild(programsSelectionContainer);

    // --- 3. КНОПКИ УПРАВЛЕНИЯ ---
    const controls = createElement('div', 'modal-controls', '');
    const cancelBtn = createElement('button', 'btn', 'Отмена');
    cancelBtn.onclick = () => overlay.remove();

    const generateBtn = createElement('button', 'btn btn-primary', 'Сформировать PDF');
    generateBtn.onclick = () => {

        const includePrograms = document.getElementById('include-programs-toggle').checked;
        let selectedProgramIds = [];

        if (includePrograms) {
            // Собираем ID только тех, которые отмечены
            selectedProgramIds = Array.from(document.querySelectorAll('.program-select-checkbox:checked'))
                .map(checkbox => checkbox.dataset.programId);

            // Если включены, но ни одна не выбрана, предупреждаем
            if (programsInCycle.length > 0 && selectedProgramIds.length === 0) {
                showToast('Выберите хотя бы одну программу или отключите вывод тренировок.', 'error');
                return;
            }
        }

        overlay.remove();

        // 🔥 Вызываем генерацию отчета с новыми параметрами
        generateCycleReport(
            cycleId,
            planData,
            true, // includeSupplements - Всегда true для этой модалки
            includePrograms,
            selectedProgramIds // Передаем массив выбранных ID
        );
    };

    controls.appendChild(cancelBtn);
    controls.appendChild(generateBtn);
    modalContent.appendChild(controls);
    overlay.appendChild(modalContent);
    root.appendChild(overlay);

    // --- ЛОГИКА ЧЕКБОКСОВ ---
    const toggle = document.getElementById('include-programs-toggle');
    const selectAll = document.getElementById('select-all-programs');
    const checkboxes = document.querySelectorAll('.program-select-checkbox');

    // Переключение контейнера выбора программ
    const updateVisibility = () => {
        programsSelectionContainer.style.display = toggle.checked ? 'block' : 'none';
        generateBtn.disabled = toggle.checked && programsInCycle.length > 0 && Array.from(checkboxes).filter(c => c.checked).length === 0;
    };

    // Обработка "Выбрать все"
    if (selectAll) {
        selectAll.addEventListener('change', () => {
            checkboxes.forEach(c => c.checked = selectAll.checked);
            updateVisibility();
        });
    }

    // Обработка одиночных чекбоксов
    checkboxes.forEach(c => {
        c.addEventListener('change', () => {
            if (selectAll && !c.checked) {
                selectAll.checked = false;
            } else if (selectAll && Array.from(checkboxes).every(cb => cb.checked)) {
                selectAll.checked = true;
            }
            updateVisibility();
        });
    });

    toggle.addEventListener('change', updateVisibility);

    updateVisibility(); // Первоначальная установка видимости
}



// =================================================================
// 🌟 НОВАЯ ФУНКЦИЯ: РЕНДЕР СВОДНОГО HTML-ОТЧЕТА ДЛЯ ПЕЧАТИ
// =================================================================
function renderCycleReportPage(htmlContent) {
    const root = document.getElementById('root');
    root.innerHTML = '';

    const contentContainer = document.createElement('div');
    contentContainer.id = 'cycle-report-content';
    contentContainer.className = 'report-page-container';

    // Кнопка назад
    const backButton = createElement('button', 'btn back-btn', '← Назад к БАДам');
    backButton.addEventListener('click', () => {
        state.currentPage = 'supplements';
        render();
    });

    // Кнопка печати
    const printButton = createElement('button', 'btn btn-primary print-btn', '🖨️ Печать / Сохранить как PDF');
    printButton.addEventListener('click', () => {
        // Открываем отчет в новом окне для печати
        const printWindow = window.open('', '_blank');
        printWindow.document.write(htmlContent);
        printWindow.document.close();
        printWindow.print(); // Запускаем печать
        // После закрытия окна печати оно может быть закрыто, или оставлено.
    });

    const header = createElement('div', 'report-header-controls');
    header.append(backButton, printButton);
    contentContainer.append(header);

    // Контейнер, куда будет вставлен сгенерированный HTML
    const reportDisplay = createElement('div', 'report-html-display');
    reportDisplay.innerHTML = htmlContent;

    contentContainer.append(reportDisplay);
    root.append(contentContainer);

    // Важно: Отключаем навигацию, пока находимся на странице печати
    document.querySelector('.navigation').style.display = 'none';
}
// =================================================================
// ⚙️ ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ: МОДАЛЬНОЕ ОКНО ДЛЯ ОПЦИЙ ОТЧЕТА
// =================================================================
// Внимание: Эта функция требует наличия div#modal-overlay в вашем HTML
function openPdfOptionsModal(callback) {
    const modal = document.getElementById('modal-overlay');
    if (!modal) {
        // Если модальное окно не найдено, вызываем колбэк со значениями по умолчанию и выходим
        callback(true, true);
        return;
    }

    modal.innerHTML = `
        <div class="modal-content">
            <h3>Настройка отчета</h3>
            <p>Какие данные включить в сводный отчет?</p>
            <div style="margin: 15px 0;">
                <label style="display: block; margin-bottom: 10px; font-weight: bold;">
                    <input type="checkbox" id="include-supplements" checked disabled style="margin-right: 10px;">
                    План приема БАДов (обязательно)
                </label>
                <label style="display: block; margin-bottom: 10px;">
                    <input type="checkbox" id="include-journal" checked style="margin-right: 10px;">
                    Завершенные тренировки (Дневник)
                </label>
                <label style="display: block; margin-bottom: 10px;">
                    <input type="checkbox" id="include-programs" style="margin-right: 10px;">
                    Тренировочный план (Шаблоны программ)
                </label>
            </div>
            <div class="modal-controls">
                <button id="modal-cancel-btn" class="btn btn-secondary">Отмена</button>
                <button id="modal-generate-btn" class="btn btn-primary">Сгенерировать отчет</button>
            </div>
        </div>
    `;

    modal.style.display = 'flex';

    document.getElementById('modal-cancel-btn').addEventListener('click', () => {
        modal.style.display = 'none';
    });

    document.getElementById('modal-generate-btn').addEventListener('click', () => {
        const includeJournal = document.getElementById('include-journal').checked;
        const includePrograms = document.getElementById('include-programs').checked;
        modal.style.display = 'none';

        // Вызываем основной колбэк с выбранными опциями
        callback(includePrograms, includeJournal);
    });
}
// =================================================================
// 🎨 НОВАЯ ФУНКЦИЯ: ГЕНЕРАЦИЯ HTML-СВОДКИ ДНЕВНИКА
// =================================================================
function createJournalSummaryHtml(journalData, startDateString, endDateString) {
    if (!journalData || journalData.length === 0) {
        return `
            <div style="margin-bottom: 20px;">
                <h3 style="color: #6c757d; border-bottom: 1px solid #ccc; padding-bottom: 5px;">Завершенные тренировки (Дневник)</h3>
                <p style="text-align: center; color: #888;">Нет записей в дневнике за выбранный период.</p>
            </div>
        `;
    }

    // Вспомогательная функция для парсинга даты (копируется из downloadCycleReportPDF)
    const parseDate = (dateString) => new Date(dateString.split('.').reverse().join('-'));

    const start = parseDate(startDateString);
    const end = parseDate(endDateString);
    end.setHours(23, 59, 59, 999);

    // Фильтрация записей дневника по датам
    const filteredJournal = journalData.filter(record => {
        const recordDate = parseDate(record.date);
        return recordDate >= start && recordDate <= end;
    });

    if (filteredJournal.length === 0) {
        return `
            <div style="margin-bottom: 20px;">
                <h3 style="color: #6c757d; border-bottom: 1px solid #ccc; padding-bottom: 5px;">Завершенные тренировки (Дневник)</h3>
                <p style="text-align: center; color: #888;">Нет записей в дневнике за выбранный период (${startDateString} – ${endDateString}).</p>
            </div>
        `;
    }

    let html = `
        <div class="pdf-journal-section" style="margin-top: 40px; page-break-before: always;">
            <h3 style="color: #333; border-bottom: 2px solid #007bff; padding-bottom: 5px; font-size: 1.2em;">Завершенные тренировки (Дневник)</h3>
    `;

    filteredJournal.forEach(record => {
        html += `
            <div class="journal-record-block" style="margin-top: 20px; padding: 10px; border: 1px solid #ddd; border-radius: 5px; background-color: #f9f9f9;">
                <h4 style="color: #007bff; margin: 0 0 10px 0; font-size: 1.1em;">
                    Дата: ${record.date} ${record.dayOfWeek ? `(${record.dayOfWeek})` : ''} — ${record.programName || 'Без программы'}
                </h4>
        `;

        // Таблица для упражнений
        if (record.exercises && record.exercises.length > 0) {
            html += `
                <table class="report-journal-table" style="width: 100%; border-collapse: collapse; margin-bottom: 15px; font-size: 0.85em;">
                    <thead>
                        <tr style="background-color: #e9ecef;">
                            <th style="width: 45%; padding: 5px; border: 1px solid #ccc; text-align: left;">Упражнение</th>
                            <th style="width: 55%; padding: 5px; border: 1px solid #ccc;">Подходы и повторения (Вес x Повтор)</th>
                        </tr>
                    </thead>
                    <tbody>
            `;
            record.exercises.forEach((exercise, index) => {
                const setsHtml = (exercise.sets || [])
                    .map(set => `${set.weight || '—'}x${set.reps || '—'}`)
                    .join(' / ');

                html += `
                    <tr>
                        <td style="padding: 5px; border: 1px solid #ccc; text-align: left;">${index + 1}. ${exercise.name}</td>
                        <td style="padding: 5px; border: 1px solid #ccc; text-align: center;">${setsHtml}</td>
                    </tr>
                `;

                // Отображение комментария к упражнению
                if (exercise.note && exercise.note.trim() !== '') {
                    html += `
                        <tr>
                            <td colspan="2" style="padding: 2px 5px 5px 25px; border: 1px solid #ccc; text-align: left; background-color: #f1f1f1; font-style: italic; font-size: 0.9em;">
                                * Комментарий: ${exercise.note}
                            </td>
                        </tr>
                    `;
                }
            });
            html += `
                    </tbody>
                </table>
            `;
        } else {
            html += `<p style="margin: 5px 0 15px 0; font-style: italic; color: #555;">(Тренировка без упражнений)</p>`;
        }

        // Комментарий к тренировке
        if (record.comment && record.comment.trim() !== '') {
            html += `<p style="margin: 5px 0 0 0; font-weight: bold; font-size: 0.9em;">Общий комментарий:</p>`;
            html += `<p style="margin: 0 0 5px 0; font-style: italic; color: #444; background-color: #fff; padding: 5px; border-radius: 3px;">${record.comment}</p>`;
        }


        html += `</div>`; // .journal-record-block
    });

    html += `</div>`; // .pdf-journal-section
    return html;
}





function createSupplementsCalendarHtml(planData, filteredSupplementsData) {
    if (planData.supplements.length === 0 || filteredSupplementsData.length === 0) {
        return `
            <div style="margin-bottom: 20px;">
                <h3 style="color: #6c757d; border-bottom: 1px solid #ccc; padding-bottom: 5px;">План приема БАДов</h3>
                <p style="text-align: center; color: #888;">Нет данных по приему добавок за выбранный период.</p>
            </div>
        `;
    }

    const supplementNames = planData.supplements.map(name => {
        return typeof name === 'object' && name.name ? name.name : name;
    });

    // 🔥 НОВЫЙ ПАРАМЕТР: МАКСИМАЛЬНОЕ КОЛИЧЕСТВО СТОЛБЦОВ НА ЭКРАН (для мобильного)
    const MAX_COLUMNS_PER_TABLE = 5;
    let finalHtml = `
        <div class="pdf-supplements-section" style="margin-top: 20px;">
            <h3 style="color: #333; border-bottom: 2px solid #007bff; padding-bottom: 5px; font-size: 1.2em;">Прием добавок (Календарь)</h3>
    `;

    // Цикл для разделения таблицы на части
    for (let i = 0; i < supplementNames.length; i += MAX_COLUMNS_PER_TABLE) {
        const chunkedNames = supplementNames.slice(i, i + MAX_COLUMNS_PER_TABLE);
        const isFirstTable = i === 0;

        // Генерация заголовков для текущего чанка
        const headerHtml = chunkedNames.map(supName =>
            `<th style="min-width: 40px; font-size: 0.9em; text-align: center;">${supName}</th>`
        ).join('');

        finalHtml += `
            <div class="supplement-table-wrapper" style="overflow-x: auto; margin-top: ${isFirstTable ? '0' : '20px'};">
                ${!isFirstTable ? `<p style="margin: 0; font-size: 0.9em; color: #555;">(Продолжение списка добавок)</p>` : ''}
                <table class="pdf-calendar-table" style="min-width: 100%; table-layout: fixed; width: auto;">
                    <thead>
                        <tr style="background-color: #f1f1f1;">
                            <th style="min-width: 55px;">Дата</th>
                            <th style="min-width: 30px;">День</th>
                            ${headerHtml}
                        </tr>
                    </thead>
                    <tbody>
        `;

        // Тело таблицы
        filteredSupplementsData.forEach(dayRecord => {
            finalHtml += `
                <tr>
                    <td style="font-weight: bold; background-color: #f8f8f8;">${formatDayAndMonth(dayRecord.date)}</td>
                    <td>${dayRecord.dayOfWeek || '—'}</td>

                    ${chunkedNames.map(supName => {
                const dose = dayRecord.doses && dayRecord.doses[supName] ? dayRecord.doses[supName] : '';
                return `<td style="font-size: 0.9em;">${dose || '—'}</td>`;
            }).join('')}
                </tr>
            `;
        });

        finalHtml += `
                    </tbody>
                </table>
            </div>
        `;
    } // Конец цикла for

    finalHtml += `</div>`; // .pdf-supplements-section

    return finalHtml;
}


// =================================================================
// 4. ГЕНЕРАЦИЯ HTML ДЛЯ ОТЧЕТА (ИСПРАВЛЕНО)
// =================================================================

function createProgramsHtml(programsInCycle) {
    if (!programsInCycle || programsInCycle.length === 0) {
        return `
            <div style="margin-top: 20px; page-break-before: auto;">
                <h3 style="color: #6c757d; border-bottom: 1px solid #ccc; padding-bottom: 5px;">Тренировочный план (Шаблоны)</h3>
                <p style="text-align: center; color: #888;">Нет программ в текущем цикле.</p>
            </div>
        `;
    }

    let html = `
        <div class="pdf-programs-section" style="margin-top: 40px; page-break-before: always;">
            <h3 style="color: #333; border-bottom: 2px solid #007bff; padding-bottom: 5px; font-size: 1.2em;">Тренировочный план (Шаблоны программ)</h3>
    `;

    programsInCycle.forEach(program => {
        // 🔥 ИСПРАВЛЕННАЯ ПРОВЕРКА: используем program.exercises?.length
        const hasExercises = program.exercises && program.exercises.length > 0;

        html += `
            <div class="program-block" style="margin-top: 20px; padding: 10px; border: 1px solid #ddd; border-radius: 5px; background-color: #f9f9f9; page-break-inside: avoid;">
                <h4 style="color: #007bff; margin: 0 0 10px 0; font-size: 1.1em;">${program.name}</h4>
                <p style="margin: 0 0 5px 0;">Комментарий: ${program.comment || '—'}</p>

                ${hasExercises ? `
                    <table class="report-program-table" style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 0.85em;">
                        <thead>
                            <tr style="background-color: #e9ecef;">
                                <th style="width: 70%; padding: 5px; border: 1px solid #ccc; text-align: left;">Упражнение</th>
                                <th style="width: 30%; padding: 5px; border: 1px solid #ccc;">Подходы x Повторения</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${program.exercises.map(ex => `
                                <tr>
                                    <td style="padding: 5px; border: 1px solid #ccc; text-align: left;">${ex.name}</td>
                                    <td style="padding: 5px; border: 1px solid #ccc; text-align: center;">${ex.sets || '—'}x${ex.reps || '—'}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                ` : '<p style="margin-top: 10px; font-style: italic; color: #555;">(Программа без упражнений)</p>'}
            </div>
        `; // .program-block
    });

    html += `</div>`; // .pdf-programs-section
    return html;
}

// =================================================================
// 🌟 НОВАЯ ФУНКЦИЯ: РЕНДЕР ПЛАНА БАДОВ/ДОБАВОК (Обновлена)
// =================================================================
function renderSupplementsPage() {
    const currentCycle = state.cycles.find(c => c.id === state.selectedCycleId);

    const contentContainer = document.createElement('div');
    contentContainer.id = 'supplements-content';
    contentContainer.className = 'supplements-page';

    if (!currentCycle) {
        contentContainer.append(createElement('h3', null, 'План приема БАДов'));
        contentContainer.append(createElement('div', 'muted', 'Выберите цикл на вкладке "Программы" для создания плана приема добавок.'));
        root.append(contentContainer);
        return;
    }

    const backButtonText = '← К программам цикла';
    const backButton = createElement('button', 'btn back-btn', backButtonText);

    backButton.addEventListener('click', () => {
        state.currentPage = 'programsInCycle';
        render();
    });
    contentContainer.append(backButton);

    contentContainer.append(createElement('h3', null, `План добавок: ${currentCycle.name}`));

    // -----------------------------------------------------------
    // 🔥 БЛОК УПРАВЛЕНИЯ ПРЕПАРАТАМИ, ДАТАМИ И PDF
    // -----------------------------------------------------------

    const controlsWrapper = createElement('div', 'supplements-controls-wrapper');

    // Группа кнопок +/- Неделя
    const weekControlsGroup = createElement('div', 'week-controls-group');

    // 1. Кнопка "Добавить препарат" с модальным окном
    const addSupplementBtn = createElement('button', 'btn btn-primary', '➕ Препарат');
    weekControlsGroup.append(addSupplementBtn);

    addSupplementBtn.addEventListener('click', () => {
        // Открываем универсальное модальное окно
        openCommentModal(
            'new-supplement',
            '',
            'Введите название препарата',
            async (name) => {
                if (name) {
                    await addSupplement(name);
                } else {
                    showToast('Название не может быть пустым.');
                }
            }
        );
    });

    // Кнопки +/- Неделя
    const removeWeekBtn = createElement('button', 'btn btn-secondary', '–');
    removeWeekBtn.addEventListener('click', removeLastWeek);

    const weekLabel = createElement('span', 'week-label', 'Неделя');

    const addWeekBtn = createElement('button', 'btn btn-secondary', '+');
    addWeekBtn.addEventListener('click', addWeek);

    weekControlsGroup.append(removeWeekBtn, weekLabel, addWeekBtn);


    // 🔥 НОВЫЙ БЛОК: УПРАВЛЕНИЕ PDF И ДАТАМИ
    const pdfControls = createElement('div', 'pdf-controls-group');

    // ВЫБОР ДАТ: Используем local storage для запоминания последнего выбора
    const defaultStartDate = currentCycle.startDateString;
    const defaultEndDate = getTodayDateString();

    // Извлекаем сохраненные даты и убеждаемся, что они в формате ДД.ММ.ГГГГ
    let savedStartDate = localStorage.getItem('pdf_start_date') || defaultStartDate;
    let savedEndDate = localStorage.getItem('pdf_end_date') || defaultEndDate;

    // Если в localStorage сохранились даты в формате YYYY-MM-DD (после первого сохранения), преобразуем их обратно
    if (savedStartDate.includes('-')) {
        savedStartDate = savedStartDate.split('-').reverse().join('.');
    }
    if (savedEndDate.includes('-')) {
        savedEndDate = savedEndDate.split('-').reverse().join('.');
    }

    const startDateInput = createElement('input', 'date-filter-input');
    startDateInput.type = 'date';
    startDateInput.value = dateToInputFormat(savedStartDate);
    startDateInput.title = 'Дата начала отчета';

    const endDateInput = createElement('input', 'date-filter-input');
    endDateInput.type = 'date';
    endDateInput.value = dateToInputFormat(savedEndDate);
    endDateInput.title = 'Дата окончания отчета';

    // Слушатели для сохранения выбора (сохраняем в формате ДД.ММ.ГГГГ)
    startDateInput.addEventListener('change', (e) => {
        // Преобразуем YYYY-MM-DD в ДД.ММ.ГГГГ для хранения
        localStorage.setItem('pdf_start_date', e.target.value.split('-').reverse().join('.'));
    });
    endDateInput.addEventListener('change', (e) => {
        // Преобразуем YYYY-MM-DD в ДД.ММ.ГГГГ для хранения
        localStorage.setItem('pdf_end_date', e.target.value.split('-').reverse().join('.'));
    });

// ... (код до кнопки) ...

    const downloadPdfBtn = createElement('button', 'btn btn-primary download-pdf-btn', '⬇️ Сводный PDF');

    // 🔥 ИЗМЕНЕНИЕ: Теперь кнопка СРАЗУ вызывает генерацию отчета (без модалки опций)
    downloadPdfBtn.addEventListener('click', () => {
        const startValue = startDateInput.value; // YYYY-MM-DD
        const endValue = endDateInput.value;    // YYYY-MM-DD

        if (startValue && endValue) {
            const startDate = startValue.split('-').reverse().join('.');
            const endDate = endValue.split('-').reverse().join('.');

            // 1. Генерируем HTML, передавая только нужные параметры
            const reportHtml = generateCycleReportHtml(
                currentCycle,
                startDate,
                endDate
            );

            if (reportHtml) {
                // 2. Переходим на страницу отчета
                state.reportHtmlCache = reportHtml;
                state.currentPage = 'cycleReport';
                render();
            }
        } else {
            showToast('Пожалуйста, выберите начальную и конечную даты.');
        }
    });

    pdfControls.append(createElement('span', 'pdf-label', 'Отчет с:'), startDateInput, createElement('span', 'pdf-label', 'по:'), endDateInput, downloadPdfBtn);

    // ... (остальная часть функции) ...



    // Добавляем обе группы управления
    controlsWrapper.append(weekControlsGroup);
    contentContainer.append(controlsWrapper);
    contentContainer.append(pdfControls); // Отдельная секция для фильтра дат

    // -----------------------------------------------------------
    // РЕНДЕРИНГ ТАБЛИЦЫ
    // -----------------------------------------------------------
    // ... (Остальной код рендеринга таблицы остается без изменений) ...

    const planData = state.supplementPlan || { supplements: [], data: [] };
    const todayDateString = getTodayDateString(); // Сегодняшняя дата в формате ДД.ММ.ГГГГ
    let todayRowElement = null; // Переменная для хранения элемента строки

    if (planData.supplements.length === 0 && planData.data.length === 0) {
        contentContainer.append(createElement('div', 'muted', 'Начните с добавления первого препарата.'));
    } else {
        const tableWrapper = createElement('div', 'supplement-table-wrapper');
        tableWrapper.id = 'supplement-table-wrapper'; // 🔥 ДОБАВЛЕНО: ID для прокрутки

        const table = createElement('table', 'supplement-plan-table');

        // ЗАГОЛОВОК ТАБЛИЦЫ (Препараты)
        const thead = createElement('thead');
        const headerRow = createElement('tr');
        headerRow.append(createElement('th', 'date-col', 'Дата'));
        headerRow.append(createElement('th', 'day-col'));

        planData.supplements.forEach(supName => {

            const deleteBtn = createElement('button', 'btn delete-supplement-btn');
            deleteBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><title>Ios-close-empty SVG Icon</title><path fill="currentColor" d="M340.2 160l-84.4 84.3-84-83.9-11.8 11.8 84 83.8-84 83.9 11.8 11.7 84-83.8 84.4 84.2 11.8-11.7-84.4-84.3 84.4-84.2z"/></svg>';
            deleteBtn.dataset.name = supName;

            const th = createElement('th', 'supplement-col');
            const supHeader = createElement('div', 'supplement-header');
            const supNameSpan = createElement('span', '', supName);


            supHeader.append(deleteBtn);
            supHeader.append(supNameSpan);

            th.append(supHeader);
            headerRow.append(th);

        });

        thead.append(headerRow);
        table.append(thead);

        // ТЕЛО ТАБЛИЦЫ (Даты и Дозировки)
        const tbody = createElement('tbody');
        planData.data.forEach((dayRecord, dayIndex) => {
            let rowClasses = '';
            // 🔥 ЛОГИКА: Сравнение и подсветка текущей даты
            if (dayRecord.date === todayDateString) {
                rowClasses += ' today-highlight';
            }
            if (dayRecord.dayOfWeek === 'вс' || dayRecord.dayOfWeek === 'сб') {
                rowClasses += ' weekend';
            }

            const tr = createElement('tr', rowClasses.trim());
            tr.dataset.date = dayRecord.date; // Добавляем полную дату для идентификации

            // 🔥 ИЗМЕНЕНИЕ: Формат даты на ДД.ММ
            tr.append(createElement('td', 'date-col', formatDayAndMonth(dayRecord.date)));

            tr.append(createElement('td', 'day-col', dayRecord.dayOfWeek));

            planData.supplements.forEach(supName => {
                const td = createElement('td', 'dose-col');
                const doseInput = createElement('input', 'dose-input');
                doseInput.type = 'text';
                doseInput.placeholder = '';
                doseInput.value = dayRecord.doses && dayRecord.doses[supName] ? dayRecord.doses[supName] : '';
                doseInput.dataset.supName = supName;
                doseInput.dataset.dayIndex = dayIndex;

                // Отложенное сохранение для дозировок
                doseInput.addEventListener('input', (e) => {
                    debouncedSaveDoseData(
                        supName,
                        dayIndex,
                        e.target.value
                    );
                });

                td.append(doseInput);
                tr.append(td);
            });
            tbody.append(tr);

            if (dayRecord.date === todayDateString) {
                todayRowElement = tr;
            }
        });
        table.append(tbody);
        tableWrapper.append(table);
        contentContainer.append(tableWrapper);

        // 🔥 ЛОГИКА: Автоматическая прокрутка к сегодняшней дате
        if (todayRowElement) {
            // Используем setTimeout, чтобы прокрутка сработала после того, как все элементы вставлены в DOM
            setTimeout(() => {
                const wrapper = document.getElementById('supplement-table-wrapper');
                if (wrapper) {
                    const rowRect = todayRowElement.getBoundingClientRect();
                    const wrapperRect = wrapper.getBoundingClientRect();

                    // Рассчитываем позицию прокрутки для центрирования строки
                    // (rowRect.top - wrapperRect.top) - это положение строки относительно верхней границы обертки
                    // + wrapper.scrollTop - добавляем текущую прокрутку
                    // - (wrapperRect.height / 2) + (rowRect.height / 2) - центрируем
                    const scrollPosition = rowRect.top - wrapperRect.top + wrapper.scrollTop - (wrapperRect.height / 2) + (rowRect.height / 2);

                    wrapper.scrollTo({
                        top: scrollPosition,
                        behavior: 'smooth'
                    });
                }
            }, 100);
        }

        // Обработчик удаления препарата
        tableWrapper.querySelectorAll('.delete-supplement-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const supName = btn.dataset.name;
                const newPlan = JSON.parse(JSON.stringify(state.supplementPlan));

                // 1. Удаляем из списка препаратов
                newPlan.supplements = newPlan.supplements.filter(name => name !== supName);

                // 2. Удаляем дозировки этого препарата из всех записей
                newPlan.data = newPlan.data.map(dayRecord => {
                    if (dayRecord.doses) {
                        delete dayRecord.doses[supName];
                    }
                    return dayRecord;
                });

                await updateSupplementPlanInFirestore(newPlan);
            });
        });

    }

    root.append(contentContainer);
}




// =================================================================
// 🌟 НОВЫЙ ФУНКЦИОНАЛ: ОТЧЕТЫ О ПРОГРЕССЕ (ЗАМЕРЫ И ФОТО)
// =================================================================

// -----------------------------------------------------------
// 🔥 НОВЫЕ ФУНКЦИИ FIREBASE (Предполагается, что doc, updateDoc, addDoc, deleteDoc доступны)
// -----------------------------------------------------------

// 🔥 Ваша специфическая функция для получения коллекции отчетов



// 🔥 НОВАЯ ФУНКЦИЯ: Сохранение / Обновление отчета о прогрессе
async function saveProgressReport(reportData, reportId = null) {
    const reportsCollection = getReportsCollection();

    try {
        if (reportId) {
            const docRef = doc(reportsCollection, reportId);
            await updateDoc(docRef, reportData);
            showToast('Отчет о прогрессе обновлен!');
        } else {
            await addDoc(reportsCollection, reportData);
            showToast('Отчет о прогрессе сохранен!');
        }
    } catch (error) {
        console.error("Ошибка сохранения отчета:", error);
        showToast('Не удалось сохранить отчет о прогрессе.');
    }
}

// 🔥 НОВАЯ ФУНКЦИЯ: Удаление отчета
async function deleteReport(reportId) {
    if (!confirm('Вы уверены, что хотите удалить этот отчет о прогрессе?')) return;
    const reportsCollection = getReportsCollection();
    try {
        // 🔥 В реальном приложении здесь должна быть логика удаления фото из Storage
        await deleteDoc(doc(reportsCollection, reportId));
        showToast('Отчет удален.');
    } catch (error) {
        console.error("Ошибка удаления отчета:", error);
        showToast('Не удалось удалить отчет.');
    }
}



// -----------------------------------------------------------
// 🔥 НОВЫЕ ФУНКЦИИ РЕНДЕРИНГА ЭЛЕМЕНТОВ МОДАЛЬНОГО ОКНА
// -----------------------------------------------------------

function renderMetricsList(metrics, container, focusLast = false) {
    container.innerHTML = ''; // очищаем список

    metrics.forEach((metric, index) => {
        const row = createElement('div', 'metric-row');

        const nameInput = createElement('input', 'metric-name-input');
        nameInput.type = 'text';
        nameInput.placeholder = 'Название';
        nameInput.value = metric.name || '';

        const separator = createElement('span', 'metric-separator', '-');

        const valueInput = createElement('input', 'metric-value-input');
        valueInput.type = 'text';
        valueInput.placeholder = 'Значение';
        valueInput.value = metric.value || '';

        // кнопка удаления замера
        const removeBtn = createElement('button', 'btn btn-small btn-danger', 'удалить');
        removeBtn.addEventListener('click', () => {
            metrics.splice(index, 1);
            renderMetricsList(metrics, container);
        });

        row.appendChild(nameInput);
        row.appendChild(separator);
        row.appendChild(valueInput);
        row.appendChild(removeBtn);

        container.appendChild(row);
    });

    // если нужно поставить фокус на последнюю строку
    if (focusLast && container.lastChild) {
        container.lastChild.querySelector('input')?.focus();
    }
}










// 🔥 НОВАЯ ЛОГИКА: Получение базового пути для Storage
function getStoragePathForClient(reportId) {
    // Используем ту же логику пути, что и для Firestore, чтобы связать фото с клиентом/пользователем
    const basePath = state.currentMode === 'own' ? userId : state.selectedClientId;

    // Если reportId еще нет (создание нового отчета), используем временный ID
    const reportPath = reportId ? reportId : `temp_${Date.now()}`;

    // Структура: artifacts/{appId}/users/{basePath}/reports/{reportId}/photos/
    // Предполагается, что appId, userId, state доступны
    return `artifacts/${appId}/users/${basePath}/reports/${reportPath}/`;
}


// 🔥 ПОЛНОСТЬЮ ИСПРАВЛЕННАЯ ФУНКЦИЯ renderPhotoControls
// 🔥 ПЕРЕРАБОТАННАЯ ФУНКЦИЯ renderPhotoControls
function renderPhotoControls(photos, container, reportId) {
    container.innerHTML = '';

    // 1️⃣ Превью фотографий
    const previewContainer = createElement('div', 'photo-previews');
    previewContainer.style.display = 'flex';
    previewContainer.style.flexWrap = 'wrap';
    previewContainer.style.gap = '10px';
    previewContainer.style.marginBottom = '10px';

    photos.forEach((photo, index) => {
        console.log("👉 renderPhotoControls: photo.url =", photo.url, "type:", typeof photo.url);

        // Если url не строка — сразу предупреждаем
        if (typeof photo.url !== "string") {
            console.error("❌ Ошибка: photo.url не строка!", photo);
            return; // пропускаем этот элемент, чтобы не было [object Object]
        }

        const preview = createElement('div', 'photo-preview-item');
        preview.style.position = 'relative';
        preview.style.width = '60px';
        preview.style.height = '60px';
        preview.style.backgroundImage = `url(${photo.url})`; // ✅ уже точно строка
        preview.style.backgroundSize = 'cover';
        preview.style.borderRadius = '5px';
        preview.title = "Нажмите для увеличения";

        // Кнопка удаления
        const deleteBtn = createElement('button', 'btn btn-delete-photo');
        deleteBtn.innerHTML = '×';


        deleteBtn.addEventListener('click', () => {
            if (!confirm('Вы уверены, что хотите удалить это фото?')) return;
            photos.splice(index, 1);
            renderPhotoControls(photos, container, reportId);
        });

        // Клик по превью — открытие полного фото
        preview.addEventListener('click', () => openPhotoFullScreen(photo.url, photo.name));

        preview.append(deleteBtn);
        previewContainer.append(preview);
    });

    container.append(previewContainer);

    // 2️⃣ Кнопка добавления новых фото
    const fileInput = createElement('input', 'photo-file-input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.multiple = true;
    fileInput.style.display = 'none';

    const addPhotoBtn = createElement('button', 'btn btn-secondary btn-small', '+');
    addPhotoBtn.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files);
        for (const file of files) {
            showToast(`Загрузка ${file.name} через Cloudinary...`);
            try {
                const permanentUrl = await uploadFileToCloudinary(file);

                // Проверяем, что Cloudinary вернул строку
                if (typeof permanentUrl !== "string") {
                    console.error("❌ Cloudinary вернул не строку:", permanentUrl);
                    showToast(`Ошибка: Cloudinary вернул невалидный URL для ${file.name}`, 'error');
                    continue;
                }

                photos.push({ url: permanentUrl, name: file.name });
                showToast(`Фото ${file.name} загружено!`);
            } catch (error) {
                console.error(error);
                showToast(`Ошибка загрузки ${file.name}`, 'error');
            }
        }
        renderPhotoControls(photos, container, reportId);
        e.target.value = '';
    });

    container.append(addPhotoBtn);
    container.append(fileInput);
}


// 🔑 Безопасная функция просмотра фото в полный экран
const openPhotoFullScreen = (url, name = '') => {
    const overlay = createElement('div', 'overlay');
    overlay.style.cssText = `
        position: fixed; top:0; left:0; width:100%; height:100%;
        background: rgba(0,0,0,0.9); display:flex; justify-content:center; align-items:center;
        z-index:1000;
    `;

    const fullImg = createElement('img');
    fullImg.src = url;
    fullImg.alt = name;
    fullImg.style.maxWidth = '90%';
    fullImg.style.maxHeight = '90%';
    fullImg.style.borderRadius = '5px';
    fullImg.style.boxShadow = '0 0 20px rgba(0,0,0,0.5)';

    overlay.appendChild(fullImg);

    overlay.addEventListener('click', () => overlay.remove());
    document.body.appendChild(overlay);
};


// 🔥 Исправленная функция открытия фото в полный размер
function openFullScreenPhoto(url, name = '') {
    const overlay = createElement('div', 'overlay');
    overlay.style.cssText = `
        position: fixed; top:0; left:0; width:100%; height:100%;
        background: rgba(0,0,0,0.9); display:flex; justify-content:center; align-items:center;
        z-index:1000;
    `;

    const fullImg = createElement('img');
    fullImg.src = url;
    fullImg.alt = name;
    fullImg.style.maxWidth = '90%';
    fullImg.style.maxHeight = '90%';
    fullImg.style.borderRadius = '5px';
    fullImg.style.boxShadow = '0 0 20px rgba(0,0,0,0.5)';

    overlay.appendChild(fullImg);

    // клик по фону закрывает просмотр
    overlay.addEventListener('click', () => overlay.remove());

    document.body.appendChild(overlay);
}













// 🔥 НОВАЯ ФУНКЦИЯ: collectCurrentMetrics ДОЛЖНА БЫТЬ ЗДЕСЬ
function collectCurrentMetrics(metricsListDiv) {
    const metrics = [];
    const rows = metricsListDiv.querySelectorAll('.metric-row');
    rows.forEach(row => {
        const nameInput = row.querySelector('.metric-name-input');
        const valueInput = row.querySelector('.metric-value-input');
        metrics.push({
            name: nameInput.value.trim(),
            value: valueInput.value.trim()
        });
    });
    return metrics;
}
// -------------------------------------------------------------------


// 🔥 НОВАЯ ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ДЛЯ CLOUDINARY
async function uploadFileToCloudinary(file) {
    const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

    const response = await fetch(url, { method: 'POST', body: formData });
    const data = await response.json();

    if (!data.secure_url) {
        console.error("Cloudinary ответ:", data);
        throw new Error("Нет secure_url в ответе Cloudinary");
    }

    return data.secure_url;  // ✅ строка
}

// -----------------------------------------------------------
// Дополнительно: нужна функция загрузки с прогрессом
// -----------------------------------------------------------
async function uploadFileToCloudinaryWithProgress(file, onProgress) {
    return new Promise((resolve, reject) => {
        const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/upload`;

        const formData = new FormData();
        formData.append('file', file);
        formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

        const xhr = new XMLHttpRequest();
        xhr.open('POST', url);

        // 📊 Следим за прогрессом
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable && typeof onProgress === 'function') {
                const percent = Math.round((e.loaded / e.total) * 100);
                onProgress(percent);
            }
        };

        xhr.onload = () => {
            if (xhr.status === 200) {
                const data = JSON.parse(xhr.responseText);
                resolve(data.secure_url);
            } else {
                reject(`Ошибка Cloudinary: ${xhr.status}`);
            }
        };

        xhr.onerror = () => reject("Ошибка сети при загрузке");
        xhr.send(formData);
    });
}


// -----------------------------------------------------------
// 🔥 НОВАЯ ФУНКЦИЯ: МОДАЛЬНОЕ ОКНО ОТЧЕТА О ПРОГРЕССЕ
// -----------------------------------------------------------
function openProgressReportModal(reportData = null, isDuplicate = false) {
    const root = document.getElementById('root');
    const overlay = createElement('div', 'modal-overlay', '');
    overlay.classList.add('active');

    let reportToEdit = reportData ? JSON.parse(JSON.stringify(reportData)) : {};

    if (isDuplicate && reportData) {
        // Дублирование: сохраняем шаблон, но очищаем значения, фото и ID
        reportToEdit = {
            metricTemplate: reportData.metricTemplate,
            metrics: (reportData.metricTemplate || []).map(m => ({ name: m.name, value: '' })),
            comment: '',
            photos: [],
            id: null
        };
    } else if (!reportToEdit.metrics) {
        reportToEdit.metrics = [];
        reportToEdit.photos = [];
        reportToEdit.comment = '';
    }

    const modalContent = createElement('div', 'modal-content modal-progress-report');
    modalContent.style.maxWidth = '600px';

    // --- ЗАГОЛОВОК ---
    modalContent.appendChild(createElement('div', 'modal-title', reportData ? 'Редактирование Отчета' : 'Новый Отчет о Прогрессе'));

    // --- Дата ---
    const dateDisplay = createElement('p', 'report-date-display', `Дата: ${reportToEdit.date || getTodayDateString()}`);
    dateDisplay.style.marginBottom = '15px';
    modalContent.appendChild(dateDisplay);


    // -----------------------------------------------------------
    // СЕКЦИЯ 1: ЗАМЕРЫ (МЕТРИКИ)
    // -----------------------------------------------------------
    const metricsContainer = createElement('div', 'metrics-editor-container');
    metricsContainer.innerHTML = '<h4>Замеры</h4>';

    const metricsListDiv = createElement('div', 'metrics-list');
    metricsContainer.appendChild(metricsListDiv);

    // Кнопка "Добавить замер"
    const addMetricBtn = createElement('button', 'btn btn-secondary btn-small', '+');
    addMetricBtn.style.marginTop = '10px';

    addMetricBtn.addEventListener('click', () => {
        // 🔥 ИСПРАВЛЕНИЕ 1: Собираем текущие значения из DOM, чтобы не потерять их
        reportToEdit.metrics = collectCurrentMetrics(metricsListDiv);

        // Добавляем новое пустое поле
        reportToEdit.metrics.push({ name: '', value: '' });

        // Перерисовываем список
        renderMetricsList(reportToEdit.metrics, metricsListDiv, true);
    });

    metricsContainer.appendChild(addMetricBtn);
    modalContent.appendChild(metricsContainer);

    // -----------------------------------------------------------
    // СЕКЦИЯ 2: ФОТО
    // -----------------------------------------------------------
    const photosContainer = createElement('div', 'photos-editor-container');
    photosContainer.innerHTML = '<h4 style="margin-top: 20px;">Фото</h4>';
    const photosControlsDiv = createElement('div', 'photos-controls-div');
    photosContainer.appendChild(photosControlsDiv);

    modalContent.appendChild(photosContainer);

    // -----------------------------------------------------------
    // СЕКЦИЯ 3: КОММЕНТАРИЙ
    // -----------------------------------------------------------
    const commentInput = createElement('textarea', 'comment-input');
    commentInput.placeholder = 'Общий комментарий к изменениям...';
    commentInput.value = reportToEdit.comment || '';
    commentInput.style.marginTop = '20px';
    commentInput.style.minHeight = '80px';
    commentInput.style.width = '100%';

    modalContent.appendChild(createElement('h4', null, 'Комментарий'));
    modalContent.appendChild(commentInput);


    // -----------------------------------------------------------
    // ИНИЦИАЛИЗАЦИЯ И РЕНДЕР
    // -----------------------------------------------------------

    // 🔥 ИСПРАВЛЕНИЕ 2: Добавляем слушатель 'input' на контейнер
    // Это гарантирует, что при любом вводе в любое поле ввода, массив reportToEdit.metrics
    // будет обновлен с актуальными значениями из DOM.
    metricsListDiv.addEventListener('input', (e) => {
        if (e.target.classList.contains('metric-name-input')  || e.target.classList.contains('metric-value-input')) {
            reportToEdit.metrics = collectCurrentMetrics(metricsListDiv);
            // Примечание: renderMetricsList здесь не вызываем, чтобы не сбивать фокус
        }
    });

    // Инициализация списков
    renderMetricsList(reportToEdit.metrics, metricsListDiv, true);
    renderPhotoControls(reportToEdit.photos, photosControlsDiv, reportToEdit.id);
    renderMetricsList(reportToEdit.metrics || [], metricsListDiv);

    // --- КНОПКИ УПРАВЛЕНИЯ ---
    const controls = createElement('div', 'modal-controls', '');
    const cancelBtn = createElement('button', 'btn', 'Отмена');
    cancelBtn.onclick = () => overlay.remove();

    const saveBtn = createElement('button', 'btn btn-primary', '💾 Сохранить Отчет');
    saveBtn.onclick = async () => {
        // 🔥 ИСПРАВЛЕНИЕ 3: Используем collectCurrentMetrics для финального сбора данных
        // Это гарантирует, что даже если пользователь не нажимал "Новый замер",
        // его введенные данные будут сохранены.
        const finalMetrics = collectCurrentMetrics(metricsListDiv);
        let isValid = true;

        // Финальная валидация (проверяем, что нет пустых пар "имя/значение")
        finalMetrics.forEach(m => {
            if (!m.name || !m.value) {
                isValid = false;
            }
        });

        if (!isValid) {
            showToast('Пожалуйста, заполните как название, так и значение для каждого замера.', 'error');
            return;
        }

        if (finalMetrics.length === 0) {
            showToast('Отчет должен содержать хотя бы один замер.', 'error');
            return;
        }

        // 1. Создание объекта для сохранения
        const reportToSave = {
            date: reportToEdit.date || getTodayDateString(),
            comment: commentInput.value.trim(),
            metrics: finalMetrics,
            photos: reportToEdit.photos,
            metricTemplate: finalMetrics.map(m => ({ name: m.name }))
        };

        // 2. Вызов функции сохранения
        await saveProgressReport(reportToSave, reportToEdit.id);
        overlay.remove();
    };


    controls.appendChild(cancelBtn);
    controls.appendChild(saveBtn);
    modalContent.appendChild(controls);
    overlay.appendChild(modalContent);
    root.appendChild(overlay);
}




// =================================================================
// 🌟 НОВАЯ ФУНКЦИЯ: РЕНДЕР СТРАНИЦЫ ОТЧЕТОВ (ИСПРАВЛЕНО)
// =================================================================
function renderReportsPage() {
    const root = document.getElementById('root');


    const contentContainer = createElement('div', 'reports-page');
    contentContainer.style.padding = '10px';

    const selectedCycle = state.cycles.find(c => c.id === state.selectedCycleId);

    if (!selectedCycle) {
        // Цикл не выбран — только заголовок и сообщение
        contentContainer.appendChild(createElement('h3', null, 'Отчеты'));
        contentContainer.appendChild(createElement('div', 'muted', 'Выберите цикл на вкладке "Программы" для создания отчета.'));
        root.appendChild(contentContainer);

        // Навигация остаётся видимой
        const nav = document.querySelector('.navigation');
        if (nav) nav.style.display = 'flex';
        return;
    }

    // Цикл выбран — рендерим отчет как раньше
    contentContainer.appendChild(createElement('h3', null, `Отчеты: ${selectedCycle.name}`));

    const summaryBtn = createElement('button', 'btn btn-primary', '📊 Сводный отчет');
    summaryBtn.style.marginBottom = '15px';
    summaryBtn.addEventListener('click', openReportsSummaryModal);
    contentContainer.appendChild(summaryBtn);


    // Кнопки доступны только если есть выбранный цикл
    const createProgressReportBtn = createElement('button', 'btn btn-primary', '➕ Новый Замер/Фото');
    createProgressReportBtn.style.marginBottom = '15px';
    createProgressReportBtn.addEventListener('click', () => openProgressReportModal());
    contentContainer.appendChild(createProgressReportBtn);

    const compareBtn = createElement('button', 'btn btn-primary', '🔍 Сравнить');
    compareBtn.style.marginBottom = '15px';
    compareBtn.addEventListener('click', openCompareModal);
    contentContainer.appendChild(compareBtn);

    // Далее рендер списка отчетов (тот же код что у тебя)
    const reportsList = createElement('div', 'reports-list');
    reportsList.style.display = 'flex';
    reportsList.style.flexDirection = 'column';
    reportsList.style.gap = '15px';

    if (!state.reports || state.reports.length === 0) {
        reportsList.append(createElement('div', 'muted', 'Нет сохраненных отчетов.'));
    } else {
        state.reports.sort((a, b) => new Date(b.date.split('.').reverse().join('-')) - new Date(a.date.split('.').reverse().join('-')));
        state.reports.forEach(report => {
            const reportItem = createElement('div', 'report-item');
            reportItem.style.border = '1px solid #ccc';
            reportItem.style.borderRadius = '8px';
            reportItem.style.padding = '10px';
            reportItem.style.backgroundColor = '#fff';
            reportItem.style.boxShadow = '0 2px 5px rgba(0,0,0,0.1)';
            reportItem.style.display = 'flex';
            reportItem.style.flexDirection = 'column';
            reportItem.style.gap = '10px';

            reportItem.appendChild(createElement('div', 'report-date', `📅 ${report.date}`));

            if (report.metrics && report.metrics.length > 0) {
                const metricsDiv = createElement('div', 'report-metrics');
                metricsDiv.style.display = 'flex';
                metricsDiv.style.flexWrap = 'wrap';
                metricsDiv.style.gap = '5px';
                report.metrics.forEach(metric => {
                    const metricItem = createElement('div', 'metric-item', `${metric.name}: ${metric.value}`);
                    metricItem.style.backgroundColor = '#f0f0f0';
                    metricItem.style.padding = '4px 6px';
                    metricItem.style.borderRadius = '4px';
                    metricItem.style.fontSize = '14px';
                    metricsDiv.appendChild(metricItem);
                });
                reportItem.appendChild(metricsDiv);
            }

            if (report.photos && report.photos.length > 0) {
                const photosDiv = createElement('div', 'report-photos');
                photosDiv.style.display = 'flex';
                photosDiv.style.flexWrap = 'wrap';
                photosDiv.style.gap = '8px';
                report.photos.forEach((photo, index) => {
                    if (photo.url) {
                        const img = createElement('img');
                        img.src = photo.url;
                        img.style.width = '100px';
                        img.style.height = '100px';
                        img.style.objectFit = 'cover';
                        img.style.borderRadius = '5px';
                        img.style.cursor = 'pointer';
                        img.title = photo.name || `Фото ${index + 1}`;
                        photo.number = index + 1;
                        img.addEventListener('click', () => openFullScreenPhoto(photo.url, photo.name));
                        photosDiv.appendChild(img);
                    }
                });
                reportItem.appendChild(photosDiv);
            }

            if (report.comment) {
                const commentPreview = createElement('div', 'report-comment', report.comment.length > 50 ? report.comment.substring(0, 50) + '...' : report.comment);
                commentPreview.style.fontStyle = 'italic';
                commentPreview.style.color = '#555';
                reportItem.appendChild(commentPreview);
            }

            const actionsDiv = createElement('div', 'report-actions');
            actionsDiv.style.display = 'flex';
            actionsDiv.style.gap = '5px';
            actionsDiv.style.flexWrap = 'wrap';

            const editBtn = createElement('button', 'btn btn-small btn-secondary', '✏️ Редактировать');
            editBtn.addEventListener('click', () => openProgressReportModal(report));
            const duplicateBtn = createElement('button', 'btn btn-small btn-secondary', '📋 Дублировать');
            duplicateBtn.addEventListener('click', () => openProgressReportModal(report, true));

            const deleteBtn = createElement('button', 'btn btn-small btn-danger', '🗑️ Удалить');
            deleteBtn.addEventListener('click', () => {
                openConfirmModal("Удалить этот отчет?", async () => {
                    await deleteReport(report.id);
                    showToast("Отчет удален!");
                });
            });


            actionsDiv.append(editBtn, duplicateBtn, deleteBtn);
            reportItem.appendChild(actionsDiv);

            reportsList.appendChild(reportItem);
        });
    }

    contentContainer.appendChild(reportsList);
    root.appendChild(contentContainer);
}


// ======================================================================
// 🌟 Модалка выбора периода для сводного отчета
// ======================================================================
function openReportsSummaryModal() {
    const overlay = createElement('div', 'modal-overlay');
    overlay.classList.add('active');

    const modal = createElement('div', 'modal-content');
    modal.style.maxWidth = '400px';

    modal.appendChild(createElement('h3', null, 'Выберите период'));

    // Поля дат
    const fromInput = createElement('input');
    fromInput.type = 'date';
    fromInput.style.marginBottom = '10px';
    const toInput = createElement('input');
    toInput.type = 'date';

    modal.appendChild(createElement('label', null, 'С даты:'));
    modal.appendChild(fromInput);
    modal.appendChild(createElement('label', null, 'По дату:'));
    modal.appendChild(toInput);

    // Кнопки
    const controls = createElement('div', 'modal-controls');
    const cancelBtn = createElement('button', 'btn', 'Отмена');
    cancelBtn.onclick = () => overlay.remove();

    const showBtn = createElement('button', 'btn btn-primary', 'Показать');
    showBtn.onclick = () => {
        if (!fromInput.value || !toInput.value) {
            alert('Пожалуйста, выберите обе даты');
            return;
        }
        overlay.remove();
        renderReportsSummaryPage(fromInput.value, toInput.value);
    };

    controls.appendChild(cancelBtn);
    controls.appendChild(showBtn);
    modal.appendChild(controls);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
}

// ======================================================================
// 🌟 Страница сводного отчета
// ======================================================================
function renderReportsSummaryPage(startDate, endDate) {
    const root = document.getElementById('root');
    root.innerHTML = '';

    // Заголовок
    const header = createElement('div', 'summary-header');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';

    header.appendChild(createElement('h3', null, 'Сводный отчет'));

    const printBtn = createElement('button', 'btn btn-primary', '📄 Печать / PDF');
    printBtn.onclick = () => window.print();
    header.appendChild(printBtn);

    root.appendChild(header);

    // Фильтруем отчеты по периоду
    const reports = (state.reports || []).filter(r => {
        const [d, m, y] = r.date.split('.');
        const reportDate = new Date(`${y}-${m}-${d}`);
        return reportDate >= new Date(startDate) && reportDate <= new Date(endDate);
    });

    if (reports.length === 0) {
        root.appendChild(createElement('p', null, 'За выбранный период отчётов нет.'));
        return;
    }

    // --- Собираем уникальные названия замеров ---
    const metricNamesSet = new Set();
    reports.forEach(r => {
        (r.metrics || []).forEach(m => metricNamesSet.add(m.name));
    });
    const metricNames = Array.from(metricNamesSet);

    // --- Создаем таблицу ---
    const table = createElement('table', 'summary-table');
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';

    // --- Заголовок таблицы ---
    const thead = createElement('thead');
    const headerRow = createElement('tr');
    headerRow.appendChild(createElement('th', null, 'Дата'));
    metricNames.forEach(name => headerRow.appendChild(createElement('th', null, name)));
    headerRow.appendChild(createElement('th', null, 'Комментарий'));
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // --- Тело таблицы ---
    const tbody = createElement('tbody');
    reports.forEach(r => {
        const row = createElement('tr');
        row.appendChild(createElement('td', null, r.date));

        metricNames.forEach(name => {
            const metric = (r.metrics || []).find(m => m.name === name);
            row.appendChild(createElement('td', null, metric ? metric.value : '')); // если замера нет, пусто
        });

        row.appendChild(createElement('td', null, r.comment || ''));
        tbody.appendChild(row);
    });

    table.appendChild(tbody);
    root.appendChild(table);

    // --- Стили таблицы для мобильного и PDF ---
    const style = document.createElement('style');
    style.innerHTML = `
        .summary-table th, .summary-table td {
            border: 1px solid #ccc;
            padding: 5px;
            text-align: center;
            font-size: 0.85em;
        }
        .summary-table th {
            background-color: #f0f0f0;
        }
        .summary-table td:first-child {
            font-weight: bold;
        }
        @media print {
            body { font-size: 10pt; }
            .summary-table th, .summary-table td { font-size: 9pt; padding: 3pt; }
        }
    `;
    document.head.appendChild(style);
}






// =================================================================
// 🌟 Сравнение фото между отчётами
// =================================================================


// --- Модальное окно сравнения с выбором фото ---
function openCompareModal() {
    if (!state.reports || state.reports.length < 2) {
        alert('Нужно минимум 2 отчета для сравнения');
        return;
    }

    const overlay = createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.backgroundColor = 'rgba(0,0,0,0.7)';
    overlay.style.display = 'flex';
    overlay.style.justifyContent = 'center';
    overlay.style.alignItems = 'center';
    overlay.style.zIndex = '1000';
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    const modal = createElement('div');
    modal.style.backgroundColor = '#fff';
    modal.style.padding = '20px';
    modal.style.borderRadius = '8px';
    modal.style.maxWidth = '90%';
    modal.style.maxHeight = '80%';
    modal.style.overflowY = 'auto';
    modal.style.display = 'flex';
    modal.style.flexDirection = 'column';
    modal.style.gap = '10px';

    modal.appendChild(createElement('h4', null, 'Что сравнивать?'));

    const selectType = createElement('select');
    selectType.style.padding = '10px';
    selectType.style.fontSize = '16px';
    selectType.style.borderRadius = '6px';
    selectType.innerHTML = `
            <option value="photos">Фото</option>
            <option value="metrics">Замеры</option>
        `;
    modal.appendChild(selectType);

    const selectBefore = createElement('select');
    const selectAfter = createElement('select');
    [selectBefore, selectAfter].forEach(s => {
        s.style.padding = '10px';
        s.style.fontSize = '16px';
        s.style.borderRadius = '6px';
        s.style.marginTop = '10px';
    });

    state.reports.forEach(report => {
        const option1 = createElement('option');
        option1.value = report.id;
        option1.textContent = report.date;
        selectBefore.appendChild(option1);

        const option2 = createElement('option');
        option2.value = report.id;
        option2.textContent = report.date;
        selectAfter.appendChild(option2);
    });

    modal.appendChild(createElement('div', null, 'До:'));
    modal.appendChild(selectBefore);
    modal.appendChild(createElement('div', null, 'После:'));
    modal.appendChild(selectAfter);

    // --- Селекты для выбора конкретного фото ---
    const photoBefore = createElement('select');
    const photoAfter = createElement('select');
    [photoBefore, photoAfter].forEach(s => {
        s.style.padding = '8px';
        s.style.fontSize = '14px';
        s.style.borderRadius = '6px';
        s.style.marginTop = '5px';
    });

    function updatePhotoSelect(reportSelect, photoSelect) {
        const report = state.reports.find(r => r.id === reportSelect.value);
        photoSelect.innerHTML = '';
        if (report && report.photos && report.photos.length > 0) {
            report.photos.forEach(p => {
                const opt = createElement('option');
                opt.value = p.number;
                opt.textContent = p.name || `Фото ${p.number}`;
                photoSelect.appendChild(opt);
            });
        } else {
            const opt = createElement('option');
            opt.value = -1;
            opt.textContent = 'Нет фото';
            photoSelect.appendChild(opt);
        }
    }

    selectBefore.addEventListener('change', () => updatePhotoSelect(selectBefore, photoBefore));
    selectAfter.addEventListener('change', () => updatePhotoSelect(selectAfter, photoAfter));
    updatePhotoSelect(selectBefore, photoBefore);
    updatePhotoSelect(selectAfter, photoAfter);

    modal.appendChild(createElement('div', null, 'Фото до:'));
    modal.appendChild(photoBefore);
    modal.appendChild(createElement('div', null, 'Фото после:'));
    modal.appendChild(photoAfter);

    const btnCompare = createElement('button', 'btn btn-primary', 'Сравнить');
    btnCompare.style.marginTop = '10px';
    btnCompare.addEventListener('click', () => {
        const idBefore = selectBefore.value;
        const idAfter = selectAfter.value;
        const numBefore = photoBefore.value;
        const numAfter = photoAfter.value;

        if (idBefore === idAfter && numBefore === numAfter) { alert('Выберите разные фото'); return; }

        if (selectType.value === 'photos') {
            showComparePhotos(idBefore, idAfter, numBefore, numAfter);
        } else {
            showCompareMetrics(idBefore, idAfter);
        }
        overlay.remove();
    });

    modal.appendChild(btnCompare);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
}

// =================================================================
// 🌟 Сравнение метрик (замеров)
// =================================================================
function showCompareMetrics(idBefore, idAfter) {
    const report1 = state.reports.find(r => r.id === idBefore);
    const report2 = state.reports.find(r => r.id === idAfter);
    if (!report1 || !report2) return;

    const overlay = createElement('div');
    overlay.style.cssText = `
        position: fixed; top:0; left:0; width:100%; height:100%;
        background: rgba(0,0,0,0.85); display:flex; justify-content:center; align-items:center;
        z-index:1000; overflow:auto; padding:20px;
    `;
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    const container = createElement('div');
    container.style.cssText = `
        background:#fff; padding:20px; border-radius:8px; max-width:90%; overflow-x:auto;
    `;

    container.appendChild(createElement('h4', null, `Сравнение замеров: ${report1.date} ↔ ${report2.date}`));

    const table = createElement('table');
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';

    const header = createElement('tr');
    header.innerHTML = `<th>Параметр</th><th>${report1.date}</th><th>${report2.date}</th>`;
    table.appendChild(header);

    const metricsSet = new Set([
        ...(report1.metrics || []).map(m => m.name),
        ...(report2.metrics || []).map(m => m.name)
    ]);

    metricsSet.forEach(name => {
        const row = createElement('tr');
        const m1 = (report1.metrics || []).find(m => m.name === name);
        const m2 = (report2.metrics || []).find(m => m.name === name);
        row.innerHTML = `
            <td>${name}</td>
            <td>${m1 ? m1.value : '-'}</td>
            <td>${m2 ? m2.value : '-'}</td>
        `;
        row.style.borderBottom = '1px solid #ccc';
        table.appendChild(row);
    });

    container.appendChild(table);
    overlay.appendChild(container);
    document.body.appendChild(overlay);
}


// =================================================================
// 🌟 Сравнение фото
// =================================================================
function showComparePhotos(idBefore, idAfter, numBefore, numAfter) {
    const report1 = state.reports.find(r => r.id === idBefore);
    const report2 = state.reports.find(r => r.id === idAfter);
    if (!report1 || !report2) return;

    const photo1 = (report1.photos || []).find(p => p.number == numBefore);
    const photo2 = (report2.photos || []).find(p => p.number == numAfter);

    const overlay = createElement('div');
    overlay.style.cssText = `
        position: fixed; top:0; left:0; width:100%; height:100%;
        background: rgba(0,0,0,0.9); display:flex; justify-content:center; align-items:center;
        z-index:1000; gap:20px; flex-wrap:wrap;
    `;
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    if (photo1 && photo1.url) {
        const img1 = createElement('img');
        img1.src = photo1.url;
        img1.style.maxWidth = '45%';
        img1.style.borderRadius = '8px';
        overlay.appendChild(img1);
    }

    if (photo2 && photo2.url) {
        const img2 = createElement('img');
        img2.src = photo2.url;
        img2.style.maxWidth = '45%';
        img2.style.borderRadius = '8px';
        overlay.appendChild(img2);
    }

    document.body.appendChild(overlay);
}



// 🔥 ВАЖНО: Убедитесь, что у вас есть функция `renderModeChangeButton` и `deleteReport`.
// А главное — функция `openSupplementsPdfOptionsModal` (из предыдущего ответа).


// =================================================================
// ⚙️ СЛУШАТЕЛИ FIREBASE (Управление динамическими коллекциями)
// =================================================================

function unsubscribeAll() {
    programsUnsubscribe();
    journalUnsubscribe();
    clientsUnsubscribe();
    cyclesUnsubscribe();
    // 🔥 НОВЫЕ ОТПИСКИ
    supplementsUnsubscribe();
    reportsUnsubscribe();
}

function setupDynamicListeners() {
    unsubscribeAll();

    if (!userId) return;

    // 1. Клиенты
    if (state.currentMode === 'personal') {
        const clientsRef = getClientsCollection();
        if (clientsRef) {
            clientsUnsubscribe = onSnapshot(clientsRef, snapshot => {
                state.clients = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                if (state.currentPage === 'programs' && !state.selectedClientId) render();
            });
        }
    }

    // 2. Циклы
    const cyclesRef = getUserCyclesCollection();
    if (cyclesRef) {
        cyclesUnsubscribe = onSnapshot(cyclesRef, snapshot => {
            state.cycles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            if (state.currentPage === 'programs') render();
        });
    } else {
        state.cycles = [];
    }

    // 3. Программы — ТОЛЬКО ЕСЛИ ЕСТЬ ВЫБРАННЫЙ ЦИКЛ
    const programsRef = getUserProgramsCollection();
    if (programsRef && state.selectedCycleId) {
        programsUnsubscribe = onSnapshot(programsRef, snapshot => {
            state.programs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            if (['programsInCycle', 'programDetails', 'supplements', 'journal'].includes(state.currentPage)) render();
        });
    }

    // 4. Журнал
    const journalRef = getUserJournalCollection();
    if (journalRef) {
        journalUnsubscribe = onSnapshot(journalRef, snapshot => {
            state.journal = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            if (state.currentPage === 'journal') render();
        });
    }

    // 5. БАДы — только если выбран цикл
    const supplementsRef = getSupplementPlanDocRef?.();
    if (supplementsRef && state.selectedCycleId) {
        supplementsUnsubscribe = onSnapshot(supplementsRef, docSnap => {
            state.supplementPlan = docSnap.exists() ? docSnap.data() : { supplements: [], data: [] };
            if (state.currentPage === 'supplements') render();
        });
    }

    // 6. Отчёты — только если выбран цикл
    if (state.selectedCycleId) {
        const reportsRef = getReportsCollection();
        if (reportsRef) {
            reportsUnsubscribe = onSnapshot(reportsRef, snapshot => {
                state.reports = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                if (state.currentPage === 'reports') render();
            });
        }
    }
}


// -----------------------------------------------------------
// универсальную функция подтверждения удаления
// -----------------------------------------------------------

function openConfirmModal(message, onConfirm) {
    const modal = createElement('div', 'modal-overlay');
    const modalContent = createElement('div', 'modal-content modal-compact');
    modalContent.innerHTML = `
        <p>${message}</p>
        <div class="modal-controls">
            <button class="btn btn-secondary cancel-btn">Нет</button>
            <button class="btn btn-danger confirm-btn">Да</button>
        </div>
    `;
    modal.append(modalContent);
    document.body.append(modal);

    // Активация анимации
    setTimeout(() => modal.classList.add('active'), 50);

    const closeModal = () => {
        modal.classList.remove('active');
        setTimeout(() => modal.remove(), 300);
    };

    modal.querySelector('.cancel-btn').addEventListener('click', closeModal);
    modal.querySelector('.confirm-btn').addEventListener('click', async () => {
        await onConfirm();
        closeModal();
    });
}

// -----------------------------------------------------------
//  функция Top Bar
// -----------------------------------------------------------

// Рендер верхней панели
// ✅ ВЕРХНЯЯ ПАНЕЛЬ (стрелка + гамбургер + текст)
function renderTopBar() {

    const oldBar = document.querySelector('.top-bar');
    const root = document.getElementById('root');
    if (oldBar) oldBar.remove();

    const topBar = document.createElement('div');
    topBar.className = 'top-bar';

    // ------- СТРЕЛКА НАЗАД (с текстом) -------
    let showBack = false;
    const backBtn = document.createElement('button');
    backBtn.className = 'top-back-btn';

    // ✅ 1. Если мы в циклах клиента — показать стрелку "к клиентам"
        if (state.currentMode === 'personal' && state.currentPage === 'programs' && state.selectedClientId) {
            backBtn.innerHTML = '← к клиентам';
            backBtn.onclick = () => {
                state.selectedClientId = null;
                state.currentPage = 'programs'; // вернёмся в список клиентов
                render();
            };
            showBack = true;
        }

    if (state.currentPage === 'programsInCycle') {
        backBtn.innerHTML = '← к циклам';
        backBtn.onclick = () => { state.currentPage = 'programs'; render(); };
        showBack = true;
    }

    if (state.currentPage === 'programDetails') {
        backBtn.innerHTML = '← к программам';
        backBtn.onclick = () => { state.currentPage = 'programsInCycle'; render(); };
        showBack = true;
    }


    if (showBack) topBar.appendChild(backBtn);

    // ------- ГАМБУРГЕР (ВСЕГДА СПРАВА) -------
    const burger = document.createElement('button');
    burger.className = 'top-menu-btn';
    burger.innerHTML = '☰';
    burger.onclick = openMenuModal;
    topBar.appendChild(burger);

    root.prepend(topBar);
}


// Открытие меню
// ✅ МЕНЮ ПРИ НАЖАТИИ НА ГАМБУРГЕР
function openMenuModal() {
    // удаляем старую модалку если осталась
    const old = document.querySelector('.menu-overlay');
    if (old) old.remove();

    // затемнённый фон
    const overlay = document.createElement('div');
    overlay.className = 'menu-overlay';

    // само модальное окно
    const modal = document.createElement('div');
    modal.className = 'menu-modal';

    // SVG кнопка смены режима
    const modeBtn = document.createElement('button');
    modeBtn.className = 'menu-icon-btn';
    modeBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24">
            <path fill="currentColor" d="M12 21q-1.65 0-3.075-.637t-2.5-1.713l1.4-1.425q.825.8 1.875 1.288T12 19q2.5 0 4.25-1.75T18 13q0-2.5-1.75-4.25T12 7q-1.05 0-2.1.488T8.025 8.775L9.4 10.2l-6.4.2l.2-6.4l1.4 1.375Q6 4.275 7.625 3.638T11 3q3.35 0 5.675 2.325T19 11q0 3.35-2.325 5.675T12 19"/>
        </svg>
    `;
    modeBtn.title = 'Сменить режим';
    modeBtn.onclick = () => {
        overlay.remove();
        state.currentMode = null;
        state.currentPage = 'modeSelect';
        render();
    };

    // SVG кнопка выхода
    const logoutBtn = document.createElement('button');
    logoutBtn.className = 'menu-icon-btn';
    logoutBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24">
            <path fill="currentColor" d="M10 17v1.5q0 .625.438 1.062T11.5 20h7q.625 0 1.063-.438T20 18.5v-13q0-.625-.438-1.062T18.5 4h-7q-.625 0-1.062.438T10 5.5V7H8V5.5q0-1.25.875-2.125T11.5 2h7q1.25 0 2.125.875T21.5 5.5v13q0 1.25-.875 2.125T18.5 21h-7q-1.25 0-2.125-.875T8.5 18.5V17zm1-3l-4-4l4-4l1.4 1.425L10.825 9H17v2H10.825l1.575 1.575z"/>
        </svg>
    `;
    logoutBtn.title = 'Выйти из аккаунта';
    logoutBtn.onclick = async () => {
        overlay.remove();
        await signOut(auth);
        showToast("Вы вышли.");
    };

    modal.append(modeBtn, logoutBtn);
    overlay.append(modal);
    document.body.append(overlay);

    // Закрытие по клику по фону (не по модалке)
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.remove();
        }
    });
}







// =================================================================
// 🔄 ГЛАВНЫЙ РЕНДЕР: Определяет, что показать (ИСПРАВЛЕНО)
// =================================================================

function render() {


    const root = document.getElementById('root');
    root.innerHTML = ''; // Очистка


        renderTopBar();




    // ✅ Удаляем выпадающие меню (training-dropdown), если они остались открыты
    const openDropdown = document.querySelector('.training-dropdown');
    if (openDropdown) openDropdown.remove();


    // Сначала убеждаемся, что видимость экранов установлена корректно
    toggleAppVisibility(!!userId);

    // Если нет userId (не авторизован) или режим не выбран - ничего не рендерим в root
    if (!userId || state.currentMode === null) return;

    // 🔥 ЕДИНЫЙ БЛОК РЕНДЕРИНГА
    // Теперь рендерим содержимое root в зависимости от state.currentPage
    if (state.currentPage === 'programs') {
        renderCyclesPage();
    } else if (state.currentPage === 'programsInCycle') {
        renderProgramsInCyclePage();
    } else if (state.currentPage === 'programDetails') {
        renderProgramDetailsPage();
    } else if (state.currentPage === 'journal') {
        renderJournalPage();
    }  else if (state.currentPage === 'journalRecordDetails') {
              renderJournalRecordDetails();


    }else if (state.currentPage === 'supplements') {
        renderSupplementsPage();
    } else if (state.currentPage === 'reports') {
        renderReportsPage();
    } else if (state.currentPage === 'cycleReport') { // Обработка страницы отчета
        renderCycleReportPage(state.reportHtmlCache); // Предполагается наличие renderCycleReportPage
        document.querySelector('.navigation').style.display = 'none'; // Скрываем навигацию
        return; // Выходим, чтобы не обновлять активную кнопку и не показывать навигацию
    } else if (state.currentPage === 'modeSelect') {
        // Заглушка для рендера экрана выбора режима (если она тут)
        document.querySelector('.navigation').style.display = 'none'; // Скрываем навигацию на этом экране
        return;
    }

    // Если страница не 'cycleReport' и не 'modeSelect', показываем навигацию
    document.querySelector('.navigation').style.display = 'flex';


    // Обновление активной кнопки в нижней навигации
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    // Определение активной кнопки
    const activeNavButtonId = {
        'programs': 'programs-btn',
        'programsInCycle': 'programs-btn',
        'programDetails': 'programs-btn',
        'journal': 'journal-btn',
        'supplements': 'supplements-btn',
        'reports': 'reports-btn'
    }[state.currentPage];

    if (activeNavButtonId) {
        document.getElementById(activeNavButtonId)?.classList.add('active');
    }
}

// =================================================================
// 🔑 АУТЕНТИФИКАЦИЯ
// =================================================================
// ... (Код аутентификации без изменений) ...

// 🔥 Переключение между режимами Вход/Регистрация
let isLoginMode = true;
const authToggleBtn = document.getElementById('auth-toggle-btn');
const authLoginBtn = document.getElementById('auth-login-btn');
if (authToggleBtn && authLoginBtn) {
    authToggleBtn.addEventListener('click', () => {
        isLoginMode = !isLoginMode;
        authLoginBtn.innerText = isLoginMode ? 'Войти' : 'Зарегистрироваться';
        authToggleBtn.innerText = isLoginMode ? 'Зарегистрироваться' : 'Войти';
        document.querySelector('.auth-box h3').innerText = isLoginMode ? 'Вход в Дневник' : 'Регистрация';
    });

    authLoginBtn.addEventListener('click', async () => {
        const email = document.getElementById('auth-email').value;
        const password = document.getElementById('auth-password').value;
        try {
            if (isLoginMode) {
                await signInWithEmailAndPassword(auth, email, password);
                showToast('Вход выполнен успешно!');
            } else {
                await createUserWithEmailAndPassword(auth, email, password);
                showToast('Регистрация прошла успешно! Выполнен вход.');
            }
        } catch (error) {
            console.error("Ошибка аутентификации:", error);
            showToast('Ошибка: ' + (error.message.includes('auth/invalid-credential') ? 'Неверный email или пароль.' : error.message));
        }
    });
}


// =================================================================
// 🖱️ ОБРАБОТЧИКИ КЛИКОВ (Нижняя навигация и Выбор режима)
// =================================================================

// 🔥 ОБРАБОТЧИК ДЛЯ КНОПКИ "ПРОГРАММЫ"
document.getElementById('programs-btn')?.addEventListener('click', () => {
    if (!state.currentMode) return;

    // Если мы уже в разделе программ — ничего не меняем
    if (['programs', 'programsInCycle', 'programDetails'].includes(state.currentPage)) return;

    // Переходим туда, где были в последний раз
    if (state.lastProgramsPage === 'programDetails' && state.selectedProgramIdForDetails) {
        state.currentPage = 'programDetails';
    } else if (state.lastProgramsPage === 'programsInCycle' && state.selectedCycleId) {
        state.currentPage = 'programsInCycle';
    } else {
        state.currentPage = 'programs'; // по умолчанию
    }

    render();
});


// 🔥 ОБРАБОТЧИК ДЛЯ КНОПКИ "ДНЕВНИК"
document.getElementById('journal-btn')?.addEventListener('click', () => {
    if (state.currentMode) {
        if (state.currentPage !== 'journal') {
            // Сохраняем текущую страницу перед переходом в дневник
            state.previousPage = state.currentPage;
            state.currentPage = 'journal';
        } else {
            // Если мы уже в дневнике, повторное нажатие возвращает на previousPage
            state.currentPage = state.previousPage;
        }
        render();
    }
});

// 🔥 ДОБАВЛЕНО: ОБРАБОТЧИК ДЛЯ КНОПКИ "БАДЫ" - ИСПРАВЛЕН
document.getElementById('supplements-btn')?.addEventListener('click', () => {
    if (state.currentMode) {
        if (state.currentPage !== 'supplements') {
            state.previousPage = state.currentPage; // Сохраняем, откуда пришли
            state.currentPage = 'supplements';
        } else {
            state.currentPage = state.previousPage; // Повторное нажатие - возвращаемся на предыдущую
        }
        render();
    }
});

// 🔥 ДОБАВЛЕНО: ОБРАБОТЧИК ДЛЯ КНОПКИ "ОТЧЕТЫ"
document.getElementById('reports-btn')?.addEventListener('click', () => {
    if (state.currentMode) {
        if (state.currentPage !== 'reports') {
            state.previousPage = state.currentPage;
            state.currentPage = 'reports';
        } else {
            state.currentPage = state.previousPage;
        }
        render();
    }
});

// 🔥 ОБРАБОТЧИК: СОБСТВЕННЫЕ ТРЕНИРОВКИ
document.getElementById('select-own-mode')?.addEventListener('click', () => {
    state.currentMode = 'own';
    state.currentPage = 'programs';

    // ✅ Полностью сбрасываем данные клиента/цикла
    state.selectedClientId = null;
    state.selectedCycleId = null;
    state.selectedJournalCategory = null;
    state.selectedJournalProgram = null;

    setupDynamicListeners();
    render();
});

// 🔥 ОБРАБОТЧИК: ПЕРСОНАЛЬНЫЕ (ТРЕНЕР)
document.getElementById('select-personal-mode')?.addEventListener('click', () => {
    state.currentMode = 'personal';
    state.currentPage = 'programs';

    // ✅ ОБЯЗАТЕЛЬНО сбрасываем прошлые выбранные циклы из "own"
    state.selectedClientId = null;
    state.selectedCycleId = null;
    state.selectedJournalCategory = null;
    state.selectedJournalProgram = null;

    setupDynamicListeners();
    render();
});

// 🔥 ВЫХОД (Logout)
document.getElementById('mode-logout-btn')?.addEventListener('click', async () => {
    try {
        await signOut(auth);
        state.currentMode = null;
        state.selectedClientId = null;
        state.selectedCycleId = null;
        state.selectedJournalCategory = null;
        state.selectedJournalProgram = null;
        showToast('Вы вышли из системы.');
    } catch (error) {
        console.error("Ошибка при выходе:", error);
        showToast('Ошибка при выходе.');
    }
});


// =================================================================
// 🚀 ГЛАВНАЯ ТОЧКА ВХОДА (Проверка авторизации)
// =================================================================
// ... (Код onAuthStateChanged без изменений) ...

onAuthStateChanged(auth, (user) => {
    // Отписываемся от старых слушателей перед изменением userId
    unsubscribeAll();

    if (user) {
        userId = user.uid;
        // Если пользователь только что вошел, режим еще не выбран
        if (state.currentMode === null) {
            state.currentPage = 'modeSelect';
            toggleAppVisibility(true); // Показать экран выбора режима
        } else {
            // Если режим уже был выбран (например, при перезагрузке страницы),
            // переподключаем слушатели и рендерим
            setupDynamicListeners();
        }
    } else {
        userId = null;
        state.currentMode = null;
        state.selectedClientId = null;
        state.currentPage = 'auth';
        toggleAppVisibility(false); // Показать экран авторизации
    }


    // Первоначальный рендер
    render();
});
