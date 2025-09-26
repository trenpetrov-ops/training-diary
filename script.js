// Импорт необходимых модулей Firebase SDK
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import {
    getAuth,
    onAuthStateChanged,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signOut
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot, collection } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";


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
let userId = null;

// 🔥 НОВОЕ: Переменные для хранения функций отписки от слушателей Firebase
let programsUnsubscribe = () => {};
let journalUnsubscribe = () => {};
let clientsUnsubscribe = () => {};
let cyclesUnsubscribe = () => {};

// --- УПРАВЛЕНИЕ СОСТОЯНИЕМ ---
let state = {
    currentMode: null,
    currentPage: 'modeSelect',
    previousPage: 'programs',

    cycles: [],
    selectedCycleId: null,
    programs: [],
    journal: [],
    clients: [],
    selectedClientId: null,
    selectedProgramIdForDetails: null,
    expandedExerciseId: null,
    editingSetId: null,

    // ИЗМЕНЕНО: Двойной фильтр для дневника. '' - ничего не выбрано. 'all' - все циклы/программы.
    selectedJournalCategory: '',
    selectedJournalProgram: '',
};

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

// 🔥 ИЗМЕНЕНО: Управление видимостью трех основных экранов
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


// --- ФУНКЦИИ FIREBASE ---

function getUserCyclesCollection() {
    if (state.currentMode === 'own') {
        return collection(db, `artifacts/${appId}/users/${userId}/cycles`);
    } else if (state.currentMode === 'personal' && state.selectedClientId) {
        return collection(db, `artifacts/${appId}/users/${userId}/clients/${state.selectedClientId}/cycles`);
    }
    return collection(db, `artifacts/${appId}/users/${userId}/clients`);
}

function getUserProgramsCollection() {
    if (!state.selectedCycleId) {
        return collection(db, `artifacts/${appId}/users/${userId}/dummy`);
    }

    if (state.currentMode === 'own') {
        return collection(db, `artifacts/${appId}/users/${userId}/cycles/${state.selectedCycleId}/programs`);
    } else if (state.currentMode === 'personal' && state.selectedClientId) {
        return collection(db, `artifacts/${appId}/users/${userId}/clients/${state.selectedClientId}/cycles/${state.selectedCycleId}/programs`);
    }
    return collection(db, `artifacts/${appId}/users/${userId}/dummy`);
}

function getClientsCollection() {
    return collection(db, `artifacts/${appId}/users/${userId}/clients`);
}

function getUserJournalCollection() {
    if (state.currentMode === 'own') {
        return collection(db, `artifacts/${appId}/users/${userId}/journal`);
    } else if (state.currentMode === 'personal' && state.selectedClientId) {
        return collection(db, `artifacts/${appId}/users/${userId}/clients/${state.selectedClientId}/journal`);
    }
    return collection(db, `artifacts/${appId}/users/${userId}/journal_dummy`);
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

    renderModeChangeButton(contentContainer);

    const header = createElement('h3', null, 'Персональные тренировки');
    contentContainer.append(header);


    const clientInputGroup = createElement('div', 'input-group');
    const clientInput = createElement('input', null);
    clientInput.placeholder = 'Имя клиента';
    const addClientBtn = createElement('button', 'btn btn-primary', 'Добавить');
    clientInputGroup.append(clientInput, addClientBtn);
    contentContainer.append(clientInputGroup);

    addClientBtn.addEventListener('click', async () => {
        const name = clientInput.value.trim();
        if (name) {
            const newClient = {
                name: name,
                createdAt: Date.now()
            };
            try {
                await addDoc(getClientsCollection(), newClient);
                clientInput.value = '';
            } catch (error) {
                console.error("Ошибка при добавлении клиента:", error);
                showToast('Ошибка сохранения. Проверьте правила Firebase!');
            }
        }
    });

    const clientsList = createElement('div', 'clients-list list-section');

    if (state.clients.length === 0) {
        clientsList.append(createElement('div', 'muted', 'Нет клиентов. Добавьте первого!'));
    } else {
        state.clients.forEach(client => {
            const clientItem = createElement('div', 'list-item client-item');
            clientItem.dataset.id = client.id;

            clientItem.innerHTML = `<div>${client.name}</div>
                                     <div>
                                         <button class="btn delete-btn"><svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><title>Ios-trash-outline SVG Icon</title><path d="M400 113.3h-80v-20c0-16.2-13.1-29.3-29.3-29.3h-69.5C205.1 64 192 77.1 192 93.3v20h-80V128h21.1l23.6 290.7c0 16.2 13.1 29.3 29.3 29.3h141c16.2 0 29.3-13.1 29.3-29.3L379.6 128H400v-14.7zm-193.4-20c0-8.1 6.6-14.7 14.6-14.7h69.5c8.1 0 14.6 6.6 14.6 14.7v20h-98.7v-20zm135 324.6v.8c0 8.1-6.6 14.7-14.6 14.7H186c-8.1 0-14.6-6.6-14.6-14.7v-.8L147.7 128h217.2l-23.3 289.9z" fill="currentColor"/><path d="M249 160h14v241h-14z" fill="currentColor"/><path d="M320 160h-14.6l-10.7 241h14.6z" fill="currentColor"/><path d="M206.5 160H192l10.7 241h14.6z" fill="currentColor"/></svg></button>
                                     </div>`;

            const deleteBtn = clientItem.querySelector('.delete-btn');
            deleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await deleteDoc(doc(getClientsCollection(), client.id));
                if (state.selectedClientId === client.id) {
                    state.selectedClientId = null;
                }
            });

            // Обработчик клика для перехода к циклам клиента
            clientItem.addEventListener('click', (e) => {
                if (!e.target.closest('.delete-btn')) {
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

    contentContainer.append(clientsList);
    root.append(contentContainer);

}

// =================================================================
// 🔥 ФУНКЦИЯ: Отображение списка Тренировочных ЦИКЛОВ
// =================================================================
function renderCyclesPage() {
    // Если мы в режиме 'personal' и клиент не выбран, рендерим список клиентов.
    if (state.currentMode === 'personal' && state.selectedClientId === null) {
        renderClientsPage();
        return;
    }

    const contentContainer = document.createElement('div');
    contentContainer.id = 'cycles-content';
    contentContainer.className = 'programs-list-page';

    // -----------------------------------------------------------
    // Кнопка "Сменить режим" или "Назад" к клиентам
    // -----------------------------------------------------------
    if (state.currentMode === 'personal') {
        const backToClientsBtn = createElement('button', 'btn back-btn', '← К клиентам');
        backToClientsBtn.addEventListener('click', () => {
            state.selectedClientId = null;
            state.currentPage = 'programs';
            state.selectedCycleId = null;
            setupDynamicListeners();
            render();
        });
        contentContainer.append(backToClientsBtn);
    } else {
        // Если 'own' режим, показываем кнопку смены режима
        renderModeChangeButton(contentContainer);
    }


    let headerText = state.currentMode === 'own' ? 'Личные циклы' :
        `Циклы клиента: ${state.clients.find(c => c.id === state.selectedClientId)?.name || 'Неизвестно'}`;
    const header = createElement('h3', null, headerText);
    contentContainer.append(header);


    // -----------------------------------------------------------
    // БЛОК ДОБАВЛЕНИЯ ЦИКЛА
    // -----------------------------------------------------------
    const cycleInputGroup = createElement('div', 'input-group');
    const cycleInput = createElement('input', null);
    cycleInput.placeholder = 'Название цикла (Набор массы, Сушка...)';
    const addCycleBtn = createElement('button', 'btn btn-primary', 'Создать цикл');
    cycleInputGroup.append(cycleInput, addCycleBtn);
    contentContainer.append(cycleInputGroup);

    addCycleBtn.addEventListener('click', async () => {
        const name = cycleInput.value.trim();
        if (name) {
            const newCycle = {
                name: name,
                startDate: Date.now(),
                startDateString: new Date().toLocaleDateString('ru-RU'),
            };
            try {
                await addDoc(getUserCyclesCollection(), newCycle);
                cycleInput.value = '';
            } catch (error) {
                console.error("Ошибка при добавлении цикла:", error);
                showToast('Ошибка сохранения. Проверьте правила Firebase!');
            }
        }
    });

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

            cycleItem.innerHTML = `<div>${cycle.name} <small class="muted">(${cycle.startDateString})</small></div>
                                     <div>
                                         <button class="btn delete-btn "><svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><title>Ios-trash-outline SVG Icon</title><path d="M400 113.3h-80v-20c0-16.2-13.1-29.3-29.3-29.3h-69.5C205.1 64 192 77.1 192 93.3v20h-80V128h21.1l23.6 290.7c0 16.2 13.1 29.3 29.3 29.3h141c16.2 0 29.3-13.1 29.3-29.3L379.6 128H400v-14.7zm-193.4-20c0-8.1 6.6-14.7 14.6-14.7h69.5c8.1 0 14.6 6.6 14.6 14.7v20h-98.7v-20zm135 324.6v.8c0 8.1-6.6 14.7-14.6 14.7H186c-8.1 0-14.6-6.6-14.6-14.7v-.8L147.7 128h217.2l-23.3 289.9z" fill="currentColor"/><path d="M249 160h14v241h-14z" fill="currentColor"/><path d="M320 160h-14.6l-10.7 241h14.6z" fill="currentColor"/><path d="M206.5 160H192l10.7 241h14.6z" fill="currentColor"/></svg></button>
                                     </div>`;

            const deleteBtn = cycleItem.querySelector('.delete-btn');
            deleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await deleteDoc(doc(getUserCyclesCollection(), cycle.id));
            });

            const clickHandler = () => {
                state.selectedCycleId = cycle.id;
                state.currentPage = 'programsInCycle';
                setupDynamicListeners();
                render();
            };



            cycleItem.addEventListener('click', (e) => {
                if (!e.target.closest('.delete-btn')) {
                    clickHandler();
                }
            });

            cyclesList.append(cycleItem);
        });
    }

    contentContainer.append(cyclesList);
    root.append(contentContainer);
}


// =================================================================
// 🔥 ФУНКЦИЯ: Отображение программ внутри выбранного цикла
// =================================================================
function renderProgramsInCyclePage() {
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

    // Кнопка "Назад" к циклам
    const backButtonText = state.currentMode === 'own' ? '← К циклам' : `← К циклам клиента`;
    const backButton = createElement('button', 'btn back-btn', backButtonText);

    backButton.addEventListener('click', () => {
        state.currentPage = 'programs';
        state.selectedProgramIdForDetails = null;
        render();
    });
    contentContainer.append(backButton);


    const header = createElement('h3', null, `${currentCycle.name}: Программы`);
    contentContainer.append(header);

    // -----------------------------------------------------------
    // БЛОК ДОБАВЛЕНИЯ ПРОГРАММЫ
    // -----------------------------------------------------------
    const programInputGroup = createElement('div', 'input-group');
    const programInput = createElement('input', null);
    programInput.placeholder = 'Название программы (Ноги, Руки...)';
    const addProgramBtn = createElement('button', 'btn btn-primary', 'Создать');
    programInputGroup.append(programInput, addProgramBtn);
    contentContainer.append(programInputGroup);

    addProgramBtn.addEventListener('click', async () => {
        const name = programInput.value.trim();
        if (name) {
            const newProgram = {
                name: name,
                exercises: [],
                trainingNote: '' // 🔥 ИНИЦИАЛИЗАЦИЯ: Поле для комментария к тренировке
            };
            try {
                await addDoc(getUserProgramsCollection(), newProgram);
                programInput.value = '';
            } catch (error) {
                console.error("Ошибка при добавлении программы:", error);
                showToast('Ошибка сохранения. Проверьте правила Firebase!');
            }
        }
    });

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

            programItem.innerHTML = `<div>${program.name}</div>
                                     <div>
                                         <button class="btn delete-btn"><svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><title>Ios-trash-outline SVG Icon</title><path d="M400 113.3h-80v-20c0-16.2-13.1-29.3-29.3-29.3h-69.5C205.1 64 192 77.1 192 93.3v20h-80V128h21.1l23.6 290.7c0 16.2 13.1 29.3 29.3 29.3h141c16.2 0 29.3-13.1 29.3-29.3L379.6 128H400v-14.7zm-193.4-20c0-8.1 6.6-14.7 14.6-14.7h69.5c8.1 0 14.6 6.6 14.6 14.7v20h-98.7v-20zm135 324.6v.8c0 8.1-6.6 14.7-14.6 14.7H186c-8.1 0-14.6-6.6-14.6-14.7v-.8L147.7 128h217.2l-23.3 289.9z" fill="currentColor"/><path d="M249 160h14v241h-14z" fill="currentColor"/><path d="M320 160h-14.6l-10.7 241h14.6z" fill="currentColor"/><path d="M206.5 160H192l10.7 241h14.6z" fill="currentColor"/></svg></button>
                                     </div>`;

            const deleteBtn = programItem.querySelector('.delete-btn');
            deleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await deleteDoc(doc(getUserProgramsCollection(), program.id));
                if (state.selectedProgramIdForDetails === program.id) {
                    state.selectedProgramIdForDetails = null;
                }
            });

            const clickHandler = () => {
                state.selectedProgramIdForDetails = program.id;
                state.currentPage = 'programDetails';
                state.expandedExerciseId = null;
                state.editingSetId = null;
                render();
            };

            programItem.addEventListener('click', (e) => {
                if (!e.target.closest('.delete-btn')) {
                    clickHandler();
                }
            });

            programsList.append(programItem);
        });
    }

    contentContainer.append(programsList);
    root.append(contentContainer);
}


// =================================================================
// 🌟 ОБНОВЛЕННАЯ ФУНКЦИЯ: УНИВЕРСАЛЬНОЕ МОДАЛЬНОЕ ОКНО ДЛЯ КОММЕНТАРИЕВ
// =================================================================

function openCommentModal(itemId, currentNote, title, saveCallback) {
    const modalId = `modal-comment-${itemId}`;
    let modal = document.getElementById(modalId);

    // Удаляем старую модалку, если она была, чтобы избежать дублирования
    if (modal) {
        modal.remove();
    }

    modal = createElement('div', 'modal-overlay', '');
    modal.id = modalId;

    const modalContent = createElement('div', 'modal-content');
    modalContent.innerHTML = `
        <h4 class="modal-title">${title}</h4>
        <textarea id="comment-input-${itemId}" class="comment-edit-input" placeholder="Введите комментарий...">${currentNote || ''}</textarea>
        <div class="modal-controls">
            <button class="btn btn-secondary modal-cancel-btn">Отмена</button>
            <button class="btn btn-primary modal-save-btn">Сохранить</button>
        </div>
    `;

    modal.append(modalContent);
    document.body.append(modal);

    const closeModal = () => modal.classList.remove('active');

    // Активируем модальное окно (для CSS перехода)
    setTimeout(() => modal.classList.add('active'), 50);

    modal.querySelector('.modal-cancel-btn').addEventListener('click', () => {
        closeModal();
        setTimeout(() => modal.remove(), 300); // Удаляем после анимации
    });

    modal.querySelector('.modal-save-btn').addEventListener('click', async () => {
        const newNote = modal.querySelector(`#comment-input-${itemId}`).value.trim();
        await saveCallback(newNote); // Используем переданную функцию сохранения
        closeModal();
        setTimeout(() => modal.remove(), 300);
    });
}


async function saveExerciseNote(programId, exerciseId, note) {
    const currentProgram = state.programs.find(p => p.id === programId);
    if (currentProgram) {
        const currentExercise = (currentProgram.exercises || []).find(ex => ex.id === exerciseId);
        if (currentExercise) {
            currentExercise.note = note;

            try {
                await updateDoc(doc(getUserProgramsCollection(), currentProgram.id), { exercises: currentProgram.exercises });
                showToast('Комментарий к упражнению сохранен!');
            } catch (error) {
                console.error("Ошибка при сохранении комментария к упражнению:", error);
                showToast('Ошибка сохранения комментария.');
            }
        }
    }
}

async function saveTrainingNote(programId, note) {
    try {
        await updateDoc(doc(getUserProgramsCollection(), programId), { trainingNote: note });
        showToast('Комментарий к тренировке сохранен!');
    } catch (error) {
        console.error("Ошибка при сохранении комментария к тренировке:", error);
        showToast('Ошибка сохранения комментария к тренировке.');
    }
}


// 🚀 ЛОГИКА ДЛЯ СТРАНИЦЫ ДЕТАЛЕЙ ПРОГРАММЫ
const debouncedSaveSetData = debounce(async (programId, exerciseId, setIndex, field, value) => {
    const currentProgram = state.programs.find(p => p.id === programId);
    if (currentProgram) {
        const currentExercise = (currentProgram.exercises || []).find(ex => ex.id === exerciseId);
        if (currentExercise) {
            if (!currentExercise.sets) {
                currentExercise.sets = [];
            }
            currentExercise.sets[setIndex][field] = value;
            try {
                await updateDoc(doc(getUserProgramsCollection(), currentProgram.id), { exercises: currentProgram.exercises });
                // render() здесь не нужен, так как сработает Firebase listener
            } catch (error) {
                console.error("Ошибка при отложенном сохранении:", error);
            }
        }
    }
}, 1000);

function renderProgramDetailsPage() {
    const selectedProgram = state.programs.find(p => p.id === state.selectedProgramIdForDetails);

    if (!selectedProgram) {
        state.currentPage = 'programsInCycle';
        state.selectedProgramIdForDetails = null;
        render();
        return;
    }

    const contentContainer = document.createElement('div');
    contentContainer.id = 'program-details-content';
    contentContainer.className = 'program-details-page';

    const backButtonText = '← К программам цикла';
    const backButton = createElement('button', 'btn back-btn', backButtonText);

    backButton.addEventListener('click', () => {
        state.currentPage = 'programsInCycle';
        state.selectedProgramIdForDetails = null;
        render();
    });
    contentContainer.append(backButton);

    // Обработчик клика для сброса режима редактирования (скрытие полей ввода)
    contentContainer.addEventListener('click', (e) => {
        if (!e.target.closest('.set-row') && state.editingSetId !== null) {
            state.editingSetId = null;
            render();
        }
    });

    contentContainer.append(createElement('h3', null, selectedProgram.name));

    // -----------------------------------------------------------
    // БЛОК ДОБАВЛЕНИЯ УПРАЖНЕНИЯ
    // -----------------------------------------------------------
    const exerciseInputGroup = createElement('div', 'input-group exercise-input-group');
    const exerciseInput = createElement('input', null);
    exerciseInput.placeholder = 'Название упражнения';
    const addExerciseBtn = createElement('button', 'btn btn-primary', 'Добавить');
    exerciseInputGroup.append(exerciseInput, addExerciseBtn);
    contentContainer.append(exerciseInputGroup);

    addExerciseBtn.addEventListener('click', async () => {
        const name = exerciseInput.value.trim();
        if (name) {
            const newExercise = {
                id: Date.now().toString(),
                name: name,
                sets: [{ weight: '', reps: '' }],
                note: ''
            };
            const currentProgram = state.programs.find(p => p.id === state.selectedProgramIdForDetails);
            if (currentProgram) {
                if (!currentProgram.exercises) {
                    currentProgram.exercises = [];
                }
                currentProgram.exercises.push(newExercise);
                exerciseInput.value = '';
                state.expandedExerciseId = newExercise.id;
                state.editingSetId = null;
                await updateDoc(doc(getUserProgramsCollection(), currentProgram.id), { exercises: currentProgram.exercises });
            }
        }
    });

    // -----------------------------------------------------------
    // СПИСОК УПРАЖНЕНИЙ
    // -----------------------------------------------------------
    if (!selectedProgram.exercises || selectedProgram.exercises.length === 0) {
        contentContainer.append(createElement('div', 'muted', 'Нет упражнений. Добавьте первое!'));
    } else {
        const exercisesListSection = createElement('div', 'list-section');
        selectedProgram.exercises.forEach((exercise, index) => {
            const isExpanded = state.expandedExerciseId === exercise.id;
            const hasNote = exercise.note && exercise.note.trim() !== '';

            const exerciseItem = createElement('div', 'exercise-item');

            const exerciseHeader = createElement('div', `exercise-header ${isExpanded ? 'expanded' : ''}`);

            const exerciseTitle = createElement('div', 'exercise-title');
            const exerciseNumber = createElement('span', 'exercise-number', `${index + 1}.`);
            const exerciseName = createElement('span', 'exercise-name', exercise.name);

            exerciseTitle.append(exerciseNumber, exerciseName);

            const controlButtons = createElement('div', 'control-buttons');

            // Кнопка редактирования комментария к упражнению
            const editNoteBtn = createElement('button', `btn edit-note-btn ${hasNote ? 'has-note' : ''}`);
            editNoteBtn.innerHTML = ' <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><title>Edit SVG Icon</title><path fill="currentColor" d="M3.548 20.938h16.9a.5.5 0 0 0 0-1h-16.9a.5.5 0 0 0 0 1M9.71 17.18a2.587 2.587 0 0 0 1.12-.65l9.54-9.54a1.75 1.75 0 0 0 0-2.47l-.94-.93a1.788 1.788 0 0 0-2.47 0l-9.54 9.53a2.473 2.473 0 0 0-.64 1.12L6.04 17a.737.737 0 0 0 .19.72a.767.767 0 0 0 .53.22Zm.41-1.36a1.468 1.468 0 0 1-.67.39l-.97.26l-1-1l.26-.97a1.521 1.521 0 0 1 .39-.67l.38-.37l1.99 1.99Zm1.09-1.08l-1.99-1.99l6.73-6.73l1.99 1.99Zm8.45-8.45L18.65 7.3l-1.99-1.99l1.01-1.02a.748.748 0 0 1 1.06 0l.93.94a.754.754 0 0 1 0 1.06"/></svg>';
            editNoteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                // Используем универсальное модальное окно
                openCommentModal(
                    exercise.id,
                    exercise.note,
                    `Комментарий к ${exercise.name}`,
                    (newNote) => saveExerciseNote(selectedProgram.id, exercise.id, newNote)
                );
            });


            const deleteExerciseBtn = createElement('button', 'btn delete-exercise-btn');
            deleteExerciseBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><title>Ios-trash-outline SVG Icon</title><path d="M400 113.3h-80v-20c0-16.2-13.1-29.3-29.3-29.3h-69.5C205.1 64 192 77.1 192 93.3v20h-80V128h21.1l23.6 290.7c0 16.2 13.1 29.3 29.3 29.3h141c16.2 0 29.3-13.1 29.3-29.3L379.6 128H400v-14.7zm-193.4-20c0-8.1 6.6-14.7 14.6-14.7h69.5c8.1 0 14.6 6.6 14.6 14.7v20h-98.7v-20zm135 324.6v.8c0 8.1-6.6 14.7-14.6 14.7H186c-8.1 0-14.6-6.6-14.6-14.7v-.8L147.7 128h217.2l-23.3 289.9z" fill="currentColor"/><path d="M249 160h14v241h-14z" fill="currentColor"/><path d="M320 160h-14.6l-10.7 241h14.6z" fill="currentColor"/><path d="M206.5 160H192l10.7 241h14.6z" fill="currentColor"/></svg>';

            controlButtons.append(editNoteBtn, deleteExerciseBtn);
            exerciseHeader.append(exerciseTitle, controlButtons);

            deleteExerciseBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const currentProgram = state.programs.find(p => p.id === state.selectedProgramIdForDetails);
                if (currentProgram) {
                    currentProgram.exercises = (currentProgram.exercises || []).filter(ex => ex.id !== exercise.id);
                    state.expandedExerciseId = null;
                    state.editingSetId = null;
                    await updateDoc(doc(getUserProgramsCollection(), currentProgram.id), { exercises: currentProgram.exercises });
                }
            });

            const setsContainer = createElement('div', `sets-container ${isExpanded ? 'expanded' : ''}`);

            // Контейнер для отображения комментария под подходами
            const exerciseNoteContainer = createElement('div', 'exercise-note-display');
            if (hasNote) {
                const noteText = createElement('p', 'comment-text', exercise.note);
                exerciseNoteContainer.append(noteText);
            }


            const summarySetsContainer = createElement('div', `summary-sets-container ${!isExpanded ? 'visible' : ''}`);
            const summarySets = (exercise.sets || []).filter(set => (set.weight && set.weight.trim() !== '') || (set.reps && set.reps.trim() !== ''));
            if (summarySets.length > 0) {
                summarySets.forEach((set, setIndex) => {
                    const summarySpan = createElement('span', null, `${set.weight || '0'}x${set.reps || '0'}`);
                    summarySetsContainer.append(summarySpan);
                });
            }

            exerciseHeader.addEventListener('click', () => {
                if (state.expandedExerciseId === exercise.id) {
                    state.expandedExerciseId = null;
                } else {
                    state.expandedExerciseId = exercise.id;
                }
                state.editingSetId = null;
                render();
            });

            if (Array.isArray(exercise.sets)) {
                exercise.sets.forEach((set, setIndex) => {
                    const setId = `${exercise.id}-${setIndex}`;
                    const isEditing = state.editingSetId === setId;

                    const setRow = createElement('div', `set-row ${isEditing ? 'editing' : ''}`);
                    const setNumberLabel = createElement('span', 'set-label', `${setIndex + 1}.`);
                    setRow.append(setNumberLabel);

                    const inputGroup = createElement('div', 'set-input-group');
                    const weightInput = createElement('input', 'weight-input');
                    weightInput.type = 'number';
                    weightInput.placeholder = 'Вес';
                    weightInput.value = set.weight;

                    const repsInput = createElement('input', 'reps-input');
                    repsInput.type = 'number';
                    repsInput.placeholder = 'Пов';
                    repsInput.value = set.reps;

                    inputGroup.append(weightInput, repsInput);
                    setRow.append(inputGroup);


                    const setText = createElement('span', 'set-display');
                    const displayWeight = set.weight || '...';
                    const displayReps = set.reps || '...';

                    setText.innerHTML = `
                        ${displayWeight} <small class="unit-label">кг</small> x 
                        ${displayReps} <small class="unit-label">пов</small>
                    `;
                    setRow.append(setText);

                    setRow.addEventListener('click', (e) => {
                        e.stopPropagation();
                        state.editingSetId = setId;
                        render();
                    });

                    weightInput.addEventListener('click', (e) => e.stopPropagation());
                    repsInput.addEventListener('click', (e) => e.stopPropagation());

                    weightInput.addEventListener('input', (e) => {
                        debouncedSaveSetData(selectedProgram.id, exercise.id, setIndex, 'weight', e.target.value);
                    });
                    repsInput.addEventListener('input', (e) => {
                        debouncedSaveSetData(selectedProgram.id, exercise.id, setIndex, 'reps', e.target.value);
                    });

                    const deleteSetBtn = createElement('button', 'btn delete-set-row-btn', '-');

                    // 🔥 ИСПРАВЛЕНИЕ 2: Логика удаления подхода/упражнения
                    deleteSetBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        const currentProgram = state.programs.find(p => p.id === state.selectedProgramIdForDetails);
                        if (currentProgram) {
                            const currentExercise = (currentProgram.exercises || []).find(ex => ex.id === exercise.id);
                            if (currentExercise) {

                                if (currentExercise.sets.length === 1) {
                                    // 🔥 НОВОЕ ПРАВИЛО: Если это последний подход, удаляем все упражнение
                                    currentProgram.exercises = currentProgram.exercises.filter(ex => ex.id !== exercise.id);
                                    showToast('Удалено последнее упражнение!');
                                } else {
                                    // Иначе, просто удаляем подход
                                    currentExercise.sets.splice(setIndex, 1);
                                    showToast('Подход удален!');
                                }

                                state.editingSetId = null;
                                await updateDoc(doc(getUserProgramsCollection(), currentProgram.id), {
                                    exercises: currentProgram.exercises
                                });
                            }
                        }
                    });

                    setRow.append(deleteSetBtn);
                    setsContainer.append(setRow);
                });
            }

            const addSetBtn = createElement('button', 'add-set-btn', '+');
            addSetBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const currentProgram = state.programs.find(p => p.id === state.selectedProgramIdForDetails);
                if (currentProgram) {
                    const currentExercise = (currentProgram.exercises || []).find(ex => ex.id === exercise.id);
                    if (currentExercise) {
                        if (!currentExercise.sets) {
                            currentExercise.sets = [];
                        }
                        const newSetIndex = currentExercise.sets.length;
                        currentExercise.sets.push({ weight: '', reps: '' });
                        // Устанавливаем редактирование на только что созданный подход
                        state.editingSetId = `${exercise.id}-${newSetIndex}`;
                        await updateDoc(doc(getUserProgramsCollection(), currentProgram.id), { exercises: currentProgram.exercises });
                    }
                }
            });
            setsContainer.append(addSetBtn);

            // Отображение комментария в развернутом виде
            if (isExpanded) {
                setsContainer.append(exerciseNoteContainer);
            }

            exerciseItem.append(exerciseHeader, summarySetsContainer);

            // Отображение комментария в свернутом виде (если есть)
            if (!isExpanded && hasNote) {
                exerciseItem.append(exerciseNoteContainer);
            }

            exerciseItem.append(setsContainer);
            exercisesListSection.append(exerciseItem);
        });
        contentContainer.append(exercisesListSection);
    }

    // -----------------------------------------------------------
    // 🔥 БЛОК КОММЕНТАРИЕВ К ТРЕНИРОВКЕ (ИСПРАВЛЕНИЕ 1: МОДАЛЬНОЕ ОКНО)
    // -----------------------------------------------------------
    const hasTrainingNote = selectedProgram.trainingNote && selectedProgram.trainingNote.trim() !== '';

    const commentWrapper = createElement('div', 'comment-wrapper');
    const commentBtn = createElement('button', `btn comment-toggle-btn ${hasTrainingNote ? 'has-note' : ''}`, `✏️ ${hasTrainingNote ? 'Редактировать комментарий' : 'Добавить комментарий'}`);

    // Отображение комментария, если он есть
    if (hasTrainingNote) {
        const noteDisplay = createElement('p', 'comment-text-display', selectedProgram.trainingNote);
        commentWrapper.append(noteDisplay);
    }


    commentBtn.addEventListener('click', () => {
        // Вызываем универсальное модальное окно для комментария к тренировке
        openCommentModal(
            selectedProgram.id,
            selectedProgram.trainingNote,
            'Комментарий к тренировке',
            (newNote) => saveTrainingNote(selectedProgram.id, newNote)
        );
    });

    commentWrapper.prepend(commentBtn); // Кнопка должна быть сверху
    contentContainer.append(commentWrapper);


    // -----------------------------------------------------------
    // КНОПКА ЗАВЕРШЕНИЯ ТРЕНИРОВКИ
    // -----------------------------------------------------------
    const completeTrainingBtn = createElement('button', 'btn complete-training-btn', 'Завершить тренировку');
    contentContainer.append(completeTrainingBtn);

    completeTrainingBtn.addEventListener('click', async () => {
        // Теперь комментарий берем прямо из selectedProgram (он уже сохранен)
        const trainingComment = selectedProgram.trainingNote || '';
        const currentCycle = state.cycles.find(c => c.id === state.selectedCycleId);

        // 1. Фильтруем упражнения, оставляя только те, где есть подходы с данными ИЛИ комментарий
        const exercisesToSave = selectedProgram.exercises
            .filter(ex => ex.note || (ex.sets && ex.sets.some(set => set.weight || set.reps)))
            .map(ex => ({
                ...ex,
                note: ex.note || '',
                sets: (ex.sets || []).map(set => ({
                    weight: set.weight || '',
                    reps: set.reps || '',
                    note: set.note || ''
                }))
            }));

        if (exercisesToSave.length === 0 && trainingComment === '') {
            showToast('Нечего сохранять: нет подходов с данными или комментариев к тренировке/упражнениям!');
            return;
        }

        const trainingRecord = {
            date: new Date().toLocaleDateString('ru-RU'),
            time: new Date().toLocaleTimeString('ru-RU'),
            programName: selectedProgram.name,
            category: currentCycle ? currentCycle.name : selectedProgram.name,
            cycleName: currentCycle ? currentCycle.name : 'Без цикла',
            comment: trainingComment, // Используем сохраненный trainingNote
            exercises: exercisesToSave
        };

        try {
            await addDoc(getUserJournalCollection(), trainingRecord);
            showToast('Тренировка сохранена в дневнике!');

            // Вернуться к списку программ цикла
            state.currentPage = 'programsInCycle';
            state.selectedProgramIdForDetails = null;
            state.expandedExerciseId = null;
            render();

        } catch (error) {
            console.error("Ошибка при завершении тренировки:", error);
            showToast('Ошибка сохранения записи дневника.');
        }
    });

    root.append(contentContainer);
}


// =================================================================
// 🌟 ЛОГИКА СТРАНИЦЫ ДНЕВНИКА (С ДВОЙНЫМ ФИЛЬТРОМ)
// =================================================================
function renderJournalPage() {
    const contentContainer = document.createElement('div');
    contentContainer.id = 'journal-content';
    contentContainer.className = 'journal-page';

    if (state.currentMode === 'own' || (state.currentMode === 'personal' && state.selectedClientId === null)) {
        renderModeChangeButton(contentContainer);
    } else if (state.currentMode === 'personal' && state.selectedClientId) {
        const backToClientsBtn = createElement('button', 'btn back-btn', '← К циклам');
        backToClientsBtn.addEventListener('click', () => {
            state.currentPage = 'programs';
            state.selectedProgramIdForDetails = null;
            render();
        });
        contentContainer.append(backToClientsBtn);
    }


    const header = createElement('h3', null, 'Дневник тренировок');
    contentContainer.append(header);

    // -----------------------------------------------------------
    // ФИЛЬТР 1: ПО КАТЕГОРИЯМ (ЦИКЛАМ)
    // -----------------------------------------------------------
    const allCategories = [...new Set(state.journal.map(record => record.cycleName || 'Без цикла'))];
    const categoryFilter = createElement('div', 'category-filter');

    const createFilterButton = (name, value) => {
        const btn = createElement('button', `filter-btn ${state.selectedJournalCategory === value ? 'active' : ''}`, name);
        btn.addEventListener('click', () => {
            const newCategory = state.selectedJournalCategory === value ? '' : value;
            if (newCategory !== state.selectedJournalCategory) {
                // Сбрасываем фильтр программы при смене цикла
                state.selectedJournalProgram = '';
            }
            state.selectedJournalCategory = newCategory;
            render();
        });
        return btn;
    };

    // Кнопка "Все циклы" как обязательный начальный выбор
    allCategories.forEach(category => {
        categoryFilter.append(createFilterButton(category, category));
    });
    contentContainer.append(categoryFilter);

    // -----------------------------------------------------------
    // Блокируем отображение по умолчанию
    // -----------------------------------------------------------
    if (!state.selectedJournalCategory) {
        contentContainer.append(createElement('div', 'muted', 'Выберите цикл, чтобы посмотреть записи.'));
        root.append(contentContainer);
        return;
    }


    // -----------------------------------------------------------
    // ФИЛЬТР 2: ПО ПРОГРАММАМ (ВНУТРИ ВЫБРАННОГО ЦИКЛА)
    // -----------------------------------------------------------
    let programsInSelectedCycle = [];
    if (state.selectedJournalCategory === 'all') {
        // Если выбрано 'Все циклы', берем все программы
        programsInSelectedCycle = state.journal.map(record => record.programName);
    } else {
        // Иначе, берем программы только для выбранного цикла
        programsInSelectedCycle = state.journal
            .filter(record => record.cycleName === state.selectedJournalCategory)
            .map(record => record.programName);
    }

    const allPrograms = [...new Set(programsInSelectedCycle)];

    if (allPrograms.length > 0) {
        const programFilter = createElement('div', 'category-filter sub-filter');
        programFilter.style.marginTop = '10px';

        const createProgramFilterButton = (name, value) => {
            const btn = createElement('button', `filter-btn ${state.selectedJournalProgram === value ? 'active' : ''}`, name);
            btn.addEventListener('click', () => {
                state.selectedJournalProgram = state.selectedJournalProgram === value ? '' : value;
                render();
            });
            return btn;
        };

        allPrograms.forEach(programName => {
            programFilter.append(createProgramFilterButton(programName, programName));
        });
        contentContainer.append(programFilter);
    }


    // -----------------------------------------------------------
    // СПИСОК ЗАПИСЕЙ ЖУРНАЛА (С ДВОЙНОЙ ФИЛЬТРАЦИЕЙ)
    // -----------------------------------------------------------
    const journalList = createElement('div', 'journal-list list-section');

    let filteredJournal = state.journal;

    // Фильтр по циклу
    if (state.selectedJournalCategory && state.selectedJournalCategory !== 'all') {
        filteredJournal = filteredJournal.filter(record =>
            record.cycleName === state.selectedJournalCategory
        );
    }

    // Фильтр по программе
    if (state.selectedJournalProgram && state.selectedJournalProgram !== 'all') {
        filteredJournal = filteredJournal.filter(record =>
            record.programName === state.selectedJournalProgram
        );
    }

    if (filteredJournal.length === 0) {
        journalList.append(createElement('div', 'muted', 'Нет записей в дневнике, соответствующих фильтрам.'));
    } else {
        // Сортировка по дате и времени
        filteredJournal.sort((a, b) => {
            // Преобразование даты в формат YYYY-MM-DD для корректного создания Date
            const datePartsA = a.date.split('.');
            const formattedDateA = `${datePartsA[2]}-${datePartsA[1]}-${datePartsA[0]} ${a.time}`;
            const dateA = new Date(formattedDateA);

            const datePartsB = b.date.split('.');
            const formattedDateB = `${datePartsB[2]}-${datePartsB[1]}-${datePartsB[0]} ${b.time}`;
            const dateB = new Date(formattedDateB);

            return dateB - dateA;
        });

        filteredJournal.forEach(record => {
            const journalRecord = createElement('div', 'journal-record');
            journalRecord.dataset.id = record.id;

            const journalHeader = createElement('div', 'journal-header');
            const dateText = createElement('h4', null, `${record.date} в ${record.time}`);

            const deleteBtn = createElement('button', 'btn delete-btn');
            deleteBtn.addEventListener('click', async () => {
                await deleteDoc(doc(getUserJournalCollection(), record.id));
            });

            deleteBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><title>Ios-trash-outline SVG Icon</title><path d="M400 113.3h-80v-20c0-16.2-13.1-29.3-29.3-29.3h-69.5C205.1 64 192 77.1 192 93.3v20h-80V128h21.1l23.6 290.7c0 16.2 13.1 29.3 29.3 29.3h141c16.2 0 29.3-13.1 29.3-29.3L379.6 128H400v-14.7zm-193.4-20c0-8.1 6.6-14.7 14.6-14.7h69.5c8.1 0 14.6 6.6 14.6 14.7v20h-98.7v-20zm135 324.6v.8c0 8.1-6.6 14.7-14.6 14.7H186c-8.1 0-14.6-6.6-14.6-14.7v-.8L147.7 128h217.2l-23.3 289.9z" fill="currentColor"/><path d="M249 160h14v241h-14z" fill="currentColor"/><path d="M320 160h-14.6l-10.7 241h14.6z" fill="currentColor"/><path d="M206.5 160H192l10.7 241h14.6z" fill="currentColor"/></svg>';
            journalHeader.append(dateText, deleteBtn);

            const programName = createElement('div', 'journal-program-name', `${record.programName}`);

            journalRecord.append(journalHeader, programName);

            // -----------------------------------------------------------
            // 🔥 УПРАЖНЕНИЯ (С НУМЕРАЦИЕЙ)
            // -----------------------------------------------------------
            (record.exercises || []).forEach((exercise, index) => {
                const exerciseRow = createElement('div', 'journal-exercise-row');

                // Добавлена нумерация
                const exerciseName = createElement('div', 'journal-exercise-name', `${index + 1}. ${exercise.name}`);

                const setsContainer = createElement('div', 'journal-sets');

                (exercise.sets || []).forEach(set => {
                    // Используем строгие проверки на наличие данных
                    if (set.weight || set.reps) {
                        const setSpan = createElement('span', null, `${set.weight || '0'}x${set.reps || '0'}`);
                        setsContainer.append(setSpan);
                    }
                });

                exerciseRow.append(exerciseName, setsContainer);

                // Отображение комментария к упражнению, если он есть
                if (exercise.note && exercise.note.trim() !== '') {
                    const noteDisplay = createElement('p', 'journal-exercise-note', exercise.note);
                    exerciseRow.append(noteDisplay);
                }

                journalRecord.append(exerciseRow);
            });


            // -----------------------------------------------------------
            // 🔥 КОММЕНТАРИЙ ТРЕНИРОВКИ
            // -----------------------------------------------------------
            const commentSection = createElement('div', 'comment-section');
            const commentText = createElement('p', 'comment-text', record.comment || 'Нет комментария к тренировке.');

            // Если есть комментарий, показываем его
            if (record.comment && record.comment.trim() !== '') {
                // Кнопка редактирования только для записей дневника
                const editCommentBtn = createElement('button', 'btn edit-comment-btn', '✏️ Редактировать');
                commentSection.append(commentText, editCommentBtn);

                editCommentBtn.addEventListener('click', () => {
                    // Скрываем текст и кнопку
                    commentText.style.display = 'none';
                    editCommentBtn.style.display = 'none';

                    // Создаем поле редактирования
                    const editInput = createElement('textarea', 'comment-edit-input');
                    editInput.value = record.comment || '';
                    editInput.placeholder = 'Добавьте комментарий...';

                    const saveBtn = createElement('button', 'btn btn-primary btn-small', 'Сохранить');
                    const cancelBtn = createElement('button', 'btn btn-secondary btn-small', 'Отмена');

                    const controls = createElement('div', 'comment-edit-controls');
                    controls.append(saveBtn, cancelBtn);

                    commentSection.insertBefore(editInput, commentText);
                    commentSection.insertBefore(controls, commentText);

                    const stopEditing = () => {
                        editInput.remove();
                        controls.remove();
                        commentText.style.display = 'block';
                        editCommentBtn.style.display = 'block';
                    };

                    cancelBtn.addEventListener('click', stopEditing);

                    saveBtn.addEventListener('click', async () => {
                        const newComment = editInput.value.trim();
                        const journalRef = doc(getUserJournalCollection(), record.id);
                        try {
                            await updateDoc(journalRef, { comment: newComment });
                            showToast('Комментарий обновлен!');
                            stopEditing();
                            // Firebase listener обновит state.journal и вызовет render()
                        } catch (error) {
                            console.error('Ошибка обновления комментария:', error);
                            showToast('Не удалось обновить комментарий.');
                        }
                    });
                });
            } else {
                // Если комментария нет, просто показываем текст
                commentSection.append(commentText);
            }

            // Добавление секции комментария в конце записи (после упражнений)
            journalRecord.append(commentSection);

            journalList.append(journalRecord);
        });
    }

    contentContainer.append(journalList);
    root.append(contentContainer);
}

// =================================================================
// ⚙️ СЛУШАТЕЛИ FIREBASE (Управление динамическими коллекциями)
// =================================================================

function unsubscribeAll() {
    programsUnsubscribe();
    journalUnsubscribe();
    clientsUnsubscribe();
    cyclesUnsubscribe();
}

function setupDynamicListeners() {
    unsubscribeAll(); // Отписываемся от старых слушателей

    if (!userId) return;

    // 1. Всегда слушаем клиентов, если мы в режиме "Персональные"
    if (state.currentMode === 'personal') {
        clientsUnsubscribe = onSnapshot(getClientsCollection(), (snapshot) => {
            state.clients = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            // Перерисовываем только если мы на странице клиентов
            if (state.currentPage === 'programs' && state.selectedClientId === null) {
                render();
            }
        });
    } else {
        // Сброс клиентов, если не в режиме "Персональные"
        state.clients = [];
    }

    // 2. Слушаем циклы (если режим выбран)
    if (state.currentMode) {
        const shouldListenToCycles = state.currentMode === 'own' || state.selectedClientId;

        if (shouldListenToCycles) {
            cyclesUnsubscribe = onSnapshot(getUserCyclesCollection(), (snapshot) => {
                state.cycles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                // Перерисовываем, если мы на странице циклов
                if (state.currentPage === 'programs') {
                    render();
                }
            });
        }
    }


    // 3. Слушаем программы (если цикл выбран)
    if (state.selectedCycleId) {
        programsUnsubscribe = onSnapshot(getUserProgramsCollection(), (snapshot) => {
            state.programs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            // Перерисовываем, если мы на страницах программ
            if (state.currentPage === 'programsInCycle' || state.currentPage === 'programDetails') {
                render();
            }
        });
    } else {
        state.programs = [];
    }


    // 4. Слушаем журнал (если режим выбран)
    if (state.currentMode) {
        journalUnsubscribe = onSnapshot(getUserJournalCollection(), (snapshot) => {
            // Используем данные напрямую
            state.journal = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            if (state.currentPage === 'journal') {
                render();
            }
        });
    }
}




// =================================================================
// 🔄 ГЛАВНЫЙ РЕНДЕР: Определяет, что показать
// =================================================================

function render() {
    const root = document.getElementById('root');
    root.innerHTML = ''; // Очистка

    // Сначала убеждаемся, что видимость экранов установлена корректно
    toggleAppVisibility(!!userId);

    // Если нет userId (не авторизован) или режим не выбран - ничего не рендерим в root
    if (!userId || state.currentMode === null) return;

    // Теперь рендерим содержимое root в зависимости от state.currentPage
    if (state.currentPage === 'programs') {
        renderCyclesPage();
    } else if (state.currentPage === 'programsInCycle') {
        renderProgramsInCyclePage();
    } else if (state.currentPage === 'programDetails') {
        renderProgramDetailsPage();
    } else if (state.currentPage === 'journal') {
        renderJournalPage();
    }

    // Обновление активной кнопки в нижней навигации
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    const programsBtn = document.getElementById('programs-btn');
    const journalBtn = document.getElementById('journal-btn');

    if (programsBtn && (state.currentPage === 'programs' || state.currentPage === 'programsInCycle' || state.currentPage === 'programDetails')) {
        programsBtn.classList.add('active');
    } else if (journalBtn && state.currentPage === 'journal') {
        journalBtn.classList.add('active');
    }
}


// =================================================================
// 🔑 АУТЕНТИФИКАЦИЯ
// =================================================================

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

// 🔥 ОБНОВЛЕННЫЙ ОБРАБОТЧИК ДЛЯ КНОПКИ "ПРОГРАММЫ" (Обратная навигация из Дневника)
document.getElementById('programs-btn')?.addEventListener('click', () => {
    if (state.currentMode) {
        if (state.currentPage === 'journal') {
            // Если выходим из дневника, возвращаемся на предыдущую страницу
            state.currentPage = state.previousPage;
        } else {
            // Иначе (если мы уже в разделе программ), переходим к спискам циклов/клиентов
            state.currentPage = 'programs';
            state.selectedProgramIdForDetails = null; // Сбрасываем детали
        }
        render();
    }
});

// 🔥 ОБНОВЛЕННЫЙ ОБРАБОТЧИК ДЛЯ КНОПКИ "ДНЕВНИК" (Обратная навигация и запоминание)
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


// 🔥 НОВЫЕ ОБРАБОТЧИКИ ДЛЯ ЭКРАНА ВЫБОРА РЕЖИМА

document.getElementById('select-own-mode')?.addEventListener('click', () => {
    state.currentMode = 'own';
    state.currentPage = 'programs';
    setupDynamicListeners();
    render();
});

document.getElementById('select-personal-mode')?.addEventListener('click', () => {
    state.currentMode = 'personal';
    state.currentPage = 'programs';
    setupDynamicListeners();
    render();
});

// 🔥 Кнопка ВЫХОДА на экране выбора режима
document.getElementById('mode-logout-btn')?.addEventListener('click', async () => {
    try {
        await signOut(auth);
        state.currentMode = null;
        showToast('Вы вышли из системы.');
    } catch (error) {
        console.error("Ошибка при выходе:", error);
        showToast('Ошибка при выходе.');
    }
});


// =================================================================
// 🚀 ГЛАВНАЯ ТОЧКА ВХОДА (Проверка авторизации)
// =================================================================

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
