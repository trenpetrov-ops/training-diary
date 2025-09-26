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
                                         <button class="btn delete-btn">×</button>
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
                                         <button class="btn delete-btn">×</button>
                                         <button class="btn go-btn">→</button>
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

            const goBtn = cycleItem.querySelector('.go-btn');
            goBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                clickHandler();
            });

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
                exercises: []
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
                                         <button class="btn delete-btn">×</button>
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

    // ✅ ИСПРАВЛЕНИЕ 2: Обработчик клика для сброса режима редактирования (скрытие полей ввода)
    contentContainer.addEventListener('click', (e) => {
        // Проверяем, что клик не был сделан внутри элемента, который управляет редактированием
        if (!e.target.closest('.set-row') && state.editingSetId !== null) {
            // Если мы кликнули вне подхода и режим редактирования активен
            state.editingSetId = null;
            // Вызываем render, чтобы скрыть все поля ввода
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
                sets: [{ weight: '', reps: '' }]
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
            const exerciseItem = createElement('div', 'exercise-item');

            const exerciseHeader = createElement('div', `exercise-header ${isExpanded ? 'expanded' : ''}`);

            const exerciseTitle = createElement('div', 'exercise-title');
            const exerciseNumber = createElement('span', 'exercise-number', `${index + 1}.`);
            const exerciseName = createElement('span', 'exercise-name', exercise.name);

            exerciseTitle.append(exerciseNumber, exerciseName);

            const controlButtons = createElement('div', 'control-buttons');
            const deleteExerciseBtn = createElement('button', 'btn delete-exercise-btn', '×');

            controlButtons.append(deleteExerciseBtn);
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

                    // ✅ ИСПРАВЛЕНИЕ 1: Правильное удаление подхода
                    deleteSetBtn.addEventListener('click', async (e) => {
                        e.stopPropagation();
                        const currentProgram = state.programs.find(p => p.id === state.selectedProgramIdForDetails);
                        if (currentProgram) {
                            const currentExercise = (currentProgram.exercises || []).find(ex => ex.id === exercise.id);
                            if (currentExercise) {

                                // 1. Удаляем подход из массива данных упражнения
                                currentExercise.sets.splice(setIndex, 1);
                                state.editingSetId = null;

                                // 2. ПРАВИЛЬНОЕ ОБНОВЛЕНИЕ FIREBASE:
                                // Отправляем ВЕСЬ массив упражнений.
                                try {
                                    await updateDoc(doc(getUserProgramsCollection(), currentProgram.id), {
                                        exercises: currentProgram.exercises
                                    });
                                } catch (error) {
                                    console.error("Ошибка при удалении подхода:", error);
                                    showToast("Не удалось удалить подход.");
                                }

                                // render() будет вызван слушателем Firebase после обновления данных.
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

            exerciseItem.append(exerciseHeader, summarySetsContainer, setsContainer);
            exercisesListSection.append(exerciseItem);
        });
        contentContainer.append(exercisesListSection);
    }

    // -----------------------------------------------------------
    // 🔥 БЛОК КОММЕНТАРИЕВ К ТРЕНИРОВКЕ
    // -----------------------------------------------------------
    const commentWrapper = createElement('div', 'comment-wrapper');
    const commentBtn = createElement('button', 'btn comment-toggle-btn', '✏️ Добавить комментарий');
    const commentInput = createElement('textarea', 'comment-input');
    commentInput.placeholder = 'Введите комментарии к тренировке...';
    commentInput.style.display = 'none'; // Скрыто по умолчанию

    commentBtn.addEventListener('click', () => {
        const isVisible = commentInput.style.display !== 'none';
        commentInput.style.display = isVisible ? 'none' : 'block';
        commentBtn.innerText = isVisible ? '✏️ Добавить комментарий' : 'Скрыть комментарий';
    });

    commentWrapper.append(commentBtn, commentInput);
    contentContainer.append(commentWrapper);


    // -----------------------------------------------------------
    // КНОПКА ЗАВЕРШЕНИЯ ТРЕНИРОВКИ
    // -----------------------------------------------------------
    const completeTrainingBtn = createElement('button', 'btn complete-training-btn', 'Завершить тренировку');
    contentContainer.append(completeTrainingBtn);

    completeTrainingBtn.addEventListener('click', async () => {
        const trainingComment = document.querySelector('.comment-input').value.trim(); // Считываем комментарий
        const currentCycle = state.cycles.find(c => c.id === state.selectedCycleId);

        // 1. Фильтруем упражнения, оставляя только те, где есть подходы с данными
        const exercisesToSave = selectedProgram.exercises
            .filter(ex => ex.sets && ex.sets.some(set => set.weight || set.reps))
            .map(ex => ({
                // ✅ ИСПРАВЛЕНИЕ 3: Копируем весь объект упражнения и подходы
                ...ex,
                sets: (ex.sets || []).map(set => ({
                    weight: set.weight || '',
                    reps: set.reps || '',
                    note: set.note || ''
                }))
            }));

        // Если нет упражнений с данными, выдаем предупреждение
        if (exercisesToSave.length === 0) {
            showToast('Нечего сохранять: нет подходов с весом или повторениями!');
            return;
        }

        const trainingRecord = {
            date: new Date().toLocaleDateString('ru-RU'),
            time: new Date().toLocaleTimeString('ru-RU'),
            programName: selectedProgram.name,
            category: currentCycle ? currentCycle.name : selectedProgram.name,
            cycleName: currentCycle ? currentCycle.name : 'Без цикла',
            comment: trainingComment, // Сохраняем комментарий
            exercises: exercisesToSave // Используем отфильтрованный массив с полной структурой
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
        contentContainer.append(createElement('div', 'muted', 'Выберите цикл и тренировку , чтобы посмотреть записи.'));
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

            const deleteBtn = createElement('button', 'btn delete-btn', '×');
            deleteBtn.addEventListener('click', async () => {
                await deleteDoc(doc(getUserJournalCollection(), record.id));
            });

            journalHeader.append(dateText, deleteBtn);

            const programName = createElement('div', 'journal-program-name', `${record.programName}`);

            journalRecord.append(journalHeader, programName);

            // -----------------------------------------------------------
            // 🔥 УПРАЖНЕНИЯ (С НУМЕРАЦИЕЙ)
            // -----------------------------------------------------------
            (record.exercises || []).forEach((exercise, index) => {
                const exerciseRow = createElement('div', 'journal-exercise-row');

                // 🔥 Добавлена нумерация
                const exerciseName = createElement('div', 'journal-exercise-name', `${index + 1}. ${exercise.name}`);

                const setsContainer = createElement('div', 'journal-sets');

                // ✅ ИСПРАВЛЕНИЕ 3 (Проверка): Теперь sets должны быть массивом объектов
                (exercise.sets || []).forEach(set => {
                    // Используем строгие проверки на наличие данных
                    if (set.weight || set.reps) {
                        const setSpan = createElement('span', null, `${set.weight || '0'}x${set.reps || '0'}`);
                        setsContainer.append(setSpan);
                    }
                });

                exerciseRow.append(exerciseName, setsContainer);
                journalRecord.append(exerciseRow);
            });


            // -----------------------------------------------------------
            // 🔥 КОММЕНТАРИЙ ТРЕНИРОВКИ
            // -----------------------------------------------------------
            const commentSection = createElement('div', 'comment-section');
            const commentText = createElement('p', 'comment-text', record.comment || 'Нет комментария.');

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

            // 🔥 Добавление секции комментария в конце записи (после упражнений)
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
