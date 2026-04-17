import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { renderMealPage } from './pages/meal.js';
import { renderReportsPage } from './pages/reports.js';
import { renderProfilePage } from './pages/profile.js';
import { renderSupplementsPage } from './pages/supplement.js';
import { openPdfDateModal } from './pages/supplement.js';

import { openMealsPdfModal } from './pages/meal.js';
import { generateMealsPdf } from './pages/meal.js';
import { renderMealsReportPage } from './pages/meal.js';
import { destroyMealShellState, resetMealsState } from './pages/meal.js';

import { resolveSwipePanAxis } from './gestures.js';
import { attachSwipeRow, closeSwipeRowVisual } from './swipe-engine.js';

import { renderCycleReportPage } from './pages/supplement.js';
import { resetSupplementsListener } from './pages/supplement.js';
import {
    initBottomNav,
    syncBottomNavAfterRender,
    setBottomNavLayoutFromAppVisibility
} from './nav/bottom-nav.js';
// Чтобы отключить нижнее меню: замените импорт выше на './nav/bottom-nav.stub.js'
import {
    initializeAuth,
    browserLocalPersistence,
    indexedDBLocalPersistence,
    browserSessionPersistence,
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
    getDocs,
    getDoc,
    query,
    where,
    runTransaction,
    serverTimestamp,
    writeBatch
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

// ==========================================================
// 🚀 ИНИЦИАЛИЗАЦИЯ FIREBASE
// ==========================================================

const app = initializeApp(firebaseConfig);

const db = getFirestore(app);
const auth = initializeAuth(app, {
    persistence: [
        indexedDBLocalPersistence,
        browserLocalPersistence,
        browserSessionPersistence
    ],
    popupRedirectResolver: undefined
});
const storage = getStorage(app);

// ==========================================================
// 🧩 Глобальные переменные
// ==========================================================
    let userId = null;


// 🔥 НОВОЕ: Переменные для хранения функций отписки от слушателей Firebase
let programsUnsubscribe = () => {};
let journalUnsubscribe = () => {};
let clientsUnsubscribe = () => {};
let cyclesUnsubscribe = () => {};
let cyclesUnsubscribeTrainer = () => {};
let cyclesUnsubscribeClient = () => {};
let cyclesTrainerBuffer = [];
let cyclesClientBuffer = [];
let cyclesLinkKey = '';

const CODE_LOOKUP_WINDOW_MS = 60_000;
const CODE_LOOKUP_MAX = 20;
let codeLookupTimestamps = [];
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
    programDetailsOrigin: null,
    expandedExerciseId: null,
    editingSetId: null,
    lastClickedExerciseId: null,
    openSwipedExerciseId: null, // ID упражнения, у которого открыт свайп
    openSide: null, // 'left' или 'right'



    // Журнал
    selectedJournalCategory: '',
    selectedJournalProgram: '',

    // БАДы (План приема)
    supplementPlan: null, // Будет содержать текущий план для selectedCycleId

    // Отчеты
    reports: [],
    selectedReportId: null, // Для редактирования

    // 🍽️ ПИТАНИЕ 👇
    selectedFoods: new Set(),
    mealView: 'main',
    currentMealId: null,
    mealSearchTab: 'all',
    /** Вкладка «база»: английская (FatSecret) или заглушка «база пользователей». */
    mealSearchBaseMode: 'english',
    mealSearchSortByTab: {
    all: 'recentlyUsed',
    products: 'new',
    recipes: 'new'
    },
    mealSearchScrollByTab: { all: 0, products: 0, recipes: 0 },

    recipeFoodSearchQuery: '',
    recipeFoodSearchScrollTop: 0,
    createFoodBackTarget: null,
    recipeSelectedFoodId: null,

    // чтобы запомнить, какую программу мы хотим открыть после загрузки данных.
    openProgramAfterLoad: null,

    mealGoal: {
        calories: '',
        protein: 0,
        fat: 0,
        carbs: 0,
        mode: 'grams' // для sheet по умолчанию
    },
    mealGoalField: null,

    mealsData: {},
    selectedDate: null,
    reportHtmlCache: null,
    selectedJournalRecord: null,
    loadedClientIdForCycles: null,
    cyclesLoaded: false,

    userProfile: null,
    profileCabinetEditing: false,
    profileOriginPage: null,

    /** Снимок getBoundingClientRect карточек циклов до render() — для FLIP-анимации */
    cycleFlipPrevRects: null,

};
window.state = state;

// =================================================================
// Контекст: свой / персональный, клиент, цикл (цепочка без смешивания)
// =================================================================
function isOwnMode() {
    return state.currentMode === 'own';
}

function isPersonalMode() {
    return state.currentMode === 'personal';
}

function hasSelectedClient() {
    return !!state.selectedClientId;
}

function hasSelectedCycle() {
    return !!state.selectedCycleId;
}

function isClientContextReady() {
    if (!isPersonalMode()) return true;
    return hasSelectedClient();
}

function isCycleContextReady() {
    return hasSelectedCycle() && (isOwnMode() || hasSelectedClient());
}

function resetCycleScopedState() {
    resetSupplementsListener();
    resetMealsState();
    destroyMealShellState();

    state.selectedCycleId = null;

    state.selectedProgramIdForDetails = null;
    state.programDetailsOrigin = null;
    state.expandedExerciseId = null;
    state.editingSetId = null;
    state.lastClickedExerciseId = null;
    state.openSwipedExerciseId = null;
    state.openSide = null;

    state.supplementPlan = null;
    state._supplementSubscribed = false;

    state.reports = [];
    state.selectedReportId = null;
    state.programs = [];
    state.openProgramAfterLoad = null;
    state.reportHtmlCache = null;

    state.selectedFoods = new Set();
    state.mealView = 'main';
    state.currentMealId = null;
    state.mealSearchTab = 'all';
    state.mealSearchBaseMode = 'english';
    state.mealSearchSortByTab = { all: 'recentlyUsed', products: 'new', recipes: 'new' };
    state.mealSearchScrollByTab = { all: 0, products: 0, recipes: 0 };
    state.recipeFoodSearchQuery = '';
    state.recipeFoodSearchScrollTop = 0;
    state.createFoodBackTarget = null;
    state.recipeSelectedFoodId = null;
    state.mealGoal = { calories: '', protein: 0, fat: 0, carbs: 0, mode: 'grams' };
    state.mealGoalField = null;
    state.mealsData = {};
    state.selectedDate = null;
}

function resetClientScopedState() {
    resetCycleScopedState();
    state.selectedClientId = null;
    state.cycles = [];
    state.loadedClientIdForCycles = null;
    state.cyclesLoaded = false;
    state.journal = [];
    state.selectedJournalCategory = '';
    state.selectedJournalProgram = '';
    state.selectedJournalRecord = null;
}

function resetModeScopedState() {
    resetClientScopedState();
    state.previousPage = 'programs';
    state.lastProgramsPage = 'programs';
}


if (state.calendarYear === undefined) {
    const today = new Date();
    state.calendarYear = today.getFullYear();
    state.calendarMonth = today.getMonth();
}

// Запрещаем двойной тап увеличения
let lastTouchEnd = 0;
document.addEventListener('touchend', function (e) {
    const now = Date.now();

    if (now - lastTouchEnd <= 300) {
        if (e.cancelable) {
            e.preventDefault();
        }
    }

    lastTouchEnd = now;
}, { passive: false });

// Запрещаем щипок (pinch zoom)
document.addEventListener('gesturestart', function (e) {
    e.preventDefault();
}, { passive: false });




// === Таймер: ключ и хелперы хранения ===
    const TIMER_FLOAT_KEY = 'restTimerFloatingEnabled';

    function isFloatingEnabled() {
      return localStorage.getItem(TIMER_FLOAT_KEY) === '1';
    }
    function setFloatingEnabled(v) {
      localStorage.setItem(TIMER_FLOAT_KEY, v ? '1' : '0');
    }






export function showToast(message) {
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
window.showToast = showToast;



// 🔥 Управление видимостью трех основных экранов
function toggleAppVisibility(isAuthenticated) {
    const authScreen = document.getElementById('auth-screen');
    const modeSelectScreen = document.getElementById('mode-select-screen');
    const container = document.querySelector('.container');

    // Сброс всех экранов
    if (authScreen) authScreen.style.display = 'none';
    if (modeSelectScreen) modeSelectScreen.style.display = 'none';
    if (container) container.style.display = 'none';
    if (!isAuthenticated) {
        // 1. Не авторизован -> Показываем Auth
        if (authScreen) authScreen.style.display = 'flex';
        state.currentPage = 'auth';
        setBottomNavLayoutFromAppVisibility(false, false);
    } else if (isAuthenticated && state.currentMode === null) {
        // 2. Авторизован, но режим не выбран -> Показываем Mode Select
        if (modeSelectScreen) modeSelectScreen.style.display = 'flex';
        state.currentPage = 'modeSelect';
        setBottomNavLayoutFromAppVisibility(true, false);
    } else {
        // 3. Авторизован и режим выбран -> Показываем App Container
        if (container) container.style.display = 'block';
        setBottomNavLayoutFromAppVisibility(true, true);
    }
}


// --- ФУНКЦИИ FIREBASE ДЛЯ КОЛЛЕКЦИЙ ---

function getSelectedTrainerClientDoc() {
    if (state.currentMode !== 'personal' || !state.selectedClientId) return null;
    return state.clients?.find((c) => c.id === state.selectedClientId) || null;
}

function getActiveLinkedClientUid() {
    const c = getSelectedTrainerClientDoc();
    if (c?.linkedUserUid && c.linkStatus === 'active') return c.linkedUserUid;
    return null;
}

function selectedCycleUsesClientCanonical() {
    const cy = state.cycles?.find((x) => x.id === state.selectedCycleId);
    return !!cy?._firesAtClient;
}

// ✅ ЦИКЛЫ (при активной связи новые циклы создаются в каноне клиента)
function getUserCyclesCollection() {
    if (state.currentMode === 'own') {
        return collection(db, `artifacts/${appId}/users/${userId}/cycles`);
    }
    if (state.currentMode === 'personal' && state.selectedClientId) {
        const linked = getActiveLinkedClientUid();
        if (linked) {
            return collection(db, `artifacts/${appId}/users/${linked}/cycles`);
        }
        return collection(db, `artifacts/${appId}/users/${userId}/clients/${state.selectedClientId}/cycles`);
    }
    return null;
}

// ✅ ПРОГРАММЫ
function getUserProgramsCollection() {
    if (!state.selectedCycleId) return null;

    if (state.currentMode === 'own') {
        return collection(db, `artifacts/${appId}/users/${userId}/cycles/${state.selectedCycleId}/programs`);
    }
    if (state.currentMode === 'personal' && state.selectedClientId) {
        const linked = getActiveLinkedClientUid();
        if (linked && selectedCycleUsesClientCanonical()) {
            return collection(db, `artifacts/${appId}/users/${linked}/cycles/${state.selectedCycleId}/programs`);
        }
        return collection(db, `artifacts/${appId}/users/${userId}/clients/${state.selectedClientId}/cycles/${state.selectedCycleId}/programs`);
    }
    return null;
}

// ✅ ДНЕВНИК
function getUserJournalCollection() {
    if (state.currentMode === 'own') {
        return collection(db, `artifacts/${appId}/users/${userId}/journal`);
    }
    if (state.currentMode === 'personal' && state.selectedClientId) {
        const linked = getActiveLinkedClientUid();
        if (linked) {
            return collection(db, `artifacts/${appId}/users/${linked}/journal`);
        }
        return collection(db, `artifacts/${appId}/users/${userId}/clients/${state.selectedClientId}/journal`);
    }
    return null;
}

// ✅ КЛИЕНТЫ
function getClientsCollection() {
    return collection(db, `artifacts/${appId}/users/${userId}/clients`);
}




// 🔥 ДОБАВЛЕНО: Коллекция для планов БАДов
export function getCycleDocRef() {
    if (!state.selectedCycleId) return null;

    if (state.currentMode === 'own') {
        return doc(db, `artifacts/${appId}/users/${userId}/cycles/${state.selectedCycleId}`);
    }
    if (state.currentMode === 'personal' && state.selectedClientId) {
        const linked = getActiveLinkedClientUid();
        if (linked && selectedCycleUsesClientCanonical()) {
            return doc(db, `artifacts/${appId}/users/${linked}/cycles/${state.selectedCycleId}`);
        }
        return doc(db, `artifacts/${appId}/users/${userId}/clients/${state.selectedClientId}/cycles/${state.selectedCycleId}`);
    }

    return null;
}

/**
 * UID владельца библиотеки еды в Firestore.
 * Только auth.currentUser — путь должен совпадать с request.auth.uid в правилах (без фолбэка на userId).
 */
function getMealLibraryOwnerUid() {
    try {
        return auth.currentUser?.uid || null;
    } catch (_) {
        return null;
    }
}

/**
 * Ключ кэша библиотеки продуктов/рецептов.
 * Библиотека всегда у вошедшего пользователя (не к циклу и не к карточке клиента).
 */
export function getMealLibraryContextKey() {
    const uid = getMealLibraryOwnerUid();
    return uid ? `userLib:${uid}` : 'none';
}

/** Продукты текущего пользователя (вне цикла): artifacts/.../users/{uid}/mealLibraryFoods */
export function getMealLibraryFoodsCollection() {
    const uid = getMealLibraryOwnerUid();
    if (!uid) return null;
    return collection(doc(db, `artifacts/${appId}/users/${uid}`), 'mealLibraryFoods');
}

/** Рецепты текущего пользователя: artifacts/.../users/{uid}/mealLibraryRecipes */
export function getMealLibraryRecipesCollection() {
    const uid = getMealLibraryOwnerUid();
    if (!uid) return null;
    return collection(doc(db, `artifacts/${appId}/users/${uid}`), 'mealLibraryRecipes');
}

/** Общая база продуктов для всех авторизованных пользователей (копии из библиотек). */
export function getGlobalFoodCatalogCollection() {
    return collection(doc(db, `artifacts/${appId}`), 'globalFoodCatalog');
}

export function getCurrentAuthUid() {
    return auth.currentUser?.uid || null;
}



// 🔥 Коллекция для Отчетов, привязанная к циклу
export function getReportsCollection() {
    if (!state.selectedCycleId) return null;

    if (state.currentMode === 'own') {
        return collection(db, `artifacts/${appId}/users/${userId}/cycles/${state.selectedCycleId}/reports`);
    }
    if (state.currentMode === 'personal' && state.selectedClientId) {
        const linked = getActiveLinkedClientUid();
        if (linked && selectedCycleUsesClientCanonical()) {
            return collection(db, `artifacts/${appId}/users/${linked}/cycles/${state.selectedCycleId}/reports`);
        }
        return collection(db, `artifacts/${appId}/users/${userId}/clients/${state.selectedClientId}/cycles/${state.selectedCycleId}/reports`);
    }
    return null;
}






// --- БАЗОВЫЕ ФУНКЦИИ РЕНДЕРИНГА ---
export function createElement(tag, classes, innerText = '') {
    const el = document.createElement(tag);
    if (classes) {
        el.className = classes;
    }
    el.innerText = innerText;
    return el;
}
window.createElement = createElement;

// =================================================================
// 👤 Профиль пользователя (ФИО, дата рождения, публичный номер)
// =================================================================

function getUserAccountSettingsRef(uid) {
    return doc(db, 'artifacts', appId, 'users', uid, 'account', 'settings');
}

function getPublicUserCodeRef(code) {
    return doc(db, 'artifacts', appId, 'publicUserCodes', code);
}

export function generatePublicUserCode() {
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    const alnum = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let p1 = '';
    for (let i = 0; i < 6; i++) {
        const c = letters[Math.floor(Math.random() * 26)];
        p1 += Math.random() < 0.5 ? c.toUpperCase() : c;
    }
    const mid = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
    let suf = '';
    for (let i = 0; i < 6; i++) {
        const c = alnum[Math.floor(Math.random() * alnum.length)];
        suf += Math.random() < 0.5 ? c.toUpperCase() : c;
    }
    return `${p1}-${mid}-${suf}`;
}

export function normalizePublicCodeInput(raw) {
    return String(raw || '').trim().replace(/\s+/g, '');
}

function assertPublicCodeLookupAllowed() {
    const now = Date.now();
    codeLookupTimestamps = codeLookupTimestamps.filter((t) => now - t < CODE_LOOKUP_WINDOW_MS);
    if (codeLookupTimestamps.length >= CODE_LOOKUP_MAX) {
        throw new Error('Слишком много проверок номера. Подождите минуту.');
    }
    codeLookupTimestamps.push(now);
}

export async function resolvePublicCodeToUid(codeNormalized) {
    assertPublicCodeLookupAllowed();
    const ref = getPublicUserCodeRef(codeNormalized);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const uid = snap.data()?.uid;
    return typeof uid === 'string' && uid.length > 0 ? uid : null;
}

function getTrainerInvitesCollection(clientUid) {
    return collection(db, 'artifacts', appId, 'users', clientUid, 'trainerInvites');
}

function getLinkedTrainerDocRef(clientUid, trainerUid) {
    return doc(db, 'artifacts', appId, 'users', clientUid, 'linkedTrainers', trainerUid);
}

function mergeCyclesTrainerClientBuffers() {
    const map = new Map();
    for (const c of cyclesTrainerBuffer) {
        map.set(c.id, { ...c, _firesAtClient: false });
    }
    for (const c of cyclesClientBuffer) {
        map.set(c.id, { ...c, _firesAtClient: true });
    }
    state.cycles = Array.from(map.values());
}

async function syncTrainerClientCardsFromAcceptedInvites() {
    if (state.currentMode !== 'personal' || !userId) return;
    for (const c of state.clients || []) {
        if (c.linkStatus !== 'pending' || !c.inviteId || !c.linkedUserUid) continue;
        try {
            const invRef = doc(db, 'artifacts', appId, 'users', c.linkedUserUid, 'trainerInvites', c.inviteId);
            const inv = await getDoc(invRef);
            if (!inv.exists()) continue;
            const st = inv.data()?.status;
            if (st === 'accepted') {
                await updateDoc(doc(getClientsCollection(), c.id), { linkStatus: 'active' });
            } else if (st === 'rejected') {
                await deleteDoc(doc(getClientsCollection(), c.id));
            }
        } catch (e) {
            console.warn('sync invite', e);
        }
    }
}

async function createTrainerInviteByPublicCode(codeRaw) {
    const trainerUid = userId;
    if (!trainerUid) throw new Error('Не авторизован');
    const code = normalizePublicCodeInput(codeRaw);
    if (!code) throw new Error('Введите личный номер клиента');
    const clientUid = await resolvePublicCodeToUid(code);
    if (!clientUid) throw new Error('Номер не найден');
    if (clientUid === trainerUid) throw new Error('Нельзя добавить свой номер');

    let displayName = `Клиент ${code.replace(/-/g, '').slice(0, 10)}…`;
    try {
        const prof = await getDoc(getUserAccountSettingsRef(clientUid));
        if (prof.exists()) {
            const d = prof.data();
            const fn = [d.firstName, d.lastName].filter(Boolean).join(' ').trim();
            if (fn) displayName = fn;
        }
    } catch (_) {
        /* нет доступа к профилю до привязки — оставляем имя по номеру */
    }

    const clientsCol = getClientsCollection();
    const newCardRef = doc(clientsCol);
    const inviteRef = doc(getTrainerInvitesCollection(clientUid));
    const batch = writeBatch(db);
    batch.set(newCardRef, {
        name: displayName,
        linkedUserUid: clientUid,
        linkStatus: 'pending',
        inviteId: inviteRef.id,
        invitedPublicCode: code,
        createdAt: serverTimestamp()
    });
    batch.set(inviteRef, {
        trainerUid: trainerUid,
        trainerClientCardId: newCardRef.id,
        status: 'pending',
        createdAt: serverTimestamp()
    });
    await batch.commit();
}

export async function fetchPendingTrainerInvites() {
    if (!userId) return [];
    const invitesCol = collection(db, 'artifacts', appId, 'users', userId, 'trainerInvites');
    const q = query(invitesCol, where('status', '==', 'pending'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function acceptTrainerInviteClient(inviteId) {
    if (!userId) throw new Error('Не авторизован');
    const invRef = doc(db, 'artifacts', appId, 'users', userId, 'trainerInvites', inviteId);
    const snap = await getDoc(invRef);
    if (!snap.exists()) throw new Error('Приглашение не найдено');
    const data = snap.data();
    if (data.status !== 'pending') throw new Error('Приглашение уже обработано');
    const trainerUid = data.trainerUid;
    if (typeof trainerUid !== 'string' || !trainerUid) throw new Error('Некорректные данные приглашения');

    const batch = writeBatch(db);
    batch.update(invRef, { status: 'accepted', acceptedAt: serverTimestamp() });
    batch.set(getLinkedTrainerDocRef(userId, trainerUid), {
        active: true,
        trainerClientCardId: data.trainerClientCardId || '',
        linkedAt: serverTimestamp()
    });
    await batch.commit();
}

export async function rejectTrainerInviteClient(inviteId) {
    if (!userId) throw new Error('Не авторизован');
    const invRef = doc(db, 'artifacts', appId, 'users', userId, 'trainerInvites', inviteId);
    const snap = await getDoc(invRef);
    if (!snap.exists()) return;
    if (snap.data()?.status !== 'pending') return;
    await updateDoc(invRef, { status: 'rejected', rejectedAt: serverTimestamp() });
}

function openAddClientChoiceModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay-cicle modal-overlay-cicle--sheet';

    const modalContent = document.createElement('div');
    modalContent.className = 'modal-cicle modal-cicle--add-client';

    const title = createElement('h3', 'modal-cicle__title', 'Добавить клиента');
    const hint = createElement('div', 'modal-cicle__hint modal-hint--rich muted');
    hint.innerHTML =
        '<p><span class="modal-hint__badge">По номеру</span> Ученик в приложении — циклы и дневник общие после принятия приглашения.</p>' +
        '<p><span class="modal-hint__badge modal-hint__badge--soft">Только имя</span> Без приложения — карточка только у вас.</p>';

    const actions = document.createElement('div');
    actions.className = 'modal-cicle__actions modal-cicle__actions--stack';
    const byCode = createElement('button', 'btn btn-primary modal-cicle__action-btn', 'По личному номеру');
    const byName = createElement('button', 'btn btn-secondary modal-cicle__action-btn', 'Только имя (без приложения)');
    const cancel = createElement('button', 'btn cancel-btn modal-cicle__action-btn modal-cicle__action-btn--ghost', 'Отмена');
    actions.append(byCode, byName, cancel);

    const close = () => {
        if (modal.parentNode) document.body.removeChild(modal);
    };

    byCode.addEventListener('click', () => {
        close();
        openAddClientByPublicCodeModal();
    });
    byName.addEventListener('click', () => {
        close();
        openAddClientByNameModal();
    });
    cancel.addEventListener('click', close);

    modalContent.append(title, hint, actions);
    modal.append(modalContent);
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) close();
    });
}

function openAddClientByNameModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay-cicle modal-overlay-cicle--sheet';

    const modalContent = document.createElement('div');
    modalContent.className = 'modal-cicle modal-cicle--add-client';

    const title = createElement('h3', 'modal-cicle__title', 'Клиент только у вас');
    const hint = createElement('p', 'modal-cicle__hint muted');
    hint.textContent = 'Введите имя — карточка появится в списке без привязки к аккаунту ученика.';

    const field = document.createElement('div');
    field.className = 'modal-field';
    const fieldLabel = createElement('label', 'modal-field__label', 'Имя клиента');
    fieldLabel.htmlFor = 'add-client-by-name-input';
    const input = document.createElement('input');
    input.id = 'add-client-by-name-input';
    input.type = 'text';
    input.placeholder = 'Например: Мария';
    input.className = 'modal-input';
    field.append(fieldLabel, input);

    const btnRow = document.createElement('div');
    btnRow.className = 'modal-buttons modal-cicle__footer-actions';

    const cancelBtn = createElement('button', 'btn cancel-btn', 'Отмена');
    const saveBtn = createElement('button', 'btn btn-primary', 'Добавить');

    const close = () => {
        if (modal.parentNode) document.body.removeChild(modal);
    };

    cancelBtn.addEventListener('click', close);
    saveBtn.addEventListener('click', async () => {
        const name = input.value.trim();
        if (!name) {
            showToast('Введите имя клиента');
            return;
        }
        try {
            await addDoc(getClientsCollection(), { name, createdAt: Date.now() });
            showToast('Клиент добавлен');
            close();
            render();
        } catch (error) {
            console.error('add client', error);
            showToast('Ошибка сохранения. Проверьте правила Firebase.');
        }
    });

    btnRow.append(cancelBtn, saveBtn);
    modalContent.append(title, hint, field, btnRow);
    modal.append(modalContent);
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) close();
    });
    input.focus();
}

function openAddClientByPublicCodeModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay-cicle modal-overlay-cicle--sheet';

    const modalContent = document.createElement('div');
    modalContent.className = 'modal-cicle modal-cicle--add-client';

    const title = createElement('h3', 'modal-cicle__title', 'Добавить по личному номеру');

    const hint = createElement('p', 'modal-cicle__hint muted');
    hint.textContent =
        'Номер из профиля клиента в приложении. Он получит запрос в личном кабинете и сможет принять или отклонить связь.';

    const field = document.createElement('div');
    field.className = 'modal-field';
    const fieldLabel = createElement('label', 'modal-field__label', 'Личный номер');
    fieldLabel.htmlFor = 'add-client-by-code-input';
    const input = document.createElement('input');
    input.id = 'add-client-by-code-input';
    input.type = 'text';
    input.placeholder = 'AbCdEf-123456-a1B2c3';
    input.className = 'modal-input';
    input.autocomplete = 'off';
    field.append(fieldLabel, input);

    const btnGroup = document.createElement('div');
    btnGroup.className = 'modal-buttons modal-cicle__footer-actions';

    const cancelBtn = createElement('button', 'btn cancel-btn', 'Отмена');
    const confirmBtn = createElement('button', 'btn btn-primary', 'Отправить приглашение');

    const close = () => {
        if (modal.parentNode) document.body.removeChild(modal);
    };

    cancelBtn.addEventListener('click', close);
    confirmBtn.addEventListener('click', async () => {
        const raw = input.value;
        confirmBtn.disabled = true;
        try {
            await createTrainerInviteByPublicCode(raw);
            showToast('Приглашение отправлено');
            close();
            render();
        } catch (e) {
            console.error(e);
            showToast(e?.message || 'Не удалось отправить приглашение');
        } finally {
            confirmBtn.disabled = false;
        }
    });

    btnGroup.append(cancelBtn, confirmBtn);
    modalContent.append(title, hint, field, btnGroup);
    modal.append(modalContent);
    document.body.appendChild(modal);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) close();
    });

    input.focus();
}

export function buildPublicCodeVisualHTML(code) {
    if (!code || typeof code !== 'string') return '';
    const wrap = document.createElement('span');
    wrap.className = 'public-user-code-visual';
    let i = 0;
    for (const ch of code) {
        const span = document.createElement('span');
        span.className = 'public-user-code-char';
        span.textContent = ch;
        if (ch !== '-') {
            const h = (code.charCodeAt(i) * 13 + i * 7) % 1000;
            const scale = 0.88 + (h / 1000) * 0.32;
            span.style.fontSize = `${Math.round(24 * scale)}px`;
            span.style.fontWeight = h % 2 === 0 ? '600' : '800';
        } else {
            span.style.fontSize = '22px';
            span.style.opacity = '0.75';
            span.style.padding = '0 2px';
        }
        wrap.appendChild(span);
        i++;
    }
    return wrap.outerHTML;
}

export async function createUserProfileAndAssignCode(uid, profileFields, mergeBase = null) {
    const profileRef = getUserAccountSettingsRef(uid);
    const base = mergeBase && typeof mergeBase === 'object' ? { ...mergeBase } : {};
    delete base.publicCode;

    for (let attempt = 0; attempt < 50; attempt++) {
        const code = generatePublicUserCode();
        const codeRef = getPublicUserCodeRef(code);
        try {
            await runTransaction(db, async (transaction) => {
                const cSnap = await transaction.get(codeRef);
                if (cSnap.exists()) {
                    throw Object.assign(new Error('collision'), { _collision: true });
                }
                transaction.set(codeRef, {
                    uid,
                    assignedAt: serverTimestamp()
                });
                transaction.set(profileRef, {
                    ...base,
                    firstName: profileFields.firstName || '',
                    lastName: profileFields.lastName || '',
                    patronymic: profileFields.patronymic || '',
                    birthDate: profileFields.birthDate || '',
                    publicCode: code,
                    createdAt: base.createdAt || serverTimestamp(),
                    updatedAt: serverTimestamp()
                });
            });
            return code;
        } catch (e) {
            if (e && e._collision) continue;
            throw e;
        }
    }
    throw new Error('Не удалось создать уникальный номер. Попробуйте позже.');
}

export async function refreshUserProfileFromServer() {
    if (!userId) {
        state.userProfile = null;
        return null;
    }
    const ref = getUserAccountSettingsRef(userId);
    const snap = await getDoc(ref);
    state.userProfile = snap.exists() ? snap.data() : null;
    return state.userProfile;
}

export async function saveCabinetUserProfile(fields) {
    if (!userId) throw new Error('Не авторизован');
    const profileRef = getUserAccountSettingsRef(userId);
    const snap = await getDoc(profileRef);
    const existing = snap.exists() ? snap.data() : {};

    if (existing.publicCode) {
        await updateDoc(profileRef, {
            firstName: fields.firstName.trim(),
            lastName: fields.lastName.trim(),
            patronymic: (fields.patronymic || '').trim(),
            birthDate: fields.birthDate,
            updatedAt: serverTimestamp()
        });
        await refreshUserProfileFromServer();
        return { publicCode: existing.publicCode, wasNewCode: false };
    }

    const code = await createUserProfileAndAssignCode(userId, {
        firstName: fields.firstName.trim(),
        lastName: fields.lastName.trim(),
        patronymic: (fields.patronymic || '').trim(),
        birthDate: fields.birthDate
    }, existing);
    await refreshUserProfileFromServer();
    return { publicCode: code, wasNewCode: true };
}

function showPostRegistrationModal(publicCode) {
    const backdrop = createElement('div', 'modal-overlay post-registration-overlay');
    const box = createElement('div', 'modal-content post-registration-modal');

    const title = createElement('h3', 'post-registration-modal__title', 'Регистрация завершена');
    const text = createElement('p', 'muted post-registration-modal__text');
    text.innerHTML =
        'Аккаунт создан. Сохраните ваш <strong>личный номер</strong> — по нему тренер сможет пригласить вас в персональный режим.';

    const label = createElement('div', 'post-registration-modal__code-label', 'Ваш уникальный номер');

    const codeHost = document.createElement('div');
    codeHost.className = 'public-user-code-host post-registration-modal__code';
    codeHost.innerHTML = buildPublicCodeVisualHTML(publicCode);

    const copyBtn = createElement('button', 'btn btn-secondary post-registration-modal__btn', 'Скопировать номер');
    copyBtn.onclick = async () => {
        try {
            await navigator.clipboard.writeText(publicCode);
            showToast('Номер скопирован');
        } catch (_) {
            showToast('Не удалось скопировать');
        }
    };

    const ok = createElement('button', 'btn btn-primary post-registration-modal__btn post-registration-modal__btn--primary', 'Продолжить');
    ok.onclick = () => backdrop.remove();

    box.append(title, text, label, codeHost, copyBtn, ok);
    backdrop.append(box);
    document.body.append(backdrop);
    backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) backdrop.remove();
    });
}

export function syncAuthRegisterFieldsVisibility(isLoginMode) {
    const extra = document.getElementById('auth-register-extra');
    if (!extra) return;
    extra.hidden = !!isLoginMode;
    const screen = document.getElementById('auth-screen');
    const lede = document.getElementById('auth-lede');
    if (screen) screen.classList.toggle('auth-screen--register', !isLoginMode);
    if (lede) {
        lede.textContent = isLoginMode
            ? 'Войдите под своей учётной записью.'
            : 'Заполните данные — получите личный номер для связи с тренером.';
    }
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

// 🔧 Преобразование "ДД.ММ.ГГГГ" → Date
function parseDate(dateStr) {
  const [d, m, y] = dateStr.split('.').map(Number);
  return new Date(y, m - 1, d);
}


// Функция для генерации массива дат (например, на 7 или 14 дней)
export function generateDates(startDateString, numberOfDays) {
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
export function formatDayAndMonth(dateString) {
    const [day, month] = dateString.split('.');
    // Возвращаем ДД.ММ
    return `${day}.${month}`;
}


// Функция для получения сегодняшней даты в формате ДД.ММ.ГГГГ
export function getTodayDateString() {
    const today = new Date();
    const day = String(today.getDate()).padStart(2, '0');
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const year = today.getFullYear();
    return `${day}.${month}.${year}`;
}


// 🔥 НОВАЯ ФУНКЦИЯ: Преобразование ДД.ММ.ГГГГ в ГГГГ-ММ-ДД (для input type="date")
export function dateToInputFormat(dateString) {
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
        resetModeScopedState();
        state.currentMode = null;
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

            const pendingBadge =
                client.linkStatus === 'pending'
                    ? '<span class="muted" style="font-size:12px;margin-left:6px">ожидает ответа</span>'
                    : '';
            clientItem.innerHTML = `
                <div>${client.name}${pendingBadge}</div>
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
                    resetClientScopedState();
                    state.selectedClientId = client.id;
                    state.currentPage = 'programs';

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
    const addClientBtn = createElement('button', 'btn btn-primary add-client-btn');
    addClientBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"><title>Plus SVG Icon</title><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M12 20v-8m0 0V4m0 8h8m-8 0H4"/></svg>';

    addClientBtn.addEventListener('click', () => {
        openAddClientChoiceModal();
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
                resetClientScopedState();
                setupDynamicListeners();
                render();
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
// FLIP-анимация сетки циклов (перестановка без «рывка» и вылезания за экран)
// =================================================================
function captureCycleCardRectsForFlip() {
    const board = document.querySelector('#cycles-content .programs-list--cycles-board');
    if (!board) return null;
    const nodes = board.querySelectorAll('.cycle-card');
    if (!nodes.length) return null;
    const map = new Map();
    nodes.forEach((el) => {
        const r = el.getBoundingClientRect();
        map.set(el.dataset.id, { left: r.left, top: r.top, width: r.width, height: r.height });
    });
    return map;
}

function runCycleGridFlipAnimation(prevRects) {
    if (!prevRects || !prevRects.size) return;
    const board = document.querySelector('#cycles-content .programs-list--cycles-board');
    if (!board) return;
    const cards = [...board.querySelectorAll('.cycle-card')];
    if (!cards.length) return;

    board.classList.add('programs-list--cycles-board--flipping');

    let cleaned = false;
    const finishCleanup = () => {
        if (cleaned) return;
        cleaned = true;
        if (board.isConnected) board.classList.remove('programs-list--cycles-board--flipping');
        cards.forEach((el) => {
            if (!el.isConnected) return;
            el.style.transition = '';
            el.style.transform = '';
            el.style.opacity = '';
        });
    };

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const nextRects = new Map();
            cards.forEach((el) => {
                const r = el.getBoundingClientRect();
                nextRects.set(el.dataset.id, r);
            });

            cards.forEach((el) => {
                const id = el.dataset.id;
                const prev = prevRects.get(id);
                const next = nextRects.get(id);
                el.style.transition = 'none';
                if (prev && next) {
                    const dx = prev.left - next.left;
                    const dy = prev.top - next.top;
                    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
                        el.style.transform = `translate(${dx}px, ${dy}px)`;
                    }
                } else {
                    el.style.opacity = '0';
                    el.style.transform = 'translateY(14px)';
                }
            });

            requestAnimationFrame(() => {
                cards.forEach((el) => {
                    const id = el.dataset.id;
                    const hadPrev = prevRects.has(id);
                    el.style.transition = hadPrev
                        ? 'transform 0.48s cubic-bezier(0.22, 1, 0.32, 1), opacity 0.32s ease'
                        : 'transform 0.42s cubic-bezier(0.22, 1, 0.32, 1), opacity 0.42s ease';
                    el.style.transform = '';
                    el.style.opacity = '';
                });

                setTimeout(finishCleanup, 520);
            });
        });
    });
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
    // СПИСОК ЦИКЛОВ (активация цикла → меню; «Перейти к тренировкам» → список программ)
    // -----------------------------------------------------------
    const cyclesList = createElement('div', 'programs-list programs-list--cycles-board list-section');

    if (state.cycles.length === 0) {
        cyclesList.append(createElement('div', 'muted', 'Нет циклов. Создайте первый!'));
    } else {
        state.cycles.forEach((cycle) => {
            const cycleItem = createElement('div', 'list-item program-item cycle-card');
            cycleItem.dataset.id = cycle.id;
            const isActive = state.selectedCycleId === cycle.id;
            if (isActive) cycleItem.classList.add('cycle-card--active');

            const headerRow = createElement('div', 'cycle-card-header');
            const titleEl = createElement('div', 'cycle-card-title');
            titleEl.innerHTML = `${cycle.name} <small class="muted">(${cycle.startDateString || '—'})</small>`;
            titleEl.addEventListener('click', (e) => {
                if (state.selectedCycleId === cycle.id) {
                    e.stopPropagation();
                    state.currentPage = 'programsInCycle';
                    state.lastProgramsPage = 'programsInCycle';
                    render();
                }
            });

            const menuBtn = createElement('button', 'btn menu-btn');
            menuBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>`;
            menuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openCycleMenuModal(cycle);
            });
            headerRow.append(titleEl, menuBtn);
            cycleItem.append(headerRow);

            if (isActive) {
                const expand = createElement('div', 'cycle-card-expand');
                const goBtn = createElement('button', 'btn btn-primary cycle-goto-programs-btn', 'Перейти к тренировкам');
                goBtn.innerHTML = `<span>Перейти к тренировкам</span>
                                    <span>
                                       <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><title>Arrow-drop-right-line SVG Icon</title><path fill="currentColor" d="M12.172 12L9.343 9.173l1.415-1.414L15 12l-4.242 4.242l-1.415-1.414z"></path></svg>
                                    </span>
                                    `;
                goBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    state.currentPage = 'programsInCycle';
                    state.lastProgramsPage = 'programsInCycle';
                    render();
                });
                expand.appendChild(goBtn);
                cycleItem.appendChild(expand);
            }

            cycleItem.addEventListener('click', (e) => {
                if (e.target.closest('.menu-btn')) return;
                if (e.target.closest('.cycle-goto-programs-btn')) return;

                if (state.selectedCycleId === cycle.id) {
                    state.cycleFlipPrevRects = captureCycleCardRectsForFlip();
                    resetCycleScopedState();
                    state.selectedJournalCategory = '';
                    state.loadedClientIdForCycles = null;
                    setupDynamicListeners();
                    render();
                    return;
                }

                state.cycleFlipPrevRects = captureCycleCardRectsForFlip();
                state.selectedCycleId = cycle.id;
                state.selectedJournalCategory = cycle.name || '';
                setupDynamicListeners();
                render();
            });

            cyclesList.append(cycleItem);
        });
    }

    // -----------------------------------------------------------
    // Кнопка "Добавить цикл"
    // -----------------------------------------------------------
    const addCycleBtn = createElement('button', 'btn btn-primary add-cycle-btn add-cycle-btn--fullrow');
    addCycleBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 14 14"><title>Add-1-solid SVG Icon</title><path fill="currentColor" fill-rule="evenodd" d="M8 1a1 1 0 0 0-2 0v5H1a1 1 0 0 0 0 2h5v5a1 1 0 1 0 2 0V8h5a1 1 0 1 0 0-2H8z" clip-rule="evenodd"></path></svg>';

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
    const rootEl = document.getElementById('root');
    rootEl.append(contentContainer);

    const flipPrev = state.cycleFlipPrevRects;
    state.cycleFlipPrevRects = null;
    if (flipPrev && flipPrev.size) {
        runCycleGridFlipAnimation(flipPrev);
    }
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
    editBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24"><title>Edit SVG Icon</title><path fill="currentColor" d="M3.548 20.938h16.9a.5.5 0 0 0 0-1h-16.9a.5.5 0 0 0 0 1M9.71 17.18a2.587 2.587 0 0 0 1.12-.65l9.54-9.54a1.75 1.75 0 0 0 0-2.47l-.94-.93a1.788 1.788 0 0 0-2.47 0l-9.54 9.53a2.473 2.473 0 0 0-.64 1.12L6.04 17a.737.737 0 0 0 .19.72a.767.767 0 0 0 .53.22Zm.41-1.36a1.468 1.468 0 0 1-.67.39l-.97.26l-1-1l.26-.97a1.521 1.521 0 0 1 .39-.67l.38-.37l1.99 1.99Zm1.09-1.08l-1.99-1.99l6.73-6.73l1.99 1.99Zm8.45-8.45L18.65 7.3l-1.99-1.99l1.01-1.02a.748.748 0 0 1 1.06 0l.93.94a.754.754 0 0 1 0 1.06"></path></svg>';
    editBtn.addEventListener('click', () => {
        document.body.removeChild(modal);
        openEditCycleModal(cycle);
    });

    // Кнопка "Удалить"
    const deleteBtn = createElement('button', 'btn cancel-btn');
    deleteBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><title>Trash-24 SVG Icon</title><path fill="currentColor" d="M16 1.75V3h5.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H8V1.75C8 .784 8.784 0 9.75 0h4.5C15.216 0 16 .784 16 1.75m-6.5 0V3h5V1.75a.25.25 0 0 0-.25-.25h-4.5a.25.25 0 0 0-.25.25M4.997 6.178a.75.75 0 1 0-1.493.144L4.916 20.92a1.75 1.75 0 0 0 1.742 1.58h10.684a1.75 1.75 0 0 0 1.742-1.581l1.413-14.597a.75.75 0 0 0-1.494-.144l-1.412 14.596a.25.25 0 0 1-.249.226H6.658a.25.25 0 0 1-.249-.226z"></path><path fill="currentColor" d="M9.206 7.501a.75.75 0 0 1 .793.705l.5 8.5A.75.75 0 1 1 9 16.794l-.5-8.5a.75.75 0 0 1 .705-.793Zm6.293.793A.75.75 0 1 0 14 8.206l-.5 8.5a.75.75 0 0 0 1.498.088l.5-8.5Z"></path></svg>';
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
                    state.programDetailsOrigin = 'programsInCycle';
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
    const addProgramBtn = createElement('button', 'btn btn-primary add-program-btn');
    addProgramBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 14 14"><title>Add-1-solid SVG Icon</title><path fill="currentColor" fill-rule="evenodd" d="M8 1a1 1 0 0 0-2 0v5H1a1 1 0 0 0 0 2h5v5a1 1 0 1 0 2 0V8h5a1 1 0 1 0 0-2H8z" clip-rule="evenodd"></path></svg>';
    addProgramBtn.addEventListener('click', () => {
        openAddProgramModal(
            async (name) => {
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
            },
            async (programCopy) => {
                try {
                    await addDoc(getUserProgramsCollection(), programCopy);
                    showToast('Программа скопирована');
                } catch (error) {
                    console.error("Ошибка при копировании программы:", error);
                    showToast('Ошибка копирования. Проверьте правила Firebase!');
                }
            }
        );
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
    editBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24"><title>Edit SVG Icon</title><path fill="currentColor" d="M3.548 20.938h16.9a.5.5 0 0 0 0-1h-16.9a.5.5 0 0 0 0 1M9.71 17.18a2.587 2.587 0 0 0 1.12-.65l9.54-9.54a1.75 1.75 0 0 0 0-2.47l-.94-.93a1.788 1.788 0 0 0-2.47 0l-9.54 9.53a2.473 2.473 0 0 0-.64 1.12L6.04 17a.737.737 0 0 0 .19.72a.767.767 0 0 0 .53.22Zm.41-1.36a1.468 1.468 0 0 1-.67.39l-.97.26l-1-1l.26-.97a1.521 1.521 0 0 1 .39-.67l.38-.37l1.99 1.99Zm1.09-1.08l-1.99-1.99l6.73-6.73l1.99 1.99Zm8.45-8.45L18.65 7.3l-1.99-1.99l1.01-1.02a.748.748 0 0 1 1.06 0l.93.94a.754.754 0 0 1 0 1.06"></path></svg>';
    editBtn.addEventListener('click', () => {
        document.body.removeChild(modal);
        openEditProgramModal(program);
    });

    // Удалить
    const deleteBtn = createElement('button', 'btn cancel-btn');
    deleteBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><title>Trash-24 SVG Icon</title><path fill="currentColor" d="M16 1.75V3h5.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H8V1.75C8 .784 8.784 0 9.75 0h4.5C15.216 0 16 .784 16 1.75m-6.5 0V3h5V1.75a.25.25 0 0 0-.25-.25h-4.5a.25.25 0 0 0-.25.25M4.997 6.178a.75.75 0 1 0-1.493.144L4.916 20.92a1.75 1.75 0 0 0 1.742 1.58h10.684a1.75 1.75 0 0 0 1.742-1.581l1.413-14.597a.75.75 0 0 0-1.494-.144l-1.412 14.596a.25.25 0 0 1-.249.226H6.658a.25.25 0 0 1-.249-.226z"></path><path fill="currentColor" d="M9.206 7.501a.75.75 0 0 1 .793.705l.5 8.5A.75.75 0 1 1 9 16.794l-.5-8.5a.75.75 0 0 1 .705-.793Zm6.293.793A.75.75 0 1 0 14 8.206l-.5 8.5a.75.75 0 0 0 1.498.088l.5-8.5Z"></path></svg>';
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
function openAddProgramModal(onConfirmNew, onConfirmCopy) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay-cicle modal-overlay-cicle--sheet';

    const modalContent = document.createElement('div');
    modalContent.className = 'modal-cicle modal-cicle--add-program';

    const title = createElement('h3', 'modal-cicle__title', 'Добавить новую программу');

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'Введите название программы...';
    nameInput.className = 'modal-input';

    const divider = createElement('div', 'add-program-section-label', 'Перенос программы из другого цикла');

    let selectedCycleId = '';
    let selectedProgramId = '';
    let loadedPrograms = [];

    // --- Custom cycle dropdown ---
    const cycleRow = createElement('div', 'add-program-dropdown-row');
    const cycleText = createElement('span', 'add-program-dropdown-text', 'Выберите цикл');
    const cycleArrow = createElement('span', 'cycle-label-arrow', '▾');
    cycleRow.append(cycleText, cycleArrow);

    const cycleDropdown = createElement('div', 'add-program-dropdown-list');
    (state.cycles || []).forEach(cycle => {
        if (cycle.id === state.selectedCycleId) return;
        const item = createElement('div', 'add-program-dropdown-item', cycle.name);
        item.dataset.id = cycle.id;
        cycleDropdown.append(item);
    });

    const cycleWrap = createElement('div', 'add-program-dropdown-wrap');
    cycleWrap.append(cycleRow, cycleDropdown);

    // --- Custom program dropdown ---
    const programRow = createElement('div', 'add-program-dropdown-row add-program-dropdown-row--disabled');
    const programText = createElement('span', 'add-program-dropdown-text', 'Выберите программу');
    const programArrow = createElement('span', 'cycle-label-arrow', '▾');
    programRow.append(programText, programArrow);

    const programDropdown = createElement('div', 'add-program-dropdown-list');
    const programWrap = createElement('div', 'add-program-dropdown-wrap');
    programWrap.append(programRow, programDropdown);

    const confirmBtn = createElement('button', 'btn btn-primary add-program-confirm-btn', 'Добавить');
    confirmBtn.disabled = true;
    const cancelBtn = createElement('button', 'btn add-program-cancel-btn', 'Отмена');

    function closeAllDropdowns() {
        cycleDropdown.classList.remove('open');
        cycleArrow.classList.remove('open');
        programDropdown.classList.remove('open');
        programArrow.classList.remove('open');
    }

    function updateConfirmState() {
        const hasName = nameInput.value.trim().length > 0;
        const hasCopy = selectedCycleId && selectedProgramId;
        confirmBtn.disabled = !hasName && !hasCopy;
        confirmBtn.classList.toggle('disabled', confirmBtn.disabled);
    }

    function resetCopySelection() {
        selectedCycleId = '';
        selectedProgramId = '';
        loadedPrograms = [];
        cycleText.textContent = 'Выберите цикл';
        cycleText.classList.remove('add-program-dropdown-text--active');
        cycleDropdown.querySelectorAll('.add-program-dropdown-item').forEach(i => i.classList.remove('active'));
        programText.textContent = 'Выберите программу';
        programText.classList.remove('add-program-dropdown-text--active');
        programRow.classList.add('add-program-dropdown-row--disabled');
        programDropdown.innerHTML = '';
        closeAllDropdowns();
    }

    nameInput.addEventListener('input', () => {
        if (nameInput.value.trim().length > 0) {
            resetCopySelection();
        }
        updateConfirmState();
    });

    cycleRow.addEventListener('click', (e) => {
        e.stopPropagation();
        if (nameInput.value.trim().length > 0) {
            nameInput.value = '';
            updateConfirmState();
        }
        programDropdown.classList.remove('open');
        programArrow.classList.remove('open');
        cycleDropdown.classList.toggle('open');
        cycleArrow.classList.toggle('open');
    });

    cycleDropdown.addEventListener('click', async (e) => {
        e.stopPropagation();
        const item = e.target.closest('.add-program-dropdown-item');
        if (!item) return;

        selectedCycleId = item.dataset.id;
        cycleText.textContent = item.textContent;
        cycleText.classList.add('add-program-dropdown-text--active');
        cycleDropdown.querySelectorAll('.add-program-dropdown-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        closeAllDropdowns();

        nameInput.value = '';
        selectedProgramId = '';
        programText.textContent = 'Загрузка…';
        programText.classList.remove('add-program-dropdown-text--active');
        programRow.classList.add('add-program-dropdown-row--disabled');
        programDropdown.innerHTML = '';
        loadedPrograms = [];

        try {
            let programsRef;
            if (state.currentMode === 'own') {
                programsRef = collection(db, `artifacts/${appId}/users/${userId}/cycles/${selectedCycleId}/programs`);
            } else if (state.currentMode === 'personal' && state.selectedClientId) {
                const linked = getActiveLinkedClientUid();
                const cy = state.cycles?.find(c => c.id === selectedCycleId);
                if (linked && cy?._firesAtClient) {
                    programsRef = collection(db, `artifacts/${appId}/users/${linked}/cycles/${selectedCycleId}/programs`);
                } else {
                    programsRef = collection(db, `artifacts/${appId}/users/${userId}/clients/${state.selectedClientId}/cycles/${selectedCycleId}/programs`);
                }
            }

            if (!programsRef) {
                programText.textContent = 'Выберите программу';
                updateConfirmState();
                return;
            }

            const snap = await getDocs(programsRef);
            loadedPrograms = snap.docs.map(d => ({ id: d.id, ...d.data() }));

            if (loadedPrograms.length === 0) {
                programText.textContent = 'Нет программ';
                updateConfirmState();
                return;
            }

            programDropdown.innerHTML = '';
            loadedPrograms.forEach(prog => {
                const pi = createElement('div', 'add-program-dropdown-item', prog.name || 'Без названия');
                pi.dataset.id = prog.id;
                programDropdown.append(pi);
            });
            programText.textContent = 'Выберите программу';
            programRow.classList.remove('add-program-dropdown-row--disabled');
        } catch (err) {
            console.error('Ошибка загрузки программ цикла:', err);
            showToast('Не удалось загрузить программы');
            programText.textContent = 'Ошибка загрузки';
        }
        updateConfirmState();
    });

    programRow.addEventListener('click', (e) => {
        e.stopPropagation();
        if (programRow.classList.contains('add-program-dropdown-row--disabled')) return;
        cycleDropdown.classList.remove('open');
        cycleArrow.classList.remove('open');
        programDropdown.classList.toggle('open');
        programArrow.classList.toggle('open');
    });

    programDropdown.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = e.target.closest('.add-program-dropdown-item');
        if (!item) return;

        selectedProgramId = item.dataset.id;
        programText.textContent = item.textContent;
        programText.classList.add('add-program-dropdown-text--active');
        programDropdown.querySelectorAll('.add-program-dropdown-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
        closeAllDropdowns();
        updateConfirmState();
    });

    confirmBtn.addEventListener('click', async () => {
        if (confirmBtn.disabled) return;
        confirmBtn.disabled = true;

        const name = nameInput.value.trim();
        if (name) {
            await onConfirmNew(name);
            modal.remove();
            return;
        }

        const program = loadedPrograms.find(p => p.id === selectedProgramId);
        if (!program) {
            showToast('Программа не найдена');
            confirmBtn.disabled = false;
            return;
        }

        const programCopy = {
            name: program.name || 'Без названия',
            exercises: Array.isArray(program.exercises)
                ? program.exercises.map(ex => ({
                    ...ex,
                    sets: Array.isArray(ex.sets) ? ex.sets.map(s => ({ ...s })) : []
                }))
                : [],
            trainingNote: program.trainingNote || ''
        };

        await onConfirmCopy(programCopy);
        modal.remove();
    });

    cancelBtn.addEventListener('click', () => {
        modal.remove();
    });

    const btnGroup = createElement('div', 'add-program-actions');
    btnGroup.append(cancelBtn, confirmBtn);

    modalContent.append(title, nameInput, divider, cycleWrap, programWrap, btnGroup);
    modal.append(modalContent);
    document.body.appendChild(modal);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
        else if (!e.target.closest('.add-program-dropdown-wrap')) closeAllDropdowns();
    });

    nameInput.focus();
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

       <svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 56 56"><title>Camera-on-rectangle SVG Icon</title><path fill="currentColor" d="M6.155 41.944h3.763V47c0 4.038 2.078 6.076 6.155 6.076h33.772C53.922 53.076 56 51.038 56 47V26.479c0-4.038-2.078-6.077-6.155-6.077H45.26c-1.53 0-2-.294-2.882-1.293l-.313-.334v-4.312c0-4.038-2.059-6.076-6.135-6.076H6.155C2.058 8.387 0 10.425 0 14.463v21.424c0 4.038 2.058 6.057 6.155 6.057m.058-3.156c-1.96 0-3.057-1.039-3.057-3.077V14.64c0-2.039 1.097-3.097 3.057-3.097H35.87c1.94 0 3.038 1.058 3.038 3.097v1.372c-.568-.216-1.235-.314-2.098-.314h-7.82c-2.019 0-3.019.588-3.999 1.666l-1.587 1.745c-.863.98-1.353 1.293-2.882 1.293h-4.45c-4.076 0-6.154 2.039-6.154 6.077v12.309Zm9.919 11.133c-1.94 0-3.058-1.058-3.058-3.096v-20.19c0-2.019 1.117-3.077 3.058-3.077h5.174c1.764 0 2.725-.333 3.685-1.43l1.549-1.706c1.117-1.255 1.685-1.568 3.43-1.568h5.86c1.726 0 2.294.314 3.43 1.568l1.53 1.705c.98 1.098 1.92 1.431 3.685 1.431h5.312c1.94 0 3.057 1.058 3.057 3.077v20.19c0 2.038-1.117 3.096-3.057 3.096Zm16.837-3.136c5.92 0 10.682-4.743 10.682-10.721c0-5.96-4.743-10.703-10.682-10.703a10.654 10.654 0 0 0-10.702 10.702c0 5.979 4.763 10.722 10.702 10.722m14.073-15.504c1.333 0 2.43-1.078 2.43-2.411a2.43 2.43 0 1 0-4.86 0c0 1.333 1.097 2.41 2.43 2.41M32.97 43.806a7.734 7.734 0 0 1-7.742-7.742c0-4.293 3.469-7.723 7.742-7.723a7.7 7.7 0 0 1 7.722 7.722a7.704 7.704 0 0 1-7.722 7.743"/></svg>
    <span class="add-media-text">Добавить медиа</span>
   `;
   addMediaBtn.addEventListener('click', () => fileInput.click());


    // Обработка выбора файла
fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  // === Создаём прогресс-бар ===
  const progressWrap = document.createElement('div');
  progressWrap.className = 'upload-progress-wrap';
  const progressBar = document.createElement('div');
  progressBar.className = 'upload-progress-bar';
  progressWrap.append(progressBar);
  mediaContainer.append(progressWrap);

  try {
    // === Реальная загрузка с Cloudinary ===
    const url = await uploadFileToCloudinaryWithProgress(file, (percent) => {
      progressBar.style.width = percent + '%';
      progressBar.textContent = percent + '%'; // можно убрать, если не хочешь текст
      console.log('🟢 Реальный прогресс:', percent);
    });

    // === Добавляем медиа ===
    const type = file.type.startsWith('video') ? 'video' : 'photo';
    media.push({ url, type });
    renderMediaPreview(mediaContainer, media);

    // === Показываем уведомление ===
    showToast('Медиа загружено');

    // === Удаляем прогресс после короткой паузы ===
    setTimeout(() => progressWrap.remove(), 1000);
  } catch (err) {
    console.error('❌ Ошибка загрузки:', err);
    showToast('❌ Ошибка загрузки', 'error');
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


// -----------------------------------------------------------
// Дополнительно: нужна функция загрузки с прогрессом
// -----------------------------------------------------------
async function uploadFileToCloudinaryWithProgress(file, onProgress) {
  const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/upload`;
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

  const res = await axios.post(url, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (event) => {
      if (event.total && typeof onProgress === 'function') {
        const percent = Math.round((event.loaded * 100) / event.total);
        onProgress(percent);
      }
    },
  });

  onProgress(100);
  return res.data.secure_url;
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
        const delBtn = createElement('button', 'btn delete-media-btn');
           delBtn.innerHTML = `
                        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24">
                          <path fill="currentColor" d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59L7.11 5.7A1 1 0 1 0 5.7 7.11L10.59 12L5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4z"></path>
                        </svg>
           `;


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


// ===============================
// ✅ Новый менеджер свайпа
// ===============================
// ===============================
// ✅ Глобальный менеджер свайпов
// ===============================
let __openSwipeRoot = null;

function __closeSwipe(swipeRoot) {
  if (!swipeRoot) return;
  closeSwipeRowVisual(swipeRoot, () => {});
  swipeRoot.classList.remove('open-left', 'open-right');

  if (__openSwipeRoot === swipeRoot) __openSwipeRoot = null;
}

function closeAllSwipes() {
  __closeSwipe(__openSwipeRoot);
}

// Закрываем свайпы при любом клике вне
document.addEventListener('pointerdown', (e) => {
  if (!__openSwipeRoot) return;
  const path = e.composedPath ? e.composedPath() : [];
  if (!path.includes(__openSwipeRoot)) {
    __closeSwipe(__openSwipeRoot);
    e.stopPropagation();
  }
}, true);

// ===============================
// ✅ Подключение свайпа
// ===============================
function attachSwipeActions(swipeRoot, selectedProgram, exercise) {
  const content = swipeRoot.querySelector('.swipe-content');
  const rightActions = swipeRoot.querySelector('.swipe-actions.right');
  if (!content) return;

  const MAX_RIGHT = rightActions ? rightActions.offsetWidth || 120 : 120;

  rightActions?.querySelector('.action-edit')?.addEventListener('click', (e) => {
    e.stopPropagation();
    closeSwipeRowVisual(swipeRoot, () => {});
    openEditExerciseModal(selectedProgram, exercise);
  });

  rightActions?.querySelector('.action-delete')?.addEventListener('click', (e) => {
    e.stopPropagation();
    closeSwipeRowVisual(swipeRoot, () => {});
    openConfirmModal('Удалить упражнение?', async () => {
      const progRef = doc(getUserProgramsCollection(), selectedProgram.id);
      const filtered = selectedProgram.exercises.filter(ex => ex.id !== exercise.id);
      await updateDoc(progRef, { exercises: filtered });
      render();
    });
  });

  if (swipeRoot.dataset.exerciseSwipeBound === '1') return;
  swipeRoot.dataset.exerciseSwipeBound = '1';

  attachSwipeRow({
    swipeRoot,
    contentEl: content,
    maxSwipe: MAX_RIGHT,
    rootSelectorForSameType: '.exercise-swipe',
    onSwipeActiveVisual: null,
    onSwipeClosedVisual: null,
    onBeforeOpen: null,
    addDocumentClickOutside: true
  });
}


// ===============================
// === done при свапе по подходу
// ===============================


function enableSwipeDone(setRow, set) {
    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let isSwipe = false;
    let dragged = false;
    let panAxis = null;

    setRow.addEventListener("touchstart", (e) => {
        if (!e.touches || !e.touches.length) return;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        currentX = startX;
        isSwipe = true;
        dragged = false;
        panAxis = null;
    });

    setRow.addEventListener("touchmove", (e) => {
        if (!isSwipe || !e.touches || !e.touches.length) return;

        currentX = e.touches[0].clientX;
        const deltaX = currentX - startX;
        const deltaY = e.touches[0].clientY - startY;

        if (!panAxis) {
            panAxis = resolveSwipePanAxis(deltaX, deltaY);
            if (panAxis == null) return;
            if (panAxis === "y") {
                isSwipe = false;
                return;
            }
        }

        if (panAxis !== "x") return;

        if (e.cancelable) e.preventDefault();

        const diff = deltaX;
        if (Math.abs(diff) > 10) {
            setRow.style.transform = `translateX(${diff * 0.3}px)`;
            dragged = true;
        }
    }, { passive: false });

    setRow.addEventListener("touchend", (e) => {
        panAxis = null;
        if (!isSwipe) return;
        isSwipe = false;

        const diff = (e.changedTouches && e.changedTouches[0]
            ? e.changedTouches[0].clientX
            : currentX) - startX;

        if (Math.abs(diff) > 45) {
            set.done = !set.done;
            setRow.classList.toggle("done", set.done);
        }

        setRow.style.transform = "translateX(0)";

        if (dragged) {
            setRow._preventClick = true;
            setTimeout(() => { setRow._preventClick = false; }, 120);
        }
    });
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
            exerciseItem.dataset.exId = exercise.id;

            // 1. — СОЗДАЁМ HEADER (но НЕ добавляем в DOM напрямую)
            const exerciseHeader = createElement('div', `exercise-header ${isExpanded ? 'expanded' : ''}`);

exerciseHeader.addEventListener('click', () => {
    state.expandedExerciseId =
        state.expandedExerciseId === exercise.id ? null : exercise.id;

    render();
});


            const exerciseTitle = createElement('div', 'exercise-title');
            exerciseTitle.append(
                createElement('span', 'exercise-number', `${index + 1}.`),
                createElement('span', 'exercise-name', exercise.name)
            );


const editNoteBtn = createElement('button', `btn edit-note-btn ${hasNote ? 'has-note' : ''}`);
            // карандаш — оставляю твой SVG как есть
            editNoteBtn.innerHTML = `
               <svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><title>Ios-more-outline SVG Icon</title><path d="M256 238c9.9 0 18 8.1 18 18s-8.1 18-18 18-18-8.1-18-18 8.1-18 18-18m0-14c-17.7 0-32 14.3-32 32s14.3 32 32 32 32-14.3 32-32-14.3-32-32-32z" fill="currentColor"/><path d="M128.4 238c9.9 0 18 8.1 18 18s-8.1 18-18 18-18-8.1-18-18 8.1-18 18-18m0-14c-17.7 0-32 14.3-32 32s14.3 32 32 32 32-14.3 32-32-14.4-32-32-32z" fill="currentColor"/><path d="M384 238c9.9 0 18 8.1 18 18s-8.1 18-18 18-18-8.1-18-18 8.1-18 18-18m0-14c-17.7 0-32 14.3-32 32s14.3 32 32 32 32-14.3 32-32-14.3-32-32-32z" fill="currentColor"/></svg>`;

            editNoteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openCommentModal(
                    exercise.id,
                    exercise.note,
                    `Комментарий к <span class="exercise-name-span">- ${exercise.name}</span>`,
                    (newNote, media) => saveExerciseNote(selectedProgram.id, exercise.id, newNote, media)
                );
            });

            exerciseHeader.append(exerciseTitle,editNoteBtn );

            // Клик по заголовку

            // 2. — СОЗДАЁМ SWIPE ROOT
            const swipeRoot = createElement('div', 'exercise-swipe');

            // 👉 Только ПРАВАЯ зона (появляется при свайпе влево)
            const rightActions = createElement('div', 'swipe-actions right');
            rightActions.innerHTML = `
              <button class="action-btn action-edit">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><title>Setting-vert SVG Icon</title><path fill="none" stroke="currentColor" stroke-linecap="round" d="M11.5 8.5v-4m-5 10v4m10-2v2m-5 0v-6m-5-8v6m10-6v8m-7-4h4m-9 6h4m6 2h4"/></svg>
              </button>
              <button class="action-btn action-delete">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><title>Trash-24 SVG Icon</title><path fill="currentColor" d="M16 1.75V3h5.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H8V1.75C8 .784 8.784 0 9.75 0h4.5C15.216 0 16 .784 16 1.75m-6.5 0V3h5V1.75a.25.25 0 0 0-.25-.25h-4.5a.25.25 0 0 0-.25.25M4.997 6.178a.75.75 0 1 0-1.493.144L4.916 20.92a1.75 1.75 0 0 0 1.742 1.58h10.684a1.75 1.75 0 0 0 1.742-1.581l1.413-14.597a.75.75 0 0 0-1.494-.144l-1.412 14.596a.25.25 0 0 1-.249.226H6.658a.25.25 0 0 1-.249-.226z"></path><path fill="currentColor" d="M9.206 7.501a.75.75 0 0 1 .793.705l.5 8.5A.75.75 0 1 1 9 16.794l-.5-8.5a.75.75 0 0 1 .705-.793Zm6.293.793A.75.75 0 1 0 14 8.206l-.5 8.5a.75.75 0 0 0 1.498.088l.5-8.5Z"></path></svg>
              </button>
            `;

            // Контент, который ездит
            const swipeContent = createElement('div', 'swipe-content');
            swipeContent.append(exerciseHeader);

            swipeRoot.append(rightActions, swipeContent);
            exerciseItem.append(swipeRoot);

             // 4️⃣ Подключаем свайп (только 1 раз!)
                  attachSwipeActions(swipeRoot, selectedProgram, exercise);






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
                        if (set.done) {
                            setRow.classList.add("done");
                        }
                            enableSwipeDone(setRow, set);



                    const setNumberLabel = createElement('span', 'set-label', `${setIndex + 1}.`);
                    setRow.append(setNumberLabel);

                    const setText = createElement('span', 'set-display');
                    const displayWeight = set.weight || '...';
                    const displayReps = set.reps || '...';
                    setText.innerHTML = `${displayWeight} <small>кг</small> <small>x</small> ${displayReps} <small>пов</small>`;
                    setRow.append(setText);

                    // Клик для редактирования подхода
                    setRow.addEventListener('click', (e) => {
                        if (setRow._preventClick) return; // 👈 блокируем открытие после свайпа
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
            const addSetBtn = createElement('button', 'add-set-btn');
            addSetBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 16 16"><title>Plus SVG Icon</title><path fill="currentColor" d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4"></path></svg>';

            addSetBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const currentExercise = selectedProgram.exercises.find(ex => ex.id === exercise.id);
                currentExercise.sets = currentExercise.sets || [];

                if (currentExercise.sets.length === 0) {
                    currentExercise.sets.push({ weight: '', reps: '', isMain: false });
                    updateDoc(doc(getUserProgramsCollection(), selectedProgram.id), { exercises: selectedProgram.exercises }).then(render);
                    return;
                }

                // Новая модалка дублирования
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



            const bottomButtons = createElement('div', 'exercise-bottom-buttons');
            bottomButtons.style.display = 'flex';
            bottomButtons.style.gap = '6px';
            bottomButtons.append(addSetBtn);
            setsContainer.append(bottomButtons);

            // Отображение комментария под подходами (в раскрытом виде)
            if (isExpanded && (exercise.note || (exercise.media && exercise.media.length > 0))) {
                const exerciseNoteContainer = createElement('div', 'exercise-note-display');

                    // 🔥 Клик по блоку комментария = редактировать комментарий
                    exerciseNoteContainer.addEventListener("click", (e) => {
                        e.stopPropagation();
                        openCommentModal(
                            exercise.id,
                            exercise.note,
                            `Комментарий к <span class="exercise-name-span">- ${exercise.name}</span>`,
                            (newNote, media) => saveExerciseNote(selectedProgram.id, exercise.id, newNote, media)
                        );
                    });

                // 1. Текст комментария
                if (exercise.note && exercise.note.trim() !== '') {
                    const noteText = createElement('p', 'comment-text', exercise.note);
                    exerciseNoteContainer.append(noteText);
                }

                // 2. Фото / Видео (иконки или миниатюры)
                if (exercise.media && exercise.media.length > 0) {
                    const mediaContainer = createElement('div', 'note-media-preview');
                    mediaContainer.style.display = 'flex';
                    mediaContainer.style.gап = '8px';
                    mediaContainer.style.marginTop = '10px';

                    exercise.media.forEach(file => {
                        if (file.type === 'photo') {
                            const img = createElement('img');
                            img.src = file.url;
                            img.className = 'note-media-image';
                            img.style.width = '40px';
                            img.style.height = '40px';
                            img.style.objectFit = 'cover';
                            img.style.borderRadius = '5px';
                            img.style.marginRight = '7px';
                            img.style.cursor = 'pointer';
                            img.onclick = () => openPhotoFullScreen(file.url);
                            img.addEventListener("click", (e) => e.stopPropagation());
                            mediaContainer.append(img);
                        }
                        if (file.type === 'video') {
                            const videoThumb = createElement('video');
                            videoThumb.src = file.url;
                            videoThumb.className = 'note-media-video-thumb';
                            videoThumb.muted = true;
                            videoThumb.playsInline = true;
                            videoThumb.style.width = '40px';
                            videoThumb.style.height = '40px';
                            videoThumb.style.objectFit = 'cover';
                            videoThumb.style.borderRadius = '5px';
                            videoThumb.style.marginRight = '7px';
                            videoThumb.style.cursor = 'pointer';
                            videoThumb.onclick = () => openMediaFullScreen(file.url, 'video');
                            videoThumb.addEventListener("click", (e) => e.stopPropagation());
                            mediaContainer.append(videoThumb);
                        }
                    });

                    exerciseNoteContainer.append(mediaContainer);
                }

                // Вставляем в DOM под подходами
                setsContainer.append(exerciseNoteContainer);
            }

            // ВАЖНО: добавляем только swipeRoot + summary + sets (без прямого повторного exerciseHeader)
            exerciseItem.append(summarySetsContainer, setsContainer);

            // Показывать комментарий под summarySets, даже если упражнение закрыто
            if (!isExpanded && (exercise.note || (exercise.media && exercise.media.length > 0))) {
                const collapsedNote = createElement('div', 'exercise-note-collapsed');

                if (exercise.note && exercise.note.trim() !== '') {
                    const noteText = createElement('p', 'comment-text-collapsed', exercise.note);
                    collapsedNote.append(noteText);
                }

                if (exercise.media && exercise.media.length > 0) {
                    const icons = createElement('span', 'media-icons-inline');

                    const photoSVG = `
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><title>Camera SVG Icon</title><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M3 9a2 2 0 0 1 2-2h.93a2 2 0 0 0 1.664-.89l.812-1.22A2 2 0 0 1 10.07 4h3.86a2 2 0 0 1 1.664.89l.812 1.22A2 2 0 0 0 18.07 7H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M15 13a3 3 0 1 1-6 0a3 3 0 0 1 6 0"/></g></svg>
                    `;
                    const videoSVG = `
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><title>Video-camera SVG Icon</title><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="m15.75 10.5l4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25"/></svg>
                    `;

                    const hasPhoto = exercise.media.some(m => m.type === 'photo' || /\.(jpg|jpeg|png|webp)$/i.test(m.url));
                    if (hasPhoto) {
                        const span = createElement('span', 'icon-photo');
                        span.innerHTML = photoSVG;
                        icons.append(span);
                    }

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

// --- создаём общий контейнер (он и будет кликабельным) ---
const commentButtonGroup = createElement('div', 'comment-btn-group');

// --- иконка (SVG внутри кнопки) ---
const commentBtn = createElement('button', `btn comment-toggle-btn ${hasTrainingNote ? 'has-note' : ''}`);
commentBtn.innerHTML = `
  <svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24"><title>Edit SVG Icon</title><path fill="currentColor" d="M3.548 20.938h16.9a.5.5 0 0 0 0-1h-16.9a.5.5 0 0 0 0 1M9.71 17.18a2.587 2.587 0 0 0 1.12-.65l9.54-9.54a1.75 1.75 0 0 0 0-2.47l-.94-.93a1.788 1.788 0 0 0-2.47 0l-9.54 9.53a2.473 2.473 0 0 0-.64 1.12L6.04 17a.737.737 0 0 0 .19.72a.767.767 0 0 0 .53.22Zm.41-1.36a1.468 1.468 0 0 1-.67.39l-.97.26l-1-1l.26-.97a1.521 1.521 0 0 1 .39-.67l.38-.37l1.99 1.99Zm1.09-1.08l-1.99-1.99l6.73-6.73l1.99 1.99Zm8.45-8.45L18.65 7.3l-1.99-1.99l1.01-1.02a.748.748 0 0 1 1.06 0l.93.94a.754.754 0 0 1 0 1.06"></path></svg>
`;

// --- текст рядом с иконкой ---
const commentLabel = createElement(
  'span',
  'comment-label',
  hasTrainingNote ? 'Редактировать комментарий' : 'Добавить комментарий к тренировке'
);

// --- единый обработчик клика ---
const handleClick = (e) => {
  e.stopPropagation(); // предотвращает двойные вызовы
  openCommentModal(
    selectedProgram.id,
    selectedProgram.trainingNote,
    'Комментарий к тренировке',
    (newNote, media) => {
      saveTrainingNote(selectedProgram.id, newNote, media);
      commentLabel.textContent =
        newNote && newNote.trim() !== ''
          ? 'Редактировать комментарий'
          : 'Добавить комментарий к тренировке';
    }
  );
};

// --- назначаем клик только на общий контейнер ---
commentButtonGroup.addEventListener('click', handleClick);

// --- собираем элементы ---
commentButtonGroup.append(commentBtn, commentLabel);
commentWrapper.append(commentButtonGroup);

// --- если есть заметка — показываем её ниже ---
if (hasTrainingNote) {
  const noteContainer = createElement('div', 'training-note-display');

  if (selectedProgram.trainingNote.trim() !== '') {
    noteContainer.append(createElement('p', 'comment-text-display', selectedProgram.trainingNote));
  }

  if (selectedProgram.trainingMedia?.length > 0) {
    const mediaContainer = createElement('div', 'training-media-preview');
    mediaContainer.style.display = 'flex';
    mediaContainer.style.gap = '8px';
    mediaContainer.style.marginTop = '5px';

    selectedProgram.trainingMedia.forEach(file => {
      if (file.type === 'photo') {
        const img = createElement('img');
        img.src = file.url;
        Object.assign(img.style, {
          width: '30px',
          height: '30px',
          objectFit: 'cover',
          borderRadius: '5px',
          cursor: 'pointer',
        });
        img.onclick = () => openPhotoFullScreen(file.url);
        mediaContainer.append(img);
      } else if (file.type === 'video') {
        const videoThumb = createElement('video');
        Object.assign(videoThumb, {
          src: file.url,
          muted: true,
        });
        Object.assign(videoThumb.style, {
          width: '30px',
          height: '30px',
          objectFit: 'cover',
          borderRadius: '5px',
          cursor: 'pointer',
        });
        videoThumb.onclick = () => window.open(file.url, '_blank');
        mediaContainer.append(videoThumb);
      }
    });

    noteContainer.append(mediaContainer);
  }

  commentWrapper.append(noteContainer);
}

// --- добавляем в контент ---
contentContainer.append(commentWrapper);

  // -----------------------------
  // Кнопка "Завершить тренировку"
  // -----------------------------
  const completeTrainingBtn = createElement('button', 'btn complete-training-btn', 'Завершить тренировку');
  completeTrainingBtn.addEventListener('click', () => {
    openConfirmModal('Завершить и сохранить тренировку в дневник?', async () => {

            // 🔥🔥🔥 ДОБАВЛЯЕМ ОЧИСТКУ DONE ПРЯМО ЗДЕСЬ
            document.querySelectorAll(".set-row.done").forEach(row => {
                row.classList.remove("done");
            });
            // 🔥🔥🔥 END


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
        const journalCollection = getUserJournalCollection();
        const todayStr = new Date().toLocaleDateString('ru-RU');

        // 🧹 Проверяем, есть ли на сегодня запланированная тренировка — если есть, удаляем
        const q = query(
          journalCollection,
          where("date", "==", todayStr),
          where("isPlanned", "==", true)
        );
        const qSnap = await getDocs(q);

        for (const docSnap of qSnap.docs) {
          console.log("🗑 Удаляю запланированную тренировку на сегодня:", docSnap.id);
          await deleteDoc(docSnap.ref);
        }

        // 💾 Теперь сохраняем завершённую тренировку
        await addDoc(journalCollection, {
          ...trainingRecord,
          isPlanned: false, // помечаем как завершённую
        });

        showToast('Тренировка сохранена в дневнике!');
        const origin = state.programDetailsOrigin;
        state.programDetailsOrigin = null;
        state.currentPage = origin === 'journal' ? 'journal' : 'programsInCycle';
        state.selectedProgramIdForDetails = null;
        state.expandedExerciseId = null;
        render();

      } catch (error) {
        console.error("❌ Ошибка при сохранении тренировки:", error);
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




// -----------------------------------------------------------
// ⏱ Модальное окно таймера отдыха с чекбоксом активации плавающего режима
// -----------------------------------------------------------
function openTimerModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'modal-window timer-modal';

    modal.innerHTML = `
        <div class="timer-toggle-row">
            <label class="timer-toggle-label">
                <input type="checkbox" id="timer-float-toggle" class="timer-toggle-checkbox" />
                <span class="timer-toggle-box"></span>
                <span>Показывать кнопку при прокрутке</span>
            </label>
        </div>
        <div class="timer-heder">
                <div class="timer-presets left">
                    <button data-min="0" data-sec="30">30с</button>
                    <button data-min="1" data-sec="0">1м</button>
                    <button data-min="1" data-sec="30">1.5м</button>
                </div>

                        <div class="timer-heder-center">
                            <h3>Таймер отдыха</h3>
                            <div class="timer-display">00:00</div>
                        </div>
                <div class="timer-presets right">
                    <button data-min="2" data-sec="0">2м</button>
                    <button data-min="2" data-sec="30">2.5м</button>
                    <button data-min="3" data-sec="0">3м</button>
                </div>

        </div>


        <div class="timer-body">
            <div class="timer-center">
                <div class="timer-timepicker">
                    <input type="time" id="timer-time" step="1" value="00:01:00">
                </div>

                <div class="timer-buttons">
                    <button id="timer-start" class="btn btn-primary">Старт</button>
                    <button id="timer-stop" class="btn btn-secondary">Стоп</button>
                    <button id="timer-reset" class="btn btn-danger">Сброс</button>
                </div>
            </div>


        </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('visible'));

    // чекбокс: читаем сохранённое и навешиваем обработчик
    const floatToggle = modal.querySelector('#timer-float-toggle');
    floatToggle.checked = isFloatingEnabled();
    floatToggle.addEventListener('change', () => {
        setFloatingEnabled(floatToggle.checked);
        // мгновенно применяем поведение
        const topBar = document.querySelector('.top-bar');
        applyFloatingSetting(topBar);
    });

    const display = modal.querySelector('.timer-display');
    const timeInput = modal.querySelector('#timer-time');
    const startBtn = modal.querySelector('#timer-start');
    const stopBtn = modal.querySelector('#timer-stop');
    const resetBtn = modal.querySelector('#timer-reset');
    const presetButtons = modal.querySelectorAll('.timer-presets button');

    let timerInterval;
    let remainingSeconds = 0;
    let isRunning = false;

    const flashScreen = (duration = 200) => {
        modal.classList.add('flash');
        navigator.vibrate?.(100);
        setTimeout(() => modal.classList.remove('flash'), duration);
    };

    const updateDisplay = () => {
        const m = Math.floor(remainingSeconds / 60);
        const s = remainingSeconds % 60;
        display.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    };

    startBtn.onclick = () => {
        if (isRunning) return;

        const [hours, minutes, seconds] = timeInput.value.split(':').map(Number);
        remainingSeconds = (hours * 3600) + (minutes * 60) + (seconds || 0);
        if (remainingSeconds <= 0) return;

        isRunning = true;
        updateDisplay();

        timerInterval = setInterval(() => {
            remainingSeconds--;
            updateDisplay();

            if ([15, 13, 11].includes(remainingSeconds)) flashScreen(250);
            if ([10, 9, 8, 7, 5, 4].includes(remainingSeconds)) flashScreen(200);
            if ([3, 2, 1].includes(remainingSeconds)) flashScreen(150);
            if (remainingSeconds <= 3 && remainingSeconds > 0) {
                setTimeout(() => flashScreen(100), 500);
            }

            if (remainingSeconds <= 0) {
                clearInterval(timerInterval);
                isRunning = false;
                flashScreen(400);
                showToast('⏰ Отдых закончен!');
                navigator.vibrate?.([200, 100, 200]);
            }
        }, 1000);
    };

    stopBtn.onclick = () => {
        clearInterval(timerInterval);
        isRunning = false;
    };

    resetBtn.onclick = () => {
        clearInterval(timerInterval);
        isRunning = false;
        display.textContent = '00:00';
        timeInput.value = "00:01:00";
    };

    presetButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const m = (btn.dataset.min || '0').padStart(2, '0');
            const s = (btn.dataset.sec || '0').padStart(2, '0');
            timeInput.value = `00:${m}:${s}`;
            display.textContent = `${m}:${s}`;
        });
    });

    overlay.onclick = (e) => {
        if (e.target === overlay) {
            clearInterval(timerInterval);
            overlay.classList.remove('visible');
            setTimeout(() => overlay.remove(), 200);
        }
    };
}
// -----------------------------------------------------------
// 🌟 применения настройки и очистки:
// -----------------------------------------------------------
function applyFloatingSetting(topBar) {
    const btn = document.querySelector('.btn-timer');
    if (!btn || !topBar) return;

    // если включено — создаём/обновляем наблюдение
    if (isFloatingEnabled()) {
        setupFloatingTimer(topBar);
    } else {
        // выключено: убрать плавающий режим и вернуть на панель
        cleanupFloatingTimer();
        btn.classList.remove('floating', 'dragging');
        btn.style.left = '';
        btn.style.top = '';
        if (btn.parentElement === document.body) {
            topBar.appendChild(btn);
        }
    }
}

let timerObserver = null;
let dragging = false;
let longPressTimer = null;
let dragDX = 0;
let dragDY = 0;

function cleanupFloatingTimer() {
    if (timerObserver) {
        try { timerObserver.disconnect(); } catch(_) {}
        timerObserver = null;
    }
}

// -----------------------------------------------------------
// 🌟 Плавающий таймер: появляется при скролле вниз + перетаскивание, возвращается обратно
// -----------------------------------------------------------
function setupFloatingTimer(topBar) {
    const btn = document.querySelector('.btn-timer');
    if (!btn || !topBar) return;

    // если настройка выключена — просто очищаем и выходим
    if (!isFloatingEnabled()) {
        cleanupFloatingTimer();
        return;
    }

    // убираем прежний observer, если был
    cleanupFloatingTimer();

    // сохраним исходного родителя, чтобы возвращать кнопку на место
    const originalParent = topBar;
    const originalNext = btn.nextSibling;

    timerObserver = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting) {
            // top-bar виден — вернуть кнопку
            btn.classList.remove('floating', 'dragging');
            btn.style.left = '';
            btn.style.top = '';
            if (btn.parentElement === document.body) {
                if (originalNext) originalParent.insertBefore(btn, originalNext);
                else originalParent.appendChild(btn);
            }
        } else {
            // top-bar ушёл — сделать кнопку плавающей
            document.body.appendChild(btn);
            btn.classList.add('floating');
        }
    }, { threshold: 0 });

    timerObserver.observe(topBar);

    // перетаскивание (долгое нажатие)
    const startLongPress = (clientX, clientY) => {
        longPressTimer = setTimeout(() => {
            dragging = true;
            btn.classList.add('dragging');
            const r = btn.getBoundingClientRect();
            dragDX = clientX - r.left;
            dragDY = clientY - r.top;
        }, 400);
    };
    const stopLongPress = () => {
        clearTimeout(longPressTimer);
        longPressTimer = null;
    };

    // touch
    btn.addEventListener('touchstart', (e) => {
        if (!btn.classList.contains('floating')) return;
        const t = e.touches[0];
        startLongPress(t.clientX, t.clientY);
    });

    btn.addEventListener('touchmove', (e) => {
        if (!dragging) return;
        e.preventDefault();
        const t = e.touches[0];
        btn.style.left = `${t.clientX - dragDX}px`;
        btn.style.top  = `${t.clientY - dragDY}px`;
    }, { passive: false });

    btn.addEventListener('touchend', () => {
        stopLongPress();
        if (dragging) {
            dragging = false;
            btn.classList.remove('dragging');
        }
    });

    // mouse (для отладки на ПК)
    btn.addEventListener('mousedown', (e) => {
        if (!btn.classList.contains('floating')) return;
        startLongPress(e.clientX, e.clientY);
    });
    document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        e.preventDefault();
        btn.style.left = `${e.clientX - dragDX}px`;
        btn.style.top  = `${e.clientY - dragDY}px`;
    });
    document.addEventListener('mouseup', () => {
        stopLongPress();
        if (dragging) {
            dragging = false;
            btn.classList.remove('dragging');
        }
    });
}


// ===============================================================
// 📦 ЗАГРУЗКА ЦИКЛОВ личные
// ===============================================================



async function loadUserCycles() {
  try {
    console.log("📥 Загружаю личные циклы...");

    const userId = auth.currentUser?.uid;
    if (!userId) return [];

    const appId = db._databaseId?.projectId || "training-diary-51bcb";

    const cyclesRef = collection(
      db,
      "artifacts",
      appId,
      "users",
      userId,
      "cycles"
    );

    const snapshot = await getDocs(cyclesRef);
    const cycles = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    console.log("📦 Найдено личных циклов:", cycles.length, cycles);

    // 🔹 Загружаем журнал пользователя
    const journalRef = collection(
      db,
      "artifacts",
      appId,
      "users",
      userId,
      "journal"
    );
    const jSnap = await getDocs(journalRef);
    const records = jSnap.docs.map(d => d.data());

    if (records.length > 0) {
      const today = new Date();
        today.setHours(0, 0, 0, 0);
      const withDates = records.map(r => ({
        ...r,
        jsDate: (() => {
          const [d, m, y] = r.date.split('.').map(Number);
          return new Date(y, m - 1, d);
        })()
      }));

      const future = withDates
        .filter(r => r.jsDate >= today)
        .sort((a, b) => a.jsDate - b.jsDate)[0];

      const past = withDates
        .filter(r => r.jsDate < today)
        .sort((a, b) => b.jsDate - a.jsDate)[0];

      const best = future || past;

      if (best) {
        const foundCycle = cycles.find(c => c.name === best.cycleName);
        if (foundCycle) {
          state.selectedCycleId = foundCycle.id;
          state.selectedJournalCategory = foundCycle.name;
          console.log("📘 Автовыбран личный цикл по ближайшей дате:", foundCycle.name, best.date);
        }
      }
    } else if (cycles.length > 0) {
      const lastCycle = cycles[cycles.length - 1];
      state.selectedCycleId = lastCycle.id;
      state.selectedJournalCategory = lastCycle.name;
      console.log("📘 Установлен личный цикл по умолчанию:", lastCycle.name);
    } else {
      state.selectedCycleId = null;
      state.selectedJournalCategory = "Выберите цикл";
      console.log("ℹ️ Нет личных циклов");
    }

    return cycles;
  } catch (error) {
    console.error("❌ Ошибка при загрузке личных циклов:", error);
    return [];
  }
}




// ===============================================================
// 📦 ЗАГРУЗКА ЦИКЛОВ КЛИЕНТА
// ===============================================================

async function loadClientCycles(clientId) {
  try {
    console.log("📥 Загружаю циклы для клиента:", clientId);

    const uid = auth.currentUser?.uid;
    if (!uid) return [];

    const clientMeta = state.clients?.find((c) => c.id === clientId);
    const linkedUid =
      clientMeta?.linkedUserUid && clientMeta?.linkStatus === 'active' ? clientMeta.linkedUserUid : null;

    const trainerCyclesRef = collection(
      db,
      "artifacts",
      appId,
      "users",
      uid,
      "clients",
      clientId,
      "cycles"
    );

    const snapT = await getDocs(trainerCyclesRef);
    const byId = new Map();
    for (const d of snapT.docs) {
      byId.set(d.id, { id: d.id, ...d.data(), _firesAtClient: false });
    }
    if (linkedUid) {
      const clientCyclesRef = collection(db, "artifacts", appId, "users", linkedUid, "cycles");
      const snapC = await getDocs(clientCyclesRef);
      for (const d of snapC.docs) {
        byId.set(d.id, { id: d.id, ...d.data(), _firesAtClient: true });
      }
    }
    const cycles = Array.from(byId.values());
    console.log("📦 Найдено циклов для клиента (слияние):", cycles.length, cycles);

    // 🔹 Журнал: при активной связи — канон клиента, иначе карточка тренера
    const journalRef = linkedUid
      ? collection(db, "artifacts", appId, "users", linkedUid, "journal")
      : collection(db, "artifacts", appId, "users", uid, "clients", clientId, "journal");
    const jSnap = await getDocs(journalRef);
    const records = jSnap.docs.map(d => d.data());

    if (records.length > 0) {
      const today = new Date();
        today.setHours(0, 0, 0, 0);
      // Преобразуем даты
      const withDates = records.map(r => ({
        ...r,
        jsDate: (() => {
          const [d, m, y] = r.date.split('.').map(Number);
          return new Date(y, m - 1, d);
        })()
      }));

      // Ближайшая будущая (или сегодняшняя)
      const future = withDates
        .filter(r => r.jsDate >= today)
        .sort((a, b) => a.jsDate - b.jsDate)[0];

      // Последняя прошедшая
      const past = withDates
        .filter(r => r.jsDate < today)
        .sort((a, b) => b.jsDate - a.jsDate)[0];

      const best = future || past;

      if (best) {
        const foundCycle = cycles.find(c => c.name === best.cycleName);
        if (foundCycle) {
          state.selectedCycleId = foundCycle.id;
          state.selectedJournalCategory = foundCycle.name;
          console.log("📘 Автовыбран цикл по ближайшей дате:", foundCycle.name, best.date);
        }
      }
    } else if (cycles.length > 0) {
      const lastCycle = cycles[cycles.length - 1];
      state.selectedCycleId = lastCycle.id;
      state.selectedJournalCategory = lastCycle.name;
      console.log("📘 Установлен цикл по умолчанию:", lastCycle.name);
    } else {
      state.selectedCycleId = null;
      state.selectedJournalCategory = "Выберите цикл";
      console.log("ℹ️ Нет циклов у клиента");
    }

    return cycles;
  } catch (error) {
    console.error("❌ Ошибка при загрузке циклов клиента:", error);
    return [];
  }
}


// =================================================================
// 🌟 ЛОГИКА СТРАНИЦЫ ДНЕВНИКА
// =================================================================
function renderJournalPage() {
    const contentContainer = document.createElement('div');

    console.log("📋 Текущий режим:", state.currentMode, "Клиент:", state.selectedClientId);
    console.log("📦 Циклы в state:", state.cycles);



// 🔧 Вспомогательная функция для разбора даты
function parseDate(dateStr) {
  if (!dateStr) return new Date(0);
  const [d, m, y] = dateStr.split('.').map(Number);
  return new Date(y, m - 1, d);
}

// 🔧 Функция поиска ближайшей (или последней) тренировки
function getNearestRecord(records) {
  const today = new Date();

  const futureRecords = records
    .filter(r => parseDate(r.date) >= today)
    .sort((a, b) => parseDate(a.date) - parseDate(b.date));

  if (futureRecords.length > 0) return futureRecords[0]; // ближайшая будущая

  const pastRecords = records
    .filter(r => parseDate(r.date) < today)
    .sort((a, b) => parseDate(b.date) - parseDate(a.date));

  return pastRecords[0] || null; // последняя прошедшая
}

// 🔄 Проверяем и загружаем циклы для личного режима (own)
if (state.currentMode === 'own' && !state.cyclesLoaded) {
  console.log("🔄 Загружаю личные циклы...");
  state.cyclesLoaded = true;

  loadUserCycles()
    .then(async (cycles) => {
      state.cycles = cycles;
      console.log("✅ Личные циклы подгружены:", cycles);

      if (!state.selectedCycleId && cycles.length > 0) {
        const userId = auth.currentUser?.uid;
        const appId = db._databaseId?.projectId || "training-diary-51bcb";
        const journalRef = collection(db, "artifacts", appId, "users", userId, "journal");

        const jSnap = await getDocs(journalRef);
        const records = jSnap.docs.map(d => d.data());
        console.log("📒 Найдено записей в журнале:", records.length);

        const nearestRecord = getNearestRecord(records);

        if (nearestRecord) {
          const foundCycle = cycles.find(c => c.name === nearestRecord.cycleName);
          if (foundCycle) {
            state.selectedCycleId = foundCycle.id;
            state.selectedJournalCategory = foundCycle.name;
            console.log("🧭 Ближайшая тренировка:", nearestRecord.date, "→ Цикл:", foundCycle.name);
          } else {
            console.warn("⚠️ Цикл из ближайшей тренировки не найден:", nearestRecord.cycleName);
          }
        } else {
          const lastCycle = cycles[cycles.length - 1];
          state.selectedCycleId = lastCycle.id;
          state.selectedJournalCategory = lastCycle.name;
          console.log("📘 Установлен личный цикл по умолчанию:", lastCycle.name);
        }
      }

      // ✅ вызываем рендер только один раз — после всех обновлений
      render();
    })
    .catch(err => console.error("❌ Ошибка при загрузке личных циклов:", err));
}



// 🔄 Проверяем и загружаем циклы для клиента, если это персональный режим
if (state.currentMode === 'personal' && state.selectedClientId) {
  if (state.loadedClientIdForCycles !== state.selectedClientId) {
    console.log("🔄 Загружаю циклы для клиента:", state.selectedClientId);
    state.loadedClientIdForCycles = state.selectedClientId; // один раз на выбранную карточку клиента
    loadClientCycles(state.selectedClientId)
      .then(cycles => {
        state.cycles = cycles;
        console.log("✅ Циклы клиента подгружены:", cycles);

        // 🛠 Не перезаписываем, если уже выбран цикл
        if (!state.selectedCycleId && cycles.length > 0) {
          const lastCycle = cycles[cycles.length - 1];
          state.selectedCycleId = lastCycle.id;
          state.selectedJournalCategory = lastCycle.name;
          console.log('📘 Установлен цикл по умолчанию:', lastCycle.name);
        }

        render(); // перерисовываем только один раз
      })
      .catch(err => {
        console.error("❌ Ошибка при загрузке циклов клиента:", err);
      });
    return;
  }
}






if (state.currentMode === 'personal' && !state.selectedClientId) {
  // Если в персональном режиме клиент не выбран
  const msg = createElement('div', 'muted', 'Сначала выберите клиента для отображения календаря.');
  root.append(msg);
  return;
}

if (!state.selectedJournalCategory && state.journal.length > 0) {
  // Фильтруем только релевантные записи
  const relevantRecords = state.journal.filter(r => {
    if (state.currentMode === 'own') return true;
    if (state.currentMode === 'personal') {
      const linked = getActiveLinkedClientUid();
      if (linked) {
        return state.cycles.some((c) => c.name === r.cycleName || c.id === r.cycleId);
      }
      return state.cycles.some(
        (c) =>
          c.name === r.cycleName &&
          (!r.clientId || r.clientId === state.selectedClientId)
      );
    }
    return false;
  });

  if (relevantRecords.length > 0) {
    // Сортируем по дате (новые сверху)
    const sorted = [...relevantRecords].sort((a, b) => {
      const [dA, mA, yA] = a.date.split('.').map(Number);
      const [dB, mB, yB] = b.date.split('.').map(Number);
      return new Date(yB, mB - 1, dB) - new Date(yA, mA - 1, dA);
    });

    // Находим последнюю завершённую
    const lastCompleted = sorted.find(r => !r.isPlanned);
    // Если нет — последнюю запланированную
    const lastPlanned = sorted.find(r => r.isPlanned);

    // Выбираем приоритетно завершённую, если она новее
    let lastRelevant = lastPlanned;
    if (lastCompleted) {
      const [dC, mC, yC] = lastCompleted.date.split('.').map(Number);
      const [dP, mP, yP] = lastPlanned ? lastPlanned.date.split('.').map(Number) : [0, 0, 0];
      const dateCompleted = new Date(yC, mC - 1, dC);
      const datePlanned = new Date(yP, mP - 1, dP);
      lastRelevant = (!lastPlanned || dateCompleted > datePlanned) ? lastCompleted : lastPlanned;
    }

    if (lastRelevant) {
      // Находим соответствующий цикл
      const foundCycle = state.cycles.find(c => c.name === lastRelevant.cycleName);
      if (foundCycle) {
        state.selectedJournalCategory = foundCycle.name;
        state.selectedCycleId = foundCycle.id;
        console.log('✅ Автовыбран цикл:', foundCycle.name);
      } else {
        console.warn('⚠️ Цикл из последней тренировки не найден:', lastRelevant.cycleName);
      }
    }
  }
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




// ✅ ФИЛЬТРЫ ЖУРНАЛА: цикл + тренировки
const filterWrapper = createElement('div', 'journal-filters');

// --- 1. СТРОКА ЦИКЛА (клик → выбор цикла) ---
const cycleLabelBlock = createElement('div', 'cycle-label-block');
const cycleLabelIcon = createElement('span', 'cycle-label-icon', '📋');
const cycleLabelText = createElement('span', 'cycle-label-text',
    state.selectedJournalCategory || 'Цикл не выбран'
);
const cycleArrow = createElement('span', 'cycle-label-arrow', '▾');
cycleLabelBlock.append(cycleLabelIcon, cycleLabelText, cycleArrow);

const allCycleNames = [...new Set(
    state.cycles
        .filter(c => state.currentMode === 'own' || state.currentMode === 'personal')
        .map(c => c.name)
)];

if (allCycleNames.length > 0) {
    const cycleDropdown = createElement('div', 'filter-dropdown cycle-dropdown');
    const cycleDropdownLabel = createElement('div', 'filter-section-label', 'Циклы');
    cycleDropdown.append(cycleDropdownLabel);

    const cyclePills = createElement('div', 'program-pills');
    allCycleNames.forEach(name => {
        const pill = createElement('button',
            'program-pill' + (state.selectedJournalCategory === name ? ' active' : ''),
            name
        );
        pill.addEventListener('click', (e) => {
            e.stopPropagation();
            state.selectedJournalCategory = name;
            state.selectedJournalProgram = '';
            const foundCycle = state.cycles.find(c => c.name === name);
            if (foundCycle) {
                state.selectedCycleId = foundCycle.id;
                setupDynamicListeners();
            }
            render();
        });
        cyclePills.append(pill);
    });
    cycleDropdown.append(cyclePills);
    filterWrapper.append(cycleDropdown);

    cycleLabelBlock.addEventListener('click', (e) => {
        e.stopPropagation();
        const programDd = filterWrapper.querySelector('.program-dropdown');
        if (programDd) { programDd.classList.remove('open'); }
        cycleDropdown.classList.toggle('open');
        cycleArrow.classList.toggle('open');
    });
}

filterWrapper.append(cycleLabelBlock);

// --- 2. СТРОКА ФИЛЬТРА ТРЕНИРОВОК (клик → выбор программы) ---
if (state.selectedJournalCategory) {
    const programs = [...new Set(
        state.journal
            .filter(r => r.cycleName === state.selectedJournalCategory)
            .map(r => r.programName)
            .filter(Boolean)
    )];

    const activeFilterRow = createElement('div', 'active-filter-row');
    const activeFilterLabel = createElement('span', 'active-filter-label', 'Тренировка:');
    const activeFilterValue = createElement('span', 'active-filter-value' + (!state.selectedJournalProgram ? ' all' : ''),
        state.selectedJournalProgram || 'Все'
    );
    const filterArrow = createElement('span', 'cycle-label-arrow', '▾');
    activeFilterRow.append(activeFilterLabel, activeFilterValue, filterArrow);

    if (programs.length > 0) {
        const programDropdown = createElement('div', 'filter-dropdown program-dropdown');
        const programDropdownLabel = createElement('div', 'filter-section-label', 'Тренировки');
        programDropdown.append(programDropdownLabel);

        const pillsContainer = createElement('div', 'program-pills');

        const allPill = createElement('button', 'program-pill' + (!state.selectedJournalProgram ? ' active' : ''), 'Все');
        allPill.addEventListener('click', (e) => {
            e.stopPropagation();
            state.selectedJournalProgram = '';
            render();
        });
        pillsContainer.append(allPill);

        programs.forEach(prog => {
            const pill = createElement('button',
                'program-pill' + (state.selectedJournalProgram === prog ? ' active' : ''),
                prog
            );
            pill.addEventListener('click', (e) => {
                e.stopPropagation();
                state.selectedJournalProgram = prog;
                render();
            });
            pillsContainer.append(pill);
        });

        programDropdown.append(pillsContainer);
        filterWrapper.append(programDropdown);

        activeFilterRow.style.cursor = 'pointer';
        activeFilterRow.addEventListener('click', (e) => {
            e.stopPropagation();
            const cycleDd = filterWrapper.querySelector('.cycle-dropdown');
            if (cycleDd) { cycleDd.classList.remove('open'); cycleArrow.classList.remove('open'); }
            programDropdown.classList.toggle('open');
            filterArrow.classList.toggle('open');
        });
    }

    filterWrapper.append(activeFilterRow);
}

document.addEventListener('click', () => {
    filterWrapper.querySelectorAll('.filter-dropdown').forEach(d => d.classList.remove('open'));
    filterWrapper.querySelectorAll('.cycle-label-arrow').forEach(a => a.classList.remove('open'));
});

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

            // Обработчик для обычного клика (переход на тренировку)
            cell.addEventListener('click', async (e) => {
                e.stopPropagation();

                const record = dayRecords[0];
                if (!record.isPlanned) {
                    // Если тренировка завершена, открываем детали
                    state.selectedJournalRecord = record.id;
                    state.currentPage = 'journal';
                    render();
                } else {
                    // Если запланированная, переходим к программе
                    const cycle = state.cycles.find(c => c.name === record.cycleName);
                    if (cycle) {
                        state.selectedCycleId = cycle.id;
                        state.selectedJournalCategory = cycle.name;
                        setupDynamicListeners?.();
                    }

                    const program = state.programs.find(p => p.id === record.programId);
                    if (program) {
                        state.selectedProgramIdForDetails = program.id;
                        state.programDetailsOrigin = 'journal';
                        state.currentPage = 'programDetails';
                        render();
                    } else {
                        showToast('Программа не найдена');
                    }
                }
            });

            // Обработчик для долгого нажатия (удаление тренировки)
            let longPressTimer;
            let isLongPress = false;

            cell.addEventListener('touchstart', (e) => {
                e.stopPropagation();
                e.preventDefault(); // Предотвращаем выделение текста

                isLongPress = false;

                longPressTimer = setTimeout(() => {
                    isLongPress = true; // помечаем, что был долгий тап
                    openConfirmModal(
                        `Удалить запланированную тренировку "${dayRecords[0].programName}"?`,
                        async () => {
                            await deleteDoc(doc(getUserJournalCollection(), dayRecords[0].id));
                            showToast('Тренировка удалена!');
                            render(); // Обновляем страницу после удаления
                        }
                    );
                }, 800); // 800мс = долгое удержание
            });

            cell.addEventListener('touchend', async (e) => {
                clearTimeout(longPressTimer);

                // Если пользователь отпустил быстро (не долгий тап) → обычный переход
                if (!isLongPress) {
                    e.stopPropagation();

                    const record = dayRecords[0];
                    if (!record.isPlanned) {
                        // Открываем завершённую тренировку
                        state.selectedJournalRecord = record.id;
                        state.currentPage = 'journal';
                        render();
                    } else {
                        // Открываем запланированную
                        const cycle = state.cycles.find(c => c.name === record.cycleName);
                        if (cycle) {
                            state.selectedCycleId = cycle.id;
                            state.selectedJournalCategory = cycle.name;
                            setupDynamicListeners?.();
                        }

                        await openPlannedTraining(record);
                    }
                }
            });

            // Очистка таймера при отпускании
            cell.addEventListener('touchend', () => {
                clearTimeout(longPressTimer); // отмена долгого нажатия
            });

        } else {
            // Пустая ячейка — планирование
            cell.addEventListener('click', () => {
                openPlanTrainingDropdown(cell, dateStr);
            });
        }

        grid.append(cell);
    }

    container.append(grid);

    // ✅ Закрытие меню по клику вне
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
                    programId: program.id,
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
// 📌 Меню выбора тренировки в занятой ячейке (запланированные или завершённые)
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
            // ✅ ЗАПЛАНИРОВАННАЯ — ОТКРЫВАЕМ ПРОГРАММУ ИЛИ УДАЛЯЕМ
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
                        state.programDetailsOrigin = 'journal';
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
                    await deleteDoc(doc(getUserJournalCollection(), rec.id));  // Удаление записи из дневника
                }
                showToast('План удалён');
                dropdown.remove();
                render(); // Обновляем страницу после удаления
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
// 🆕 Открытие запланированной тренировки с умным ожиданием
// =================================================================
const openPlannedTraining = async (record) => {
    const cycle = state.cycles.find(c => c.name === record.cycleName);
    if (cycle) {
        state.selectedCycleId = cycle.id;
        state.selectedJournalCategory = cycle.name;
        setupDynamicListeners?.();
    }

    await new Promise(r => setTimeout(r, 300));

    let program = state.programs.find(p => p.id === record.programId);

    if (!program) {
        const snap = await getDocs(getUserProgramsCollection());
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        program = list.find(p => p.id === record.programId);
    }

    if (program) {
        state.selectedProgramIdForDetails = program.id;
        state.programDetailsOrigin = 'journal';
        state.currentPage = 'programDetails';
        render();
    } else {
        showToast(`⚠️ Программа "${record.programName}" не найдена`);
    }
};


// =================================================================
//  модалка редактирования даты завершенной тренировки
// =================================================================
function openDateModal(currentDate, onSave) {
  // Парсим дату в формат YYYY-MM-DD
  let [d, m, y] = currentDate.split('.');
  const formatted = `${y}-${m}-${d}`;

  // затемняющий фон
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  // модальное окно
  const modal = document.createElement('div');
  modal.className = 'modal-window';

  const title = document.createElement('h3');
  title.textContent = 'Выбери дату';

  const input = document.createElement('input');
  input.type = 'date';
  input.value = formatted;
  input.className = 'modal-date-input';

  const btnRow = document.createElement('div');
  btnRow.className = 'modal-btn-row';

  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Сохранить';
  saveBtn.className = 'btn modal-save-btn';

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Отмена';
  cancelBtn.className = 'btn modal-cancel-btn';

  btnRow.append(cancelBtn, saveBtn);
  modal.append(title, input, btnRow);
  overlay.append(modal);
  document.body.append(overlay);

  // плавное появление
  requestAnimationFrame(() => overlay.classList.add('visible'));

  // обработчики
  cancelBtn.onclick = () => {
    overlay.classList.remove('visible');
    setTimeout(() => overlay.remove(), 200);
    onSave(null);
  };

  saveBtn.onclick = () => {
    const val = input.value;
    overlay.classList.remove('visible');
    setTimeout(() => overlay.remove(), 200);
    onSave(val);
  };

  overlay.onclick = (e) => {
    if (e.target === overlay) cancelBtn.click();
  };
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

const menuRecord = createElement('div', 'menu-record');


// 🔥 Кнопка удаления тренировки
const deleteBtn = createElement('button', 'btn delete-record-btn');
deleteBtn.innerHTML = ' <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><title>Trash-24 SVG Icon</title><path fill="currentColor" d="M16 1.75V3h5.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H8V1.75C8 .784 8.784 0 9.75 0h4.5C15.216 0 16 .784 16 1.75m-6.5 0V3h5V1.75a.25.25 0 0 0-.25-.25h-4.5a.25.25 0 0 0-.25.25M4.997 6.178a.75.75 0 1 0-1.493.144L4.916 20.92a1.75 1.75 0 0 0 1.742 1.58h10.684a1.75 1.75 0 0 0 1.742-1.581l1.413-14.597a.75.75 0 0 0-1.494-.144l-1.412 14.596a.25.25 0 0 1-.249.226H6.658a.25.25 0 0 1-.249-.226z"></path><path fill="currentColor" d="M9.206 7.501a.75.75 0 0 1 .793.705l.5 8.5A.75.75 0 1 1 9 16.794l-.5-8.5a.75.75 0 0 1 .705-.793Zm6.293.793A.75.75 0 1 0 14 8.206l-.5 8.5a.75.75 0 0 0 1.498.088l.5-8.5Z"></path></svg> ';
deleteBtn.addEventListener('click', () => {
    openConfirmModal('Удалить эту тренировку?', async () => {
        try {
            await deleteDoc(doc(getUserJournalCollection(), record.id));
            showToast('Тренировка удалена');
            state.selectedJournalRecord = null;
            render();
        } catch (error) {
            console.error(error);
            showToast('Ошибка удаления');
        }
    });
});





    const backBtn = createElement('button', 'btn back-btn');
    backBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"><title>Ios-arrow-ltr-24-filled SVG Icon</title><path fill="currentColor" d="M12.727 3.687a1 1 0 1 0-1.454-1.374l-8.5 9a1 1 0 0 0 0 1.374l8.5 9.001a1 1 0 1 0 1.454-1.373L4.875 12z"></path></svg>';
    backBtn.addEventListener('click', () => {
        state.selectedJournalRecord = null;
        render();
    });
    menuRecord.append(backBtn,deleteBtn);
    container.append(menuRecord);

    // Заголовок
// 🔹 Заголовок с редактированием даты
const titleWrapper = createElement('div', 'record-header');
const titleDel = createElement('div', 'title-del');
const dateEdit = createElement('div', 'date-edit');




let nameElement = createElement('span', 'record-name', `${record.programName}`);
let dateElement = createElement('span', 'record-date', `${record.date}`);
const editBtn = createElement('button', 'edit-date-btn');
editBtn.innerHTML ='<svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24"><title>Edit SVG Icon</title><path fill="currentColor" d="M3.548 20.938h16.9a.5.5 0 0 0 0-1h-16.9a.5.5 0 0 0 0 1M9.71 17.18a2.587 2.587 0 0 0 1.12-.65l9.54-9.54a1.75 1.75 0 0 0 0-2.47l-.94-.93a1.788 1.788 0 0 0-2.47 0l-9.54 9.53a2.473 2.473 0 0 0-.64 1.12L6.04 17a.737.737 0 0 0 .19.72a.767.767 0 0 0 .53.22Zm.41-1.36a1.468 1.468 0 0 1-.67.39l-.97.26l-1-1l.26-.97a1.521 1.521 0 0 1 .39-.67l.38-.37l1.99 1.99Zm1.09-1.08l-1.99-1.99l6.73-6.73l1.99 1.99Zm8.45-8.45L18.65 7.3l-1.99-1.99l1.01-1.02a.748.748 0 0 1 1.06 0l.93.94a.754.754 0 0 1 0 1.06"></path></svg>';

titleWrapper.append(titleDel, dateEdit);
titleDel.append(nameElement,dateElement, editBtn);

container.append(titleWrapper);

// 📌 Редактирование даты
editBtn.addEventListener('click', () => {
  openDateModal(record.date, async (newDate) => {
    if (!newDate) return;
    const [year, month, day] = newDate.split('-');
    const formatted = `${day}.${month}.${year}`;

    try {
      await updateDoc(doc(getUserJournalCollection(), record.id), { date: formatted });
      showToast('Дата обновлена!');
      render();
    } catch (e) {
      console.error(e);
      showToast('Ошибка обновления даты');
    }
  });
});





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

// Берём только заполненные подходы
const arr = (exercise.sets || []).filter(s => s.weight || s.reps);

// индекс первого main-set
const firstMainIdx = arr.findIndex(s => s.isMain);

arr.forEach((s, i) => {
  // перед первым main-set вставляем перенос строки
  if (i === firstMainIdx && firstMainIdx !== -1) {
    sets.append(createElement('span', 'line-break')); // <-- перенос
  }

  const span = createElement('span', `set-item${s.isMain ? ' main-set' : ''}`);
  span.textContent = `${s.weight || 0}x${s.reps || 0}`;
  sets.append(span);
});

block.append(sets);


            const noteMediaWrap = createElement('div', 'note-media-wrap');
        if (exercise.note) {
            const note = createElement('p', 'exercise-note', exercise.note);

            noteMediaWrap.append(note);
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
            noteMediaWrap.append(mediaWrap);
        }
            block.append(noteMediaWrap);
        container.append(block);
    });



    root.append(container);
}








// =================================================================
// ✅ ГАРАНТИЯ ВЫБОРА ЦИКЛА
// =================================================================
export function ensureCycleSelected(onSelectedCallback) {
    if (isPersonalMode() && !hasSelectedClient()) {
        state.currentPage = 'programs';
        if (typeof onSelectedCallback === 'function') onSelectedCallback();
        return false;
    }
    if (!state.selectedCycleId) {
        openCycleSelectModal(onSelectedCallback);
        return false;
    }
    return true;
}


// =====================================================================
// 📦 МОДАЛЬНОЕ ОКНО ВЫБОРА ЦИКЛА
// =====================================================================
 export function openCycleSelectModal(callback) {
     const modal = document.createElement('div');
     modal.className = 'modal-overlay';

     const box = document.createElement('div');
     box.className = 'modal-box-cycle-list-supplements';

     const title = createElement('h3', null, 'Выберите цикл');
     box.append(title);

     const list = createElement('div', 'cycle-list');
     list.style.display = 'flex';
     list.style.flexDirection = 'column';
     list.style.gap = '8px';
     list.style.margin = '15px 0';

     if (!state.cycles || state.cycles.length === 0) {
         list.append(createElement('div', 'muted', 'Циклов пока нет.'));
     } else {
         state.cycles.forEach(cycle => {
             const btn = createElement('button', 'btn btn-light', cycle.name);

             btn.addEventListener('click', () => {
                 resetCycleScopedState();
                 state.selectedCycleId = cycle.id;

                 console.log('✅ Цикл выбран:', cycle.name);

                 document.body.removeChild(modal);

                 setupDynamicListeners();
                 rerenderCurrentPage();
             });

             list.append(btn);
         });
     }

     const cancel = createElement('button', 'btn btn-outline', 'Отмена');
     cancel.addEventListener('click', () => document.body.removeChild(modal));

     box.append(list, cancel);
     modal.append(box);
     document.body.append(modal);
 }

function rerenderCurrentPage() {
    switch (state.currentPage) {
        case 'meals':
            return renderMealPage();

        case 'supplements':
            return renderSupplementsPage();

        case 'programs':
            return renderProgramsPage?.();

        default:
            return render();
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























// =================================================================
// ⚙️ СЛУШАТЕЛИ FIREBASE (Управление динамическими коллекциями)
// =================================================================

function computeCyclesLinkKey() {
    if (state.currentMode !== 'personal' || !state.selectedClientId) return '';
    const cx = state.clients?.find((x) => x.id === state.selectedClientId);
    return `${cx?.linkStatus || 'none'}:${cx?.linkedUserUid || ''}`;
}

function attachCycleDataListeners() {
    cyclesUnsubscribeTrainer();
    cyclesUnsubscribeClient();
    cyclesTrainerBuffer = [];
    cyclesClientBuffer = [];

    const mergeCyclesAndMaybeRender = () => {
        mergeCyclesTrainerClientBuffers();
        if (state.currentPage === 'programs') render();
    };

    if (state.currentMode === 'own') {
        const ref = collection(db, `artifacts/${appId}/users/${userId}/cycles`);
        cyclesUnsubscribeTrainer = onSnapshot(ref, (snapshot) => {
            cyclesTrainerBuffer = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
            cyclesClientBuffer = [];
            mergeCyclesTrainerClientBuffers();
            if (state.currentPage === 'programs') render();
        });
        cyclesUnsubscribeClient = () => {};
        cyclesUnsubscribe = () => {
            cyclesUnsubscribeTrainer();
            cyclesUnsubscribeClient();
        };
    } else if (state.currentMode === 'personal' && state.selectedClientId) {
        const trainerCardRef = collection(
            db,
            `artifacts/${appId}/users/${userId}/clients/${state.selectedClientId}/cycles`
        );
        cyclesUnsubscribeTrainer = onSnapshot(trainerCardRef, (snapshot) => {
            cyclesTrainerBuffer = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
            mergeCyclesAndMaybeRender();
        });

        const linkedUid = getActiveLinkedClientUid();
        if (linkedUid) {
            const clientCanonRef = collection(db, `artifacts/${appId}/users/${linkedUid}/cycles`);
            cyclesUnsubscribeClient = onSnapshot(clientCanonRef, (snapshot) => {
                cyclesClientBuffer = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
                mergeCyclesAndMaybeRender();
            });
        } else {
            cyclesUnsubscribeClient = () => {};
            cyclesClientBuffer = [];
        }
        cyclesUnsubscribe = () => {
            cyclesUnsubscribeTrainer();
            cyclesUnsubscribeClient();
        };
    } else {
        cyclesUnsubscribe = () => {};
        state.cycles = [];
    }

    const programsRef = getUserProgramsCollection();
    if (programsRef && state.selectedCycleId) {
        programsUnsubscribe = onSnapshot(programsRef, (snapshot) => {
            state.programs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
            if (['programsInCycle', 'programDetails', 'supplements', 'journal', 'meal', 'reports'].includes(state.currentPage)) render();
        });
    }

    const journalRef = getUserJournalCollection();
    if (journalRef) {
        journalUnsubscribe = onSnapshot(journalRef, (snapshot) => {
            state.journal = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

            if (state.currentMode === 'personal' && state.selectedClientId && state.journal.length > 0 && !state.selectedCycleId) {
                const linked = getActiveLinkedClientUid();
                const clientRecords = linked
                    ? state.journal
                    : state.journal.filter((r) => r.clientId === state.selectedClientId);

                if (clientRecords.length > 0) {
                    const latestRecord = clientRecords.sort((a, b) => {
                        const aTime = a.updatedAt?.seconds || a.createdAt?.seconds || 0;
                        const bTime = b.updatedAt?.seconds || b.createdAt?.seconds || 0;
                        return bTime - aTime;
                    })[0];

                    const usedCycle =
                        state.cycles.find((c) => c.id === latestRecord.cycleId) ||
                        state.cycles.find((c) => c.name === latestRecord.cycleName);

                    if (usedCycle) {
                        state.selectedCycleId = usedCycle.id;
                        state.selectedJournalCategory = usedCycle.name;
                        console.log(`📘 Установлен цикл по умолчанию (журнал): ${usedCycle.name}`);
                    }
                }
            }

            if (state.currentPage === 'journal') render();
        });
    }

    if (state.selectedCycleId) {
        const cycleRef = getCycleDocRef?.();
        if (cycleRef) {
            supplementsUnsubscribe = onSnapshot(cycleRef, (docSnap) => {
                const docData = docSnap.exists() ? docSnap.data() : {};
                const supplementPlan = docData.supplementPlan || {};
                state.supplementPlan = {
                    supplements: Array.isArray(supplementPlan.supplements) ? supplementPlan.supplements : [],
                    data: Array.isArray(supplementPlan.data) ? supplementPlan.data : []
                };
                if (state.currentPage === 'supplements') render();
            });
        }
    }

    if (state.selectedCycleId) {
        const reportsRef = getReportsCollection();
        if (reportsRef) {
            reportsUnsubscribe = onSnapshot(reportsRef, (snapshot) => {
                state.reports = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
                if (state.currentPage === 'reports') render();
            });
        }
    }

    cyclesLinkKey = computeCyclesLinkKey();
}

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
            clientsUnsubscribe = onSnapshot(clientsRef, async (snapshot) => {
                state.clients = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                await syncTrainerClientCardsFromAcceptedInvites();
                const nk = computeCyclesLinkKey();
                if (state.currentMode === 'personal' && state.selectedClientId && nk !== cyclesLinkKey) {
                    programsUnsubscribe();
                    journalUnsubscribe();
                    supplementsUnsubscribe();
                    reportsUnsubscribe();
                    cyclesUnsubscribe();
                    attachCycleDataListeners();
                    if (['programs', 'programsInCycle', 'programDetails', 'journal', 'meal', 'reports', 'supplements'].includes(state.currentPage)) {
                        render();
                    }
                }
                if (state.currentPage === 'programs' && !state.selectedClientId) render();
            });
        }
    }

    // 2–6. Циклы, программы, журнал, БАДы, отчёты
    attachCycleDataListeners();
}


// -----------------------------------------------------------
// универсальную функция подтверждения удаления
// -----------------------------------------------------------

export function openConfirmModal(message, onConfirm) {
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
export function renderTopBar() {

    const oldBar = document.querySelector('.top-bar');
    const root = document.getElementById('root');
    if (oldBar) oldBar.remove();


        // 🧹 ОЧИСТКА старого плавающего таймера при переходе между страницами
        if (timerObserver) {
            try { timerObserver.disconnect(); } catch (_) {}
            timerObserver = null;
        }
        const oldFloating = document.querySelector('.btn-timer.floating');
        if (oldFloating) oldFloating.remove();
        // 🧹 конец очистки

    const topBar = document.createElement('div');
    topBar.className = 'top-bar';


 if (state.currentPage === 'supplements' || state.currentPage === 'meal') {

     const wrap = document.createElement('div');
     wrap.className = 'topbar-cycle-btns';

                    // 📄 PDF кнопка
                    const pdfButton = document.createElement('button');
                    pdfButton.className = 'btn btn-primaryPdf';
                    pdfButton.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 32 32"><title>Pdf SVG Icon</title><path fill="currentColor" d="M30 11V9h-8v14h2v-6h5v-2h-5v-4zM8 9H2v14h2v-5h4a2 2 0 0 0 2-2v-5a2 2 0 0 0-2-2m0 7H4v-5h4zm8 7h-4V9h4a4 4 0 0 1 4 4v6a4 4 0 0 1-4 4m-2-2h2a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-2z"></path></svg>
         `;

            pdfButton.onclick = () => {
                console.log('PDF CLICK');

                const cycle = state.cycles?.find(c => c.id === state.selectedCycleId);

                if (!cycle) {
                    console.log('❌ нет цикла');
                    return;
                }

                console.log('currentPage:', state.currentPage);

                if (state.currentPage === 'supplements') {
                    console.log('👉 supplements');
                    openPdfDateModal(cycle);
                }

                if (state.currentPage === 'meal') {
                    console.log('👉 meal');
                    openMealsPdfModal(cycle);
                }
            };

            if (state.currentPage === 'meal') {
                const targetBtn = document.createElement('button');
                targetBtn.type = 'button';
                targetBtn.className = 'calendar-btn meal-target-btn';
                targetBtn.id = 'meal-target-btn';
                targetBtn.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 16 16"><title>Document-target-16-regular SVG Icon</title><path fill="currentColor" d="m9.647 1.439l2.914 2.914l.001-.001c.281.282.439.663.439 1.061v7.586a2 2 0 0 1-2 2H7.258l.133-.1a2.4 2.4 0 0 0 .281-.229c.203-.203.374-.434.534-.671h2.795a1 1 0 0 0 1-1v-7h-2.5a1.5 1.5 0 0 1-1.5-1.5v-2.5h-3a1 1 0 0 0-1 1v3.092a1.48 1.48 0 0 0-.983 1.177l-.01.004L3 7.276V3a2 2 0 0 1 2-2h3.586a1.5 1.5 0 0 1 1.061.439M9 4.499a.5.5 0 0 0 .5.5h2.293L9 2.206zm-4.5 8a1 1 0 1 0 .002-2.001a1 1 0 0 0-.002 2.001m4-1.5h-.551A3.49 3.49 0 0 0 5 8.05v-.551a.5.5 0 1 0-1 0v.551a3.49 3.49 0 0 0-2.949 2.949H.5a.5.5 0 1 0 0 1h.551A3.49 3.49 0 0 0 4 14.948v.551a.5.5 0 1 0 1 0v-.551a3.49 3.49 0 0 0 2.949-2.949H8.5a.5.5 0 1 0 0-1m-2.232 2.268a2.501 2.501 0 0 1-4.078-2.724a2.501 2.501 0 1 1 4.078 2.724"></path></svg>
                `;
                targetBtn.onclick = () => {
                    state.mealView = 'goal';
                    renderMealPage();
                };
                wrap.append(pdfButton, targetBtn);
            } else {
                wrap.append(pdfButton);
            }

            topBar.appendChild(wrap);
        }




    // ------- СТРЕЛКА НАЗАД (с текстом) -------
    let showBack = false;
    const backBtn = document.createElement('button');
    backBtn.className = 'top-back-btn';

    // ✅ 1. Если мы в циклах клиента — показать стрелку "к клиентам"
        if (state.currentMode === 'personal' && state.currentPage === 'programs' && state.selectedClientId) {
            backBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"><title>Ios-arrow-ltr-24-filled SVG Icon</title><path fill="currentColor" d="M12.727 3.687a1 1 0 1 0-1.454-1.374l-8.5 9a1 1 0 0 0 0 1.374l8.5 9.001a1 1 0 1 0 1.454-1.373L4.875 12z"></path></svg>';
            backBtn.onclick = () => {
                resetClientScopedState();
                state.currentPage = 'programs'; // вернёмся в список клиентов
                setupDynamicListeners();
                render();
            };
            showBack = true;
        }

    if (state.currentPage === 'profile') {
        backBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"><title>Ios-arrow-ltr-24-filled SVG Icon</title><path fill="currentColor" d="M12.727 3.687a1 1 0 1 0-1.454-1.374l-8.5 9a1 1 0 0 0 0 1.374l8.5 9.001a1 1 0 1 0 1.454-1.373L4.875 12z"></path></svg>';
        backBtn.onclick = () => {
            state.profileCabinetEditing = false;
            state.currentPage = state.profileOriginPage || 'programs';
            state.profileOriginPage = null;
            render();
        };
        showBack = true;
    }

    if (state.currentPage === 'programsInCycle') {
        backBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"><title>Ios-arrow-ltr-24-filled SVG Icon</title><path fill="currentColor" d="M12.727 3.687a1 1 0 1 0-1.454-1.374l-8.5 9a1 1 0 0 0 0 1.374l8.5 9.001a1 1 0 1 0 1.454-1.373L4.875 12z"></path></svg>';
        backBtn.onclick = () => { state.currentPage = 'programs'; render(); };
        showBack = true;
    }

    if (state.currentPage === 'programDetails') {
        backBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"><title>Ios-arrow-ltr-24-filled SVG Icon</title><path fill="currentColor" d="M12.727 3.687a1 1 0 1 0-1.454-1.374l-8.5 9a1 1 0 0 0 0 1.374l8.5 9.001a1 1 0 1 0 1.454-1.373L4.875 12z"></path></svg>';
        backBtn.onclick = () => {
            const origin = state.programDetailsOrigin;
            state.programDetailsOrigin = null;
            if (origin === 'journal') {
                state.currentPage = 'journal';
            } else {
                state.currentPage = 'programsInCycle';
            }
            render();
        };
        showBack = true;

        // 🔥 Кнопка таймера для страницы деталей программы
        if (state.currentPage === 'programDetails') {
            const timerBtn = document.createElement('button');
            timerBtn.className = 'btn btn-timer';
            timerBtn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 12 12"><title>Timer-12-regular SVG Icon</title><path fill="currentColor" d="M3 .5a.5.5 0 0 1 .5-.5h4a.5.5 0 0 1 0 1h-4A.5.5 0 0 1 3 .5m2 7a.5.5 0 0 0 1 0v-3a.5.5 0 0 0-1 0zM5.5 2a4.5 4.5 0 1 0 0 9a4.5 4.5 0 0 0 0-9M2 6.5a3.5 3.5 0 1 1 7 0a3.5 3.5 0 0 1-7 0m8.148-2.647a.5.5 0 1 0 .706-.708l-1.002-.998a.5.5 0 1 0-.706.708z"></path></svg>
            `;
            timerBtn.onclick = openTimerModal;
            topBar.appendChild(timerBtn);
        }

    }


    if (showBack) topBar.appendChild(backBtn);

    // ------- ГАМБУРГЕР (ВСЕГДА СПРАВА) -------
    const burger = document.createElement('button');
    burger.className = 'top-menu-btn';
    burger.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 15 15"><title>Hamburger-menu SVG Icon</title><path fill="currentColor" fill-rule="evenodd" d="M1.5 3a.5.5 0 0 0 0 1h12a.5.5 0 0 0 0-1zM1 7.5a.5.5 0 0 1 .5-.5h12a.5.5 0 0 1 0 1h-12a.5.5 0 0 1-.5-.5m0 4a.5.5 0 0 1 .5-.5h12a.5.5 0 0 1 0 1h-12a.5.5 0 0 1-.5-.5" clip-rule="evenodd"></path></svg>';
    burger.onclick = openMenuModal;
    topBar.appendChild(burger);

    root.prepend(topBar);
    setupFloatingTimer(topBar);


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
        <svg xmlns="http://www.w3.org/2000/svg" width="37" height="37" viewBox="0 0 56 56"><title>Arrow-2-squarepath SVG Icon</title><path fill="currentColor" d="M40.131 7.904h-18.27c-1.28 0-2.02.65-1.997 1.795c.022 1.145.718 1.818 1.997 1.818h18.203c2.245 0 3.501 1.19 3.501 3.524v24.375l-3.366-3.59l-2.133-2.11c-.763-.741-1.84-.831-2.603-.068c-.763.763-.718 1.863.045 2.626l7.564 7.519c1.459 1.459 3.097 1.459 4.556 0l7.564-7.519c.785-.763.808-1.863.045-2.626c-.763-.763-1.818-.696-2.582.067l-2.154 2.11l-3.322 3.569V14.862c0-4.646-2.379-6.958-7.048-6.958m-24.24 41.32h18.27c1.28 0 2.02-.65 1.998-1.795c-.023-1.167-.719-1.818-1.998-1.818H15.936c-2.245 0-3.48-1.19-3.48-3.524V17.712l3.345 3.569l2.155 2.132c.763.74 1.818.83 2.604.045c.763-.74.718-1.84-.045-2.604l-7.564-7.541c-1.482-1.437-3.098-1.437-4.58 0L.809 20.854C.9 21.618 0 22.717.763 23.458c.763.786 1.84.696 2.604-.045l2.154-2.132l3.322-3.546v24.532c0 4.646 2.357 6.958 7.048 6.958"></path></svg>
    `;
    modeBtn.title = 'Сменить режим';
    modeBtn.onclick = () => {
        overlay.remove();
        state.currentMode = null;
        state.currentPage = 'modeSelect';
        render();
    };

    const profileBtn = document.createElement('button');
    profileBtn.className = 'menu-icon-btn';
    profileBtn.title = 'Личный кабинет';
    profileBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24"><title>Person SVG Icon</title><path fill="currentColor" d="M12 12q-1.65 0-2.825-1.175T8 8t1.175-2.825T12 4t2.825 1.175T16 8t-1.175 2.825T12 12m-8 8v-1.8q0-.85.438-1.55T5.6 15.85q1.55-.775 3.15-1.163T12 14.5q1.65 0 3.25.388t3.15 1.162q.775.4 1.213 1.1T20 18.2V20zm2-2h12v-.8q0-.3-.137-.512t-.363-.288q-1.425-.725-2.787-1.112T12 16.5q-1.65 0-3.012.388T6.5 18.1q-.225.125-.363.3T6 18.8zm6-8.5q.825 0 1.413-.587T14 8t-.587-1.412T12 6t-1.412.588T10 8t.588 1.413T12 11.5m0 8"/></svg>
    `;
    profileBtn.onclick = () => {
        overlay.remove();
        state.profileCabinetEditing = false;
        state.profileOriginPage = state.currentPage;
        state.currentPage = 'profile';
        render();
    };

    // SVG кнопка выхода
    const logoutBtn = document.createElement('button');
    logoutBtn.className = 'menu-icon-btn';
    logoutBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="37" height="37" viewBox="0 0 16 16"><title>Box-arrow-left SVG Icon</title><g fill="currentColor" fill-rule="evenodd"><path d="M6 12.5a.5.5 0 0 0 .5.5h8a.5.5 0 0 0 .5-.5v-9a.5.5 0 0 0-.5-.5h-8a.5.5 0 0 0-.5.5v2a.5.5 0 0 1-1 0v-2A1.5 1.5 0 0 1 6.5 2h8A1.5 1.5 0 0 1 16 3.5v9a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 5 12.5v-2a.5.5 0 0 1 1 0z"></path><path d="M.146 8.354a.5.5 0 0 1 0-.708l3-3a.5.5 0 1 1 .708.708L1.707 7.5H10.5a.5.5 0 0 1 0 1H1.707l2.147 2.146a.5.5 0 0 1-.708.708z"></path></g></svg>
    `;
    logoutBtn.title = 'Выйти из аккаунта';
    logoutBtn.onclick = async () => {
        overlay.remove();
        await signOut(auth);
        showToast("Вы вышли.");
    };

    modal.append(modeBtn, profileBtn, logoutBtn);
    overlay.append(modal);
    document.body.append(overlay);

    // Закрытие по клику по фону (не по модалке)
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.remove();
        }
    });
}


// ============================================================
// 📦 Регистрация Service Worker и уведомления
// ============================================================
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  const isCapacitorNative =
    window.Capacitor?.isNativePlatform?.() === true ||
    /Capacitor/i.test(window.navigator?.userAgent || '');

  if (!isCapacitorNative) {
    try {
      const swUrl = new URL('./sw.js', import.meta.url);
      const scope = new URL('./', import.meta.url).href;
      navigator.serviceWorker
        .register(swUrl.href, { scope })
        .then(() => console.log('✅ Service Worker зарегистрирован'))
        .catch((err) => console.error('Ошибка регистрации SW', err));
    } catch (err) {
      console.error('Ошибка регистрации SW', err);
    }
  }
}





// =================================================================
// 🔄 ГЛАВНЫЙ РЕНДЕР: Определяет, что показать (ИСПРАВЛЕНО)
// =================================================================
export function render() {
    const root = document.getElementById('root');
    root.innerHTML = '';

    renderTopBar();

    const openDropdown = document.querySelector('.training-dropdown');
    if (openDropdown) openDropdown.remove();

    toggleAppVisibility(!!userId);

    if (!userId || state.currentMode === null) {
        hideStatusBarEverywhere();
        syncBottomNavAfterRender(state.currentPage);
        return;
    }

    const clientRequiredPages = ['programsInCycle', 'programDetails', 'meal', 'reports', 'supplements', 'journal', 'journalRecordDetails'];
    if (isPersonalMode() && !hasSelectedClient() && clientRequiredPages.includes(state.currentPage)) {
        state.currentPage = 'programs';
    }

    const cycleRequiredPages = ['programsInCycle', 'programDetails', 'meal', 'reports', 'supplements', 'cycleReport', 'mealsReport'];
    if (!hasSelectedCycle() && cycleRequiredPages.includes(state.currentPage)) {
        state.currentPage = 'programs';
    }

    if (state.currentPage === 'programs') {
        renderCyclesPage();
    } else if (state.currentPage === 'programsInCycle') {
        renderProgramsInCyclePage();
    } else if (state.currentPage === 'programDetails') {
        renderProgramDetailsPage();
    } else if (state.currentPage === 'journal') {
        renderJournalPage();
    } else if (state.currentPage === 'journalRecordDetails') {
        renderJournalRecordDetails();
    } else if (state.currentPage === 'supplements') {
        renderSupplementsPage();
    } else if (state.currentPage === 'meal') {
        renderMealPage();
    } else if (state.currentPage === 'profile') {
        renderProfilePage();
    } else if (state.currentPage === 'reports') {
        renderReportsPage();
    } else if (state.currentPage === 'cycleReport') {
        renderCycleReportPage(state.reportHtmlCache);
        syncBottomNavAfterRender(state.currentPage);
        hideStatusBarEverywhere();
        return;
    } else if (state.currentPage === 'mealsReport') {
        renderMealsReportPage(state.reportHtmlCache);
        syncBottomNavAfterRender(state.currentPage);
        hideStatusBarEverywhere();
        return;
    } else if (state.currentPage === 'modeSelect') {
        syncBottomNavAfterRender(state.currentPage);
        hideStatusBarEverywhere();
        return;
    }

    syncBottomNavAfterRender(state.currentPage);

    hideStatusBarEverywhere();
}
window.render = render;

initBottomNav();

async function hideStatusBarEverywhere() {
    try {
        const StatusBar = window.Capacitor?.Plugins?.StatusBar;
        if (!StatusBar) return;
        await StatusBar.hide({ animation: 'NONE' });
    } catch (err) {
        console.error('StatusBar error:', err);
    }
}

window.hideStatusBarEverywhere = hideStatusBarEverywhere;

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
        const titleEl = document.querySelector('.auth-box__title') || document.querySelector('.auth-box h3');
        if (titleEl) titleEl.textContent = isLoginMode ? 'Вход в Дневник' : 'Регистрация';
        syncAuthRegisterFieldsVisibility(isLoginMode);
    });

    syncAuthRegisterFieldsVisibility(isLoginMode);

    authLoginBtn.addEventListener('click', async () => {
        const email = document.getElementById('auth-email').value.trim();
        const password = document.getElementById('auth-password').value;
        try {
            if (isLoginMode) {
                await signInWithEmailAndPassword(auth, email, password);
                showToast('Вход выполнен успешно!');
            } else {
                const firstName = document.getElementById('auth-first-name')?.value?.trim() || '';
                const lastName = document.getElementById('auth-last-name')?.value?.trim() || '';
                const patronymic = document.getElementById('auth-patronymic')?.value?.trim() || '';
                const birthDate = document.getElementById('auth-birth-date')?.value || '';

                if (!firstName || !lastName || !patronymic || !birthDate) {
                    showToast('Заполните имя, фамилию, отчество и дату рождения.');
                    return;
                }
                if (!email || !password) {
                    showToast('Укажите email и пароль.');
                    return;
                }

                const cred = await createUserWithEmailAndPassword(auth, email, password);
                const code = await createUserProfileAndAssignCode(cred.user.uid, {
                    firstName,
                    lastName,
                    patronymic,
                    birthDate
                });
                await refreshUserProfileFromServer();
                render();
                showPostRegistrationModal(code);
            }
        } catch (error) {
            console.error("Ошибка аутентификации:", error);
            showToast('Ошибка: ' + (error.message.includes('auth/invalid-credential') ? 'Неверный email или пароль.' : error.message));
        }
    });
}


// ======================================================================
// 🖱️ ОБРАБОТЧИКИ КЛИКОВ (нижняя навигация — ./nav/bottom-nav.js)
// =================================================================

// 🔥 ОБРАБОТЧИК: СОБСТВЕННЫЕ ТРЕНИРОВКИ
document.getElementById('select-own-mode')?.addEventListener('click', () => {
    resetModeScopedState();
    state.currentMode = 'own';
    state.currentPage = 'programs';

    setupDynamicListeners();
    render();
});

// 🔥 ОБРАБОТЧИК: ПЕРСОНАЛЬНЫЕ (ТРЕНЕР)
document.getElementById('select-personal-mode')?.addEventListener('click', () => {
    resetModeScopedState();
    state.currentMode = 'personal';
    state.currentPage = 'programs';

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

onAuthStateChanged(auth, async (user) => {
    const loading = document.getElementById('loading-screen');

    // Пока грузится — показываем лоадер
    loading.classList.remove('hide');

    unsubscribeAll();

    if (user) {
        userId = user.uid;
        console.log('🔑 Пользователь вошёл:', userId);

        try {
            await refreshUserProfileFromServer();
        } catch (e) {
            console.warn('Профиль не загружен:', e);
            state.userProfile = null;
        }

        // Если режим ещё не выбран — показываем выбор режима
        if (state.currentMode === null) {
            state.currentPage = 'modeSelect';
            toggleAppVisibility(true);
        } else {
            setupDynamicListeners();
        }

    } else {
        userId = null;
        state.currentMode = null;
        state.selectedClientId = null;
        state.currentPage = 'auth';
        state.userProfile = null;
        toggleAppVisibility(false);
    }

    // Первичный рендер
    render();

    // ❗ Даем приложению дорендериться → и скрываем загрузку
    setTimeout(() => {
        loading.classList.add('hide');
    }, 300); // можно увеличить если захочешь плавности
});
