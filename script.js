import { initializeApp } from "firebase/app";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import { renderMealPage } from './pages/meal.js';
import { renderReportsPage } from './pages/reports.js';
import { renderProfilePage } from './pages/profile.js';
import { renderSupplementsPage } from './pages/supplement.js';
import { cleanupSupplementTransientUi } from './pages/supplement.js';
import { openPdfDateModal } from './pages/supplement.js';
import { isSupplementsTableViewActive } from './pages/supplement.js';

import { openMealsPdfModal } from './pages/meal.js';
import { generateMealsPdf } from './pages/meal.js';
import { renderMealsReportPage } from './pages/meal.js';
import { destroyMealShellState, resetMealsState } from './pages/meal.js';

import { resolveSwipePanAxis } from './gestures.js';
import { attachSwipeRow, closeSwipeRowVisual } from './swipe-engine.js';

import { renderCycleReportPage } from './pages/supplement.js';
import { resetSupplementsListener } from './pages/supplement.js';
import { getSupplementPlanSnapshotSignature } from './pages/supplement.js';
import { sanitizeSupplementPlan } from './pages/supplement.js';
import { attachMonthCarouselSwipe } from './calendar-month-carousel.js';
import {
    initBottomNav,
    syncBottomNavAfterRender,
    syncBottomNavTrialCountdown,
    setBottomNavLayoutFromAppVisibility,
    syncSupplementsBottomNavBadge
} from './nav/bottom-nav.js';
// Чтобы отключить нижнее меню: замените импорт выше на './nav/bottom-nav.stub.js'
import {
    initializeAuth,
    browserLocalPersistence,
    indexedDBLocalPersistence,
    browserSessionPersistence,
    beforeAuthStateChanged,
    onAuthStateChanged,
    createUserWithEmailAndPassword,
    signInWithEmailAndPassword,
    signInWithCustomToken,
    signOut
} from "firebase/auth";
import {
    initializeFirestore,
    memoryLocalCache,
    persistentLocalCache,
    persistentSingleTabManager
} from "firebase/firestore";
import {
    doc,
    addDoc,
    setDoc,
    updateDoc,
    deleteDoc,
    deleteField,
    onSnapshot,
    collection,
    getDocs,
    getDoc,
    query,
    where,
    runTransaction,
    serverTimestamp,
    writeBatch,
    arrayUnion
} from "./offline/firestore-ops.js";

// 🔥 ДОБАВЛЯЕМ ИМПОРТЫ ДЛЯ FIREBASE STORAGE
import {
    getStorage,
    ref,
    uploadBytesResumable,
    getDownloadURL,
    deleteObject
} from "firebase/storage";
import { initNetworkMonitoring, getNetworkStatusSnapshot, subscribeNetworkStatus, isNetworkOffline } from './offline/network-status.js';
import { describeSyncStatus, getSyncStatusSnapshot, subscribeSyncStatus } from './offline/sync-status.js';
import { getCachedMediaObjectUrl, preloadMediaUrls as preloadOfflineMediaUrls } from './offline/media-cache.js';
import {
    attachPendingMediaTarget,
    deletePendingMediaUpload,
    getPendingMediaObjectUrl,
    isPendingMediaUrl as isPendingMediaUrlFromQueue,
    listPendingMediaUploads,
    queuePendingMediaFile,
    releasePendingMediaObjectUrls,
    updatePendingMediaState
} from './offline/pending-media-queue.js';
import {
    createProgram,
    deleteProgram,
    queueProgramExercisesSave as queueProgramExercisesSaveViaRepository,
    updateProgramDocument
} from './offline/repositories/programs-repository.js';
import { createClient, deleteClient, updateClient } from './offline/repositories/clients-repository.js';
import { createCycle, deleteCycle, updateCycle } from './offline/repositories/cycles-repository.js';
import {
    createJournalRecord,
    deleteJournalRecord,
    deleteJournalRecordsByIds,
    replacePlannedTrainingWithCompleted,
    updateJournalRecord
} from './offline/repositories/journal-repository.js';

document.addEventListener('contextmenu', (e) => e.preventDefault(), { capture: true });

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
const LAST_SELECTED_CYCLE_STORAGE_PREFIX = 'trainingDiary:lastSelectedCycle:v1';
const LOCAL_BUILD_TRIAL_STARTED_AT_KEY = 'trainingDiary:localBuildTrialStartedAt:v1';
const LOCAL_BUILD_TRIAL_BUILD_STAMP_KEY = 'trainingDiary:localBuildTrialBuildStamp:v1';
const LOCAL_BUILD_TRIAL_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const FIRESTORE_PERSISTENT_CACHE_BYTES = 100 * 1024 * 1024;


// Используем projectId в качестве уникального ID приложения для структуры базы
const appId = firebaseConfig.projectId;
const EXCLUSIVE_SESSION_DOC_ID = 'authSession';
const EXCLUSIVE_SESSION_DEVICE_ID_KEY = `trainingDiary:exclusiveSessionDeviceId:${appId}`;
const EXCLUSIVE_SESSION_NOTICE_KEY = `trainingDiary:exclusiveSessionNotice:${appId}`;
const initialAuthToken = null;
const APPLE_HEALTH_CAPACITOR_CALLBACK_SCHEME = 'App';

function parseAppleHealthSyncReturnUrl(rawUrl) {
    try {
        if (!rawUrl) return null;
        const url = new URL(String(rawUrl));
        if (!url.searchParams.has('appleHealthSync')) return null;

        return {
            status: String(url.searchParams.get('status') || 'done'),
            date: String(url.searchParams.get('appleHealthDate') || '').trim(),
            target: String(url.searchParams.get('appleHealthTarget') || '').trim()
        };
    } catch (_) {
        return null;
    }
}

function readAppleHealthSyncReturnParams() {
    const payload = parseAppleHealthSyncReturnUrl(window.location.href);
    if (!payload) return null;

    try {
        const url = new URL(window.location.href);
        url.searchParams.delete('appleHealthSync');
        url.searchParams.delete('appleHealthDate');
        url.searchParams.delete('appleHealthTarget');
        url.searchParams.delete('status');
        const cleanSearch = url.searchParams.toString();
        const cleanUrl = `${url.pathname}${cleanSearch ? `?${cleanSearch}` : ''}${url.hash || ''}`;
        window.history.replaceState({}, '', cleanUrl);

        return payload;
    } catch (_) {
        return null;
    }
}

const initialAppleHealthSyncReturn = readAppleHealthSyncReturnParams();
// =================================================================

if (!firebaseConfig || Object.keys(firebaseConfig).length === 0) {
    console.error("Firebase config is missing. Please provide it for the app to work correctly.");
}

// ==========================================================
// 🚀 ИНИЦИАЛИЗАЦИЯ FIREBASE
// ==========================================================

const app = initializeApp(firebaseConfig);

const db = (() => {
    try {
        return initializeFirestore(app, {
            localCache: persistentLocalCache({
                cacheSizeBytes: FIRESTORE_PERSISTENT_CACHE_BYTES,
                tabManager: persistentSingleTabManager()
            })
        });
    } catch (error) {
        console.warn('[firestore] Falling back to memory cache:', error);
        return initializeFirestore(app, {
            localCache: memoryLocalCache()
        });
    }
})();
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
let linkedTrainerAccessUnsubscribe = () => {};
let ownLinkedTrainersUnsubscribe = () => {};
let cyclesTrainerBuffer = [];
let cyclesClientBuffer = [];
let cyclesLinkKey = '';

const CODE_LOOKUP_WINDOW_MS = 60_000;
const CODE_LOOKUP_MAX = 20;
let codeLookupTimestamps = [];
// 🔥 ДОБАВЛЕНО: Слушатели для БАДОВ и ОТЧЕТОВ
let supplementsUnsubscribe = () => {};
let reportsUnsubscribe = () => {};
let networkMonitoringCleanup = () => {};
let syncStatusUnsubscribe = () => {};
let networkStatusUnsubscribe = () => {};
let authSessionUnsubscribe = () => {};
let exclusiveSessionMeta = null;
let exclusiveSessionClaimPromise = null;
let exclusiveSessionClaimFingerprint = '';
let exclusiveSessionInFlightFingerprint = '';
let exclusiveSessionSignOutPromise = null;
let exclusiveSessionReauthPromise = null;
let exclusiveSessionWasOnline = getNetworkStatusSnapshot().online !== false;
let exclusiveSessionWriteLockState = null;
let exclusiveSessionReadOnlyOverlay = null;
let pendingExclusiveSessionLoginAttempt = null;
const cyclePreloadInFlight = new Map();
const cyclePreloadCompletedAt = new Map();

const EXCLUSIVE_SESSION_TAKEOVER_TITLE = 'Аккаунт уже открыт на другом устройстве';
const EXCLUSIVE_SESSION_SIGNED_OUT_MESSAGE = 'Вход выполнен на другом устройстве. Это устройство вышло из аккаунта, чтобы уменьшить риск перезаписи данных.';
const EXCLUSIVE_SESSION_READ_ONLY_MESSAGE = 'Аккаунт открыт на другом устройстве. Это устройство переведено в режим только чтения, чтобы уменьшить риск перезаписи данных.';



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
    selectedClientTrainerAccess: null,
    ownLinkedTrainersAccess: [],
    isProgramsLoading: false,

    userProfile: null,
    localBuildTrial: null,
    profileCabinetEditing: false,
    profileOriginPage: null,
    networkStatus: getNetworkStatusSnapshot(),
    syncStatus: getSyncStatusSnapshot(),
    appleHealthSyncReturn: initialAppleHealthSyncReturn,
    appleHealthSyncToastShown: false,

    /** Снимок getBoundingClientRect карточек циклов до render() — для FLIP-анимации */
    cycleFlipPrevRects: null,

};
window.state = state;

function queueProgramExercisesSave(programId, exercises, options = {}) {
    queueProgramExercisesSaveViaRepository(getUserProgramsCollection(), programId, exercises, {
        ...options,
        onError: (_error, errorMessage) => {
            showToast(errorMessage);
        }
    });
}

function cloneProgramExercisesSnapshot(exercises = []) {
    return JSON.parse(JSON.stringify(Array.isArray(exercises) ? exercises : []));
}

function scheduleProgramExercisesSave(programId, exercises, options = {}) {
    if (!programId) return Promise.resolve();

    const snapshot = cloneProgramExercisesSnapshot(exercises);
    const delayMs = Number.isFinite(options.delayMs) ? Math.max(0, Number(options.delayMs)) : 420;

    return programExercisesWriter.schedule(
        programId,
        () => updateDoc(doc(getUserProgramsCollection(), programId), { exercises: snapshot }),
        { delayMs }
    );
}

function queueProgramExercisesSaveLegacy(programId, exercises, options = {}) {
    const errorMessage = options.errorMessage || 'Не удалось сохранить изменения тренировки';

    void scheduleProgramExercisesSave(programId, exercises, options).catch((error) => {
        console.error('[program-save] failed:', error);
        showToast(errorMessage);
    });
}

export function getAppNetworkStatus() {
    return state.networkStatus || getNetworkStatusSnapshot();
}

export function getAppSyncStatus() {
    return state.syncStatus || getSyncStatusSnapshot();
}

export function isOfflineModeActive() {
    return getAppNetworkStatus().online === false;
}

export function isOfflineMediaUploadUnsupportedError(error) {
    return String(error?.message || error || '').trim() === 'offline_media_upload_not_supported';
}

export function getOfflineMediaUploadUnavailableMessage() {
    return 'Офлайн-режим: фото и видео пока можно добавлять только при наличии интернета';
}

export function getOnlineOnlyFeatureMessage(featureLabel = 'Эта функция') {
    return `${featureLabel} доступна только онлайн`;
}

function throwIfOnlineOnlyFeatureOffline(featureLabel) {
    if (isOfflineModeActive()) {
        throw new Error(getOnlineOnlyFeatureMessage(featureLabel));
    }
}

function isPendingMediaUrl(url) {
    return isPendingMediaUrlFromQueue(url);
}

function getOfflineMediaQueuedMessage() {
    return 'Фото сохранено на устройстве и будет загружено, когда появится интернет.';
}

function shouldShowSyncStatusPill(snapshot = getAppSyncStatus()) {
    return snapshot.status !== 'synced';
}

function getSyncStatusPillLabel(snapshot = getAppSyncStatus()) {
    switch (snapshot.status) {
        case 'offline-pending':
            return 'Ждёт сети';
        case 'offline':
            return 'Офлайн';
        case 'syncing':
            return 'Сохраняю…';
        case 'error':
        case 'offline-error':
            return 'Не сохранено';
        default:
            return 'Сохранено';
    }
}

function getSyncStatusPillTitle(snapshot = getAppSyncStatus()) {
    const base = describeSyncStatus(snapshot);
    if (snapshot.pendingWrites > 0) {
        const count = snapshot.pendingWrites;
        const noun = pluralizeRussianUnit(count, 'изменение', 'изменения', 'изменений');
        return `${base}. В очереди ${count} ${noun}.`;
    }
    return base;
}

function syncTopBarSyncStatusIndicator() {
    const host = document.body;
    if (!host) return;

    let pill = host.querySelector('.top-bar-sync-status');
    const snapshot = getAppSyncStatus();
    const shouldShow = shouldShowSyncStatusPill(snapshot)
        && Boolean(userId)
        && state.currentMode !== null
        && state.currentPage !== 'auth'
        && state.currentPage !== 'modeSelect';

    if (!shouldShow) {
        pill?.remove();
        return;
    }

    if (!pill) {
        pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'top-bar-sync-status';
        pill.addEventListener('click', () => {
            const current = getAppSyncStatus();
            showToast(getSyncStatusPillTitle(current));
        });
        host.appendChild(pill);
    }

    pill.className = `top-bar-sync-status top-bar-sync-status--${snapshot.status}`;
    pill.textContent = getSyncStatusPillLabel(snapshot);
    pill.title = getSyncStatusPillTitle(snapshot);
    pill.setAttribute('aria-label', pill.title);
}

function applyAppConnectivityState({ rerender = false } = {}) {
    state.networkStatus = getNetworkStatusSnapshot();
    state.syncStatus = getSyncStatusSnapshot();
    syncTopBarSyncStatusIndicator();
    if (rerender) render();
}

function enqueueAppleHealthSyncReturn(payload, { rerender = false } = {}) {
    if (!payload || typeof payload !== 'object') return false;

    state.appleHealthSyncReturn = {
        status: String(payload.status || 'done'),
        date: String(payload.date || '').trim(),
        target: String(payload.target || '').trim(),
        _handled: false
    };
    state.appleHealthSyncToastShown = false;

    if (rerender) {
        try {
            render();
        } catch (_) {}
    }

    return true;
}

async function installCapacitorAppleHealthReturnListener() {
    if (!isCapacitorNativePlatform()) return;

    const appPlugin = window.Capacitor?.Plugins?.App;
    if (!appPlugin) {
        console.warn('[AppleHealth] Capacitor App plugin is not available. Native x-success return is disabled.');
        return;
    }

    const handleUrl = (rawUrl) => {
        const payload = parseAppleHealthSyncReturnUrl(rawUrl);
        if (!payload) return false;
        return enqueueAppleHealthSyncReturn(payload, { rerender: true });
    };

    try {
        if (typeof appPlugin.addListener === 'function') {
            await appPlugin.addListener('appUrlOpen', (event) => {
                handleUrl(event?.url);
            });
        }
    } catch (error) {
        console.warn('[AppleHealth] Failed to subscribe to appUrlOpen.', error);
    }

    try {
        if (typeof appPlugin.getLaunchUrl === 'function') {
            const launch = await appPlugin.getLaunchUrl();
            handleUrl(launch?.url);
        }
    } catch (error) {
        console.warn('[AppleHealth] Failed to read launch URL.', error);
    }
}

// =================================================================
// Scroll memory (in-memory, resets on reload)
// Один скролл-контейнер (#root) используется для разных страниц,
// поэтому храним scrollTop раздельно по "ключу экрана".
// =================================================================
const __scrollTopByViewKey = new Map();
let __lastViewKeyForScrollMemory = null;

function getScrollMemoryViewKey() {
    // journal имеет два состояния: список (завершённые/план) и детали записи.
    if (state.currentPage === 'journal') {
        return state.selectedJournalRecord ? `journal:record:${state.selectedJournalRecord}` : 'journal:list';
    }
    return String(state.currentPage || 'unknown');
}

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

function getLastSelectedCycleStorageKey() {
    if (!userId || !state.currentMode) return null;
    if (state.currentMode === 'own') {
        return `${LAST_SELECTED_CYCLE_STORAGE_PREFIX}:${userId}:own`;
    }
    if (state.currentMode === 'personal' && state.selectedClientId) {
        return `${LAST_SELECTED_CYCLE_STORAGE_PREFIX}:${userId}:personal:${state.selectedClientId}`;
    }
    return null;
}

function persistLastSelectedCycleId(cycleId) {
    const storageKey = getLastSelectedCycleStorageKey();
    if (!storageKey) return;
    try {
        if (cycleId) {
            localStorage.setItem(storageKey, String(cycleId));
        } else {
            localStorage.removeItem(storageKey);
        }
    } catch (_) {
        // ignore storage failures
    }
}

function readLastSelectedCycleId() {
    const storageKey = getLastSelectedCycleStorageKey();
    if (!storageKey) return '';
    try {
        return String(localStorage.getItem(storageKey) || '').trim();
    } catch (_) {
        return '';
    }
}

function restoreLastSelectedCycleFromState() {
    const savedCycleId = readLastSelectedCycleId();
    if (!savedCycleId) return false;

    const savedCycle = (state.cycles || []).find((cycle) => cycle.id === savedCycleId);
    if (!savedCycle) {
        persistLastSelectedCycleId('');
        return false;
    }

    applyCycleSelection(savedCycle, { preserveJournalSelection: true });
    return true;
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
    syncSupplementsBottomNavBadge(null);

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
    state.mealSummaryMonth = null;
    state.mealSummarySelectedDate = null;
    state.mealBurnedSummaryDate = null;
}

function resetClientScopedState() {
    resetCycleScopedState();
    state.selectedClientId = null;
    state.cycles = [];
    state.selectedClientTrainerAccess = null;
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
let activeToastElement = null;

export function showToast(message) {
    if (activeToastElement?.isConnected) return;

    const toast = document.createElement('div');
    toast.className = 'toast-message';
    toast.innerText = message;
    document.body.append(toast);
    activeToastElement = toast;

    setTimeout(() => {
        toast.classList.add('show');
    }, 100);

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            toast.remove();
            if (activeToastElement === toast) {
                activeToastElement = null;
            }
        }, 500);
    }, 3000);
}
window.showToast = showToast;

const TOPBAR_BACK_ARROW_MARKUP = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m3.55 12l7.35 7.35q.375.375.363.875t-.388.875t-.875.375t-.875-.375l-7.7-7.675q-.3-.3-.45-.675T.825 12t.15-.75t.45-.675l7.7-7.7q.375-.375.888-.363t.887.388t.375.875t-.375.875z"></path></svg>`;

let localBuildTrialTickTimer = 0;

function pluralizeRussianUnit(value, one, few, many) {
    const abs = Math.abs(Number(value) || 0);
    const mod100 = abs % 100;
    const mod10 = abs % 10;
    if (mod100 >= 11 && mod100 <= 14) return many;
    if (mod10 === 1) return one;
    if (mod10 >= 2 && mod10 <= 4) return few;
    return many;
}

function readLocalBuildTrialStartedAt() {
    try {
        const raw = window.localStorage?.getItem?.(LOCAL_BUILD_TRIAL_STARTED_AT_KEY);
        const parsed = Number(raw);
        if (!Number.isFinite(parsed) || parsed <= 0) return null;
        return parsed;
    } catch (_) {
        return null;
    }
}

function persistLocalBuildTrialStartedAt(value) {
    try {
        window.localStorage?.setItem?.(LOCAL_BUILD_TRIAL_STARTED_AT_KEY, String(value));
    } catch (_) {}
}

function readLocalBuildTrialBuildStamp() {
    try {
        return String(window.localStorage?.getItem?.(LOCAL_BUILD_TRIAL_BUILD_STAMP_KEY) || '').trim();
    } catch (_) {
        return '';
    }
}

function persistLocalBuildTrialBuildStamp(value) {
    try {
        const normalized = String(value || '').trim();
        if (!normalized) {
            window.localStorage?.removeItem?.(LOCAL_BUILD_TRIAL_BUILD_STAMP_KEY);
            return;
        }
        window.localStorage?.setItem?.(LOCAL_BUILD_TRIAL_BUILD_STAMP_KEY, normalized);
    } catch (_) {}
}

function getCurrentLocalBuildTrialBuildStamp() {
    try {
        return String(window.__TD_BUILD_STAMP__ || '').trim();
    } catch (_) {
        return '';
    }
}

function ensureLocalBuildTrialStartedAt() {
    if (!isCapacitorIosPlatform()) return null;

    const currentBuildStamp = getCurrentLocalBuildTrialBuildStamp();
    const savedBuildStamp = readLocalBuildTrialBuildStamp();
    const existing = readLocalBuildTrialStartedAt();
    if (existing && (!currentBuildStamp || currentBuildStamp === savedBuildStamp)) {
        return existing;
    }

    const startedAt = Date.now();
    persistLocalBuildTrialStartedAt(startedAt);
    persistLocalBuildTrialBuildStamp(currentBuildStamp);
    return startedAt;
}

function buildLocalBuildTrialUiState(startedAt) {
    if (!Number.isFinite(startedAt) || startedAt <= 0) return null;

    const expiresAt = startedAt + LOCAL_BUILD_TRIAL_DURATION_MS;
    const remainingMs = Math.max(0, expiresAt - Date.now());
    const totalSeconds = Math.floor(remainingMs / 1000);
    const days = Math.floor(totalSeconds / (24 * 60 * 60));
    const hours = Math.floor((totalSeconds % (24 * 60 * 60)) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return {
        startedAt,
        expiresAt,
        remainingMs,
        days,
        hours,
        minutes,
        seconds,
        navText: `До окончания подписки ${days} ${pluralizeRussianUnit(days, 'день', 'дня', 'дней')} ${hours} ${pluralizeRussianUnit(hours, 'час', 'часа', 'часов')} ${minutes} ${pluralizeRussianUnit(minutes, 'минута', 'минуты', 'минут')} ${seconds} ${pluralizeRussianUnit(seconds, 'секунда', 'секунды', 'секунд')}`
    };
}

function syncLocalBuildTrialCountdown() {
    if (!isCapacitorIosPlatform()) {
        state.localBuildTrial = null;
        syncBottomNavTrialCountdown('');
        return null;
    }

    const startedAt = ensureLocalBuildTrialStartedAt();
    state.localBuildTrial = buildLocalBuildTrialUiState(startedAt);
    syncBottomNavTrialCountdown(state.localBuildTrial?.navText || '');
    return state.localBuildTrial;
}

function scheduleLocalBuildTrialCountdownTick() {
    if (localBuildTrialTickTimer) {
        window.clearTimeout(localBuildTrialTickTimer);
        localBuildTrialTickTimer = 0;
    }

    syncLocalBuildTrialCountdown();

    if (!isCapacitorIosPlatform()) return;

    const nextDelay = Math.max(250, 1000 - (Date.now() % 1000) + 25);
    localBuildTrialTickTimer = window.setTimeout(() => {
        scheduleLocalBuildTrialCountdownTick();
    }, nextDelay);
}



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

    syncLocalBuildTrialCountdown();

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

export function getLocalDateString(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function bytesToHex(bytes) {
    return Array.from(bytes)
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('');
}

async function sha256HexBrowser(value) {
    const payload = new TextEncoder().encode(String(value || ''));
    const digest = await crypto.subtle.digest('SHA-256', payload);
    return bytesToHex(new Uint8Array(digest));
}

function generateAppleHealthTokenValue() {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return `ah_${bytesToHex(bytes)}`;
}

export async function createAppleHealthImportToken() {
    const uid = getCurrentAuthUid();
    if (!uid) throw new Error('Не удалось определить пользователя.');

    const tokenRef = getCurrentUserPrivateDocRef('appleHealthImport', uid);
    const previousSnap = await getDoc(tokenRef);
    const previousHash = String(previousSnap.data()?.tokenHash || '').trim();
    const token = generateAppleHealthTokenValue();
    const tokenHash = await sha256HexBrowser(token);
    await setDoc(tokenRef, {
        tokenHash,
        updatedAt: serverTimestamp(),
        source: 'pwa'
    }, { merge: true });

    await setDoc(getAppleHealthImportTokenMapRef(tokenHash), {
        uid,
        source: 'pwa',
        updatedAt: serverTimestamp()
    }, { merge: true });

    if (previousHash && previousHash !== tokenHash) {
        try {
            await deleteDoc(getAppleHealthImportTokenMapRef(previousHash));
        } catch (_) {
            // ignore stale cleanup failure; the new token is already active
        }
    }

    return {
        token,
        updatedAt: new Date().toISOString()
    };
}

export async function getAppleHealthImportSettings() {
    const uid = getCurrentAuthUid();
    if (!uid) return null;
    const settingsRef = getCurrentUserPrivateDocRef('appleHealthImport', uid);
    const snap = await getDoc(settingsRef);
    if (!snap.exists()) return null;
    const data = snap.data() || {};
    const tokenHash = String(data.tokenHash || '').trim();

    if (tokenHash) {
        try {
            await setDoc(getAppleHealthImportTokenMapRef(tokenHash), {
                uid,
                source: 'pwa_repair',
                updatedAt: serverTimestamp()
            }, { merge: true });
        } catch (error) {
            console.warn('apple health token map repair failed', error);
        }
    }

    return {
        tokenHash,
        source: data.source || '',
        updatedAt: data.updatedAt || null
    };
}

export function isAppleShortcutsLaunchSupported() {
    const userAgent = navigator.userAgent || '';
    return /iPhone|iPad|iPod/i.test(userAgent);
}

export function isCapacitorNativePlatform() {
    return (
        window.Capacitor?.isNativePlatform?.() === true ||
        /Capacitor/i.test(window.navigator?.userAgent || '')
    );
}

function isLocalDevelopmentHost() {
    const hostname = String(window.location?.hostname || '').trim().toLowerCase();
    return hostname === '127.0.0.1' || hostname === 'localhost';
}

export function resolveServerApiUrl(path = '') {
    const normalizedPath = String(path || '').startsWith('/')
        ? String(path || '')
        : `/${String(path || '')}`;

    if (!isCapacitorNativePlatform() && !isLocalDevelopmentHost()) {
        return normalizedPath;
    }

    const authDomain = String(firebaseConfig?.authDomain || '').trim();
    const projectId = String(firebaseConfig?.projectId || '').trim();
    const hostingOrigin = authDomain
        ? `https://${authDomain}`
        : (projectId ? `https://${projectId}.web.app` : '');

    if (!hostingOrigin) {
        return normalizedPath;
    }

    return new URL(normalizedPath, hostingOrigin).toString();
}

export function isStandalonePwaDisplayMode() {
    try {
        return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    } catch (_) {
        return window.navigator?.standalone === true;
    }
}

function buildAppleHealthShortcutCallbackUrl({ date, target, status = 'done' }) {
    if (isCapacitorNativePlatform()) {
        const nativeUrl = new URL(`${APPLE_HEALTH_CAPACITOR_CALLBACK_SCHEME}://apple-health-sync`);
        nativeUrl.searchParams.set('appleHealthSync', 'done');
        nativeUrl.searchParams.set('appleHealthDate', date);
        nativeUrl.searchParams.set('appleHealthTarget', target);
        if (status && status !== 'done') {
            nativeUrl.searchParams.set('status', status);
        }
        return nativeUrl.toString();
    }

    const returnUrl = new URL(window.location.origin + window.location.pathname);
    returnUrl.searchParams.set('appleHealthSync', 'done');
    returnUrl.searchParams.set('appleHealthDate', date);
    returnUrl.searchParams.set('appleHealthTarget', target);
    if (status && status !== 'done') {
        returnUrl.searchParams.set('status', status);
    }
    return returnUrl.toString();
}

export function buildAppleHealthShortcutUrl({ uid, date, target = 'mealBurned' }) {
    const shortcutName = 'Sync Training Diary';
    const payload = {
        uid,
        date,
        source: 'manual_button'
    };
    const baseUrl =
        'shortcuts://x-callback-url/run-shortcut' +
        '?name=' + encodeURIComponent(shortcutName) +
        '&input=text' +
        '&text=' + encodeURIComponent(JSON.stringify(payload));

    if (!isCapacitorNativePlatform() && isStandalonePwaDisplayMode()) {
        return baseUrl;
    }

    const successUrl = buildAppleHealthShortcutCallbackUrl({ date, target, status: 'done' });
    const cancelUrl = buildAppleHealthShortcutCallbackUrl({ date, target, status: 'cancel' });
    const errorUrl = buildAppleHealthShortcutCallbackUrl({ date, target, status: 'error' });

    return (
        baseUrl +
        '&x-success=' + encodeURIComponent(successUrl) +
        '&x-cancel=' + encodeURIComponent(cancelUrl) +
        '&x-error=' + encodeURIComponent(errorUrl)
    );
}

export function launchAppleHealthShortcut(options = {}) {
    const uid = options.uid || getCurrentAuthUid();
    const date = options.date || getLocalDateString(new Date());
    const target = options.target || 'mealBurned';

    if (!uid) {
        return { ok: false, reason: 'missing_uid' };
    }
    if (!isAppleShortcutsLaunchSupported()) {
        return { ok: false, reason: 'unsupported_platform' };
    }

    window.location.href = buildAppleHealthShortcutUrl({ uid, date, target });
    return { ok: true };
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

function getUserPrivateDocRef(uid, docId) {
    return doc(db, 'artifacts', appId, 'users', uid, 'private', docId);
}

function getAppleHealthImportTokenMapRef(tokenHash) {
    return doc(db, 'artifacts', appId, 'appleHealthImportTokens', tokenHash);
}

function getUserHealthDailyDocRef(uid, dateStr) {
    return doc(db, 'artifacts', appId, 'users', uid, 'healthDaily', dateStr);
}

export function getCurrentUserPrivateDocRef(docId, uid = getCurrentAuthUid()) {
    if (!uid || !docId) return null;
    return getUserPrivateDocRef(uid, docId);
}

function readExclusiveSessionDeviceId() {
    try {
        return String(window.localStorage?.getItem?.(EXCLUSIVE_SESSION_DEVICE_ID_KEY) || '').trim();
    } catch (_) {
        return '';
    }
}

function createExclusiveSessionDeviceId() {
    try {
        if (window.crypto?.randomUUID) {
            return `td-${window.crypto.randomUUID()}`;
        }
        const bytes = new Uint8Array(16);
        window.crypto.getRandomValues(bytes);
        return `td-${bytesToHex(bytes)}`;
    } catch (_) {
        return `td-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }
}

function getOrCreateExclusiveSessionDeviceId() {
    const existing = readExclusiveSessionDeviceId();
    if (existing) return existing;
    const next = createExclusiveSessionDeviceId();
    try {
        window.localStorage?.setItem?.(EXCLUSIVE_SESSION_DEVICE_ID_KEY, next);
    } catch (_) {}
    return next;
}

function persistExclusiveSessionNotice(message) {
    const normalized = String(message || '').trim();
    if (!normalized) return;
    try {
        window.localStorage?.setItem?.(EXCLUSIVE_SESSION_NOTICE_KEY, normalized);
    } catch (_) {}
}

function consumeExclusiveSessionNotice() {
    try {
        const message = String(window.localStorage?.getItem?.(EXCLUSIVE_SESSION_NOTICE_KEY) || '').trim();
        if (message) {
            window.localStorage?.removeItem?.(EXCLUSIVE_SESSION_NOTICE_KEY);
        }
        return message;
    } catch (_) {
        return '';
    }
}

function showPendingExclusiveSessionNotice() {
    const message = consumeExclusiveSessionNotice();
    if (!message) return;
    window.setTimeout(() => showToast(message), 120);
}

function syncExclusiveSessionWriteGuard() {
    if (exclusiveSessionWriteLockState?.blocked) {
        window.__TRAINING_DIARY_WRITE_GUARD__ = () => ({
            blocked: true,
            message: exclusiveSessionWriteLockState.message || ''
        });
        return;
    }
    try {
        delete window.__TRAINING_DIARY_WRITE_GUARD__;
    } catch (_) {
        window.__TRAINING_DIARY_WRITE_GUARD__ = undefined;
    }
}

function ensureExclusiveSessionReadOnlyOverlay(message) {
    const normalized = String(message || '').trim()
        || 'Аккаунт открыт на другом телефоне. Это устройство переведено в режим только чтения.';

    let overlay = exclusiveSessionReadOnlyOverlay;
    if (!overlay || !overlay.isConnected) {
        overlay = document.createElement('div');
        overlay.className = 'exclusive-session-overlay';
        overlay.style.cssText = [
            'position:fixed',
            'inset:0',
            'z-index:1000001',
            'display:flex',
            'align-items:center',
            'justify-content:center',
            'padding:24px',
            'background:rgba(10,16,28,0.52)',
            'backdrop-filter:blur(10px)',
            '-webkit-backdrop-filter:blur(10px)'
        ].join(';');

        const card = document.createElement('div');
        card.style.cssText = [
            'width:min(92vw,380px)',
            'padding:20px 18px',
            'border-radius:18px',
            'background:#ffffff',
            'box-shadow:0 20px 44px rgba(15,23,42,0.22)',
            'text-align:left',
            'color:#111827'
        ].join(';');

        const title = document.createElement('div');
        title.textContent = 'Сессия перенесена';
        title.style.cssText = 'font-size:18px;font-weight:700;line-height:1.2;margin-bottom:10px;';

        const body = document.createElement('div');
        body.className = 'exclusive-session-overlay__body';
        body.style.cssText = 'font-size:14px;line-height:1.45;color:#4b5563;white-space:pre-wrap;';

        card.append(title, body);
        overlay.append(card);
        document.body.append(overlay);
        exclusiveSessionReadOnlyOverlay = overlay;
    }

    const body = overlay.querySelector('.exclusive-session-overlay__body');
    if (body) {
        body.textContent = `${normalized}\n\nИзменения уже заблокированы. Выполняем выход из аккаунта...`;
    }

    return overlay;
}

function activateExclusiveSessionReadOnly(message) {
    exclusiveSessionWriteLockState = {
        blocked: true,
        message: String(message || '').trim()
            || 'Аккаунт открыт на другом телефоне. Изменения на этом устройстве заблокированы.'
    };
    syncExclusiveSessionWriteGuard();
    ensureExclusiveSessionReadOnlyOverlay(exclusiveSessionWriteLockState.message);
}

function clearExclusiveSessionReadOnly() {
    exclusiveSessionWriteLockState = null;
    syncExclusiveSessionWriteGuard();
    try {
        exclusiveSessionReadOnlyOverlay?.remove();
    } catch (_) {}
    exclusiveSessionReadOnlyOverlay = null;
}

function getExclusiveSessionPlatform() {
    return isCapacitorNativePlatform() ? 'capacitor' : 'web';
}

function parseExclusiveSessionDeviceLabel(value) {
    const normalized = String(value || '').trim();
    if (!normalized) return '';

    const source = normalized.includes(':')
        ? normalized.split(':').slice(1).join(':').trim()
        : normalized;

    if (/iPhone/i.test(source)) return 'iPhone';
    if (/iPad/i.test(source)) return 'iPad';
    if (/Android/i.test(source)) return 'Android';
    if (/Windows/i.test(source)) return 'Windows PC';
    if (/Macintosh|Mac OS|MacIntel|MacPPC|Mac68K|Mac/i.test(source)) return 'Mac';
    if (/Linux/i.test(source)) return 'Linux';
    return normalized;
}

function getExclusiveSessionDeviceLabel() {
    const platform = String(window.Capacitor?.getPlatform?.() || '').trim().toLowerCase();
    const userAgent = String(window.navigator?.userAgent || '').trim();

    if (platform === 'ios' || /iPhone/i.test(userAgent)) return 'iPhone';
    if (/iPad/i.test(userAgent)) return 'iPad';
    if (platform === 'android' || /Android/i.test(userAgent)) return 'Android';
    if (/Windows/i.test(userAgent)) return 'Windows PC';
    if (/Macintosh|Mac OS|MacIntel|MacPPC|Mac68K|Mac/i.test(userAgent)) return 'Mac';
    if (/Linux/i.test(userAgent)) return 'Linux';
    return isCapacitorNativePlatform() ? 'Мобильное устройство' : 'Устройство';
}

function buildExclusiveSessionTakeoverMessage(deviceLabel) {
    const normalizedLabel = parseExclusiveSessionDeviceLabel(deviceLabel);
    const deviceSentence = normalizedLabel
        ? `Ранее вход в этот аккаунт был выполнен на устройстве ${normalizedLabel}.`
        : 'Ранее вход в этот аккаунт был выполнен на другом устройстве.';
    return `${deviceSentence} Если на том устройстве были внесены изменения и они ещё не синхронизировались, при продолжении входа на этом устройстве может произойти перезапись части данных.`;
}

function clearAuthCredentialInputs() {
    const emailInput = document.getElementById('auth-email');
    const passwordInput = document.getElementById('auth-password');
    if (emailInput) {
        emailInput.value = '';
    }
    if (passwordInput) {
        passwordInput.value = '';
    }
    emailInput?.focus?.();
}

function openExclusiveSessionTakeoverModal(deviceLabel) {
    return new Promise((resolve) => {
        const overlay = createElement('div', 'modal-overlay');
        const modal = createElement('div', 'modal-content modal-compact');
        const title = createElement('h3', 'modal-title', EXCLUSIVE_SESSION_TAKEOVER_TITLE);
        const text = createElement('p', 'duplicate-text', buildExclusiveSessionTakeoverMessage(deviceLabel));
        const followup = createElement('p', 'duplicate-text', 'Продолжить вход на этом устройстве?');
        const controls = createElement('div', 'duplicate-controls');
        const confirmBtn = createElement('button', 'btn btn-primary', 'Войти здесь');
        const cancelBtn = createElement('button', 'btn btn-secondary cancel-btn', 'Отмена');

        const close = (result) => {
            try {
                overlay.remove();
            } catch (_) {}
            resolve(result);
        };

        confirmBtn.addEventListener('click', () => close(true));
        cancelBtn.addEventListener('click', () => close(false));
        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) {
                close(false);
            }
        });
        controls.append(confirmBtn, cancelBtn);
        modal.append(title, text, followup, controls);
        overlay.append(modal);
        document.body.appendChild(overlay);
    });
}

async function previewExclusiveSessionClaim(user) {
    if (!user) return null;
    if (getAppNetworkStatus().online === false) {
        return { ok: false, skipped: 'offline' };
    }

    const token = String(await user.getIdToken() || '').trim();
    if (!token) {
        throw new Error('exclusive_session_missing_token');
    }

    const response = await fetch(resolveServerApiUrl('/api/session/claim'), {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
            deviceId: getOrCreateExclusiveSessionDeviceId(),
            platform: getExclusiveSessionPlatform(),
            deviceLabel: getExclusiveSessionDeviceLabel(),
            previewOnly: true
        })
    });

    let payload = null;
    try {
        payload = await response.json();
    } catch (_) {
        payload = null;
    }

    if (!response.ok) {
        const error = new Error(payload?.error || `exclusive_session_preview_${response.status}`);
        error.payload = payload;
        throw error;
    }

    return payload;
}

async function releaseExclusiveSessionClaim(user = auth.currentUser) {
    if (!user?.uid || getAppNetworkStatus().online === false) return;
    const sessionRef = getCurrentUserPrivateDocRef(EXCLUSIVE_SESSION_DOC_ID, user.uid);
    if (!sessionRef) return;
    const localDeviceId = getOrCreateExclusiveSessionDeviceId();

    await runTransaction(db, async (tx) => {
        const snap = await tx.get(sessionRef);
        if (!snap.exists) return;
        const current = snap.data() || {};
        const currentDeviceId = String(current.activeDeviceId || '').trim();
        if (!currentDeviceId || currentDeviceId !== localDeviceId) return;

        tx.set(sessionRef, {
            activeDeviceId: deleteField(),
            deviceLabel: deleteField(),
            platform: deleteField(),
            signedOutAt: serverTimestamp(),
            updatedAt: serverTimestamp()
        }, { merge: true });
    });
}

async function performExplicitSignOut(successMessage = 'Вы вышли из системы.') {
    try {
        await releaseExclusiveSessionClaim(auth.currentUser);
    } catch (error) {
        console.warn('[session] release on signOut failed:', error);
    }

    await signOut(auth);
    showToast(successMessage);
}

beforeAuthStateChanged(auth, async (user) => {
    const pendingAttempt = pendingExclusiveSessionLoginAttempt;
    if (!user || !pendingAttempt || pendingAttempt.mode !== 'email-password-login') {
        return;
    }

    try {
        const preview = await previewExclusiveSessionClaim(user);
        if (!preview?.wouldTakeOver) {
            return;
        }

        const confirmed = await openExclusiveSessionTakeoverModal(preview.activeDeviceLabel);
        if (confirmed) {
            return;
        }

        clearAuthCredentialInputs();
        const error = new Error('exclusive_session_takeover_cancelled');
        error.code = 'exclusive_session_takeover_cancelled';
        throw error;
    } finally {
        pendingExclusiveSessionLoginAttempt = null;
    }
});

forceSignOutForExclusiveSession = async function (message) {
    if (exclusiveSessionSignOutPromise) {
        return exclusiveSessionSignOutPromise;
    }

    const normalizedMessage = EXCLUSIVE_SESSION_SIGNED_OUT_MESSAGE;
    persistExclusiveSessionNotice(normalizedMessage);

    exclusiveSessionSignOutPromise = (async () => {
        teardownExclusiveSessionListener();
        clearExclusiveSessionRuntime();
        activateExclusiveSessionReadOnly(normalizedMessage);
        try {
            showToast(normalizedMessage);
        } catch (_) {}
        await new Promise((resolve) => window.setTimeout(resolve, 900));
        try {
            await signOut(auth);
        } catch (error) {
            console.warn('[session] forced signOut failed:', error);
        } finally {
            exclusiveSessionSignOutPromise = null;
        }
    })();

    return exclusiveSessionSignOutPromise;
};

function clearExclusiveSessionRuntime() {
    exclusiveSessionMeta = null;
    exclusiveSessionClaimPromise = null;
    exclusiveSessionClaimFingerprint = '';
    exclusiveSessionInFlightFingerprint = '';
    exclusiveSessionReauthPromise = null;
}

function teardownExclusiveSessionListener() {
    try {
        authSessionUnsubscribe();
    } catch (_) {}
    authSessionUnsubscribe = () => {};
}

async function readExclusiveSessionTokenMeta(user = auth.currentUser, { forceRefresh = false } = {}) {
    if (!user) return null;
    const tokenResult = await user.getIdTokenResult(forceRefresh);
    const claimAuthTime = Number(tokenResult?.claims?.auth_time || 0);
    const parsedAuthTime = Number.isFinite(claimAuthTime) && claimAuthTime > 0
        ? Math.floor(claimAuthTime)
        : Math.floor(new Date(tokenResult?.authTime || Date.now()).getTime() / 1000);
    const token = String(tokenResult?.token || await user.getIdToken(forceRefresh) || '').trim();

    return {
        uid: user.uid,
        token,
        authTime: parsedAuthTime,
        deviceId: getOrCreateExclusiveSessionDeviceId()
    };
}

async function ensureExclusiveSessionMeta(user = auth.currentUser, options = {}) {
    const meta = await readExclusiveSessionTokenMeta(user, options);
    exclusiveSessionMeta = meta;
    return meta;
}

async function reauthenticateExclusiveSessionWithCustomToken(customToken) {
    const normalized = String(customToken || '').trim();
    if (!normalized) return null;
    if (exclusiveSessionReauthPromise) {
        return exclusiveSessionReauthPromise;
    }

    exclusiveSessionReauthPromise = (async () => {
        clearExclusiveSessionRuntime();
        return signInWithCustomToken(auth, normalized);
    })();

    try {
        return await exclusiveSessionReauthPromise;
    } finally {
        if (exclusiveSessionReauthPromise) {
            exclusiveSessionReauthPromise = null;
        }
    }
}

function isExclusiveSessionSnapshotStale(snapshotData, meta = exclusiveSessionMeta) {
    if (!snapshotData || !meta) return false;
    const remoteMinAuthTime = Number(snapshotData.minAuthTime || 0);
    const remoteDeviceId = String(snapshotData.activeDeviceId || '').trim();
    if (remoteMinAuthTime > meta.authTime) return true;
    return remoteMinAuthTime === meta.authTime && Boolean(remoteDeviceId) && remoteDeviceId !== meta.deviceId;
}

async function forceSignOutForExclusiveSession(message) {
    if (exclusiveSessionSignOutPromise) {
        return exclusiveSessionSignOutPromise;
    }

    const normalizedMessage = String(message || '').trim()
        || 'Аккаунт открыт на другом телефоне. Это устройство вышло из системы, чтобы не перезаписать данные.';
    persistExclusiveSessionNotice(normalizedMessage);

    exclusiveSessionSignOutPromise = (async () => {
        teardownExclusiveSessionListener();
        clearExclusiveSessionRuntime();
        activateExclusiveSessionReadOnly(normalizedMessage);
        try {
            showToast(normalizedMessage);
        } catch (_) {}
        await new Promise((resolve) => window.setTimeout(resolve, 900));
        try {
        await signOut(auth);
        } catch (error) {
            console.warn('[session] forced signOut failed:', error);
        } finally {
            exclusiveSessionSignOutPromise = null;
        }
    })();

    return exclusiveSessionSignOutPromise;
}

async function ensureExclusiveSessionClaim(user = auth.currentUser, options = {}) {
    if (!user) return null;
    if (exclusiveSessionSignOutPromise) return null;
    if (!options.ignoreOfflineGuard && getAppNetworkStatus().online === false) {
        return { ok: false, skipped: 'offline' };
    }

    const meta = await ensureExclusiveSessionMeta(user, { forceRefresh: options.forceTokenRefresh === true });
    if (!meta?.token || !meta?.uid || !Number.isFinite(meta.authTime) || meta.authTime <= 0) {
        throw new Error('exclusive_session_missing_token');
    }

    const fingerprint = `${meta.uid}:${meta.authTime}:${meta.deviceId}`;
    if (!options.force && exclusiveSessionClaimFingerprint === fingerprint) {
        return { ok: true, cached: true, deviceId: meta.deviceId, authTime: meta.authTime };
    }
    if (!options.force && exclusiveSessionClaimPromise && exclusiveSessionInFlightFingerprint === fingerprint) {
        return exclusiveSessionClaimPromise;
    }

    exclusiveSessionInFlightFingerprint = fingerprint;
    const inFlight = (async () => {
        const response = await fetch(resolveServerApiUrl('/api/session/claim'), {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${meta.token}`
            },
            body: JSON.stringify({
                deviceId: meta.deviceId,
                platform: getExclusiveSessionPlatform(),
                deviceLabel: getExclusiveSessionDeviceLabel()
            })
        });

        let payload = null;
        try {
            payload = await response.json();
        } catch (_) {
            payload = null;
        }

        if (response.status === 409 && payload?.error === 'stale_session') {
            await forceSignOutForExclusiveSession(
                'Аккаунт открыт на другом телефоне. Это устройство вышло из системы, чтобы не перезаписать данные.'
            );
            return payload;
        }

        if (!response.ok) {
            throw new Error(payload?.error || `exclusive_session_claim_${response.status}`);
        }

        if (payload?.reauthCustomToken) {
            await reauthenticateExclusiveSessionWithCustomToken(payload.reauthCustomToken);
            return {
                ...payload,
                reauthenticated: true
            };
        }

        exclusiveSessionClaimFingerprint = fingerprint;
        return payload;
    })();

    exclusiveSessionClaimPromise = inFlight;
    try {
        return await inFlight;
    } finally {
        if (exclusiveSessionClaimPromise === inFlight) {
            exclusiveSessionClaimPromise = null;
            exclusiveSessionInFlightFingerprint = '';
        }
    }
}

async function handleExclusiveSessionSnapshot(user, snapshot) {
    if (!user?.uid || auth.currentUser?.uid !== user.uid || exclusiveSessionSignOutPromise) {
        return;
    }

    const meta = exclusiveSessionMeta?.uid === user.uid
        ? exclusiveSessionMeta
        : await ensureExclusiveSessionMeta(user).catch((error) => {
            console.warn('[session] meta bootstrap failed:', error);
            return null;
        });

    if (!meta) return;

    if (!snapshot.exists()) {
        if (getAppNetworkStatus().online !== false) {
            void ensureExclusiveSessionClaim(user, { reason: 'missing_snapshot' }).catch((error) => {
                console.warn('[session] claim after missing snapshot failed:', error);
            });
        }
        return;
    }

    const data = snapshot.data() || {};
    if (isExclusiveSessionSnapshotStale(data, meta)) {
        await forceSignOutForExclusiveSession(
            'Аккаунт открыт на другом телефоне. Это устройство вышло из системы, чтобы не перезаписать данные.'
        );
        return;
    }

    const remoteMinAuthTime = Number(data.minAuthTime || 0);
    const remoteDeviceId = String(data.activeDeviceId || '').trim();
    if (getAppNetworkStatus().online !== false && (!remoteDeviceId || remoteMinAuthTime < meta.authTime)) {
        void ensureExclusiveSessionClaim(user, { reason: 'stale_snapshot' }).catch((error) => {
            console.warn('[session] claim after stale snapshot failed:', error);
        });
    }
}

function attachExclusiveSessionListener(user = auth.currentUser) {
    teardownExclusiveSessionListener();
    if (!user?.uid) return;

    const ref = getCurrentUserPrivateDocRef(EXCLUSIVE_SESSION_DOC_ID, user.uid);
    if (!ref) return;

    authSessionUnsubscribe = onSnapshot(ref, (snapshot) => {
        void handleExclusiveSessionSnapshot(user, snapshot);
    }, (error) => {
        console.warn('[session] authSession listener failed:', error);
    });
}

function maybeClaimExclusiveSessionAfterReconnect() {
    if (!auth.currentUser || getAppNetworkStatus().online === false) return;
    void ensureExclusiveSessionClaim(auth.currentUser, { reason: 'reconnect' }).catch((error) => {
        console.warn('[session] reconnect claim failed:', error);
    });
}

function maybePreloadSelectedCycleAfterReconnect() {
    if (!state.selectedCycleId || getAppNetworkStatus().online === false) return;
    const selectedCycle = state.cycles?.find((cycle) => cycle.id === state.selectedCycleId);
    if (!selectedCycle) return;
    void preloadSelectedCycleOfflineBundle(selectedCycle).catch((error) => {
        console.warn('[cycle-preload] reconnect preload failed:', error);
    });
}

export function getCurrentUserHealthDailyDocRef(dateStr, uid = getCurrentAuthUid()) {
    if (!uid || !dateStr) return null;
    return getUserHealthDailyDocRef(uid, dateStr);
}

export function getCurrentUserHealthDailyCollection(uid = getCurrentAuthUid()) {
    if (!uid) return null;
    return collection(db, 'artifacts', appId, 'users', uid, 'healthDaily');
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

function normalizeTrainerCycleAccessSettings(data = {}) {
    return {
        active: data?.active !== false,
        fullCycleAccess: data?.fullCycleAccess === true,
        allowedCycleIds: Array.isArray(data?.allowedCycleIds)
            ? data.allowedCycleIds.map((id) => String(id || '').trim()).filter(Boolean)
            : []
    };
}

function getCycleTrainerAccessMap(cycle = {}) {
    const raw = cycle?.trainerAccess;
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function cycleHasTrainerDirectAccess(cycle, trainerUid = userId) {
    if (!cycle || !trainerUid) return false;
    return getCycleTrainerAccessMap(cycle)[trainerUid] === true;
}

function trainerAccessAllowsCycle(access, cycleId) {
    if (!access || !cycleId) return false;
    if (access.fullCycleAccess) return true;
    return Array.isArray(access.allowedCycleIds) && access.allowedCycleIds.includes(String(cycleId));
}

function ownCycleIsSharedWithTrainer(cycleId) {
    if (!cycleId) return false;
    return (state.ownLinkedTrainersAccess || []).some((access) => trainerAccessAllowsCycle(access, cycleId));
}

async function fetchOwnCyclesForClientAccessRaw() {
    if (!userId) return [];
    const cyclesRef = collection(db, 'artifacts', appId, 'users', userId, 'cycles');
    const snap = await getDocs(cyclesRef);
    return snap.docs.map((item) => ({ id: item.id, ...item.data() }));
}

function sortCyclesForAccessUi(cycles = []) {
    return [...cycles].sort((a, b) => {
        const aTime = Number(a?.startDate || 0);
        const bTime = Number(b?.startDate || 0);
        if (aTime !== bTime) return bTime - aTime;
        return String(a?.name || '').localeCompare(String(b?.name || ''), 'ru');
    });
}

export async function fetchOwnCyclesForClientAccess() {
    const cycles = await fetchOwnCyclesForClientAccessRaw();
    return sortCyclesForAccessUi(cycles).map((cycle) => ({
        id: cycle.id,
        name: String(cycle.name || '').trim() || 'Без названия'
    }));
}

function buildTrainerCycleAccessSummary(trainerUid, cycles = [], accessSettings = {}) {
    const sortedCycles = sortCyclesForAccessUi(cycles);
    const normalized = normalizeTrainerCycleAccessSettings(accessSettings);
    const fullCycleAccess = normalized.fullCycleAccess;
    if (fullCycleAccess) {
        return {
            accessMode: 'full',
            allowedCycleIds: sortedCycles.map((cycle) => cycle.id),
            allowedCycleNames: sortedCycles.map((cycle) => String(cycle.name || '').trim()).filter(Boolean)
        };
    }

    // Только явный список из linkedTrainers; пустой список при частичном доступе = нет циклов
    const allowed = normalized.allowedCycleIds.length
        ? sortedCycles.filter((cycle) => normalized.allowedCycleIds.includes(cycle.id))
        : [];
    return {
        accessMode: allowed.length ? 'partial' : 'none',
        allowedCycleIds: allowed.map((cycle) => cycle.id),
        allowedCycleNames: allowed.map((cycle) => String(cycle.name || '').trim()).filter(Boolean)
    };
}

function getSelectedTrainerCycleAccessSettings() {
    return normalizeTrainerCycleAccessSettings(state.selectedClientTrainerAccess || {});
}

function canTrainerAccessCanonicalClientCycle(cycle) {
    if (!cycle?.id) return false;
    if (state.currentMode !== 'personal' || !state.selectedClientId) return true;
    // Сырой буфер клиента из onSnapshot ещё без _firesAtClient — раньше из‑за этого
    // все циклы проходили фильтр. При активной связи проверяем только linkedTrainers.
    if (!getActiveLinkedClientUid()) return true;

    const access = getSelectedTrainerCycleAccessSettings();
    return trainerAccessAllowsCycle(access, cycle.id);
}

function filterTrainerVisibleClientCycles(cycles = []) {
    return cycles.filter((cycle) => canTrainerAccessCanonicalClientCycle(cycle));
}

function filterJournalRecordsForVisibleCycles(records = []) {
    if (state.currentMode !== 'personal' || !state.selectedClientId) return records;
    if (!getActiveLinkedClientUid()) return records;

    const visibleCycleIds = new Set((state.cycles || []).map((cycle) => cycle.id).filter(Boolean));
    const visibleCycleNames = new Set((state.cycles || []).map((cycle) => cycle.name).filter(Boolean));

    if (!visibleCycleIds.size && !visibleCycleNames.size) return [];

    return records.filter((record) => {
        if (record?.cycleId && visibleCycleIds.has(record.cycleId)) return true;
        if (record?.cycleName && visibleCycleNames.has(record.cycleName)) return true;
        return false;
    });
}

function syncSelectedCycleAfterVisibilityChange() {
    if (
        state.selectedJournalCategory &&
        !state.cycles.some((cycle) => cycle.name === state.selectedJournalCategory)
    ) {
        state.selectedJournalCategory = '';
        state.selectedJournalProgram = '';
        state.selectedJournalRecord = null;
    }

    if (!state.selectedCycleId) return;
    const currentCycle = state.cycles.find((cycle) => cycle.id === state.selectedCycleId);
    if (currentCycle) return;

    persistLastSelectedCycleId('');
    resetCycleScopedState();
    state.selectedJournalCategory = '';
    state.selectedJournalProgram = '';
    state.selectedJournalRecord = null;

    const cycleRequiredPages = ['programsInCycle', 'programDetails', 'meal', 'reports', 'supplements', 'cycleReport', 'mealsReport'];
    if (cycleRequiredPages.includes(state.currentPage)) {
        state.currentPage = 'programs';
    }
}

function resetCycleDerivedStateForSwitch() {
    resetSupplementsListener();
    resetMealsState();
    destroyMealShellState();

    state.selectedProgramIdForDetails = null;
    state.programDetailsOrigin = null;
    state.expandedExerciseId = null;
    state.editingSetId = null;
    state.lastClickedExerciseId = null;
    state.openSwipedExerciseId = null;
    state.openSide = null;

    state.supplementPlan = null;
    state._supplementSubscribed = false;
    syncSupplementsBottomNavBadge(null);

    state.reports = [];
    state.selectedReportId = null;
    state.programs = [];
    state.openProgramAfterLoad = null;
    state.reportHtmlCache = null;
    state.isProgramsLoading = true;

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
    state.mealSummaryMonth = null;
    state.mealSummarySelectedDate = null;
    state.mealBurnedSummaryDate = null;
}

function getCyclePreloadKey(cycleRef = getCycleDocRef()) {
    if (!cycleRef?.path) return '';
    return String(cycleRef.path).trim();
}

function collectProgramMediaUrls(programs = []) {
    const urls = [];
    (Array.isArray(programs) ? programs : []).forEach((program) => {
        (Array.isArray(program?.trainingMedia) ? program.trainingMedia : []).forEach((item) => {
            const url = String(item?.url || '').trim();
            if (url) urls.push(url);
        });
        (Array.isArray(program?.exercises) ? program.exercises : []).forEach((exercise) => {
            (Array.isArray(exercise?.media) ? exercise.media : []).forEach((item) => {
                const url = String(item?.url || '').trim();
                if (url) urls.push(url);
            });
        });
    });
    return urls;
}

function collectReportMediaUrls(reports = []) {
    const urls = [];
    (Array.isArray(reports) ? reports : []).forEach((report) => {
        (Array.isArray(report?.photos) ? report.photos : []).forEach((photo) => {
            const url = String(photo?.url || '').trim();
            if (url) urls.push(url);
        });
    });
    return urls;
}

function collectMealMediaUrls(mealDocs = []) {
    const urls = [];
    (Array.isArray(mealDocs) ? mealDocs : []).forEach((entry) => {
        const data = entry?.data || entry;
        Object.keys(data || {}).forEach((key) => {
            if (!/^meal\d+$/.test(key)) return;
            const items = Array.isArray(data[key]) ? data[key] : [];
            items.forEach((item) => {
                if (item?.isMealPhoto !== true) return;
                const url = String(item?.photoUrl || '').trim();
                if (url) urls.push(url);
            });
        });
    });
    return urls;
}

async function preloadSelectedCycleOfflineBundle(cycle = state.cycles?.find((item) => item.id === state.selectedCycleId), options = {}) {
    if (!cycle?.id || getAppNetworkStatus().online === false) {
        return { ok: false, skipped: 'offline-or-missing-cycle' };
    }

    const cycleRef = getCycleDocRef();
    const preloadKey = getCyclePreloadKey(cycleRef);
    if (!cycleRef || !preloadKey) {
        return { ok: false, skipped: 'missing-cycle-ref' };
    }

    if (cyclePreloadInFlight.has(preloadKey)) {
        return cyclePreloadInFlight.get(preloadKey);
    }

    if (options.force !== true && cyclePreloadCompletedAt.has(preloadKey)) {
        return {
            ok: true,
            skipped: 'already-preloaded',
            at: cyclePreloadCompletedAt.get(preloadKey)
        };
    }

    const run = (async () => {
        const programsRef = getUserProgramsCollection();
        const reportsRef = getReportsCollection();
        const mealsRef = collection(cycleRef, 'meals');
        const mealLibraryFoodsRef = getMealLibraryFoodsCollection();
        const mealLibraryRecipesRef = getMealLibraryRecipesCollection();
        const tasks = [
            getDoc(cycleRef),
            programsRef ? getDocs(programsRef) : Promise.resolve(null),
            reportsRef ? getDocs(reportsRef) : Promise.resolve(null),
            mealsRef ? getDocs(mealsRef) : Promise.resolve(null),
            mealLibraryFoodsRef ? getDocs(mealLibraryFoodsRef) : Promise.resolve(null),
            mealLibraryRecipesRef ? getDocs(mealLibraryRecipesRef) : Promise.resolve(null)
        ];

        const settled = await Promise.allSettled(tasks);
        const rejected = settled.filter((item) => item.status === 'rejected');

        if (rejected.length > 0) {
            console.warn('[cycle-preload] partial preload failures:', rejected.map((item) => item.reason));
        }

        const programs = settled[1]?.status === 'fulfilled'
            ? settled[1].value.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
            : [];
        const reports = settled[2]?.status === 'fulfilled'
            ? settled[2].value.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
            : [];
        const mealDocs = settled[3]?.status === 'fulfilled'
            ? settled[3].value.docs.map((docSnap) => ({ id: docSnap.id, data: docSnap.data() }))
            : [];

        const mediaUrls = Array.from(new Set([
            ...collectProgramMediaUrls(programs),
            ...collectReportMediaUrls(reports),
            ...collectMealMediaUrls(mealDocs)
        ]));

        let mediaPreloadResult = { ok: true, total: 0, cached: 0, failed: 0 };
        if (mediaUrls.length > 0) {
            mediaPreloadResult = await preloadOfflineMediaUrls(mediaUrls, { concurrency: 3 });
        }

        cyclePreloadCompletedAt.set(preloadKey, Date.now());

        return {
            ok: rejected.length === 0 && mediaPreloadResult.failed === 0,
            partial: rejected.length > 0,
            cycleId: cycle.id,
            failedTasks: rejected.length,
            mediaCached: mediaPreloadResult.cached,
            mediaFailed: mediaPreloadResult.failed
        };
    })();

    cyclePreloadInFlight.set(preloadKey, run);

    try {
        return await run;
    } finally {
        if (cyclePreloadInFlight.get(preloadKey) === run) {
            cyclePreloadInFlight.delete(preloadKey);
        }
    }
}

function applyCycleSelection(cycle, options = {}) {
    if (!cycle?.id) return false;

    const shouldReload = options.reloadData === true || state.selectedCycleId !== cycle.id;
    persistLastSelectedCycleId(cycle.id);

    if (options.captureFlip === true) {
        state.cycleFlipPrevRects = captureCycleCardRectsForFlip();
    }

    if (shouldReload) {
        resetCycleDerivedStateForSwitch();
        state.selectedCycleId = cycle.id;
        state.selectedJournalCategory = cycle.name || '';
        if (!options.preserveJournalSelection) {
            state.selectedJournalProgram = '';
            state.selectedJournalRecord = null;
        }
        setupDynamicListeners();
        if (options.preload !== false) {
            void preloadSelectedCycleOfflineBundle(cycle, { force: options.forcePreload === true }).catch((error) => {
                console.warn('[cycle-preload] failed:', error);
            });
        }
    }

    if (options.openPrograms === true) {
        state.currentPage = 'programsInCycle';
        state.lastProgramsPage = 'programsInCycle';
    }

    return shouldReload;
}

function normalizePersonNameFields(data = {}) {
    const firstName = String(data?.firstName || '').trim();
    const lastName = String(data?.lastName || '').trim();
    return {
        firstName,
        lastName,
        fullName: [firstName, lastName].filter(Boolean).join(' ').trim()
    };
}

async function getOwnProfileNameFields() {
    const cached = state.userProfile && typeof state.userProfile === 'object'
        ? normalizePersonNameFields(state.userProfile)
        : { firstName: '', lastName: '', fullName: '' };

    if (cached.firstName || cached.lastName) {
        return cached;
    }

    if (!userId) return cached;

    try {
        const snap = await getDoc(getUserAccountSettingsRef(userId));
        if (!snap.exists()) return cached;
        return normalizePersonNameFields(snap.data());
    } catch (_) {
        return cached;
    }
}

function mergeCyclesTrainerClientBuffers() {
    const map = new Map();
    for (const c of cyclesTrainerBuffer) {
        map.set(c.id, { ...c, _firesAtClient: false });
    }
    for (const c of filterTrainerVisibleClientCycles(cyclesClientBuffer)) {
        map.set(c.id, { ...c, _firesAtClient: true });
    }
    state.cycles = sortCyclesForAccessUi(Array.from(map.values()));
    syncSelectedCycleAfterVisibilityChange();
    if (!state.selectedCycleId && state.cycles.length > 0) {
        restoreLastSelectedCycleFromState();
    }
}

async function syncTrainerClientCardsFromAcceptedInvites() {
    if (state.currentMode !== 'personal' || !userId) return;
    for (const c of state.clients || []) {
        if (!c.inviteId || !c.linkedUserUid) continue;
        try {
            if (c.linkStatus === 'pending') {
                const invRef = doc(db, 'artifacts', appId, 'users', c.linkedUserUid, 'trainerInvites', c.inviteId);
                const inv = await getDoc(invRef);
                if (!inv.exists()) continue;
                const st = inv.data()?.status;
                if (st === 'accepted') {
                    await updateClient(getClientsCollection(), c.id, { linkStatus: 'active' });
                } else if (st === 'rejected') {
                    await deleteClient(getClientsCollection(), c.id);
                }
                continue;
            }

            if (c.linkStatus === 'active') {
                const linkedRef = getLinkedTrainerDocRef(c.linkedUserUid, userId);
                const linkedSnap = await getDoc(linkedRef);
                const isLinked = linkedSnap.exists() && linkedSnap.data()?.active === true;
                if (!isLinked) {
                    await deleteClient(getClientsCollection(), c.id);
                }
            }
        } catch (e) {
            console.warn('sync invite', e);
        }
    }
}

async function createTrainerInviteByPublicCode(codeRaw) {
    throwIfOnlineOnlyFeatureOffline('Связь клиент-тренер');
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

    const trainerName = await getOwnProfileNameFields();

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
        trainerFirstName: trainerName.firstName,
        trainerLastName: trainerName.lastName,
        trainerName: trainerName.fullName,
        status: 'pending',
        createdAt: serverTimestamp()
    });
    await batch.commit();
}

export async function fetchPendingTrainerInvites() {
    throwIfOnlineOnlyFeatureOffline('Связь клиент-тренер');
    if (!userId) return [];
    const invitesCol = collection(db, 'artifacts', appId, 'users', userId, 'trainerInvites');
    const q = query(invitesCol, where('status', '==', 'pending'));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function acceptTrainerInviteClient(inviteId) {
    throwIfOnlineOnlyFeatureOffline('Связь клиент-тренер');
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
        inviteId: inviteId,
        trainerFirstName: String(data.trainerFirstName || '').trim(),
        trainerLastName: String(data.trainerLastName || '').trim(),
        trainerName: String(data.trainerName || '').trim(),
        fullCycleAccess: false,
        allowedCycleIds: [],
        linkedAt: serverTimestamp()
    });
    await batch.commit();
}

export async function rejectTrainerInviteClient(inviteId) {
    throwIfOnlineOnlyFeatureOffline('Связь клиент-тренер');
    if (!userId) throw new Error('Не авторизован');
    const invRef = doc(db, 'artifacts', appId, 'users', userId, 'trainerInvites', inviteId);
    const snap = await getDoc(invRef);
    if (!snap.exists()) return;
    if (snap.data()?.status !== 'pending') return;
    await updateDoc(invRef, { status: 'rejected', rejectedAt: serverTimestamp() });
}

export async function fetchLinkedTrainersForClient() {
    throwIfOnlineOnlyFeatureOffline('Связь клиент-тренер');
    if (!userId) return [];

    const linkedCol = collection(db, 'artifacts', appId, 'users', userId, 'linkedTrainers');
    const [snap, ownCycles] = await Promise.all([
        getDocs(linkedCol),
        fetchOwnCyclesForClientAccessRaw()
    ]);

    const trainers = await Promise.all(snap.docs.map(async (item) => {
            const data = item.data() || {};
            let firstName = String(data.trainerFirstName || '').trim();
            let lastName = String(data.trainerLastName || '').trim();
            let trainerName = String(data.trainerName || '').trim();
            const inviteId = String(data.inviteId || '').trim();

            if ((!firstName || !lastName) && inviteId) {
                try {
                    const inviteSnap = await getDoc(
                        doc(db, 'artifacts', appId, 'users', userId, 'trainerInvites', inviteId)
                    );
                    if (inviteSnap.exists()) {
                        const inviteData = inviteSnap.data() || {};
                        firstName = firstName || String(inviteData.trainerFirstName || '').trim();
                        lastName = lastName || String(inviteData.trainerLastName || '').trim();
                        trainerName = trainerName || String(inviteData.trainerName || '').trim();
                    }
                } catch (_) {
                    /* keep fallback below */
                }
            }

            if ((!firstName || !lastName) && trainerName) {
                const parts = trainerName.split(/\s+/).filter(Boolean);
                if (!firstName && parts.length) firstName = parts[0];
                if (!lastName && parts.length > 1) lastName = parts.slice(1).join(' ');
            }

            const accessSummary = buildTrainerCycleAccessSummary(item.id, ownCycles, data);

            return {
                id: item.id,
                trainerUid: item.id,
                active: data.active !== false,
                trainerClientCardId: String(data.trainerClientCardId || '').trim(),
                inviteId,
                firstName,
                lastName,
                fullCycleAccess: data.fullCycleAccess === true,
                accessMode: accessSummary.accessMode,
                allowedCycleIds: accessSummary.allowedCycleIds,
                allowedCycleNames: accessSummary.allowedCycleNames,
                fullName: [firstName, lastName].filter(Boolean).join(' ').trim() || trainerName || 'Тренер'
            };
        }));

    return trainers.filter((trainer) => trainer.active);
}

export async function saveLinkedTrainerCycleAccess(trainerUid, options = {}) {
    throwIfOnlineOnlyFeatureOffline('Связь клиент-тренер');
    if (!userId) throw new Error('Не авторизован');

    const normalizedTrainerUid = String(trainerUid || '').trim();
    if (!normalizedTrainerUid) throw new Error('Не найден тренер');

    const linkedRef = getLinkedTrainerDocRef(userId, normalizedTrainerUid);
    const linkedSnap = await getDoc(linkedRef);
    if (!linkedSnap.exists()) throw new Error('Связь с тренером не найдена');

    const fullCycleAccess = options?.fullCycleAccess === true;
    const allowedCycleIds = new Set(
        Array.isArray(options?.allowedCycleIds)
            ? options.allowedCycleIds.map((id) => String(id || '').trim()).filter(Boolean)
            : []
    );

    const ownCycles = await fetchOwnCyclesForClientAccessRaw();
    const batch = writeBatch(db);
    batch.update(linkedRef, {
        fullCycleAccess,
        allowedCycleIds: [...allowedCycleIds],
        accessUpdatedAt: serverTimestamp()
    });

    for (const cycle of ownCycles) {
        const cycleRef = doc(db, 'artifacts', appId, 'users', userId, 'cycles', cycle.id);
        const fieldName = `trainerAccess.${normalizedTrainerUid}`;
        const shouldGrant = allowedCycleIds.has(cycle.id);
        const alreadyGranted = cycleHasTrainerDirectAccess(cycle, normalizedTrainerUid);

        if (shouldGrant) {
            batch.update(cycleRef, { [fieldName]: true });
        } else if (alreadyGranted) {
            batch.update(cycleRef, { [fieldName]: deleteField() });
        }
    }

    await batch.commit();

    const nextCycles = ownCycles.map((cycle) => {
        const nextAccessMap = { ...getCycleTrainerAccessMap(cycle) };
        if (allowedCycleIds.has(cycle.id)) {
            nextAccessMap[normalizedTrainerUid] = true;
        } else {
            delete nextAccessMap[normalizedTrainerUid];
        }
        return { ...cycle, trainerAccess: nextAccessMap };
    });

    return buildTrainerCycleAccessSummary(normalizedTrainerUid, nextCycles, {
        fullCycleAccess,
        allowedCycleIds: [...allowedCycleIds]
    });
}

export async function disconnectLinkedTrainerClient(trainerUid) {
    throwIfOnlineOnlyFeatureOffline('Связь клиент-тренер');
    if (!userId) throw new Error('Не авторизован');

    const normalizedTrainerUid = String(trainerUid || '').trim();
    if (!normalizedTrainerUid) throw new Error('Не найден тренер для разрыва связи');

    const linkedRef = getLinkedTrainerDocRef(userId, normalizedTrainerUid);
    const linkedSnap = await getDoc(linkedRef);
    if (!linkedSnap.exists()) return;

    const linkedData = linkedSnap.data() || {};
    const trainerClientCardId = String(linkedData.trainerClientCardId || '').trim();
    const inviteId = String(linkedData.inviteId || '').trim();
    const ownCycles = await fetchOwnCyclesForClientAccessRaw();
    const batch = writeBatch(db);

    batch.delete(linkedRef);

    if (inviteId) {
        batch.delete(
            doc(
                db,
                'artifacts',
                appId,
                'users',
                userId,
                'trainerInvites',
                inviteId
            )
        );
    }

    for (const cycle of ownCycles) {
        if (!cycleHasTrainerDirectAccess(cycle, normalizedTrainerUid)) continue;
        batch.update(
            doc(db, 'artifacts', appId, 'users', userId, 'cycles', cycle.id),
            { [`trainerAccess.${normalizedTrainerUid}`]: deleteField() }
        );
    }

    await batch.commit();

    if (trainerClientCardId) {
        try {
            await deleteDoc(
                doc(
                    db,
                    'artifacts',
                    appId,
                    'users',
                    normalizedTrainerUid,
                    'clients',
                    trainerClientCardId
                )
            );
        } catch (e) {
            console.warn('disconnectLinkedTrainerClient: trainer card cleanup skipped', e?.code || e);
        }
    }
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
        if (isOfflineModeActive()) {
            showToast(getOnlineOnlyFeatureMessage('Связь клиент-тренер'));
            return;
        }
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
            await createClient(getClientsCollection(), { name, createdAt: Date.now() });
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
            await performExplicitSignOut(); state.currentMode = null; return;
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
            await deleteClient(getClientsCollection(), client.id);
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
            await updateClient(getClientsCollection(), client.id, { name: newName });
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
    // СПИСОК ЦИКЛОВ: 1-й клик — активация и раскрытие; 2-й по той же карточке (или заголовок
    // когда активна, или «Перейти к тренировкам») — список программ цикла.
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
            const accessMark = state.currentMode === 'own' && ownCycleIsSharedWithTrainer(cycle.id)
                ? `<span class="cycle-card-access-mark" title="Этот цикл доступен тренеру">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                            <path fill="currentColor" d="m10 15.172l-3.95-3.95l-1.414 1.414L10 18L20.364 7.636l-1.414-1.414z"></path>
                        </svg>
                   </span>`
                : '';
            const dateStr = cycle.startDateString || '—';
            titleEl.innerHTML = `${accessMark}<span>${cycle.name}</span> <span><small class="muted">(${dateStr})</small></span>`;
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
                    state.currentPage = 'programsInCycle';
                    state.lastProgramsPage = 'programsInCycle';
                    render();
                    return;
                }
                applyCycleSelection(cycle, { captureFlip: true });
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
            const linkedUid = getActiveLinkedClientUid();
            if (state.currentMode === 'personal' && linkedUid) {
                newCycle.createdByTrainerUid = userId;
                newCycle.trainerAccess = { [userId]: true };
            }
            try {
                if (state.currentMode === 'personal' && linkedUid) {
                    await createCycle(db, getUserCyclesCollection(), newCycle, {
                        linkedTrainerAccessRef: getLinkedTrainerDocRef(linkedUid, userId)
                    });
                } else {
                    await createCycle(db, getUserCyclesCollection(), newCycle);
                }
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
    editBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" xmlns:xlink="http://www.w3.org/1999/xlink" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><title>Редактировать</title><path fill="currentColor" d="M 14.96 1.812 C 14.01 1.875 13.23 2.479 12.62 3.165 C 9.636 6.167 6.628 9.151 3.651 12.16 C 2.981 12.89 2.991 13.94 2.731 14.85 C 2.558 15.67 2.348 16.49 2.197 17.32 C 2.22 17.74 2.708 17.9 3.055 17.74 C 4.394 17.42 5.752 17.18 7.078 16.81 C 7.617 16.62 8.021 16.2 8.41 15.8 C 8.307 15.4 8.24 15 8.211 14.59 C 7.701 15.02 7.32 15.65 6.678 15.89 C 5.577 16.16 4.465 16.39 3.359 16.64 C 3.627 15.5 3.846 14.35 4.144 13.22 C 4.449 12.6 5.062 12.2 5.511 11.69 C 7.823 9.38 10.14 7.07 12.45 4.76 C 13.38 5.69 14.31 6.62 15.24 7.551 C 14.82 7.971 14.41 8.391 13.99 8.811 C 14.4 8.842 14.8 8.907 15.2 9.01 C 16 8.179 16.87 7.41 17.62 6.537 C 18.58 5.306 18.3 3.354 17.05 2.432 C 16.46 1.971 15.7 1.747 14.96 1.812 z M 15.6 2.848 C 16.69 3.048 17.46 4.279 17.1 5.346 C 16.93 5.981 16.38 6.384 15.95 6.84 C 15.02 5.91 14.08 4.98 13.15 4.051 C 13.7 3.495 14.29 2.812 15.14 2.818 C 15.29 2.801 15.45 2.84 15.6 2.848 z "/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-miterlimit="10" d="M12.07,13.39L13.71,12.47L15.35,13.39L15.35,15.22L13.71,16.15L12.07,15.22z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-miterlimit="10" d="M16.98,13.5L17.8,12.6L17.18,11.55L15.97,11.84L14.59,11.1L14.32,10.22L13.1,10.22L12.82,11.1L11.45,11.84L10.24,11.55L9.62,12.6L10.44,13.5L10.44,15.12L9.62,16.01L10.24,17.07L11.45,16.78L12.82,17.52L13.1,18.4L14.32,18.4L14.59,17.52L15.97,16.78L17.18,17.07L17.8,16.01L16.98,15.12z"/></svg>';
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
            await deleteCycle(getUserCyclesCollection(), cycle.id);
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
    modalContent.className = `modal-edit modal-simple-form ${MODAL_TEXT_INPUT_CLASS}`;
    prepareKeyboardDockedModal(modal, modalContent);

    const title = createElement('h3', 'modal-simple-form__title', 'Редактировать название цикла');

    const input = document.createElement('input');
    input.type = 'text';
    input.value = cycle.name;
    input.className = 'modal-input';

    const btnGroup = document.createElement('div');
    btnGroup.className = 'modal-buttons';

    const cancelBtn = createElement('button', 'btn cancel-btn', 'Отмена');
    const saveBtn = createElement('button', 'btn btn-primary', 'Изменить');

    cancelBtn.addEventListener('click', () => {
        document.body.removeChild(modal);
    });

    saveBtn.addEventListener('click', async () => {
        const newName = input.value.trim();
        if (!newName) {
            showToast('Введите название!');
            return;
        }
        try {
            await updateCycle(getUserCyclesCollection(), cycle.id, { name: newName });
            document.body.removeChild(modal);
        } catch (error) {
            console.error("Ошибка при обновлении цикла:", error);
            showToast('Ошибка сохранения');
        }
    });

    btnGroup.append(cancelBtn, saveBtn);
    modalContent.append(title, input, btnGroup);
    modal.append(modalContent);
    presentKeyboardDockedModal(modal, modalContent);

    // Закрытие при клике вне модалки
    modal.addEventListener('click', (e) => {
        if (e.target === modal) document.body.removeChild(modal);
    });
}


// =================================================================
// 🌟 МОДАЛКА: ДОБАВЛЕНИЕ ЦИКЛА
// =================================================================
function openAddCycleModal(onConfirm) {
    console.log('Модалка должна открыться'); // проверка
    const modal = document.createElement('div');
    modal.className = 'modal-overlay-cicle';

    const modalContent = document.createElement('div');
    modalContent.className = `modal-cicle modal-simple-form ${MODAL_TEXT_INPUT_CLASS}`;
    prepareKeyboardDockedModal(modal, modalContent);

    const title = createElement('h3', 'modal-simple-form__title', 'Добавить новый цикл');

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Введите название цикла...';
    input.className = 'modal-input';

    const btnGroup = document.createElement('div');
    btnGroup.className = 'modal-buttons';

    const cancelBtn = createElement('button', 'btn cancel-btn', 'Отмена');
    const confirmBtn = createElement('button', 'btn btn-primary', 'Добавить');

    cancelBtn.addEventListener('click', () => {
        document.body.removeChild(modal);
    });


    confirmBtn.addEventListener('click', async () => {
        const name = input.value.trim();
        if (!name) {
            showToast('Введите название цикла!');
            return;
        }
        await onConfirm(name);
        document.body.removeChild(modal);
    });

    btnGroup.append(cancelBtn, confirmBtn);
    modalContent.append(title, input, btnGroup);
    modal.append(modalContent);
    presentKeyboardDockedModal(modal, modalContent);


    // Закрытие при клике вне модалки
    modal.addEventListener('click', (e) => {
        if (e.target === modal) document.body.removeChild(modal);
    });
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

    if (state.isProgramsLoading && state.programs.length === 0) {
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
                if (programItem.dataset.suppressClick === '1') {
                    programItem.dataset.suppressClick = '0';
                    return;
                }
                if (!e.target.closest('.menu-btn')) {
                    state.selectedProgramIdForDetails = program.id;
                    state.programDetailsOrigin = 'programsInCycle';
                    state.currentPage = 'programDetails';
                    state.expandedExerciseId = null;
                    state.editingSetId = null;
                    render();
                }
            });

            attachProgramReorderLongPress({ itemEl: programItem, parentEl: programsList });
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
                    await createProgram(getUserProgramsCollection(), newProgram);
                } catch (error) {
                    console.error("Ошибка при добавлении программы:", error);
                    showToast('Ошибка сохранения. Проверьте правила Firebase!');
                }
            },
            async (programCopy) => {
                try {
                    await createProgram(getUserProgramsCollection(), programCopy);
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
    editBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" xmlns:xlink="http://www.w3.org/1999/xlink" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><title>Редактировать</title><path fill="currentColor" d="M 14.96 1.812 C 14.01 1.875 13.23 2.479 12.62 3.165 C 9.636 6.167 6.628 9.151 3.651 12.16 C 2.981 12.89 2.991 13.94 2.731 14.85 C 2.558 15.67 2.348 16.49 2.197 17.32 C 2.22 17.74 2.708 17.9 3.055 17.74 C 4.394 17.42 5.752 17.18 7.078 16.81 C 7.617 16.62 8.021 16.2 8.41 15.8 C 8.307 15.4 8.24 15 8.211 14.59 C 7.701 15.02 7.32 15.65 6.678 15.89 C 5.577 16.16 4.465 16.39 3.359 16.64 C 3.627 15.5 3.846 14.35 4.144 13.22 C 4.449 12.6 5.062 12.2 5.511 11.69 C 7.823 9.38 10.14 7.07 12.45 4.76 C 13.38 5.69 14.31 6.62 15.24 7.551 C 14.82 7.971 14.41 8.391 13.99 8.811 C 14.4 8.842 14.8 8.907 15.2 9.01 C 16 8.179 16.87 7.41 17.62 6.537 C 18.58 5.306 18.3 3.354 17.05 2.432 C 16.46 1.971 15.7 1.747 14.96 1.812 z M 15.6 2.848 C 16.69 3.048 17.46 4.279 17.1 5.346 C 16.93 5.981 16.38 6.384 15.95 6.84 C 15.02 5.91 14.08 4.98 13.15 4.051 C 13.7 3.495 14.29 2.812 15.14 2.818 C 15.29 2.801 15.45 2.84 15.6 2.848 z "/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-miterlimit="10" d="M12.07,13.39L13.71,12.47L15.35,13.39L15.35,15.22L13.71,16.15L12.07,15.22z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-miterlimit="10" d="M16.98,13.5L17.8,12.6L17.18,11.55L15.97,11.84L14.59,11.1L14.32,10.22L13.1,10.22L12.82,11.1L11.45,11.84L10.24,11.55L9.62,12.6L10.44,13.5L10.44,15.12L9.62,16.01L10.24,17.07L11.45,16.78L12.82,17.52L13.1,18.4L14.32,18.4L14.59,17.52L15.97,16.78L17.18,17.07L17.8,16.01L16.98,15.12z"/></svg>';
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
            await deleteProgram(getUserProgramsCollection(), program.id);
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
    modalContent.className = `modal-edit modal-simple-form ${MODAL_TEXT_INPUT_CLASS}`;
    prepareKeyboardDockedModal(modal, modalContent);

    const title = createElement('h3', 'modal-simple-form__title', 'Редактировать название программы');

    const input = document.createElement('input');
    input.type = 'text';
    input.value = program.name;
    input.className = 'modal-input';

    const btnGroup = document.createElement('div');
    btnGroup.className = 'modal-buttons';

    const cancelBtn = createElement('button', 'btn cancel-btn', 'Отмена');
    const saveBtn = createElement('button', 'btn btn-primary', 'Изменить');

    cancelBtn.addEventListener('click', () => {
        document.body.removeChild(modal);
    });

    saveBtn.addEventListener('click', async () => {
        const newName = input.value.trim();
        if (!newName) {
            showToast('Введите название!');
            return;
        }
        try {
            await updateProgramDocument(getUserProgramsCollection(), program.id, { name: newName });
            document.body.removeChild(modal);
        } catch (error) {
            console.error("Ошибка при обновлении программы:", error);
            showToast('Ошибка сохранения');
        }
    });

    btnGroup.append(cancelBtn, saveBtn);
    modalContent.append(title, input, btnGroup);
    modal.append(modalContent);
    presentKeyboardDockedModal(modal, modalContent);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) document.body.removeChild(modal);
    });
}

// =================================================================
// 🌟 МОДАЛКА: ДОБАВЛЕНИЕ ПРОГРАММЫ
// =================================================================
function createCycleLabelArrow() {
    const arrow = createElement('span', 'cycle-label-arrow');
    arrow.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="m12.37 15.835l6.43-6.63C19.201 8.79 18.958 8 18.43 8H5.57c-.528 0-.771.79-.37 1.205l6.43 6.63c.213.22.527.22.74 0"/>
        </svg>
    `;
    return arrow;
}

function openAddProgramModal(onConfirmNew, onConfirmCopy) {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay-cicle modal-overlay-cicle--sheet';

    const modalContent = document.createElement('div');
    modalContent.className = `modal-cicle modal-cicle--add-program ${MODAL_TEXT_INPUT_CLASS}`;
    prepareKeyboardDockedModal(modal, modalContent);

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
    const cycleArrow = createCycleLabelArrow();
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
    const programArrow = createCycleLabelArrow();
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
    presentKeyboardDockedModal(modal, modalContent);

    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
        else if (!e.target.closest('.add-program-dropdown-wrap')) closeAllDropdowns();
    });
}


// =================================================================
// 🌟 Модалка для редактирования подхода
// =================================================================
const __DROP_SET_MAX_PARTS = 5;

function __getDropSetGroupBounds(exercise, idx) {
    const sets = exercise?.sets || [];
    if (idx < 0 || idx >= sets.length) return [idx, idx];
    let start = idx;
    while (start > 0 && sets[start]?.continuation) start -= 1;
    let end = idx;
    while (end < sets.length - 1 && sets[end + 1]?.continuation) end += 1;
    return [start, end];
}

function __getApproachOrdinalForSet(sets, setIndex) {
    if (!Array.isArray(sets) || setIndex < 0 || setIndex >= sets.length) return 0;
    let n = 0;
    for (let i = 0; i <= setIndex; i++) {
        if (!sets[i]?.continuation) n++;
    }
    return n;
}

/** Журнал: один фрагмент «вес×повторы» с символом умножения в отдельном span */
function __appendJournalTrainingCompact(parent, weight, reps) {
    const compact = createElement('span', 'set-item__compact');
    compact.append(
        document.createTextNode(String(weight ?? 0)),
        createElement('span', 'set-item__times', 'x'),
        document.createTextNode(String(reps ?? 0))
    );
    parent.append(compact);
}

function __dropSetTreeSvg(isLastInGroup) {
    if (isLastInGroup) {
        return `<svg class="set-row__tree-svg set-row__tree-svg--last" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 34" width="22" height="34" aria-hidden="true"><path class="set-row__tree-path" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" d="M11 0v15h9"/></svg>`;
    }
    return `<svg class="set-row__tree-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 34" width="22" height="34" aria-hidden="true"><path class="set-row__tree-path" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" d="M11 0v34M11 14h9"/></svg>`;
}

const __DROP_SET_TREE_ROOT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" xmlns:xlink="http://www.w3.org/1999/xlink" id="Шконка 8" viewBox="0 0 22 34">
  <path class="set-row__tree-path" fill="none" stroke="currentColor" stroke-width="1.32" stroke-linecap="round" stroke-linejoin="round" d="M12.7,15.1 L12.7,31.3 M12.8,15.1 L15.6,15.1 L21.6,15.1"></path>
</svg>`;

function __formatSetDisplayKgReps(displayWeight, displayReps) {
    return `${displayWeight} <small>кг</small> <small>x</small> ${displayReps} <small>пов</small>`;
}

/** Модалки с вводом текста: циклы, программы, упражнения, подход, комментарии. */
export const MODAL_TEXT_INPUT_CLASS = 'modal-text-input';

export function prepareKeyboardDockedModal(overlay, host) {
    if (!overlay || !host) return;
    host.classList.add('keyboard-docked-modal-host');
}

export function presentKeyboardDockedModal(overlay, host, options = {}) {
    if (!overlay || !host) return;

    const focusTarget = options.focusTarget || null;
    const focusDelayMs = Math.max(0, Number(options.focusDelayMs) || 0);
    const selectText = Boolean(options.selectText);

    if (!overlay.isConnected) {
        document.body.appendChild(overlay);
    }
    if (focusTarget) {
        window.setTimeout(() => {
            if (!focusTarget.isConnected) return;
            try {
                focusTarget.focus();
                if (selectText && typeof focusTarget.select === 'function') {
                    focusTarget.select();
                }
            } catch (_) {}
        }, focusDelayMs);
    }
}

function openEditSetModal(programId, exerciseId, setIndex, currentSet) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';

    const modal = document.createElement('div');
    modal.className = `modal-set ${MODAL_TEXT_INPUT_CLASS}`;
    prepareKeyboardDockedModal(overlay, modal);

    const program = state.programs.find(p => p.id === programId);
    const exercise = program?.exercises?.find(ex => ex.id === exerciseId);
    if (!program || !exercise || !Array.isArray(exercise.sets) || !exercise.sets[setIndex]) {
        document.body.appendChild(overlay);
        overlay.remove();
        return;
    }

    const [gStart, gEnd] = __getDropSetGroupBounds(exercise, setIndex);
    const groupSets = exercise.sets.slice(gStart, gEnd + 1).slice(0, __DROP_SET_MAX_PARTS);
    const approachOrdinal = __getApproachOrdinalForSet(exercise.sets, gStart);

    const headerRow = createElement('div', 'modal-set-header');
    const title = createElement('h3', null, `${approachOrdinal}. подход`);

    const checkboxWrapper = createElement('label', 'checkbox-wrapper checkbox-wrapper--modal-header');
    const isMainCheckbox = createElement('input', 'checkbox-input');
    isMainCheckbox.type = 'checkbox';
    isMainCheckbox.checked = !!groupSets[0]?.isMain;
    const customCheckbox = createElement('span', 'checkbox-custom');
    const checkboxLabel = createElement('span', 'checkbox-text', 'рабочий');
    checkboxWrapper.append(isMainCheckbox, customCheckbox, checkboxLabel);
    headerRow.append(title, checkboxWrapper);

    const fieldsWrap = createElement('div', 'modal-set-fields');
    const rowMetas = [];

    const addPartBtn = createElement('button', 'btn btn-secondary modal-set-add-part-btn');
    addPartBtn.type = 'button';
    addPartBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 14 14"><title>Add-1-solid SVG Icon</title><path fill="currentColor" fill-rule="evenodd" d="M8 1a1 1 0 0 0-2 0v5H1a1 1 0 0 0 0 2h5v5a1 1 0 1 0 2 0V8h5a1 1 0 0 0 0-2H8z" clip-rule="evenodd"></path></svg><span>добавить сет</span>';

    const deleteBtnSvg = `
                        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24">
                          <path fill="currentColor" d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59L7.11 5.7A1 1 0 1 0 5.7 7.11L10.59 12L5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4z"/>
                        </svg>`;

    const btnOk = createElement('button', 'btn btn-primary modal-set-ok-btn', 'ОК');

    const syncAddBtnState = () => {
        addPartBtn.disabled = rowMetas.length >= __DROP_SET_MAX_PARTS;
        rowMetas.forEach((m) => {
            if (m.delBtn) m.delBtn.disabled = rowMetas.length <= 1;
        });
    };

    const removeRow = (meta) => {
        const ix = rowMetas.indexOf(meta);
        if (ix < 1 || rowMetas.length <= 1) return;
        meta.row.remove();
        rowMetas.splice(ix, 1);
        syncAddBtnState();
    };

    const addFirstRow = (w = '', r = '') => {
        const row = createElement('div', 'modal-set-row modal-set-row--first');
        const wIn = createElement('input');
        wIn.type = 'number';
        wIn.placeholder = 'Вес';
        wIn.value = w || '';
        const spanX = createElement('span', 'SpanX', ' x');
        const rIn = createElement('input');
        rIn.type = 'number';
        rIn.placeholder = 'Повт';
        rIn.value = r || '';
        row.append(wIn, spanX, rIn, btnOk);
        fieldsWrap.append(row);
        rowMetas.push({ row, wIn, rIn, delBtn: null });
    };

    const addExtraRow = (w = '', r = '') => {
        if (rowMetas.length >= __DROP_SET_MAX_PARTS) return;

        const row = createElement('div', 'modal-set-row');
        const wIn = createElement('input');
        wIn.type = 'number';
        wIn.placeholder = 'Вес';
        wIn.value = w || '';
        const spanX = createElement('span', 'SpanX', ' x');
        const rIn = createElement('input');
        rIn.type = 'number';
        rIn.placeholder = 'Повт';
        rIn.value = r || '';
        const delBtn = createElement('button', 'btn delete-set-btn modal-set-row-delete');
        delBtn.type = 'button';
        delBtn.innerHTML = deleteBtnSvg;
        const meta = { row, wIn, rIn, delBtn };
        delBtn.addEventListener('click', () => removeRow(meta));
        row.append(wIn, spanX, rIn, delBtn);
        fieldsWrap.append(row);
        rowMetas.push(meta);
        syncAddBtnState();
    };

    if (groupSets.length) {
        addFirstRow(groupSets[0].weight || '', groupSets[0].reps || '');
        for (let i = 1; i < groupSets.length; i++) {
            addExtraRow(groupSets[i].weight || '', groupSets[i].reps || '');
        }
    } else {
        addFirstRow('', '');
    }

    addPartBtn.addEventListener('click', () => addExtraRow('', ''));
    syncAddBtnState();

    btnOk.addEventListener('click', async () => {
        const parts = rowMetas.map((m) => ({
            weight: m.wIn.value.trim(),
            reps: m.rIn.value.trim()
        })).filter((p) => p.weight !== '' || p.reps !== '');

        if (!parts.length) {
            showToast('Укажите вес или повторения');
            return;
        }

        const isMain = !!isMainCheckbox.checked;
        const newSets = parts.map((p, j) => {
            const prev = groupSets[j];
            return {
                weight: p.weight,
                reps: p.reps,
                isMain,
                done: prev && typeof prev.done === 'boolean' ? prev.done : false,
                continuation: j > 0
            };
        });

        const fresh = state.programs.find(p => p.id === programId);
        const ex = fresh?.exercises?.find(ex => ex.id === exerciseId);
        if (!fresh || !ex || !Array.isArray(ex.sets)) {
            document.body.removeChild(overlay);
            return;
        }

        const anchor = Math.min(gStart, Math.max(0, ex.sets.length - 1));
        const [s0, s1] = __getDropSetGroupBounds(ex, anchor);
        ex.sets.splice(s0, s1 - s0 + 1, ...newSets);

        try {
            queueProgramExercisesSave(fresh.id, fresh.exercises, {
                delayMs: 280,
                errorMessage: 'Не удалось сохранить подходы'
            });
            render();
        } catch (err) {
            console.error(err);
            showToast('Ошибка сохранения');
        }
        document.body.removeChild(overlay);
    });

    modal.append(headerRow, fieldsWrap, addPartBtn);
    overlay.append(modal);
    presentKeyboardDockedModal(overlay, modal);

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            document.body.removeChild(overlay);
        }
    });
}


// =================================================================
// 🌟 МОДАЛКА: Комментарий с поддержкой фото/видео (новые файлы → Firebase Storage)
// =================================================================
function openCommentModal(exerciseId, currentNote, titleText, onSave) {
    const overlay = createElement('div', 'modal-overlay');
    const modal = createElement('div', `modal-content modal-compact comExer ${MODAL_TEXT_INPUT_CLASS}`);
    prepareKeyboardDockedModal(overlay, modal);

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
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';

   // Кнопка "Медиа" с SVG вместо текста 📎
   const addMediaBtn = createElement('button', 'btn btn-secondary');
   addMediaBtn.innerHTML = `

       <svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="0 0 56 56"><title>Camera-on-rectangle SVG Icon</title><path fill="currentColor" d="M6.155 41.944h3.763V47c0 4.038 2.078 6.076 6.155 6.076h33.772C53.922 53.076 56 51.038 56 47V26.479c0-4.038-2.078-6.077-6.155-6.077H45.26c-1.53 0-2-.294-2.882-1.293l-.313-.334v-4.312c0-4.038-2.059-6.076-6.135-6.076H6.155C2.058 8.387 0 10.425 0 14.463v21.424c0 4.038 2.058 6.057 6.155 6.057m.058-3.156c-1.96 0-3.057-1.039-3.057-3.077V14.64c0-2.039 1.097-3.097 3.057-3.097H35.87c1.94 0 3.038 1.058 3.038 3.097v1.372c-.568-.216-1.235-.314-2.098-.314h-7.82c-2.019 0-3.019.588-3.999 1.666l-1.587 1.745c-.863.98-1.353 1.293-2.882 1.293h-4.45c-4.076 0-6.154 2.039-6.154 6.077v12.309Zm9.919 11.133c-1.94 0-3.058-1.058-3.058-3.096v-20.19c0-2.019 1.117-3.077 3.058-3.077h5.174c1.764 0 2.725-.333 3.685-1.43l1.549-1.706c1.117-1.255 1.685-1.568 3.43-1.568h5.86c1.726 0 2.294.314 3.43 1.568l1.53 1.705c.98 1.098 1.92 1.431 3.685 1.431h5.312c1.94 0 3.057 1.058 3.057 3.077v20.19c0 2.038-1.117 3.096-3.057 3.096Zm16.837-3.136c5.92 0 10.682-4.743 10.682-10.721c0-5.96-4.743-10.703-10.682-10.703a10.654 10.654 0 0 0-10.702 10.702c0 5.979 4.763 10.722 10.702 10.722m14.073-15.504c1.333 0 2.43-1.078 2.43-2.411a2.43 2.43 0 1 0-4.86 0c0 1.333 1.097 2.41 2.43 2.41M32.97 43.806a7.734 7.734 0 0 1-7.742-7.742c0-4.293 3.469-7.723 7.742-7.723a7.7 7.7 0 0 1 7.722 7.722a7.704 7.704 0 0 1-7.722 7.743"/></svg>
    <span class="add-media-text">Добавить медиа</span>
   `;
   addMediaBtn.addEventListener('click', () => {
     fileInput.click();
   });
   addMediaBtn.querySelector('.add-media-text')?.replaceChildren(document.createTextNode('Добавить фото'));


    // Обработка выбора файла
   mediaContainer.__afterRender = () => {
     mediaContainer.prepend(addMediaBtn);
   };
   const syncCommentMediaContainer = () => {
     renderMediaPreview(mediaContainer, media);
   };
   syncCommentMediaContainer();
fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (!String(file.type || '').toLowerCase().startsWith('image/')) {
    showToast('В комментарии можно добавлять только фото');
    fileInput.value = '';
    return;
  }

  // === Создаём прогресс-бар ===
  const progressWrap = document.createElement('div');
  progressWrap.className = 'upload-progress-wrap';
  const progressBar = document.createElement('div');
  progressBar.className = 'upload-progress-bar';
  progressWrap.append(progressBar);
  mediaContainer.append(progressWrap);

  try {
    const url = await uploadUserMediaFileOrQueueWithProgress(file, 'training-media', (percent) => {
      progressBar.style.width = percent + '%';
      progressBar.textContent = percent + '%'; // можно убрать, если не хочешь текст
      console.log('🟢 Реальный прогресс:', percent);
    });

    // === Добавляем медиа ===
    media.push({ url, type: 'photo' });
    syncCommentMediaContainer();

    // === Показываем уведомление ===
    showToast(
      url.startsWith('local-media://')
        ? 'Фото сохранено на устройстве и будет загружено, когда появится интернет.'
        : 'Фото загружено'
    );

    // === Удаляем прогресс после короткой паузы ===
    setTimeout(() => progressWrap.remove(), 1000);
  } catch (err) {
    console.error('❌ Ошибка загрузки:', err);
    showToast('Не удалось сохранить фото', 'error');
    progressWrap.remove();
  } finally {
    fileInput.value = '';
  }
});






// ✅ Только кнопка "Сохранить"
const controls = createElement('div', 'modal-controls');
const cancelBtn = createElement('button', 'btn cancel-btn', 'Отмена');
const saveBtn = createElement('button', 'btn btn-primary', 'Сохранить');
controls.append(cancelBtn, saveBtn);

// ✅ Закрытие модалки по клику на фон (overlay)
let commentModalSaved = false;
const closeCommentModal = async () => {
    if (!commentModalSaved) {
        await purgePendingMediaUrls(media.map((item) => item?.url));
    }
    overlay.remove();
};
overlay.addEventListener('click', () => {
    void closeCommentModal();
});

// ❗ Чтобы клик по модалке не закрывал её
modal.addEventListener('click', (e) => e.stopPropagation());
cancelBtn.addEventListener('click', () => {
    void closeCommentModal();
});

// ✅ Сохранение данных
saveBtn.addEventListener('click', () => {
    commentModalSaved = true;
    onSave(textarea.value.trim(), media);
    overlay.remove();
});
    modal.append(title, textarea, mediaContainer, fileInput, controls);
    overlay.append(modal);
    presentKeyboardDockedModal(overlay, modal);
}


// -----------------------------------------------------------------------------
// Новые загрузки медиа: Firebase Storage (users/{uid}/...).
// Старые записи с URL Cloudinary продолжают открываться по сохранённой ссылке.
// -----------------------------------------------------------------------------
const MEDIA_UPLOAD_MAX_IMAGE_EDGE = 2048;
const MEDIA_UPLOAD_IMAGE_QUALITY = 0.82;
const MEDIA_UPLOAD_REENCODE_BYTES_THRESHOLD = 1_400_000;
const MEDIA_UPLOAD_SKIP_IMAGE_TYPES = new Set(['image/gif', 'image/svg+xml']);

function isCompressibleUploadImage(file) {
    if (!file) return false;
    const mimeType = String(file.type || '').trim().toLowerCase();
    return mimeType.startsWith('image/') && !MEDIA_UPLOAD_SKIP_IMAGE_TYPES.has(mimeType);
}

function replaceFileExtension(filename, nextExtension) {
    const safeName = String(filename || '').trim() || 'image';
    const baseName = safeName.replace(/\.[^.]+$/, '') || 'image';
    const normalizedExtension = String(nextExtension || 'jpg').replace(/^\.+/, '').trim() || 'jpg';
    return `${baseName}.${normalizedExtension}`;
}

function loadImageElementFromFile(file) {
    return new Promise((resolve, reject) => {
        const objectUrl = URL.createObjectURL(file);
        const image = new Image();

        const cleanup = () => {
            try {
                URL.revokeObjectURL(objectUrl);
            } catch (_) {}
        };

        image.onload = () => {
            cleanup();
            resolve(image);
        };

        image.onerror = () => {
            cleanup();
            reject(new Error('image_load_failed'));
        };

        image.src = objectUrl;
    });
}

function canvasToJpegBlob(canvas, quality) {
    return new Promise((resolve) => {
        canvas.toBlob(resolve, 'image/jpeg', quality);
    });
}

async function compressImageFileForUpload(file) {
    if (!isCompressibleUploadImage(file)) return file;

    const mimeType = String(file.type || '').trim().toLowerCase();
    const originalSize = Number(file.size || 0);
    const forceReencode = /image\/hei(c|f)/i.test(mimeType);
    const image = await loadImageElementFromFile(file).catch(() => null);
    if (!image) return file;

    const sourceWidth = Number(image.naturalWidth || image.width || 0);
    const sourceHeight = Number(image.naturalHeight || image.height || 0);
    if (!sourceWidth || !sourceHeight) return file;

    const largestSide = Math.max(sourceWidth, sourceHeight);
    const shouldResize = largestSide > MEDIA_UPLOAD_MAX_IMAGE_EDGE;
    const shouldReencode = forceReencode || shouldResize || originalSize >= MEDIA_UPLOAD_REENCODE_BYTES_THRESHOLD;
    if (!shouldReencode) return file;

    const scale = shouldResize ? (MEDIA_UPLOAD_MAX_IMAGE_EDGE / largestSide) : 1;
    const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
    const targetHeight = Math.max(1, Math.round(sourceHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return file;

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, targetWidth, targetHeight);
    context.drawImage(image, 0, 0, targetWidth, targetHeight);

    const compressedBlob = await canvasToJpegBlob(canvas, MEDIA_UPLOAD_IMAGE_QUALITY);
    if (!compressedBlob) return file;

    const shouldUseCompressed =
        forceReencode
        || shouldResize
        || originalSize === 0
        || compressedBlob.size < (originalSize * 0.97);

    if (!shouldUseCompressed) return file;

    return new File(
        [compressedBlob],
        replaceFileExtension(file.name || 'image.jpg', 'jpg'),
        {
            type: 'image/jpeg',
            lastModified: Date.now()
        }
    );
}

async function prepareUserMediaFileForUpload(file) {
    if (!file) throw new Error('media_file_missing');
    if (!isCompressibleUploadImage(file)) return file;

    try {
        return await compressImageFileForUpload(file);
    } catch (error) {
        console.warn('[media-upload] image compression skipped:', error);
        return file;
    }
}

const offlineMediaSourceBindings = new WeakMap();

export async function resolveOfflineMediaDisplayUrl(url) {
    const normalized = String(url || '').trim();
    if (!normalized) return '';
    if (/^(blob:|data:)/i.test(normalized)) return normalized;

    if (isPendingMediaUrl(normalized)) {
        try {
            const pendingObjectUrl = await getPendingMediaObjectUrl(normalized);
            return pendingObjectUrl || normalized;
        } catch (error) {
            console.warn('[pending-media-queue] resolve display url failed:', error);
            return normalized;
        }
    }

    try {
        const cachedUrl = await getCachedMediaObjectUrl(normalized);
        return cachedUrl || normalized;
    } catch (error) {
        console.warn('[media-cache] resolve display url failed:', error);
        return normalized;
    }
}

export function applyOfflineMediaSource(element, url, type = 'photo') {
    if (!element) return;
    const normalized = String(url || '').trim();
    if (!normalized) return;

    const token = {};
    offlineMediaSourceBindings.set(element, token);

    const assignSource = (sourceUrl) => {
        if (offlineMediaSourceBindings.get(element) !== token || !sourceUrl) return;
        if (element.src !== sourceUrl) {
            element.src = sourceUrl;
            if (type === 'video' && typeof element.load === 'function') {
                element.load();
            }
        }
    };

    assignSource(normalized);
    void resolveOfflineMediaDisplayUrl(normalized).then(assignSource).catch(() => {});
}

export function applyOfflineMediaBackground(element, url) {
    if (!element) return;
    const normalized = String(url || '').trim();
    if (!normalized) return;

    const token = {};
    offlineMediaSourceBindings.set(element, token);

    const assignBackground = (sourceUrl) => {
        if (offlineMediaSourceBindings.get(element) !== token || !sourceUrl) return;
        element.style.backgroundImage = `url(${sourceUrl})`;
    };

    assignBackground(normalized);
    void resolveOfflineMediaDisplayUrl(normalized).then(assignBackground).catch(() => {});
}

function isExclusiveSessionWriteBlocked() {
    try {
        return Boolean(window.__TRAINING_DIARY_WRITE_GUARD__?.()?.blocked);
    } catch (_) {
        return false;
    }
}

function isRecoverableOfflineUploadError(error) {
    if (getAppNetworkStatus().online === false) return true;
    const code = String(error?.code || '').trim().toLowerCase();
    const message = String(error?.message || error || '').trim().toLowerCase();
    return code.includes('network')
        || code.includes('retry-limit-exceeded')
        || message.includes('network')
        || message.includes('offline');
}

function normalizePendingMediaUrls(urls = []) {
    return Array.from(new Set(
        (Array.isArray(urls) ? urls : [])
            .map((url) => String(url || '').trim())
            .filter((url) => isPendingMediaUrl(url))
    ));
}

async function attachPendingMediaTargetsByUrls(urls = [], target) {
    const pendingUrls = normalizePendingMediaUrls(urls);
    if (!pendingUrls.length || !target) return;

    await Promise.allSettled(
        pendingUrls.map((pendingUrl) => attachPendingMediaTarget(pendingUrl, target))
    );
}

async function purgePendingMediaUrls(urls = []) {
    const pendingUrls = normalizePendingMediaUrls(urls);
    if (!pendingUrls.length) return;

    await Promise.allSettled(
        pendingUrls.map((pendingUrl) => deletePendingMediaUpload(pendingUrl))
    );
}

export async function bindPendingMediaUrlsToTarget(urls = [], target) {
    await attachPendingMediaTargetsByUrls(urls, target);
}

export async function discardPendingMediaDraftUrls(urls = []) {
    await purgePendingMediaUrls(urls);
}

export async function uploadUserMediaFileWithProgress(file, folder = 'uploads', onProgress) {
    const uid = getCurrentAuthUid();
    if (!uid) throw new Error('Нужна авторизация для загрузки файла');

    if (isOfflineModeActive()) throw new Error('offline_media_upload_not_supported');
    const preparedFile = await prepareUserMediaFileForUpload(file);
    const safeFolder = String(folder || 'uploads').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'uploads';
    const rawName = preparedFile.name || file.name || 'file';
    const safeName = rawName.replace(/[^\w.\-+()]/g, '_').slice(0, 180);
    const fullPath = `users/${uid}/${safeFolder}/${Date.now()}_${safeName}`;
    const storageRef = ref(storage, fullPath);
    const task = uploadBytesResumable(storageRef, preparedFile, {
        contentType: preparedFile.type || file.type || 'application/octet-stream'
    });

    return new Promise((resolve, reject) => {
        task.on(
            'state_changed',
            (snapshot) => {
                if (typeof onProgress === 'function' && snapshot.totalBytes > 0) {
                    const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
                    onProgress(pct);
                }
            },
            (err) => reject(err),
            async () => {
                try {
                    const url = await getDownloadURL(task.snapshot.ref);
                    if (typeof onProgress === 'function') onProgress(100);
                    resolve(url);
                } catch (e) {
                    reject(e);
                }
            }
        );
    });
}

/** Удаление файла из Firebase Storage по HTTPS download URL (наш bucket). Облако Cloudinary / чужие URL пропускаются. */
async function uploadPreparedUserMediaFileToStorage(preparedFile, originalFile, folder = 'uploads', onProgress) {
    const uid = getCurrentAuthUid();
    if (!uid) throw new Error('media_upload_auth_required');

    const safeFolder = String(folder || 'uploads').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'uploads';
    const rawName = preparedFile.name || originalFile?.name || 'file';
    const safeName = rawName.replace(/[^\w.\-+()]/g, '_').slice(0, 180);
    const fullPath = `users/${uid}/${safeFolder}/${Date.now()}_${safeName}`;
    const storageRef = ref(storage, fullPath);
    const task = uploadBytesResumable(storageRef, preparedFile, {
        contentType: preparedFile.type || originalFile?.type || 'application/octet-stream'
    });

    return new Promise((resolve, reject) => {
        task.on(
            'state_changed',
            (snapshot) => {
                if (typeof onProgress === 'function' && snapshot.totalBytes > 0) {
                    const pct = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
                    onProgress(pct);
                }
            },
            (err) => reject(err),
            async () => {
                try {
                    const url = await getDownloadURL(task.snapshot.ref);
                    if (typeof onProgress === 'function') onProgress(100);
                    resolve(url);
                } catch (error) {
                    reject(error);
                }
            }
        );
    });
}

async function queueOfflineUserMediaFile(file, preparedFile, folder = 'uploads', onProgress) {
    const uid = getCurrentAuthUid();
    if (!uid) throw new Error('media_upload_auth_required');

    const queued = await queuePendingMediaFile(preparedFile, {
        ownerUid: uid,
        folder
    });

    if (typeof onProgress === 'function') onProgress(100);
    return queued.pendingUrl;
}

export async function uploadUserMediaFileOrQueueWithProgress(file, folder = 'uploads', onProgress) {
    const uid = getCurrentAuthUid();
    if (!uid) throw new Error('media_upload_auth_required');

    const preparedFile = await prepareUserMediaFileForUpload(file);

    if (isOfflineModeActive()) {
        return queueOfflineUserMediaFile(file, preparedFile, folder, onProgress);
    }

    try {
        return await uploadPreparedUserMediaFileToStorage(preparedFile, file, folder, onProgress);
    } catch (error) {
        if (isRecoverableOfflineUploadError(error)) {
            return queueOfflineUserMediaFile(file, preparedFile, folder, onProgress);
        }
        throw error;
    }
}

function replaceTrainingMediaPendingUrl(items = [], pendingUrl, remoteUrl) {
    let changed = false;
    const nextItems = (Array.isArray(items) ? items : []).map((item) => {
        if (!item || typeof item !== 'object') return item;
        if (String(item.url || '').trim() !== pendingUrl) return item;
        changed = true;
        return { ...item, url: remoteUrl };
    });
    return { changed, nextItems };
}

function replaceExerciseMediaPendingUrl(exercises = [], exerciseId, pendingUrl, remoteUrl) {
    let changed = false;
    const nextExercises = JSON.parse(JSON.stringify(Array.isArray(exercises) ? exercises : []));

    nextExercises.forEach((exercise) => {
        if (String(exercise?.id || '').trim() !== String(exerciseId || '').trim()) return;
        const mediaItems = Array.isArray(exercise.media) ? exercise.media : [];
        exercise.media = mediaItems.map((item) => {
            if (!item || typeof item !== 'object') return item;
            if (String(item.url || '').trim() !== pendingUrl) return item;
            changed = true;
            return { ...item, url: remoteUrl };
        });
    });

    return { changed, nextExercises };
}

function replaceMealPhotoPendingUrl(items = [], pendingUrl, remoteUrl) {
    let changed = false;
    const nextItems = (Array.isArray(items) ? items : []).map((item) => {
        if (!item || typeof item !== 'object') return item;
        if (item?.isMealPhoto !== true) return item;
        if (String(item.photoUrl || '').trim() !== pendingUrl) return item;
        changed = true;
        return { ...item, photoUrl: remoteUrl };
    });
    return { changed, nextItems };
}

function replaceReportPhotoPendingUrl(items = [], pendingUrl, remoteUrl) {
    let changed = false;
    const nextItems = (Array.isArray(items) ? items : []).map((item) => {
        if (!item || typeof item !== 'object') return item;
        if (String(item.url || '').trim() !== pendingUrl) return item;
        changed = true;
        return { ...item, url: remoteUrl };
    });
    return { changed, nextItems };
}

async function buildPendingMediaTargetUpdate(target, pendingUrl, remoteUrl) {
    const docPath = String(target?.docPath || '').trim();
    if (!docPath) return { ok: false, skipped: 'missing-doc-path' };

    const refToUpdate = doc(db, docPath);
    const snap = await getDoc(refToUpdate);
    if (!snap.exists()) {
        return { ok: false, skipped: 'missing-doc' };
    }

    const data = snap.data() || {};

    switch (String(target?.type || '').trim()) {
        case 'program-training-media': {
            const { changed, nextItems } = replaceTrainingMediaPendingUrl(data.trainingMedia, pendingUrl, remoteUrl);
            if (!changed) return { ok: false, skipped: 'missing-placeholder' };
            return { ok: true, ref: refToUpdate, patch: { trainingMedia: nextItems } };
        }
        case 'program-exercise-media': {
            const { changed, nextExercises } = replaceExerciseMediaPendingUrl(data.exercises, target.exerciseId, pendingUrl, remoteUrl);
            if (!changed) return { ok: false, skipped: 'missing-placeholder' };
            return { ok: true, ref: refToUpdate, patch: { exercises: nextExercises } };
        }
        case 'meal-photo': {
            const mealId = String(target?.mealId || '').trim();
            if (!mealId) return { ok: false, skipped: 'missing-meal-id' };
            const { changed, nextItems } = replaceMealPhotoPendingUrl(data[mealId], pendingUrl, remoteUrl);
            if (!changed) return { ok: false, skipped: 'missing-placeholder' };
            return { ok: true, ref: refToUpdate, patch: { [mealId]: nextItems } };
        }
        case 'report-photo': {
            const { changed, nextItems } = replaceReportPhotoPendingUrl(data.photos, pendingUrl, remoteUrl);
            if (!changed) return { ok: false, skipped: 'missing-placeholder' };
            return { ok: true, ref: refToUpdate, patch: { photos: nextItems } };
        }
        default:
            return { ok: false, skipped: 'unsupported-target-type' };
    }
}

async function applyUploadedPendingMediaToTarget(record, remoteUrl) {
    const pendingUrl = String(record?.pendingUrl || '').trim();
    if (!pendingUrl || !record?.target) return { ok: false, skipped: 'missing-target' };

    const updatePlan = await buildPendingMediaTargetUpdate(record.target, pendingUrl, remoteUrl);
    if (!updatePlan.ok) {
        return updatePlan;
    }

    await updateDoc(updatePlan.ref, updatePlan.patch);
    return { ok: true };
}

async function processPendingMediaUploadQueue(options = {}) {
    if (isOfflineModeActive()) {
        return { ok: false, skipped: 'offline' };
    }

    if (isExclusiveSessionWriteBlocked()) {
        return { ok: false, skipped: 'read-only-session' };
    }

    const syncSnapshot = getAppSyncStatus();
    if (options.force !== true && syncSnapshot.hasPendingWrites) {
        return { ok: false, skipped: 'waiting-firestore-sync' };
    }

    const uid = getCurrentAuthUid();
    if (!uid) return { ok: false, skipped: 'missing-user' };

    const pendingItems = await listPendingMediaUploads({
        ownerUid: uid,
        status: 'pending',
        requireTarget: true
    });
    if (!pendingItems.length) {
        return { ok: true, processed: 0, uploaded: 0, skipped: 0, failed: 0 };
    }

    let uploaded = 0;
    let skipped = 0;
    let failed = 0;

    for (const record of pendingItems) {
        const pendingUrl = String(record?.pendingUrl || '').trim();
        if (!pendingUrl || !record?.fileBlob) {
            await deletePendingMediaUpload(pendingUrl);
            skipped += 1;
            continue;
        }

        const existingTarget = await buildPendingMediaTargetUpdate(record.target, pendingUrl, pendingUrl);
        if (!existingTarget.ok) {
            await deletePendingMediaUpload(pendingUrl);
            skipped += 1;
            continue;
        }

        await updatePendingMediaState(pendingUrl, {
            status: 'uploading',
            lastAttemptAt: Date.now(),
            lastError: ''
        });

        try {
            const uploadFile = new File(
                [record.fileBlob],
                record.fileName || 'image.jpg',
                {
                    type: record.mimeType || record.fileBlob.type || 'application/octet-stream',
                    lastModified: Number(record.lastModified || Date.now()) || Date.now()
                }
            );
            const remoteUrl = await uploadPreparedUserMediaFileToStorage(uploadFile, uploadFile, record.folder || 'uploads');
            const applyResult = await applyUploadedPendingMediaToTarget(record, remoteUrl);

            if (!applyResult.ok) {
                await deleteUserFirebaseStorageFileByDownloadUrl(remoteUrl);
                await deletePendingMediaUpload(pendingUrl);
                skipped += 1;
                continue;
            }

            await preloadOfflineMediaUrls([remoteUrl], { concurrency: 1 });
            await deletePendingMediaUpload(pendingUrl);
            uploaded += 1;
        } catch (error) {
            console.error('[pending-media-queue] upload failed:', error);
            failed += 1;
            await updatePendingMediaState(pendingUrl, {
                status: 'pending',
                lastError: String(error?.message || error || '').trim(),
                lastAttemptAt: Date.now()
            });
        }
    }

    if (uploaded > 0) {
        showToast(uploaded === 1
            ? '1 фото загружено из офлайн-очереди'
            : `${uploaded} фото загружено из офлайн-очереди`);
    }

    return {
        ok: failed === 0,
        processed: pendingItems.length,
        uploaded,
        skipped,
        failed
    };
}

function schedulePendingMediaUploadFlush(options = {}) {
    if (pendingMediaUploadFlushPromise) {
        return pendingMediaUploadFlushPromise;
    }

    const run = Promise.resolve()
        .then(() => processPendingMediaUploadQueue(options))
        .catch((error) => {
            console.warn('[pending-media-queue] flush failed:', error);
            return { ok: false, skipped: 'error', error };
        });

    pendingMediaUploadFlushPromise = run.finally(() => {
        if (pendingMediaUploadFlushPromise === run) {
            pendingMediaUploadFlushPromise = null;
        }
    });

    return pendingMediaUploadFlushPromise;
}

export function flushPendingMediaUploadQueue(options = {}) {
    return schedulePendingMediaUploadFlush(options);
}

export async function deleteUserFirebaseStorageFileByDownloadUrl(downloadUrl) {
    if (!downloadUrl || typeof downloadUrl !== 'string') return;
    const u = downloadUrl.trim();
    if (!u) return;
    if (isPendingMediaUrl(u)) {
        await deletePendingMediaUpload(u);
        return;
    }
    const bucket = firebaseConfig.storageBucket;
    if (!bucket) return;
    const isFirebase =
        (u.startsWith('gs://') && u.includes(bucket)) ||
        (u.includes('firebasestorage.googleapis.com') && u.includes(bucket));
    if (!isFirebase) return;
    try {
        await deleteObject(ref(storage, u));
    } catch (e) {
        const msg = `${e?.code || ''} ${e?.message || e || ''}`;
        if (/object-not-found|404/i.test(msg)) return;
        console.warn('deleteUserFirebaseStorageFileByDownloadUrl:', e);
        showToast('Не удалось удалить файл из хранилища', 'error');
    }
}

// -----------------------------------------------------------
// Дополнительно: прежняя загрузка в Cloudinary (оставлена для совместимости)
// -----------------------------------------------------------
export async function uploadFileToCloudinaryWithProgress(file, onProgress) {
  if (isOfflineModeActive()) {
    throw new Error('offline_media_upload_not_supported');
  }

  const preparedFile = await prepareUserMediaFileForUpload(file);
  const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/upload`;
  const formData = new FormData();
  formData.append('file', preparedFile);
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.responseType = 'json';

    if (xhr.upload && typeof onProgress === 'function') {
      xhr.upload.addEventListener('progress', (event) => {
        if (!event.lengthComputable || !event.total) return;
        const percent = Math.round((event.loaded * 100) / event.total);
        onProgress(percent);
      });
    }

    xhr.addEventListener('load', () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`cloudinary_upload_failed_${xhr.status}`));
        return;
      }

      const body = xhr.response && typeof xhr.response === 'object'
        ? xhr.response
        : JSON.parse(xhr.responseText || '{}');

      if (typeof onProgress === 'function') onProgress(100);
      resolve(body.secure_url);
    });

    xhr.addEventListener('error', () => reject(new Error('cloudinary_upload_network_error')));
    xhr.addEventListener('abort', () => reject(new Error('cloudinary_upload_aborted')));
    xhr.send(formData);
  });
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
function renderMediaPreview(container, media, afterRender = null) {
    container.innerHTML = ''; // Очистить контейнер

    media.forEach((file, index) => {
        const mediaItem = createElement('div', 'media-item');
        mediaItem.style.position = 'relative';
        mediaItem.style.display = 'inline-block';

        // === Если фото ===
        if (file.type === 'photo') {
            const img = createElement('img');
            applyOfflineMediaSource(img, file.url, 'photo');
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
            applyOfflineMediaSource(video, file.url, 'video');
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


        delBtn.addEventListener('click', async () => {
            const urlToDrop = typeof file.url === 'string' ? file.url : '';
            if (urlToDrop) await deleteUserFirebaseStorageFileByDownloadUrl(urlToDrop);
            media.splice(index, 1);      // Удаляем из массива
            renderMediaPreview(container, media); // Перерисовываем
        });

        mediaItem.append(delBtn);
        container.append(mediaItem);
    });
    if (typeof container.__afterRender === 'function') {
        container.__afterRender();
    }
}

// =================================================================
// 🌟 ФУНКЦИЯ: Сохранение комментария к тренировке
// =================================================================
async function saveTrainingNote(programId, note, media = []) {
    const program = state.programs.find(p => p.id === programId);
    if (!program) return;

    program.trainingNote = note;
    program.trainingMedia = media;
    const programsCollection = getUserProgramsCollection();
    const programDocPath = programsCollection ? doc(programsCollection, programId).path : '';

    try {
        await updateProgramDocument(programsCollection, programId, {
            trainingNote: note,
            trainingMedia: media
        });
        await attachPendingMediaTargetsByUrls(media.map((item) => item?.url), {
            type: 'program-training-media',
            docPath: programDocPath
        });
        void schedulePendingMediaUploadFlush();
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

    if (media) {
        exercise.media = media.map((item) => ({
            url: item.url,
            type: item.type || (item.url.endsWith('.mp4') ? 'video' : 'photo'),
            addedAt: Date.now()
        }));
    }

    const cleanedExercises = JSON.parse(JSON.stringify(program.exercises));
    const programsCollection = getUserProgramsCollection();
    const programDocPath = programsCollection ? doc(programsCollection, programId).path : '';

    try {
        await updateProgramDocument(programsCollection, programId, {
            exercises: cleanedExercises
        });
        await attachPendingMediaTargetsByUrls(media.map((item) => item?.url), {
            type: 'program-exercise-media',
            docPath: programDocPath,
            exerciseId
        });
        void schedulePendingMediaUploadFlush();
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
let __activeExerciseReorder = null;
let __activeSetReorder = null;

let __activeProgramReorder = null;

function __createExerciseReorderPlaceholder(fromEl) {
  const ph = document.createElement('div');
  ph.className = 'exercise-reorder-placeholder';
  const r = fromEl.getBoundingClientRect();
  ph.style.height = `${Math.max(1, Math.round(r.height))}px`;
  return ph;
}

function __createExerciseReorderGhost(fromEl, rect) {
  const ghost = fromEl.cloneNode(true);
  ghost.classList.add('exercise-reorder-ghost');
  ghost.style.width = `${Math.round(rect.width)}px`;
  ghost.style.height = `${Math.round(rect.height)}px`;
  ghost.style.left = `0px`;
  ghost.style.top = `0px`;
  document.body.appendChild(ghost);
  return ghost;
}

function __clampGhostTranslateToViewport(ghostEl, x, y) {
  if (!ghostEl) return { x, y };
  const vw = window.innerWidth || document.documentElement.clientWidth || 0;
  const vh = window.innerHeight || document.documentElement.clientHeight || 0;
  const w = ghostEl.offsetWidth || 0;
  const h = ghostEl.offsetHeight || 0;
  const maxX = Math.max(0, vw - w);
  const maxY = Math.max(0, vh - h);
  return {
    x: Math.min(maxX, Math.max(0, x)),
    y: Math.min(maxY, Math.max(0, y))
  };
}

function __exerciseReorderLayoutItems(parentEl, draggedEl) {
  return [...parentEl.querySelectorAll('.exercise-item')].filter((el) => {
    if (el === draggedEl) return false;
    return el.style.display !== 'none';
  });
}

function __setReorderLayoutItems(parentEl, draggedEl) {
  return [...parentEl.querySelectorAll('.set-row')].filter((el) => {
    if (el === draggedEl) return false;
    return el.style.display !== 'none';
  });
}

function __createSetReorderPlaceholder(fromEl) {
  const ph = document.createElement('div');
  ph.className = 'set-reorder-placeholder';
  const r = fromEl.getBoundingClientRect();
  ph.style.height = `${Math.max(1, Math.round(r.height))}px`;
  return ph;
}

function __createSetReorderGhost(fromEl, rect) {
  const ghost = fromEl.cloneNode(true);
  ghost.classList.add('set-reorder-ghost');
  ghost.style.width = `${Math.round(rect.width)}px`;
  ghost.style.height = `${Math.round(rect.height)}px`;
  ghost.style.left = '0px';
  ghost.style.top = '0px';
  document.body.appendChild(ghost);
  return ghost;
}

function __setPlaceholderSlotIndex(parentEl, ph, draggedEl) {
  const layoutItems = __setReorderLayoutItems(parentEl, draggedEl);
  let el = ph.nextElementSibling;
  while (el && (!(el instanceof HTMLElement) || el.style.display === 'none')) {
    el = el.nextElementSibling;
  }
  if (!el || !el.classList?.contains('set-row')) return layoutItems.length;
  const idx = layoutItems.indexOf(el);
  return idx < 0 ? layoutItems.length : idx;
}

function __updateSetReorderGhostPos(active, clientX, clientY) {
  if (!active?.ghostEl || !active.placeholderEl) return;
  const ph = active.placeholderEl.getBoundingClientRect();
  const lift = typeof active.setGhostLiftPx === 'number' ? active.setGhostLiftPx : -6;
  const maxOff = Math.min(18, Math.min(ph.width, ph.height) * 0.2);
  const cx = ph.left + ph.width / 2;
  const cy = ph.top + ph.height / 2;
  const sx = active.setStartX ?? clientX;
  const sy = active.setStartY ?? clientY;
  let ox = 0;
  let oy = (clientY - sy) + lift;
  if (oy > maxOff) oy = maxOff;
  if (oy < -maxOff) oy = -maxOff;
  const gw = active.ghostEl.offsetWidth || ph.width || 0;
  const gh = active.ghostEl.offsetHeight || ph.height || 0;
  const rawX = cx - gw / 2 + ox;
  const rawY = cy - gh / 2 + oy;
  const { x, y } = __clampGhostTranslateToViewport(active.ghostEl, rawX, rawY);
  active.ghostEl.style.transform = `translate3d(${x}px, ${y}px, 0)`;
}

function updateSetReorderVisual(active) {
  if (!active?.placeholderEl || !active?.parentEl || !active?.itemEl) return;
  const layoutItems = __setReorderLayoutItems(active.parentEl, active.itemEl);
  const currentIndex = __setPlaceholderSlotIndex(active.parentEl, active.placeholderEl, active.itemEl);
  const lastIndex = layoutItems.length;
  active.placeholderEl.classList.toggle('set-reorder-placeholder--can-up', currentIndex > 0);
  active.placeholderEl.classList.toggle('set-reorder-placeholder--can-down', currentIndex >= 0 && currentIndex < lastIndex);
  active.itemEl.classList.toggle('set-row--can-move-up', currentIndex > 0);
  active.itemEl.classList.toggle('set-row--can-move-down', currentIndex >= 0 && currentIndex < lastIndex);
}

function refreshSetApproachOrderNumbers(parentEl) {
  if (!parentEl) return;
  const dragged = [...parentEl.querySelectorAll('.set-row.set-row--dragging-source')][0];
  const layoutItems = __setReorderLayoutItems(parentEl, dragged || null);
  layoutItems.forEach((itemEl, index) => {
    const nextOrder = `${index + 1}.`;
    itemEl.dataset.approachOrder = String(index + 1);
    itemEl.querySelectorAll('.set-label').forEach((labelEl) => {
      labelEl.textContent = nextOrder;
    });
    itemEl.querySelectorAll('.set-display-line__ord').forEach((ordEl) => {
      ordEl.textContent = nextOrder;
    });
  });
}

function placeSetPlaceholderAtIndex(active, targetIndex) {
  if (!active?.placeholderEl || !active?.parentEl) return false;

  const parentEl = active.parentEl;
  const ph = active.placeholderEl;
  const layoutItems = __setReorderLayoutItems(parentEl, active.itemEl);
  const currentIndex = __setPlaceholderSlotIndex(parentEl, ph, active.itemEl);
  const clampedIndex = Math.max(0, Math.min(layoutItems.length, targetIndex | 0));

  if (currentIndex < 0 || currentIndex === clampedIndex) return false;

  const beforeRects = new Map();
  layoutItems.forEach((el) => {
    beforeRects.set(el, el.getBoundingClientRect());
  });

  if (clampedIndex >= layoutItems.length) {
    if (active.tailAnchorEl && active.tailAnchorEl !== ph && active.tailAnchorEl.parentElement === parentEl) {
      parentEl.insertBefore(ph, active.tailAnchorEl);
    } else {
      parentEl.appendChild(ph);
    }
  } else {
    const beforeEl = layoutItems[clampedIndex];
    if (beforeEl) parentEl.insertBefore(ph, beforeEl);
  }

  const afterLayout = __setReorderLayoutItems(parentEl, active.itemEl);
  afterLayout.forEach((el) => {
    const before = beforeRects.get(el);
    if (!before) return;
    const after = el.getBoundingClientRect();
    const dy = before.top - after.top;
    if (!dy) return;

    el.style.transition = 'none';
    el.style.transform = `translateY(${dy}px)`;
    void el.offsetHeight;
    el.style.transition = 'transform 160ms ease';
    el.style.transform = '';
    window.setTimeout(() => {
      if (el.style.transition === 'transform 160ms ease') el.style.transition = '';
    }, 190);
  });

  active.didChange = clampedIndex !== (active.originSlotIndex ?? currentIndex);
  refreshSetApproachOrderNumbers(parentEl);
  updateSetReorderVisual(active);
  return true;
}

function moveSetPlaceholderByPointerY(active, pointerY) {
  if (!active?.itemEl || !active?.parentEl || !active.placeholderEl) return false;

  const layoutItems = __setReorderLayoutItems(active.parentEl, active.itemEl);
  let targetIndex = layoutItems.length;

  for (let index = 0; index < layoutItems.length; index += 1) {
    const rect = layoutItems[index].getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    if (pointerY < mid) {
      targetIndex = index;
      break;
    }
  }

  return placeSetPlaceholderAtIndex(active, targetIndex);
}

function moveSetInReorder(active, direction) {
  if (!active?.placeholderEl || !active?.parentEl || !direction) return false;

  const parentEl = active.parentEl;
  const ph = active.placeholderEl;
  const layoutItems = __setReorderLayoutItems(parentEl, active.itemEl);
  const effectiveFrom = __setPlaceholderSlotIndex(parentEl, ph, active.itemEl);
  const toIndex = effectiveFrom + direction;
  if (effectiveFrom < 0 || toIndex < 0 || toIndex > layoutItems.length) return false;
  return placeSetPlaceholderAtIndex(active, toIndex);
}

function __collectExerciseApproachGroups(exercise) {
  const groups = [];
  if (!Array.isArray(exercise?.sets)) return groups;

  let setIndex = 0;
  while (setIndex < exercise.sets.length) {
    if (exercise.sets[setIndex]?.continuation) {
      setIndex += 1;
      continue;
    }
    const [start, end] = __getDropSetGroupBounds(exercise, setIndex);
    groups.push({
      key: `${String(exercise.id)}:${start}`,
      start,
      end,
      sets: JSON.parse(JSON.stringify(exercise.sets.slice(start, end + 1)))
    });
    setIndex = end + 1;
  }

  return groups;
}

async function finishSetReorder(saveChanges = true) {
  const active = __activeSetReorder;
  if (!active) return;

  __activeSetReorder = null;

  if (active.ghostEl) {
    active.ghostEl.remove();
    active.ghostEl = null;
  }

  if (active.placeholderEl && active.placeholderEl.parentElement) {
    active.parentEl.insertBefore(active.itemEl, active.placeholderEl);
    active.placeholderEl.remove();
    active.placeholderEl = null;
  }

  active.itemEl.style.transform = '';
  if (active.restoreSetStyle) {
    active.itemEl.style.visibility = active.restoreSetStyle.visibility;
    active.itemEl.style.opacity = active.restoreSetStyle.opacity;
    active.itemEl.style.display = active.restoreSetStyle.display;
    active.itemEl.style.pointerEvents = active.restoreSetStyle.pointerEvents;
  } else {
    active.itemEl.style.visibility = '';
    active.itemEl.style.opacity = '';
    active.itemEl.style.display = '';
    active.itemEl.style.pointerEvents = '';
  }

  active.itemEl.dataset.setReorderLock = '0';
  active.itemEl.classList.remove(
    'set-row--reorder-active',
    'set-row--can-move-up',
    'set-row--can-move-down',
    'set-row--dragging-source'
  );
  if (active.placeholderEl) {
    active.placeholderEl.classList.remove('set-reorder-placeholder--can-up', 'set-reorder-placeholder--can-down');
  }
  document.documentElement.classList.remove('exercise-reorder-lock');
  document.body.classList.remove('exercise-reorder-lock');

  active.itemEl._preventClick = true;
  window.setTimeout(() => {
    active.itemEl._preventClick = false;
  }, 220);

  if (!saveChanges || !active.didChange) {
    refreshSetApproachOrderNumbers(active.parentEl);
    return;
  }

  const orderedKeys = [...active.parentEl.querySelectorAll('.set-row[data-approach-key]')]
    .map((rowEl) => rowEl.dataset.approachKey)
    .filter(Boolean);

  const nextGroups = orderedKeys
    .map((key) => active.groupMap.get(key))
    .filter(Boolean);

  if (!nextGroups.length) {
    refreshSetApproachOrderNumbers(active.parentEl);
    return;
  }

  active.exercise.sets = nextGroups.flatMap((group) => JSON.parse(JSON.stringify(group.sets)));

  try {
    queueProgramExercisesSave(active.selectedProgram.id, active.selectedProgram.exercises, {
      delayMs: 240,
      errorMessage: 'Не удалось сохранить порядок подходов'
    });
    render();
  } catch (error) {
    console.error('Не удалось сохранить порядок подходов:', error);
    active.exercise.sets = JSON.parse(JSON.stringify(active.originalSets));
    showToast('Не удалось сохранить порядок подходов');
    render();
  }
}
function attachSetReorderLongPress({ setRow, selectedProgram, exercise }) {
  if (!setRow || setRow.dataset.setReorderBound === '1') return;
  setRow.dataset.setReorderBound = '1';

  let pointerId = null;
  let touchId = null;
  let pressTimer = null;
  let startX = 0;
  let startY = 0;
  let lastY = 0;
  let reorderStarted = false;

  const clearPressTimer = () => {
    if (!pressTimer) return;
    clearTimeout(pressTimer);
    pressTimer = null;
  };

  const beginReorder = () => {
    if (__activeSetReorder || __activeExerciseReorder || !setRow.parentElement) return;

    reorderStarted = true;

    try {
      if (pointerId != null) setRow.setPointerCapture?.(pointerId);
    } catch (_) {
      /* noop */
    }

    const parentEl = setRow.parentElement;
    const rect = setRow.getBoundingClientRect();
    const placeholderEl = __createSetReorderPlaceholder(setRow);
    parentEl.insertBefore(placeholderEl, setRow);
    const ghostEl = __createSetReorderGhost(setRow, rect);
    const tailAnchorEl = [...parentEl.children].find((child) =>
      child instanceof HTMLElement
      && child !== setRow
      && child !== placeholderEl
      && !child.classList.contains('set-row')
      && !child.classList.contains('set-reorder-placeholder')
    ) || null;

    const restoreSetStyle = {
      visibility: setRow.style.visibility,
      opacity: setRow.style.opacity,
      display: setRow.style.display,
      pointerEvents: setRow.style.pointerEvents
    };

    __activeSetReorder = {
      selectedProgram,
      exercise,
      itemEl: setRow,
      parentEl,
      placeholderEl,
      ghostEl,
      tailAnchorEl,
      originalSets: JSON.parse(JSON.stringify(exercise.sets || [])),
      groupMap: new Map(__collectExerciseApproachGroups(exercise).map((group) => [group.key, group])),
      didChange: false,
      setStartX: startX,
      setStartY: lastY,
      setGhostLiftPx: -6,
      originSlotIndex: __setPlaceholderSlotIndex(parentEl, placeholderEl, setRow),
      restoreSetStyle
    };

    setRow.classList.add('set-row--reorder-active', 'set-row--dragging-source');
    setRow.dataset.setReorderLock = '1';
    setRow.style.opacity = '0';
    setRow.style.pointerEvents = 'none';
    setRow.style.display = 'none';
    document.documentElement.classList.add('exercise-reorder-lock');
    document.body.classList.add('exercise-reorder-lock');

    __updateSetReorderGhostPos(__activeSetReorder, startX, lastY);
    updateSetReorderVisual(__activeSetReorder);
  };

  const handlePointerDown = (e) => {
    if (e.pointerType === 'touch') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest('.delete-set-btn, .edit-note-btn, .action-btn, input, textarea, select, a, button')) return;
    if (__activeSetReorder || __activeExerciseReorder) return;

    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    lastY = e.clientY;
    reorderStarted = false;
    clearPressTimer();
    pressTimer = setTimeout(beginReorder, 320);
    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerEnd);
    window.addEventListener('pointercancel', handlePointerEnd);
  };

  const handlePointerMove = (e) => {
    if (e.pointerId !== pointerId) return;

    lastY = e.clientY;

    if (!reorderStarted) {
      if (Math.abs(e.clientX - startX) > 10 || Math.abs(e.clientY - startY) > 10) {
        clearPressTimer();
      }
      return;
    }

    const active = __activeSetReorder;
    if (!active) return;

    if (e.cancelable) e.preventDefault();
    moveSetPlaceholderByPointerY(active, e.clientY);
    __updateSetReorderGhostPos(active, e.clientX, e.clientY);
  };

  const removeTouchWindowListeners = () => {
    window.removeEventListener('touchmove', handleTouchMove);
    window.removeEventListener('touchend', handleTouchEnd);
    window.removeEventListener('touchcancel', handleTouchEnd);
  };

  const getTrackedTouch = (touchList) => {
    if (touchId == null) return null;
    return [...touchList].find((touch) => touch.identifier === touchId) || null;
  };

  const handleTouchStart = (e) => {
    if (e.touches.length !== 1) return;
    if (e.target.closest('.delete-set-btn, .edit-note-btn, .action-btn, input, textarea, select, a, button')) return;
    if (__activeSetReorder || __activeExerciseReorder) return;

    const touch = e.changedTouches[0];
    touchId = touch.identifier;
    startX = touch.clientX;
    startY = touch.clientY;
    lastY = touch.clientY;
    reorderStarted = false;
    clearPressTimer();
    pressTimer = setTimeout(beginReorder, 320);
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);
    window.addEventListener('touchcancel', handleTouchEnd);
  };

  const handleTouchMove = (e) => {
    const touch = getTrackedTouch(e.touches);
    if (!touch) return;

    lastY = touch.clientY;

    if (!reorderStarted) {
      if (Math.abs(touch.clientX - startX) > 10 || Math.abs(touch.clientY - startY) > 10) {
        clearPressTimer();
      }
      return;
    }

    const active = __activeSetReorder;
    if (!active) return;

    if (e.cancelable) e.preventDefault();
    moveSetPlaceholderByPointerY(active, touch.clientY);
    __updateSetReorderGhostPos(active, touch.clientX, touch.clientY);
  };

  const releasePointer = () => {
    if (pointerId == null) return;
    try {
      setRow.releasePointerCapture?.(pointerId);
    } catch (_) {
      /* noop */
    }
    pointerId = null;
  };

  const removeWindowListeners = () => {
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerEnd);
    window.removeEventListener('pointercancel', handlePointerEnd);
  };

  const handlePointerEnd = async () => {
    clearPressTimer();
    removeWindowListeners();
    releasePointer();

    const didReorder = reorderStarted;
    reorderStarted = false;

    if (didReorder) {
      await finishSetReorder(true);
    }
  };

  const handleTouchEnd = async (e) => {
    const trackedTouchEnded = touchId != null && [...e.changedTouches].some((touch) => touch.identifier === touchId);
    if (!trackedTouchEnded) return;

    clearPressTimer();
    removeTouchWindowListeners();
    touchId = null;

    const didReorder = reorderStarted;
    reorderStarted = false;

    if (didReorder) {
      await finishSetReorder(true);
    }
  };

  setRow.addEventListener('pointerdown', handlePointerDown);
  setRow.addEventListener('touchstart', handleTouchStart, { passive: true });
}

function __updateExerciseReorderGhostPos(active, clientX, clientY) {
  if (!active?.ghostEl || !active.placeholderEl) return;
  const ph = active.placeholderEl.getBoundingClientRect();
  const lift = typeof active.exerciseGhostLiftPx === 'number' ? active.exerciseGhostLiftPx : -6;
  const maxOff = Math.min(22, Math.min(ph.width, ph.height) * 0.2);
  const cx = ph.left + ph.width / 2;
  const cy = ph.top + ph.height / 2;
  const sx = active.exerciseStartX ?? clientX;
  const sy = active.exerciseStartY ?? clientY;
  let ox = 0;
  let oy = (clientY - sy) + lift;
  if (oy > maxOff) oy = maxOff;
  if (oy < -maxOff) oy = -maxOff;
  const gw = active.ghostEl.offsetWidth || ph.width || 0;
  const gh = active.ghostEl.offsetHeight || ph.height || 0;
  const rawX = cx - gw / 2 + ox;
  const rawY = cy - gh / 2 + oy;
  const { x, y } = __clampGhostTranslateToViewport(active.ghostEl, rawX, rawY);
  active.ghostEl.style.transform = `translate3d(${x}px, ${y}px, 0)`;
}

function __createProgramReorderPlaceholder(fromEl) {
    const ph = document.createElement('div');
    ph.className = 'program-reorder-placeholder';
    const r = fromEl.getBoundingClientRect();
    ph.style.height = `${Math.max(1, Math.round(r.height))}px`;
    return ph;
}

function __createProgramReorderGhost(fromEl, rect) {
    const ghost = fromEl.cloneNode(true);
    ghost.classList.add('program-reorder-ghost');
    ghost.style.width = `${Math.round(rect.width)}px`;
    ghost.style.height = `${Math.round(rect.height)}px`;
    ghost.style.left = `0px`;
    ghost.style.top = `0px`;
    document.body.appendChild(ghost);
    return ghost;
}

function __programItemsVisualOrder(parentEl, excludeEl) {
    const items = [...parentEl.querySelectorAll('.program-item')].filter((el) => el !== excludeEl);
    return items
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .sort((a, b) => {
            const dy = a.r.top - b.r.top;
            if (Math.abs(dy) > 6) return dy;
            return a.r.left - b.r.left;
        })
        .map((x) => x.el);
}

function __programHoleCellFromSlot(ordered, slotIndex) {
    const n = ordered.length;
    const slot = Math.max(0, Math.min(n, slotIndex | 0));
    if (n === 0) return { row: 0, col: 0 };
    if (slot < n) return { row: Math.floor(slot / 3), col: slot % 3 };
    const last = n - 1;
    const lr = Math.floor(last / 3);
    const lc = last % 3;
    if (lc < 2) return { row: lr, col: lc + 1 };
    return { row: lr + 1, col: 0 };
}

function __programSlotIndexFromCell(ordered, cell) {
    const n = ordered.length;
    if (!n) return 0;
    if (!cell) return 0;
    const row = Math.max(0, cell.row | 0);
    const col = Math.min(2, Math.max(0, cell.col | 0));
    const idx = row * 3 + col;
    if (idx < 0) return 0;
    if (idx > n) return n;
    return idx;
}

function __idealProgramCellFromPointer(parentEl, pointerX, pointerY) {
    const pr = parentEl.getBoundingClientRect();
    if (pr.width <= 1 || pr.height <= 1) return { row: 0, col: 0 };

    const col = Math.min(2, Math.max(0, Math.floor(((pointerX - pr.left) / pr.width) * 3)));
    const sample = parentEl.querySelector('.program-item');
    const sr = sample?.getBoundingClientRect?.();
    const estTileH = Math.max(64, sr?.height || 84, pr.height / 8);
    const row = Math.min(64, Math.max(0, Math.floor((pointerY - pr.top) / estTileH)));
    return { row, col };
}

function __syncProgramReorderGhost(active, clientX, clientY) {
    if (!active?.ghostEl || !active.placeholderEl) return;
    const ph = active.placeholderEl.getBoundingClientRect();
    const lift = typeof active.ghostLiftPx === 'number' ? active.ghostLiftPx : -6;
    const maxOff = Math.min(26, Math.min(ph.width, ph.height) * 0.22);
    const cx = ph.left + ph.width / 2;
    const cy = ph.top + ph.height / 2;
    const sx = active.startX ?? clientX;
    const sy = active.startY ?? clientY;
    let ox = (clientX - sx);
    let oy = (clientY - sy) + lift;
    if (ox > maxOff) ox = maxOff;
    if (ox < -maxOff) ox = -maxOff;
    if (oy > maxOff) oy = maxOff;
    if (oy < -maxOff) oy = -maxOff;
    const gw = active.ghostEl.offsetWidth || ph.width || 0;
    const gh = active.ghostEl.offsetHeight || ph.height || 0;
    const rawX = cx - gw / 2 + ox;
    const rawY = cy - gh / 2 + oy;
    const { x, y } = __clampGhostTranslateToViewport(active.ghostEl, rawX, rawY);
    active.ghostEl.style.transform = `translate3d(${x}px, ${y}px, 0)`;
}

function __applyProgramSlotIndex(active, slotIndex) {
    if (!active?.parentEl || !active.placeholderEl) return;
    const parentEl = active.parentEl;
    const addBtn = parentEl.querySelector('.add-program-btn');
    const ordered = __programItemsVisualOrder(parentEl, active.itemEl);
    const n = ordered.length;
    const idx = Math.max(0, Math.min(n, slotIndex | 0));

    if (idx >= n) {
        if (addBtn) parentEl.insertBefore(active.placeholderEl, addBtn);
        else parentEl.appendChild(active.placeholderEl);
        return;
    }
    const beforeEl = ordered[idx];
    if (beforeEl && active.placeholderEl !== beforeEl.previousSibling) {
        parentEl.insertBefore(active.placeholderEl, beforeEl);
    }
}

function __maybeStepProgramGrid(active, pointerX, pointerY) {
    if (!active?.parentEl || !active.placeholderEl) return;

    const STEP_COOLDOWN_MS = 165;
    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (active.lastGridStepAt && now - active.lastGridStepAt < STEP_COOLDOWN_MS) return;

    const ordered = __programItemsVisualOrder(active.parentEl, active.itemEl);
    if (!ordered.length) return;

    let slot = active.slotIndex;
    if (slot == null) slot = active.originIndex;
    slot = Math.max(0, Math.min(ordered.length, slot | 0));

    const hole = __programHoleCellFromSlot(ordered, slot);
    const idealCell = __idealProgramCellFromPointer(active.parentEl, pointerX, pointerY);
    const ideal = __programSlotIndexFromCell(ordered, idealCell);

    if (ideal === slot) return;

    let dr = idealCell.row - hole.row;
    let dc = idealCell.col - hole.col;
    if (dr === 0 && dc === 0) return;

    let nextCell = { row: hole.row, col: hole.col };
    if (Math.abs(dr) >= Math.abs(dc) && dr !== 0) {
        nextCell = { row: hole.row + Math.sign(dr), col: hole.col };
    } else if (dc !== 0) {
        nextCell = { row: hole.row, col: hole.col + Math.sign(dc) };
    }

    const nextSlot = __programSlotIndexFromCell(ordered, nextCell);
    if (nextSlot === slot) return;

    active.lastGridStepAt = now;
    active.slotIndex = nextSlot;
    __applyProgramSlotIndex(active, nextSlot);

    const children = [...active.parentEl.children];
    let phIndexAmongPrograms = 0;
    for (const el of children) {
        if (el === active.placeholderEl) break;
        if (el.classList?.contains('program-item')) phIndexAmongPrograms += 1;
    }
    active.didChange = phIndexAmongPrograms !== active.originIndex;
}

let __programReorderAutoScrollRaf = 0;

function __stopProgramReorderAutoScroll() {
    if (__programReorderAutoScrollRaf) {
        cancelAnimationFrame(__programReorderAutoScrollRaf);
        __programReorderAutoScrollRaf = 0;
    }
}

function __scheduleProgramReorderAutoScroll(active, clientX, clientY) {
    if (!active?.ghostEl) return;
    const rootEl = document.getElementById('root');
    if (!rootEl) return;

    const EDGE_PX = 72;
    const MAX_STEP = 22;

    active.lastPointerX = clientX;
    active.lastPointerY = clientY;

    const step = () => {
        __programReorderAutoScrollRaf = 0;
        if (!__activeProgramReorder || __activeProgramReorder !== active) return;

        const py = active.lastPointerY;
        const px = active.lastPointerX;

        const vh = window.innerHeight || document.documentElement.clientHeight || 0;
        let dy = 0;
        if (py < EDGE_PX) {
            dy = -Math.ceil(((EDGE_PX - py) / EDGE_PX) * MAX_STEP);
        } else if (py > vh - EDGE_PX) {
            dy = Math.ceil(((py - (vh - EDGE_PX)) / EDGE_PX) * MAX_STEP);
        }

        if (dy) {
            const prevTop = rootEl.scrollTop;
            rootEl.scrollTop = Math.max(0, Math.min(rootEl.scrollHeight - rootEl.clientHeight, prevTop + dy));
            const applied = rootEl.scrollTop - prevTop;
            if (applied) {
                active.pointerOffsetY -= applied;
                __maybeStepProgramGrid(active, px, py);
                __syncProgramReorderGhost(active, px, py);
            }
        }

        const vh2 = window.innerHeight || document.documentElement.clientHeight || 0;
        if (py < EDGE_PX || py > vh2 - EDGE_PX) {
            __programReorderAutoScrollRaf = requestAnimationFrame(step);
        }
    };

    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    if (clientY < EDGE_PX || clientY > vh - EDGE_PX) {
        if (!__programReorderAutoScrollRaf) {
            __programReorderAutoScrollRaf = requestAnimationFrame(step);
        }
    }
}

async function finishProgramReorder(saveChanges = true) {
    const active = __activeProgramReorder;
    if (!active) return;

    __activeProgramReorder = null;
    __stopProgramReorderAutoScroll();

    if (active.ghostEl) {
        active.ghostEl.remove();
        active.ghostEl = null;
    }

    if (active.placeholderEl && active.placeholderEl.parentElement) {
        active.parentEl.insertBefore(active.itemEl, active.placeholderEl);
        active.placeholderEl.remove();
        active.placeholderEl = null;
    }

    if (active.restoreStyle) {
        active.itemEl.style.height = active.restoreStyle.height;
        active.itemEl.style.minHeight = active.restoreStyle.minHeight;
        active.itemEl.style.margin = active.restoreStyle.margin;
        active.itemEl.style.padding = active.restoreStyle.padding;
        active.itemEl.style.border = active.restoreStyle.border;
        active.itemEl.style.overflow = active.restoreStyle.overflow;
        active.itemEl.style.visibility = active.restoreStyle.visibility;
        active.itemEl.style.opacity = active.restoreStyle.opacity;
        active.itemEl.style.display = active.restoreStyle.display;
        active.itemEl.style.pointerEvents = active.restoreStyle.pointerEvents;
    } else {
        active.itemEl.style.visibility = '';
        active.itemEl.style.height = '';
        active.itemEl.style.minHeight = '';
        active.itemEl.style.margin = '';
        active.itemEl.style.padding = '';
        active.itemEl.style.border = '';
        active.itemEl.style.overflow = '';
        active.itemEl.style.opacity = '';
        active.itemEl.style.display = '';
        active.itemEl.style.pointerEvents = '';
    }
    active.itemEl.classList.remove('program-item--reorder-active', 'program-item--dragging-source');

    if (!saveChanges || !active.didChange) {
        document.documentElement.classList.remove('program-reorder-lock');
        document.body.classList.remove('program-reorder-lock');
        return;
    }

    const orderedIds = [...active.parentEl.querySelectorAll('.program-item')].map((el) => el.dataset.id).filter(Boolean);
    const programById = new Map(active.programs.map((p) => [p.id, p]));
    const nextPrograms = orderedIds.map((id) => programById.get(id)).filter(Boolean);
    state.programs = nextPrograms;

    try {
        // сохраняем порядок по полю order
        await Promise.all(
            orderedIds.map((id, idx) => updateDoc(doc(getUserProgramsCollection(), id), { order: idx }))
        );
        render();
    } catch (error) {
        console.error('Не удалось сохранить порядок программ:', error);
        showToast('Не удалось сохранить порядок');
        render();
    } finally {
        document.documentElement.classList.remove('program-reorder-lock');
        document.body.classList.remove('program-reorder-lock');
    }
}

function attachProgramReorderLongPress({ itemEl, parentEl }) {
    if (!itemEl || itemEl.dataset.programReorderBound === '1') return;
    itemEl.dataset.programReorderBound = '1';

    let pressTimer = null;
    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let lastY = 0;
    let reorderStarted = false;
    let pointerId = null;
    let touchId = null;
    let windowListenersBound = false;
    const DRAG_START_MOVE_PX = 6;

    const clearPressTimer = () => {
        if (!pressTimer) return;
        clearTimeout(pressTimer);
        pressTimer = null;
    };

    const bindWindowListeners = () => {
        if (windowListenersBound) return;
        windowListenersBound = true;
        window.addEventListener('pointermove', handlePointerMove, { passive: false });
        window.addEventListener('pointerup', handlePointerEnd);
        window.addEventListener('pointercancel', handlePointerCancel);
        window.addEventListener('touchmove', handleTouchMove, { passive: false });
        window.addEventListener('touchend', handleTouchEnd);
        window.addEventListener('touchcancel', handleTouchCancel);
    };

    const beginReorder = () => {
        if (__activeProgramReorder || !parentEl) return;
        reorderStarted = true;
        itemEl.dataset.suppressClick = '1';
        const rect = itemEl.getBoundingClientRect();
        const originIndex = [...parentEl.querySelectorAll('.program-item')].indexOf(itemEl);
        const placeholderEl = __createProgramReorderPlaceholder(itemEl);
        parentEl.insertBefore(placeholderEl, itemEl);
        // Не схлопываем карточку до 0px — иначе grid пересобирается и ghost "прыгает" в сторону.
        // Плейсхолдер держит ячейку, саму карточку прячем из потока (display:none).
        const restoreStyle = {
            height: itemEl.style.height,
            minHeight: itemEl.style.minHeight,
            margin: itemEl.style.margin,
            padding: itemEl.style.padding,
            border: itemEl.style.border,
            overflow: itemEl.style.overflow,
            visibility: itemEl.style.visibility,
            opacity: itemEl.style.opacity,
            display: itemEl.style.display,
            pointerEvents: itemEl.style.pointerEvents
        };

        const ghostEl = __createProgramReorderGhost(itemEl, rect);
        ghostEl.dataset.sourceId = itemEl.dataset.id || '';

        itemEl.classList.add('program-item--reorder-active', 'program-item--dragging-source');
        itemEl.style.opacity = '0';
        itemEl.style.pointerEvents = 'none';
        itemEl.style.display = 'none';

        __activeProgramReorder = {
            itemEl,
            parentEl,
            startX,
            startY,
            didChange: false,
            programs: state.programs.slice(),
            placeholderEl,
            ghostEl,
            pointerOffsetX: startX - rect.left,
            pointerOffsetY: startY - rect.top,
            originIndex,
            slotIndex: originIndex,
            lastGridStepAt: 0,
            ghostLiftPx: -6,
            restoreStyle
        };

        document.documentElement.classList.add('program-reorder-lock');
        document.body.classList.add('program-reorder-lock');

        __applyProgramSlotIndex(__activeProgramReorder, originIndex);
        __syncProgramReorderGhost(__activeProgramReorder, lastX, lastY);
    };

    const removeWindowListeners = () => {
        if (!windowListenersBound) return;
        windowListenersBound = false;
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerEnd);
        window.removeEventListener('pointercancel', handlePointerCancel);
        window.removeEventListener('touchmove', handleTouchMove);
        window.removeEventListener('touchend', handleTouchEnd);
        window.removeEventListener('touchcancel', handleTouchCancel);
    };

    const handlePointerMove = (e) => {
        if (pointerId == null) return;
        if (e.pointerId !== pointerId) return;
        lastX = e.clientX;
        lastY = e.clientY;

        if (!reorderStarted) {
            if (Math.abs(lastX - startX) > DRAG_START_MOVE_PX || Math.abs(lastY - startY) > DRAG_START_MOVE_PX) {
                clearPressTimer();
            }
            return;
        }

        const active = __activeProgramReorder;
        if (!active) return;
        if (e.cancelable) e.preventDefault();
        __maybeStepProgramGrid(active, e.clientX, e.clientY);
        __syncProgramReorderGhost(active, e.clientX, e.clientY);
        __scheduleProgramReorderAutoScroll(active, e.clientX, e.clientY);
    };

    const getTrackedTouch = (touchList) => {
        if (touchId == null) return null;
        return [...touchList].find((t) => t.identifier === touchId) || null;
    };

    const handleTouchMove = (e) => {
        const touch = getTrackedTouch(e.touches);
        if (!touch) return;
        lastX = touch.clientX;
        lastY = touch.clientY;

        if (!reorderStarted) {
            if (Math.abs(lastX - startX) > DRAG_START_MOVE_PX || Math.abs(lastY - startY) > DRAG_START_MOVE_PX) {
                clearPressTimer();
            }
            return;
        }

        const active = __activeProgramReorder;
        if (!active) return;
        if (e.cancelable) e.preventDefault();
        __maybeStepProgramGrid(active, touch.clientX, touch.clientY);
        __syncProgramReorderGhost(active, touch.clientX, touch.clientY);
        __scheduleProgramReorderAutoScroll(active, touch.clientX, touch.clientY);
    };

    const handlePointerEnd = async () => {
        clearPressTimer();
        removeWindowListeners();
        const didReorder = reorderStarted;
        reorderStarted = false;
        pointerId = null;
        touchId = null;
        if (didReorder) await finishProgramReorder(true);
    };

    const handlePointerCancel = async () => {
        clearPressTimer();
        removeWindowListeners();
        const didReorder = reorderStarted;
        reorderStarted = false;
        pointerId = null;
        touchId = null;
        if (didReorder) await finishProgramReorder(false);
    };

    const handleTouchEnd = async (e) => {
        const ended = touchId != null && [...e.changedTouches].some((t) => t.identifier === touchId);
        if (!ended) return;
        clearPressTimer();
        removeWindowListeners();
        const didReorder = reorderStarted;
        reorderStarted = false;
        touchId = null;
        pointerId = null;
        if (didReorder) await finishProgramReorder(true);
    };

    const handleTouchCancel = async (e) => {
        const cancelled = touchId != null && [...e.changedTouches].some((t) => t.identifier === touchId);
        if (!cancelled) return;
        clearPressTimer();
        removeWindowListeners();
        const didReorder = reorderStarted;
        reorderStarted = false;
        touchId = null;
        pointerId = null;
        if (didReorder) await finishProgramReorder(false);
    };

    itemEl.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'touch') return;
        if (e.button != null && e.button !== 0) return;
        if (e.target.closest('.menu-btn')) return;
        if (__activeExerciseReorder || __activeProgramReorder) return;
        pointerId = e.pointerId;
        startX = e.clientX;
        startY = e.clientY;
        lastX = startX;
        lastY = startY;
        reorderStarted = false;
        clearPressTimer();
        pressTimer = setTimeout(beginReorder, 360);
        bindWindowListeners();
    }, { passive: true });

    itemEl.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) return;
        if (e.target.closest('.menu-btn')) return;
        if (__activeExerciseReorder || __activeProgramReorder) return;
        const touch = e.changedTouches[0];
        touchId = touch.identifier;
        startX = touch.clientX;
        startY = touch.clientY;
        lastX = startX;
        lastY = startY;
        pointerId = null;
        reorderStarted = false;
        clearPressTimer();
        pressTimer = setTimeout(beginReorder, 360);
        bindWindowListeners();
    }, { passive: true });
}

function __closeSwipe(swipeRoot) {
  if (!swipeRoot) return;
  setExerciseSwipeShadowSuppressed(swipeRoot, false);
  closeSwipeRowVisual(swipeRoot, () => {});
  swipeRoot.classList.remove('open-left', 'open-right');

  if (__openSwipeRoot === swipeRoot) __openSwipeRoot = null;
}

function closeAllSwipes() {
  __closeSwipe(__openSwipeRoot);
}

function getExerciseItemForSwipe(swipeRoot) {
  if (!swipeRoot || typeof swipeRoot.closest !== 'function') return null;
  return swipeRoot.closest('.exercise-item');
}

function setExerciseSwipeShadowSuppressed(swipeRoot, suppressed) {
  const exerciseItem = getExerciseItemForSwipe(swipeRoot);
  if (!exerciseItem) return;
  exerciseItem.style.boxShadow = suppressed ? 'none' : '';
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
  const content = swipeRoot.querySelector('.food-info-header-content') || swipeRoot.querySelector('.swipe-content');
  if (!content) return;

  const MAX_RIGHT = 168;

  swipeRoot.querySelector('.action-edit')?.addEventListener('click', (e) => {
    e.stopPropagation();
    setExerciseSwipeShadowSuppressed(swipeRoot, false);
    closeSwipeRowVisual(swipeRoot, () => {});
    openEditExerciseModal(selectedProgram, exercise);
  });

  swipeRoot.querySelector('.action-delete')?.addEventListener('click', (e) => {
    e.stopPropagation();
    setExerciseSwipeShadowSuppressed(swipeRoot, false);
    closeSwipeRowVisual(swipeRoot, () => {});
    openConfirmModal('Удалить упражнение?', async () => {
      const progRef = doc(getUserProgramsCollection(), selectedProgram.id);
      const filtered = selectedProgram.exercises.filter(ex => ex.id !== exercise.id);
      selectedProgram.exercises = filtered;
      queueProgramExercisesSave(selectedProgram.id, selectedProgram.exercises, { errorMessage: 'Не удалось удалить упражнение' });
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
    onSwipeActiveVisual: (root) => {
      setExerciseSwipeShadowSuppressed(root, true);
    },
    onSwipeClosedVisual: (root) => {
      setExerciseSwipeShadowSuppressed(root, false);
    },
    onBeforeOpen: null,
    addDocumentClickOutside: true,
    edgeWidth: 0,
    edgeWidthLeft: 0,
    maxSwipeLeft: 0
  });
}

function __exercisePlaceholderSlotIndex(parentEl, ph, draggedEl) {
  const layoutItems = __exerciseReorderLayoutItems(parentEl, draggedEl);
  let el = ph.nextElementSibling;
  while (el && (!(el instanceof HTMLElement) || el.style.display === 'none')) {
    el = el.nextElementSibling;
  }
  if (!el || !el.classList?.contains('exercise-item')) return layoutItems.length;
  const idx = layoutItems.indexOf(el);
  return idx < 0 ? layoutItems.length : idx;
}

function updateExerciseReorderVisual(active) {
  if (!active?.placeholderEl || !active?.parentEl) return;
  const layoutItems = __exerciseReorderLayoutItems(active.parentEl, active.itemEl);
  const ph = active.placeholderEl;
  const currentIndex = __exercisePlaceholderSlotIndex(active.parentEl, ph, active.itemEl);
  const lastIndex = layoutItems.length;
  ph.classList.toggle('exercise-reorder-placeholder--can-up', currentIndex > 0);
  ph.classList.toggle('exercise-reorder-placeholder--can-down', currentIndex >= 0 && currentIndex < lastIndex);
}

function refreshExerciseOrderNumbers(parentEl) {
  if (!parentEl) return;
  const dragged = [...parentEl.querySelectorAll('.exercise-item.exercise-item--dragging-source')][0];
  const layoutItems = __exerciseReorderLayoutItems(parentEl, dragged || null);
  layoutItems.forEach((itemEl, index) => {
    const numberEl = itemEl.querySelector('.exercise-number');
    if (numberEl) numberEl.textContent = `${index + 1}.`;
  });
}

function moveExerciseInReorder(active, direction) {
  if (!active?.placeholderEl || !active?.parentEl || !direction) return false;

  const parentEl = active.parentEl;
  const ph = active.placeholderEl;
  const layoutItems = __exerciseReorderLayoutItems(parentEl, active.itemEl);
  const effectiveFrom = __exercisePlaceholderSlotIndex(parentEl, ph, active.itemEl);
  const toIndex = effectiveFrom + direction;

  if (effectiveFrom < 0 || toIndex < 0 || toIndex > layoutItems.length) return false;

  const beforeRects = new Map();
  layoutItems.forEach((el) => {
    beforeRects.set(el, el.getBoundingClientRect());
  });

  if (direction < 0) {
    const beforeEl = layoutItems[toIndex];
    if (beforeEl) parentEl.insertBefore(ph, beforeEl);
  } else if (toIndex >= layoutItems.length) {
    parentEl.appendChild(ph);
  } else {
    const beforeEl = layoutItems[toIndex];
    if (beforeEl) parentEl.insertBefore(ph, beforeEl);
  }

  const afterLayout = __exerciseReorderLayoutItems(parentEl, active.itemEl);
  afterLayout.forEach((el) => {
    const before = beforeRects.get(el);
    if (!before) return;
    const after = el.getBoundingClientRect();
    const dy = before.top - after.top;
    if (!dy) return;

    el.style.transition = 'none';
    el.style.transform = `translateY(${dy}px)`;
    void el.offsetHeight;
    el.style.transition = 'transform 160ms ease';
    el.style.transform = '';
    window.setTimeout(() => {
      if (el.style.transition === 'transform 160ms ease') el.style.transition = '';
    }, 190);
  });

  active.didChange = true;
  refreshExerciseOrderNumbers(active.parentEl);
  updateExerciseReorderVisual(active);
  return true;
}

async function finishExerciseReorder(saveChanges = true) {
  const active = __activeExerciseReorder;
  if (!active) return;

  __activeExerciseReorder = null;

  if (active.ghostEl) {
    active.ghostEl.remove();
    active.ghostEl = null;
  }

  if (active.placeholderEl && active.placeholderEl.parentElement) {
    active.parentEl.insertBefore(active.itemEl, active.placeholderEl);
    active.placeholderEl.remove();
    active.placeholderEl = null;
  }

  active.itemEl.style.transform = '';
  if (active.restoreExerciseStyle) {
    active.itemEl.style.visibility = active.restoreExerciseStyle.visibility;
    active.itemEl.style.opacity = active.restoreExerciseStyle.opacity;
    active.itemEl.style.display = active.restoreExerciseStyle.display;
    active.itemEl.style.pointerEvents = active.restoreExerciseStyle.pointerEvents;
  } else {
    active.itemEl.style.visibility = '';
    active.itemEl.style.opacity = '';
    active.itemEl.style.display = '';
    active.itemEl.style.pointerEvents = '';
  }
  active.itemEl.classList.remove(
    'exercise-item--reorder-active',
    'exercise-item--can-move-up',
    'exercise-item--can-move-down',
    'exercise-item--dragging-source'
  );
  if (active.placeholderEl) {
    active.placeholderEl.classList.remove('exercise-reorder-placeholder--can-up', 'exercise-reorder-placeholder--can-down');
  }
  if (active.headerEl) active.headerEl.dataset.suppressClick = '0';
  document.documentElement.classList.remove('exercise-reorder-lock');
  document.body.classList.remove('exercise-reorder-lock');

  if (!saveChanges || !active.didChange) return;

  active.selectedProgram.exercises = __exerciseReorderLayoutItems(active.parentEl, null)
    .map((itemEl) => active.exerciseMap.get(itemEl.dataset.exId))
    .filter(Boolean);

  try {
    queueProgramExercisesSave(active.selectedProgram.id, active.selectedProgram.exercises, {
      delayMs: 240,
      errorMessage: 'Не удалось сохранить порядок упражнений'
    });
    render();
  } catch (error) {
    console.error('Не удалось сохранить порядок упражнений:', error);
    active.selectedProgram.exercises = active.originalExercises;
    showToast('Не удалось сохранить порядок');
    render();
  }
}

function attachExerciseReorderLongPress({ headerEl, itemEl, swipeRoot, selectedProgram, exercise }) {
  if (!headerEl || headerEl.dataset.exerciseReorderBound === '1') return;
  headerEl.dataset.exerciseReorderBound = '1';

  let pointerId = null;
  let touchId = null;
  let pressTimer = null;
  let startX = 0;
  let startY = 0;
  let lastY = 0;
  let reorderStarted = false;
  const STEP_COOLDOWN_MS = 140;
  // Чуть чувствительнее (~20%): меньше "запас" у середины соседней карточки
  const MID_CROSS_PADDING_PX = 5;

  const shouldStepNow = (active, now) => {
    const last = active?.lastStepAt || 0;
    if (now - last < STEP_COOLDOWN_MS) return false;
    active.lastStepAt = now;
    return true;
  };

  const tryStepByPointerY = (active, pointerY) => {
    if (!active?.itemEl || !active?.parentEl || !active.placeholderEl) return;
    const layoutItems = __exerciseReorderLayoutItems(active.parentEl, active.itemEl);
    const slot = __exercisePlaceholderSlotIndex(active.parentEl, active.placeholderEl, active.itemEl);

    const prev = slot > 0 ? layoutItems[slot - 1] : null;
    const next = slot < layoutItems.length ? layoutItems[slot] : null;

    // Вверх: переставляем только когда палец пересёк середину предыдущего элемента (с небольшим запасом).
    if (prev) {
      const r = prev.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      if (pointerY < mid - MID_CROSS_PADDING_PX) {
        moveExerciseInReorder(active, -1);
        return;
      }
    }

    // Вниз: переставляем только когда палец пересёк середину следующего элемента (с небольшим запасом).
    if (next) {
      const r = next.getBoundingClientRect();
      const mid = r.top + r.height / 2;
      if (pointerY > mid + MID_CROSS_PADDING_PX) {
        moveExerciseInReorder(active, 1);
      }
    }
  };

  const clearPressTimer = () => {
    if (!pressTimer) return;
    clearTimeout(pressTimer);
    pressTimer = null;
  };

  const suppressNextClick = () => {
    headerEl.dataset.suppressClick = '1';
  };

  const beginReorder = () => {
    if (__activeExerciseReorder || !itemEl.parentElement) return;

    reorderStarted = true;
    suppressNextClick();
    closeAllSwipes();

    try {
      if (pointerId != null) headerEl.setPointerCapture?.(pointerId);
    } catch (_) {
      /* noop */
    }

    const parentEl = itemEl.parentElement;
    const rect = itemEl.getBoundingClientRect();
    const originIndex = [...parentEl.querySelectorAll('.exercise-item')].indexOf(itemEl);
    const placeholderEl = __createExerciseReorderPlaceholder(itemEl);
    parentEl.insertBefore(placeholderEl, itemEl);
    const ghostEl = __createExerciseReorderGhost(itemEl, rect);

    const restoreExerciseStyle = {
      visibility: itemEl.style.visibility,
      opacity: itemEl.style.opacity,
      display: itemEl.style.display,
      pointerEvents: itemEl.style.pointerEvents
    };

    __activeExerciseReorder = {
      selectedProgram,
      exerciseId: exercise.id,
      headerEl,
      itemEl,
      parentEl,
      exerciseMap: new Map(selectedProgram.exercises.map((ex) => [String(ex.id), ex])),
      originalExercises: selectedProgram.exercises.slice(),
      didChange: false,
      startY: lastY,
      placeholderEl,
      ghostEl,
      exerciseStartX: startX,
      exerciseStartY: lastY,
      exerciseGhostLiftPx: -6,
      restoreExerciseStyle,
      originIndex
    };

    itemEl.classList.add('exercise-item--reorder-active', 'exercise-item--dragging-source');
    itemEl.style.opacity = '0';
    itemEl.style.pointerEvents = 'none';
    itemEl.style.display = 'none';
    document.documentElement.classList.add('exercise-reorder-lock');
    document.body.classList.add('exercise-reorder-lock');

    __updateExerciseReorderGhostPos(__activeExerciseReorder, startX, lastY);
    updateExerciseReorderVisual(__activeExerciseReorder);
  };

  const handlePointerDown = (e) => {
    if (e.pointerType === 'touch') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest('.edit-note-btn, .action-btn, input, textarea, select, a')) return;
    if (swipeRoot.classList.contains('open') || swipeRoot.classList.contains('open-left') || swipeRoot.classList.contains('open-right')) return;
    if (__activeExerciseReorder) return;

    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    lastY = e.clientY;
    reorderStarted = false;
    clearPressTimer();
    pressTimer = setTimeout(beginReorder, 320);
    window.addEventListener('pointermove', handlePointerMove, { passive: false });
    window.addEventListener('pointerup', handlePointerEnd);
    window.addEventListener('pointercancel', handlePointerEnd);
  };

  const handlePointerMove = (e) => {
    if (e.pointerId !== pointerId) return;

    lastY = e.clientY;

    if (!reorderStarted) {
      if (Math.abs(e.clientX - startX) > 10 || Math.abs(e.clientY - startY) > 10) {
        clearPressTimer();
      }
      return;
    }

    const active = __activeExerciseReorder;
    if (!active) return;

    if (e.cancelable) e.preventDefault();

    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (shouldStepNow(active, now)) {
      tryStepByPointerY(active, e.clientY);
    }
    __updateExerciseReorderGhostPos(active, e.clientX, e.clientY);
  };

  const removeTouchWindowListeners = () => {
    window.removeEventListener('touchmove', handleTouchMove);
    window.removeEventListener('touchend', handleTouchEnd);
    window.removeEventListener('touchcancel', handleTouchEnd);
  };

  const getTrackedTouch = (touchList) => {
    if (touchId == null) return null;
    return [...touchList].find((touch) => touch.identifier === touchId) || null;
  };

  const handleTouchStart = (e) => {
    if (e.touches.length !== 1) return;
    if (e.target.closest('.edit-note-btn, .action-btn, input, textarea, select, a')) return;
    if (swipeRoot.classList.contains('open') || swipeRoot.classList.contains('open-left') || swipeRoot.classList.contains('open-right')) return;
    if (__activeExerciseReorder) return;

    const touch = e.changedTouches[0];
    touchId = touch.identifier;
    startX = touch.clientX;
    startY = touch.clientY;
    lastY = touch.clientY;
    reorderStarted = false;
    clearPressTimer();
    pressTimer = setTimeout(beginReorder, 320);
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);
    window.addEventListener('touchcancel', handleTouchEnd);
  };

  const handleTouchMove = (e) => {
    const touch = getTrackedTouch(e.touches);
    if (!touch) return;

    lastY = touch.clientY;

    if (!reorderStarted) {
      if (Math.abs(touch.clientX - startX) > 10 || Math.abs(touch.clientY - startY) > 10) {
        clearPressTimer();
      }
      return;
    }

    const active = __activeExerciseReorder;
    if (!active) return;

    if (e.cancelable) e.preventDefault();

    const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (shouldStepNow(active, now)) {
      tryStepByPointerY(active, touch.clientY);
    }
    __updateExerciseReorderGhostPos(active, touch.clientX, touch.clientY);
  };

  const releasePointer = () => {
    if (pointerId == null) return;
    try {
      headerEl.releasePointerCapture?.(pointerId);
    } catch (_) {
      /* noop */
    }
    pointerId = null;
  };

  const removeWindowListeners = () => {
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerEnd);
    window.removeEventListener('pointercancel', handlePointerEnd);
  };

  const handlePointerEnd = async () => {
    clearPressTimer();
    removeWindowListeners();
    releasePointer();

    const didReorder = reorderStarted;
    reorderStarted = false;

    if (didReorder) {
      await finishExerciseReorder(true);
    }
  };

  const handleTouchEnd = async (e) => {
    const trackedTouchEnded = touchId != null && [...e.changedTouches].some((touch) => touch.identifier === touchId);
    if (!trackedTouchEnded) return;

    clearPressTimer();
    removeTouchWindowListeners();
    touchId = null;

    const didReorder = reorderStarted;
    reorderStarted = false;

    if (didReorder) {
      await finishExerciseReorder(true);
    }
  };

  headerEl.addEventListener('pointerdown', handlePointerDown);
  headerEl.addEventListener('touchstart', handleTouchStart, { passive: true });
}


// ===============================
// === done при свапе по подходу
// ===============================


function enableSwipeDone(setRow, setsArg) {
    const syncSets = Array.isArray(setsArg) ? setsArg : [setsArg];
    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let isSwipe = false;
    let dragged = false;
    let panAxis = null;

    setRow.addEventListener("touchstart", (e) => {
        if (setRow.dataset.setReorderLock === '1') return;
        if (!e.touches || !e.touches.length) return;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        currentX = startX;
        isSwipe = true;
        dragged = false;
        panAxis = null;
    }, { passive: true });

    setRow.addEventListener("touchmove", (e) => {
        if (setRow.dataset.setReorderLock === '1') return;
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
        if (setRow.dataset.setReorderLock === '1') {
            isSwipe = false;
            dragged = false;
            panAxis = null;
            setRow.style.transform = "translateX(0)";
            return;
        }
        panAxis = null;
        if (!isSwipe) return;
        isSwipe = false;

        const diff = (e.changedTouches && e.changedTouches[0]
            ? e.changedTouches[0].clientX
            : currentX) - startX;

        if (Math.abs(diff) > 45) {
            const newDone = !syncSets[0].done;
            syncSets.forEach((s) => { s.done = newDone; });
            setRow.classList.toggle("done", newDone);
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
    contentContainer.append(createElement('h3', 'program-details-page-title', selectedProgram.name));

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
            const exerciseHeader = createElement('div', `exercise-header food-info-header ${isExpanded ? 'expanded' : ''}`);

exerciseHeader.addEventListener('click', () => {
    if (exerciseHeader.dataset.suppressClick === '1') {
        exerciseHeader.dataset.suppressClick = '0';
        return;
    }
    state.expandedExerciseId =
        state.expandedExerciseId === exercise.id ? null : exercise.id;

    render();
});


            const exerciseTitle = createElement('div', 'exercise-title');
            const exerciseTitleCopy = createElement('div', 'exercise-title-copy');
            exerciseTitleCopy.append(createElement('span', 'exercise-name', exercise.name));
            if (String(exercise.description || '').trim()) {
                exerciseTitleCopy.append(
                    createElement('div', 'exercise-description', exercise.description.trim())
                );
            }
            exerciseTitle.append(
                createElement('span', 'exercise-number', `${index + 1}.`),
                exerciseTitleCopy
            );


            // Кнопка "добавить комментарий": показываем только если комментария нет.
            let editNoteBtn = null;
            if (!hasNote) {
                editNoteBtn = createElement('button', 'btn edit-note-btn');
                editNoteBtn.innerHTML = `
<svg xmlns="http://www.w3.org/2000/svg" version="1.1" xmlns:xlink="http://www.w3.org/1999/xlink" id="Иконка 7" viewBox="0 0 17 12">
  <g>
    <path fill="none" fill-rule="evenodd" d="M6.5,12.39 L6.5,12.39 L6.44,12.4 L6.43,12.4 L6.43,12.4 L6.38,12.39 C6.38,12.37 6.38,12.39 6.37,12.39 L6.37,12.39 L6.36,12.64 L6.37,12.65 L6.37,12.65 L6.43,12.7 L6.44,12.7 L6.44,12.7 L6.51,12.65 L6.51,12.65 L6.52,12.64 L6.51,12.39 C6.51,12.39 6.5,12.39 6.5,12.39 M6.65,12.31 L6.65,12.31 L6.53,12.37 L6.53,12.37 L6.53,12.39 L6.53,12.62 L6.54,12.64 L6.54,12.64 L6.66,12.69 C6.68,12.7 6.68,12.7 6.69,12.69 L6.69,12.68 L6.66,12.32 C6.66,12.32 6.66,12.31 6.65,12.31 M6.23,12.31 C6.23,12.31 6.22,12.31 6.22,12.32 L6.22,12.32 L6.19,12.68 C6.19,12.69 6.2,12.69 6.2,12.7 L6.22,12.69 L6.34,12.64 L6.35,12.64 L6.35,12.62 L6.35,12.39 L6.35,12.37 L6.35,12.37 Z"/>
  </g>
  <g>
    <path fill="none" fill-rule="evenodd" d="M6.44,12.09 L6.44,12.09 L6.39,12.1 L6.38,12.1 L6.38,12.1 L6.34,12.09 C6.34,12.08 6.34,12.09 6.31,12.09 L6.31,12.09 L6.3,12.34 L6.31,12.36 L6.31,12.36 L6.38,12.4 L6.39,12.4 L6.39,12.4 L6.46,12.36 L6.46,12.36 L6.47,12.34 L6.46,12.09 C6.46,12.09 6.44,12.09 6.44,12.09 M6.6,12.02 L6.6,12.02 L6.48,12.08 L6.48,12.08 L6.48,12.09 L6.48,12.32 L6.49,12.34 L6.49,12.34 L6.61,12.39 C6.63,12.4 6.63,12.4 6.63,12.39 L6.63,12.38 L6.61,12.03 C6.61,12.03 6.61,12.02 6.6,12.02 M6.18,12.02 C6.18,12.02 6.17,12.02 6.17,12.03 L6.17,12.03 L6.15,12.38 C6.15,12.39 6.16,12.39 6.16,12.4 L6.17,12.39 L6.29,12.34 L6.29,12.34 L6.29,12.32 L6.29,12.09 L6.29,12.08 L6.29,12.08 Z"/>
    <g>
      <path fill="none" fill-rule="evenodd" d="M6.35,12.48 L6.35,12.48 L6.29,12.51 L6.28,12.51 L6.28,12.51 L6.24,12.48 C6.24,12.47 6.24,12.48 6.23,12.48 L6.23,12.48 L6.22,12.74 L6.23,12.75 L6.23,12.75 L6.28,12.8 L6.29,12.8 L6.29,12.8 L6.36,12.75 L6.36,12.75 L6.37,12.74 L6.36,12.48 C6.36,12.48 6.35,12.48 6.35,12.48 M6.51,12.41 L6.51,12.41 L6.38,12.47 L6.38,12.47 L6.38,12.48 L6.38,12.73 L6.39,12.74 L6.39,12.74 L6.52,12.79 C6.54,12.8 6.54,12.8 6.55,12.79 L6.55,12.78 L6.52,12.43 C6.52,12.43 6.52,12.41 6.51,12.41 M6.08,12.41 C6.08,12.41 6.06,12.41 6.06,12.43 L6.06,12.43 L6.04,12.78 C6.04,12.79 6.05,12.79 6.05,12.8 L6.06,12.79 L6.18,12.74 L6.2,12.74 L6.2,12.73 L6.2,12.48 L6.2,12.47 L6.2,12.47 Z"/>
    </g>
  </g>
  <g>
    <path fill="none" fill-rule="evenodd" d="M5.3,10.73 L5.3,10.73 L5.26,10.75 L5.26,10.75 L5.25,10.75 L5.21,10.73 C5.21,10.73 5.21,10.73 5.2,10.74 L5.2,10.74 L5.19,10.95 L5.2,10.96 L5.2,10.96 L5.25,11 L5.26,11 L5.26,11 L5.31,10.96 L5.32,10.95 L5.32,10.95 L5.31,10.74 C5.31,10.74 5.31,10.73 5.3,10.73 M5.43,10.68 L5.42,10.68 L5.34,10.72 L5.33,10.73 L5.33,10.73 L5.34,10.94 L5.34,10.95 L5.35,10.95 L5.44,10.99 C5.45,11 5.45,11 5.46,10.99 L5.46,10.98 L5.44,10.69 C5.44,10.68 5.44,10.68 5.43,10.68 M5.09,10.68 C5.08,10.68 5.08,10.68 5.08,10.68 L5.07,10.69 L5.06,10.98 C5.06,10.99 5.06,10.99 5.06,11 L5.07,10.99 L5.17,10.95 L5.17,10.95 L5.17,10.94 L5.18,10.73 L5.18,10.73 L5.18,10.72 Z"/>
    <path fill="currentColor" fill-rule="evenodd" d="M11.31,9.45 C11.56,9.2 11.99,9.19 12.26,9.41 C12.53,9.65 12.56,10.04 12.35,10.33 L12.28,10.4 L11.25,11.39 C10.4,12.2 9.04,12.2 8.19,11.39 C7.92,11.11 7.47,11.1 7.18,11.32 L7.1,11.39 L6.75,11.74 C6.49,11.98 6.08,11.98 5.81,11.76 C5.53,11.52 5.47,11.11 5.72,10.84 L5.78,10.79 L6.12,10.46 C6.95,9.64 8.31,9.64 9.17,10.46 C9.44,10.72 9.89,10.74 10.21,10.5 L10.26,10.46 Z M10.04,.58 C10.72,-.05 11.78,-.06 12.46,.55 C13.12,1.16 13.19,2.19 12.58,2.86 L12.49,2.94 L4.49,10.65 C4.39,10.74 4.27,10.83 4.14,10.86 L4.04,10.92 L2.07,11.44 C1.84,11.51 1.59,11.46 1.42,11.3 C1.26,11.14 1.18,10.92 1.21,10.69 L1.22,10.61 L1.78,8.73 C1.82,8.59 1.89,8.47 1.98,8.37 L2.04,8.29 Z M11.68,1.19 C11.56,1.08 11.23,1.1 11.1,1.19 L10.67,1.46 L2.89,8.93 L2.31,10.33 L3.76,9.91 L11.82,2.15 C11.96,2.03 11.96,1.86 11.96,1.46"/>
  </g>
</svg>`;

                editNoteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openCommentModal(
                        exercise.id,
                        exercise.note,
                        `Комментарий к <span class="exercise-name-span">- ${exercise.name}</span>`,
                        (newNote, media) => saveExerciseNote(selectedProgram.id, exercise.id, newNote, media)
                    );
                });
            }

            const headerArrow = createElement('span', 'exercise-header-arrow');
            headerArrow.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><title>Arrow-drop-right-line SVG Icon</title><path fill="currentColor" d="M12.172 12L9.343 9.173l1.415-1.414L15 12l-4.242 4.242l-1.415-1.414z"></path></svg>';

            exerciseHeader.append(exerciseTitle, headerArrow);

            // Клик по заголовку

            // 2. — СОЗДАЁМ SWIPE ROOT
            const swipeRoot = createElement('div', 'exercise-swipe food-swipe food-swipe--meal-item food-swipe--exercise-item');
            const swipeRow = createElement('div', 'meal-food-item exercise-swipe-row');
            const swipeContent = createElement('div', 'food-info-header-content');
            const actionsStrip = createElement('div', 'food-swipe-meal-actions exercise-swipe-actions');

            const editSlot = createElement('div', 'food-swipe-plan-slot exercise-swipe-edit-slot');
            const editBtn = createElement('button', 'action-btn action-plan action-edit');
            editBtn.type = 'button';
            editBtn.innerHTML = `
              <span class="action-plan-text" role="img" aria-label="Edit exercise">
                <svg xmlns="http://www.w3.org/2000/svg" version="1.1" xmlns:xlink="http://www.w3.org/1999/xlink" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><title>Edit exercise</title><path fill="currentColor" d="M 14.96 1.812 C 14.01 1.875 13.23 2.479 12.62 3.165 C 9.636 6.167 6.628 9.151 3.651 12.16 C 2.981 12.89 2.991 13.94 2.731 14.85 C 2.558 15.67 2.348 16.49 2.197 17.32 C 2.22 17.74 2.708 17.9 3.055 17.74 C 4.394 17.42 5.752 17.18 7.078 16.81 C 7.617 16.62 8.021 16.2 8.41 15.8 C 8.307 15.4 8.24 15 8.211 14.59 C 7.701 15.02 7.32 15.65 6.678 15.89 C 5.577 16.16 4.465 16.39 3.359 16.64 C 3.627 15.5 3.846 14.35 4.144 13.22 C 4.449 12.6 5.062 12.2 5.511 11.69 C 7.823 9.38 10.14 7.07 12.45 4.76 C 13.38 5.69 14.31 6.62 15.24 7.551 C 14.82 7.971 14.41 8.391 13.99 8.811 C 14.4 8.842 14.8 8.907 15.2 9.01 C 16 8.179 16.87 7.41 17.62 6.537 C 18.58 5.306 18.3 3.354 17.05 2.432 C 16.46 1.971 15.7 1.747 14.96 1.812 z M 15.6 2.848 C 16.69 3.048 17.46 4.279 17.1 5.346 C 16.93 5.981 16.38 6.384 15.95 6.84 C 15.02 5.91 14.08 4.98 13.15 4.051 C 13.7 3.495 14.29 2.812 15.14 2.818 C 15.29 2.801 15.45 2.84 15.6 2.848 z "/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-miterlimit="10" d="M12.07,13.39L13.71,12.47L15.35,13.39L15.35,15.22L13.71,16.15L12.07,15.22z"/><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-miterlimit="10" d="M16.98,13.5L17.8,12.6L17.18,11.55L15.97,11.84L14.59,11.1L14.32,10.22L13.1,10.22L12.82,11.1L11.45,11.84L10.24,11.55L9.62,12.6L10.44,13.5L10.44,15.12L9.62,16.01L10.24,17.07L11.45,16.78L12.82,17.52L13.1,18.4L14.32,18.4L14.59,17.52L15.97,16.78L17.18,17.07L17.8,16.01L16.98,15.12z"/></svg>
              </span>
            `;
            editSlot.append(editBtn);

            const deleteSlot = createElement('div', 'food-swipe-delete-slot exercise-swipe-delete-slot');
            const deleteBtn = createElement('button', 'action-btn action-delete');
            deleteBtn.type = 'button';
            deleteBtn.innerHTML = `
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><title>Trash-24 SVG Icon</title><path fill="currentColor" d="M16 1.75V3h5.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H8V1.75C8 .784 8.784 0 9.75 0h4.5C15.216 0 16 .784 16 1.75m-6.5 0V3h5V1.75a.25.25 0 0 0-.25-.25h-4.5a.25.25 0 0 0-.25.25M4.997 6.178a.75.75 0 1 0-1.493.144L4.916 20.92a1.75 1.75 0 0 0 1.742 1.58h10.684a1.75 1.75 0 0 0 1.742-1.581l1.413-14.597a.75.75 0 0 0-1.494-.144l-1.412 14.596a.25.25 0 0 1-.249.226H6.658a.25.25 0 0 1-.249-.226z"></path><path fill="currentColor" d="M9.206 7.501a.75.75 0 0 1 .793.705l.5 8.5A.75.75 0 1 1 9 16.794l-.5-8.5a.75.75 0 0 1 .705-.793Zm6.293.793A.75.75 0 1 0 14 8.206l-.5 8.5a.75.75 0 0 0 1.498.088l.5-8.5Z"></path></svg>
            `;
            deleteSlot.append(deleteBtn);

            actionsStrip.append(editSlot, deleteSlot);
            swipeContent.append(exerciseHeader, actionsStrip);
            swipeRow.append(swipeContent);
            swipeRoot.append(swipeRow);
            exerciseItem.append(swipeRoot);

             // 4️⃣ Подключаем свайп (только 1 раз!)
                  attachSwipeActions(swipeRoot, selectedProgram, exercise);
                  attachExerciseReorderLongPress({
                      headerEl: exerciseHeader,
                      itemEl: exerciseItem,
                      swipeRoot,
                      selectedProgram,
                      exercise
                  });






            // Контейнер для подходов
            const setsContainer = createElement('div', `sets-container ${isExpanded ? 'expanded' : ''}`);

            // Свернутый краткий вид подходов (чипсы) — одна группа дропа = один чип
            const summarySetsContainer = createElement('div', `summary-sets-container ${!isExpanded ? 'visible' : ''}`);
            if (Array.isArray(exercise.sets) && exercise.sets.length) {
                let si = 0;
                while (si < exercise.sets.length) {
                    if (exercise.sets[si].continuation) {
                        si++;
                        continue;
                    }
                    const [gs, ge] = __getDropSetGroupBounds(exercise, si);
                    const groupSlice = exercise.sets.slice(gs, ge + 1);
                    const nonEmptyParts = groupSlice.filter((st) => (st.weight && st.weight.trim() !== '') || (st.reps && st.reps.trim() !== ''));
                    if (nonEmptyParts.length) {
                        const chipOrd = __getApproachOrdinalForSet(exercise.sets, gs);
                        const chipText = `${chipOrd}. ${nonEmptyParts.map((st) => `${st.weight || '0'} кг x ${st.reps || '0'} пов`).join(' · ')}`;
                        const isMainChip = groupSlice.some((st) => st.isMain);
                        const summarySpan = createElement('span', isMainChip ? 'main-set' : '', chipText);
                        summarySetsContainer.append(summarySpan);
                    }
                    si = ge + 1;
                }
            }

            // Полный список подходов (дроп-группа — один set-row)
            if (Array.isArray(exercise.sets)) {
                let setIndex = 0;
                while (setIndex < exercise.sets.length) {
                    if (exercise.sets[setIndex].continuation) {
                        setIndex++;
                        continue;
                    }
                    const [gStart, gEnd] = __getDropSetGroupBounds(exercise, setIndex);
                    const groupSets = exercise.sets.slice(gStart, gEnd + 1);
                    const isDropGroup = groupSets.length > 1;
                    const headSet = groupSets[0];

                    const setRow = createElement('div', `set-row ${headSet.isMain ? 'main-set' : ''}${isDropGroup ? ' set-row--drop-group' : ''}`);
                    const approachOrd = __getApproachOrdinalForSet(exercise.sets, gStart);
                    setRow.dataset.approachKey = `${String(exercise.id)}:${gStart}`;
                    setRow.dataset.approachOrder = String(approachOrd);
                    if (groupSets.some((s) => s.done)) {
                        setRow.classList.add('done');
                    }
                    enableSwipeDone(setRow, groupSets);
                    attachSetReorderLongPress({
                        setRow,
                        selectedProgram,
                        exercise
                    });

                    if (isDropGroup) {
                        const stack = createElement('div', 'set-display-stack');
                        groupSets.forEach((part, j) => {
                            const line = createElement(
                                'div',
                                j === 0
                                    ? 'set-display-line set-display-line--drop set-display-line--drop-root'
                                    : 'set-display-line set-display-line--drop'
                            );
                            const displayWeight = part.weight || '...';
                            const displayReps = part.reps || '...';
                            const fullHtml = __formatSetDisplayKgReps(displayWeight, displayReps);
                            const isLastInDrop = j === groupSets.length - 1;
                            const treeCell = createElement('span', 'set-display-line__tree');
                            treeCell.innerHTML = j === 0 ? __DROP_SET_TREE_ROOT_SVG : __dropSetTreeSvg(isLastInDrop);
                            const ordSpan = createElement(
                                'span',
                                j === 0 ? 'set-display-line__ord' : 'set-display-line__ord set-display-line__ord--phantom'
                            );
                            ordSpan.textContent = `${approachOrd}.`;
                            if (j !== 0) ordSpan.setAttribute('aria-hidden', 'true');
                            const text = createElement('span', 'set-display-line__text');
                            text.innerHTML = fullHtml;
                            line.append(treeCell, ordSpan, text);
                            stack.append(line);
                        });
                        setRow.append(stack);
                    } else {
                        const ordLabel = createElement('span', 'set-label', `${approachOrd}.`);
                        const setText = createElement('span', 'set-display');
                        const displayWeight = headSet.weight || '...';
                        const displayReps = headSet.reps || '...';
                        setText.innerHTML = __formatSetDisplayKgReps(displayWeight, displayReps);
                        setRow.append(ordLabel, setText);
                    }

                    setRow.addEventListener('click', (e) => {
                        if (setRow._preventClick) return;
                        e.stopPropagation();
                        openEditSetModal(selectedProgram.id, exercise.id, gStart, headSet);
                    });

                    const deleteSetBtn = createElement('button', 'btn delete-set-btn');
                    deleteSetBtn.innerHTML = `
                        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24">
                          <path fill="currentColor" d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59L7.11 5.7A1 1 0 1 0 5.7 7.11L10.59 12L5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4z"/>
                        </svg>`;
                    deleteSetBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const groupLen = gEnd - gStart + 1;
                        const delMsg = groupLen > 1
                            ? 'Удалить подход со всеми сетами дропа?'
                            : 'Удалить этот подход?';
                        openConfirmModal(delMsg, async () => {
                            exercise.sets.splice(gStart, groupLen);

                            if (exercise.sets.length === 0) {
                                const currentProgram = state.programs.find(p => p.id === selectedProgram.id);
                                if (currentProgram) {
                                    currentProgram.exercises = currentProgram.exercises.filter(ex => ex.id !== exercise.id);
                                }
                            }

                            queueProgramExercisesSave(selectedProgram.id, selectedProgram.exercises, {
                                errorMessage: 'Не удалось сохранить изменения тренировки'
                            });
                            render();
                        });
                    });
                    setRow.append(deleteSetBtn);

                    setsContainer.append(setRow);
                    setIndex = gEnd + 1;
                }
            }

            // Кнопки под подходами (добавить подход, комментарий к упражнению + индикаторы медиа)
            const addSetBtn = createElement('button', 'add-set-btn');
            addSetBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 14 14"><title>Add-1-solid SVG Icon</title><path fill="currentColor" fill-rule="evenodd" d="M8 1a1 1 0 0 0-2 0v5H1a1 1 0 0 0 0 2h5v5a1 1 0 1 0 2 0V8h5a1 1 0 1 0 0-2H8z" clip-rule="evenodd"></path></svg><span>добавить подход</span>';

            addSetBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const currentExercise = selectedProgram.exercises.find(ex => ex.id === exercise.id);
                currentExercise.sets = currentExercise.sets || [];

                if (currentExercise.sets.length === 0) {
                    currentExercise.sets.push({ weight: '', reps: '', isMain: false });
                    queueProgramExercisesSave(selectedProgram.id, selectedProgram.exercises, { errorMessage: 'Не удалось сохранить изменения тренировки' });
                    render();
                    return;
                }

                // Новая модалка дублирования
                openDuplicateSetModal("Дублировать предыдущий подход?", async () => {
                    const lastSet = currentExercise.sets[currentExercise.sets.length - 1];
                    currentExercise.sets.push({
                        weight: lastSet.weight || '',
                        reps: lastSet.reps || '',
                        isMain: lastSet.isMain || false,
                        continuation: false
                    });
                    queueProgramExercisesSave(selectedProgram.id, selectedProgram.exercises, { errorMessage: 'Не удалось сохранить изменения тренировки' });
                    render();
                }, async () => {
                    currentExercise.sets.push({ weight: '', reps: '', isMain: false });
                    queueProgramExercisesSave(selectedProgram.id, selectedProgram.exercises, { errorMessage: 'Не удалось сохранить изменения тренировки' });
                    render();
                });
            });



            const bottomButtons = createElement('div', 'exercise-bottom-buttons');
            bottomButtons.style.display = 'flex';
            bottomButtons.style.gap = '6px';
            bottomButtons.append(addSetBtn);
            if (editNoteBtn) bottomButtons.append(editNoteBtn);
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
                    mediaContainer.style.gap = '8px';
                    mediaContainer.style.marginTop = '10px';

                    exercise.media.forEach(file => {
                        if (file.type === 'photo') {
                            const img = createElement('img');
                            applyOfflineMediaSource(img, file.url, 'photo');
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
                            applyOfflineMediaSource(videoThumb, file.url, 'video');
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
<svg xmlns="http://www.w3.org/2000/svg" version="1.1" xmlns:xlink="http://www.w3.org/1999/xlink" id="Иконка 7" viewBox="0 0 17 12">
  <g>
    <path fill="none" fill-rule="evenodd" d="M6.5,12.39 L6.5,12.39 L6.44,12.4 L6.43,12.4 L6.43,12.4 L6.38,12.39 C6.38,12.37 6.38,12.39 6.37,12.39 L6.37,12.39 L6.36,12.64 L6.37,12.65 L6.37,12.65 L6.43,12.7 L6.44,12.7 L6.44,12.7 L6.51,12.65 L6.51,12.65 L6.52,12.64 L6.51,12.39 C6.51,12.39 6.5,12.39 6.5,12.39 M6.65,12.31 L6.65,12.31 L6.53,12.37 L6.53,12.37 L6.53,12.39 L6.53,12.62 L6.54,12.64 L6.54,12.64 L6.66,12.69 C6.68,12.7 6.68,12.7 6.69,12.69 L6.69,12.68 L6.66,12.32 C6.66,12.32 6.66,12.31 6.65,12.31 M6.23,12.31 C6.23,12.31 6.22,12.31 6.22,12.32 L6.22,12.32 L6.19,12.68 C6.19,12.69 6.2,12.69 6.2,12.7 L6.22,12.69 L6.34,12.64 L6.35,12.64 L6.35,12.62 L6.35,12.39 L6.35,12.37 L6.35,12.37 Z"/>
  </g>
  <g>
    <path fill="none" fill-rule="evenodd" d="M6.44,12.09 L6.44,12.09 L6.39,12.1 L6.38,12.1 L6.38,12.1 L6.34,12.09 C6.34,12.08 6.34,12.09 6.31,12.09 L6.31,12.09 L6.3,12.34 L6.31,12.36 L6.31,12.36 L6.38,12.4 L6.39,12.4 L6.39,12.4 L6.46,12.36 L6.46,12.36 L6.47,12.34 L6.46,12.09 C6.46,12.09 6.44,12.09 6.44,12.09 M6.6,12.02 L6.6,12.02 L6.48,12.08 L6.48,12.08 L6.48,12.09 L6.48,12.32 L6.49,12.34 L6.49,12.34 L6.61,12.39 C6.63,12.4 6.63,12.4 6.63,12.39 L6.63,12.38 L6.61,12.03 C6.61,12.03 6.61,12.02 6.6,12.02 M6.18,12.02 C6.18,12.02 6.17,12.02 6.17,12.03 L6.17,12.03 L6.15,12.38 C6.15,12.39 6.16,12.39 6.16,12.4 L6.17,12.39 L6.29,12.34 L6.29,12.34 L6.29,12.32 L6.29,12.09 L6.29,12.08 L6.29,12.08 Z"/>
    <g>
      <path fill="none" fill-rule="evenodd" d="M6.35,12.48 L6.35,12.48 L6.29,12.51 L6.28,12.51 L6.28,12.51 L6.24,12.48 C6.24,12.47 6.24,12.48 6.23,12.48 L6.23,12.48 L6.22,12.74 L6.23,12.75 L6.23,12.75 L6.28,12.8 L6.29,12.8 L6.29,12.8 L6.36,12.75 L6.36,12.75 L6.37,12.74 L6.36,12.48 C6.36,12.48 6.35,12.48 6.35,12.48 M6.51,12.41 L6.51,12.41 L6.38,12.47 L6.38,12.47 L6.38,12.48 L6.38,12.73 L6.39,12.74 L6.39,12.74 L6.52,12.79 C6.54,12.8 6.54,12.8 6.55,12.79 L6.55,12.78 L6.52,12.43 C6.52,12.43 6.52,12.41 6.51,12.41 M6.08,12.41 C6.08,12.41 6.06,12.41 6.06,12.43 L6.06,12.43 L6.04,12.78 C6.04,12.79 6.05,12.79 6.05,12.8 L6.06,12.79 L6.18,12.74 L6.2,12.74 L6.2,12.73 L6.2,12.48 L6.2,12.47 L6.2,12.47 Z"/>
    </g>
  </g>
  <g>
    <path fill="none" fill-rule="evenodd" d="M5.3,10.73 L5.3,10.73 L5.26,10.75 L5.26,10.75 L5.25,10.75 L5.21,10.73 C5.21,10.73 5.21,10.73 5.2,10.74 L5.2,10.74 L5.19,10.95 L5.2,10.96 L5.2,10.96 L5.25,11 L5.26,11 L5.26,11 L5.31,10.96 L5.32,10.95 L5.32,10.95 L5.31,10.74 C5.31,10.74 5.31,10.73 5.3,10.73 M5.43,10.68 L5.42,10.68 L5.34,10.72 L5.33,10.73 L5.33,10.73 L5.34,10.94 L5.34,10.95 L5.35,10.95 L5.44,10.99 C5.45,11 5.45,11 5.46,10.99 L5.46,10.98 L5.44,10.69 C5.44,10.68 5.44,10.68 5.43,10.68 M5.09,10.68 C5.08,10.68 5.08,10.68 5.08,10.68 L5.07,10.69 L5.06,10.98 C5.06,10.99 5.06,10.99 5.06,11 L5.07,10.99 L5.17,10.95 L5.17,10.95 L5.17,10.94 L5.18,10.73 L5.18,10.73 L5.18,10.72 Z"/>
    <path fill="currentColor" fill-rule="evenodd" d="M11.31,9.45 C11.56,9.2 11.99,9.19 12.26,9.41 C12.53,9.65 12.56,10.04 12.35,10.33 L12.28,10.4 L11.25,11.39 C10.4,12.2 9.04,12.2 8.19,11.39 C7.92,11.11 7.47,11.1 7.18,11.32 L7.1,11.39 L6.75,11.74 C6.49,11.98 6.08,11.98 5.81,11.76 C5.53,11.52 5.47,11.11 5.72,10.84 L5.78,10.79 L6.12,10.46 C6.95,9.64 8.31,9.64 9.17,10.46 C9.44,10.72 9.89,10.74 10.21,10.5 L10.26,10.46 Z M10.04,.58 C10.72,-.05 11.78,-.06 12.46,.55 C13.12,1.16 13.19,2.19 12.58,2.86 L12.49,2.94 L4.49,10.65 C4.39,10.74 4.27,10.83 4.14,10.86 L4.04,10.92 L2.07,11.44 C1.84,11.51 1.59,11.46 1.42,11.3 C1.26,11.14 1.18,10.92 1.21,10.69 L1.22,10.61 L1.78,8.73 C1.82,8.59 1.89,8.47 1.98,8.37 L2.04,8.29 Z M11.68,1.19 C11.56,1.08 11.23,1.1 11.1,1.19 L10.67,1.46 L2.89,8.93 L2.31,10.33 L3.76,9.91 L11.82,2.15 C11.96,2.03 11.96,1.86 11.96,1.46"/>
  </g>
</svg>
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
        applyOfflineMediaSource(img, file.url, 'photo');
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
        videoThumb.onclick = () => openMediaFullScreen(file.url, 'video');
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
            // ?????? END


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
        await replacePlannedTrainingWithCompleted(db, journalCollection, todayStr, trainingRecord);
        showToast('Тренировка сохранена в дневнике!');
        const legacyOrigin = state.programDetailsOrigin;
        state.programDetailsOrigin = null;
        state.currentPage = legacyOrigin === 'journal' ? 'journal' : 'programsInCycle';
        state.selectedProgramIdForDetails = null;
        state.expandedExerciseId = null;
        render();
        return;

        // 🧹 Проверяем, есть ли на сегодня запланированная тренировка — если есть, удаляем
        const q = query(
          journalCollection,
          where("date", "==", todayStr),
          where("isPlanned", "==", true)
        );
        const qSnap = await getDocs(q);

        for (const docSnap of qSnap.docs) {
          console.log("🗑 Удаляю запланированную тренировку на сегодня:", docSnap.id);
          console.debug('legacy journal cleanup skipped', docSnap.id);
        }

        // 💾 Теперь сохраняем завершённую тренировку
        const legacyCompletedRecord = ({
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
    setupProgramDetailsTopBarTitleSync();



}


// =================================================================
// Добавляем универсальную функцию full-screen просмотра
// =================================================================


// ✅ Универсальная функция full-screen медиа (фото или видео)
export function openMediaFullScreen(url, type = 'photo') {
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
        applyOfflineMediaSource(img, url, 'photo');
        img.style.maxWidth = '90%';
        img.style.maxHeight = '90%';
        img.style.borderRadius = '10px';
        img.style.boxShadow = '0 0 20px rgba(255,255,255,0.2)';
        overlay.appendChild(img);
    }

    // Если видео
    if (type === 'video') {
        const video = document.createElement('video');
        applyOfflineMediaSource(video, url, 'video');
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
    const modalContent = createElement('div', `modal-content modal-add-exercise modal-simple-form ${MODAL_TEXT_INPUT_CLASS}`);
    prepareKeyboardDockedModal(modal, modalContent);

    const title = createElement('h3', 'modal-simple-form__title', 'Новое упражнение');

    const input = createElement('input', 'modal-input');
    input.placeholder = 'Название упражнения';
    const descriptionInput = createElement('input', 'modal-input');
    descriptionInput.placeholder = 'Уточнение';

    const btnGroup = createElement('div', 'modal-buttons');

    const cancelBtn = createElement('button', 'btn cancel-btn', 'Отмена');
    const saveBtn = createElement('button', 'btn btn-primary', 'Добавить');

    cancelBtn.addEventListener('click', () => {
        document.body.removeChild(modal);
    });

    saveBtn.addEventListener('click', async () => {
        const name = input.value.trim();
        if (!name) return showToast('Введите название упражнения!');

        const description = descriptionInput.value.trim();
        const newExercise = {
            id: Date.now().toString(),
            name,
            description,
            sets: [{ weight: '', reps: '' }],
            note: ''
        };
        program.exercises = program.exercises || [];
        program.exercises.push(newExercise);

        queueProgramExercisesSave(program.id, program.exercises, { errorMessage: 'Не удалось сохранить изменения тренировки' });
        document.body.removeChild(modal);
        render();
    });

    btnGroup.append(cancelBtn, saveBtn);
    modalContent.append(title, input, descriptionInput, btnGroup);
    modal.append(modalContent);
    presentKeyboardDockedModal(modal, modalContent);

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
            queueProgramExercisesSave(program.id, program.exercises, { errorMessage: 'Не удалось сохранить изменения тренировки' });
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
  // ✏️ Модалка редактирования названия упражнения
  // =================================================================
  function openEditExerciseModal(selectedProgram, exercise) {
      const overlay = createElement('div', 'modal-overlay');
      overlay.addEventListener('click', (e) => {
          if (e.target === overlay) document.body.removeChild(overlay);
      });

      const modal = createElement('div', `modal-content modal-compact modal-edit-exercise-name modal-simple-form ${MODAL_TEXT_INPUT_CLASS}`);
      prepareKeyboardDockedModal(overlay, modal);

      const title = createElement('h3', 'modal-simple-form__title', 'Редактировать упражнение');

      const nameInput = createElement('input', 'modal-input');
      nameInput.type = 'text';
      nameInput.value = exercise.name;
      const descriptionInput = createElement('input', 'modal-input');
      descriptionInput.type = 'text';
      descriptionInput.placeholder = 'Уточнение';
      descriptionInput.value = String(exercise.description || '');

      const controls = createElement('div', 'modal-buttons');
      const cancel = createElement('button', 'btn cancel-btn', 'Отмена');
      const save = createElement('button', 'btn btn-primary', 'Изменить');

      cancel.addEventListener('click', () => {
          document.body.removeChild(overlay);
      });

      save.addEventListener('click', async () => {
          const nextName = nameInput.value.trim();
          if (!nextName) {
              showToast('Введите название');
              return;
          }

          exercise.name = nextName;
          exercise.description = descriptionInput.value.trim();
          queueProgramExercisesSave(selectedProgram.id, selectedProgram.exercises, {
              errorMessage: 'Не удалось сохранить изменения тренировки'
          });
          showToast('Обновлено');
          document.body.removeChild(overlay);
          render();
      });

      controls.append(cancel, save);
      modal.append(title, nameInput, descriptionInput, controls);
      overlay.appendChild(modal);
      presentKeyboardDockedModal(overlay, modal);
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
let cleanupProgramDetailsTopBarTitleSync = null;
let cleanupJournalRecordDetailsTopBarTitleSync = null;

function cleanupFloatingTimer() {
    if (timerObserver) {
        try { timerObserver.disconnect(); } catch(_) {}
        timerObserver = null;
    }
}

function teardownProgramDetailsTopBarTitleSync() {
    if (typeof cleanupProgramDetailsTopBarTitleSync === 'function') {
        try { cleanupProgramDetailsTopBarTitleSync(); } catch (_) {}
    }
    cleanupProgramDetailsTopBarTitleSync = null;
}

function teardownJournalRecordDetailsTopBarTitleSync() {
    if (typeof cleanupJournalRecordDetailsTopBarTitleSync === 'function') {
        try { cleanupJournalRecordDetailsTopBarTitleSync(); } catch (_) {}
    }
    cleanupJournalRecordDetailsTopBarTitleSync = null;
}

function setupProgramDetailsTopBarTitleSync() {
    teardownProgramDetailsTopBarTitleSync();

    if (state.currentPage !== 'programDetails') return;

    const rootScroll = document.getElementById('root');
    const topBar = document.querySelector('.top-bar.top-bar--program-details');
    const pageBlock = document.getElementById('program-details-content');
    const barTitle = topBar?.querySelector('.top-bar-program-title');
    const pageTitle = document.querySelector('#program-details-content > h3.program-details-page-title');
    if (!rootScroll || !topBar || !pageBlock || !barTitle || !pageTitle) return;

    let frameId = 0;
    const EPS = 0.5;

    const update = () => {
        frameId = 0;

        const topBarRect = topBar.getBoundingClientRect();
        const pageBlockRect = pageBlock.getBoundingClientRect();
        const pageTitleRect = pageTitle.getBoundingClientRect();
        const overlapPx = topBarRect.bottom - pageBlockRect.top;
        const titleSwapThreshold = Math.max(22, Math.round((pageTitleRect.height || 44) / 2));
        const shouldShowBorder = overlapPx > EPS;
        const shouldSwapTitles = overlapPx >= titleSwapThreshold;

        barTitle.style.opacity = shouldSwapTitles ? '1' : '0';
        pageTitle.style.opacity = shouldSwapTitles ? '0' : '1';
        topBar.classList.toggle('top-bar-stuck-border', shouldShowBorder);
    };

    const requestUpdate = () => {
        if (frameId) return;
        frameId = window.requestAnimationFrame(update);
    };

    barTitle.style.opacity = '0';
    pageTitle.style.opacity = '1';
    topBar.classList.remove('top-bar-stuck-border');

    rootScroll.addEventListener('scroll', requestUpdate, { passive: true });
    window.addEventListener('resize', requestUpdate);

    requestUpdate();

    cleanupProgramDetailsTopBarTitleSync = () => {
        if (frameId) {
            window.cancelAnimationFrame(frameId);
            frameId = 0;
        }
        rootScroll.removeEventListener('scroll', requestUpdate);
        window.removeEventListener('resize', requestUpdate);
        barTitle.style.opacity = '0';
        pageTitle.style.opacity = '1';
        topBar.classList.remove('top-bar-stuck-border');
    };
}

function setupJournalRecordDetailsTopBarTitleSync() {
    teardownJournalRecordDetailsTopBarTitleSync();

    if (state.currentPage !== 'journal' || !state.selectedJournalRecord) return;

    const rootScroll = document.getElementById('root');
    const topBar = document.querySelector('.top-bar.top-bar--journal-record-details');
    const headerBlock = document.querySelector('.journal-record-details .record-header');
    const barTitle = topBar?.querySelector('.top-bar-program-title');
    const deleteBtn = topBar?.querySelector('.top-delete-btn');
    const headerTitleGroup = headerBlock?.querySelector('.title-del');
    if (!rootScroll || !topBar || !headerBlock || !barTitle || !headerTitleGroup || !deleteBtn) return;

    let frameId = 0;
    const EPS = 0.5;
    const titleSwapThreshold = 25;

    const update = () => {
        frameId = 0;

        const topBarRect = topBar.getBoundingClientRect();
        const headerRect = headerBlock.getBoundingClientRect();
        const overlapPx = topBarRect.bottom - headerRect.top;
        const shouldShowBorder = overlapPx > EPS;
        const shouldSwapTitles = overlapPx >= titleSwapThreshold;

        barTitle.style.opacity = shouldSwapTitles ? '1' : '0';
        headerTitleGroup.style.opacity = shouldSwapTitles ? '0' : '1';
        deleteBtn.style.opacity = shouldSwapTitles ? '0' : '1';
        deleteBtn.style.pointerEvents = shouldSwapTitles ? 'none' : 'auto';
        topBar.classList.toggle('top-bar-stuck-border', shouldShowBorder);
    };

    const requestUpdate = () => {
        if (frameId) return;
        frameId = window.requestAnimationFrame(update);
    };

    barTitle.style.opacity = '0';
    headerTitleGroup.style.opacity = '1';
    deleteBtn.style.opacity = '1';
    deleteBtn.style.pointerEvents = 'auto';
    topBar.classList.remove('top-bar-stuck-border');

    rootScroll.addEventListener('scroll', requestUpdate, { passive: true });
    window.addEventListener('resize', requestUpdate);

    requestUpdate();

    cleanupJournalRecordDetailsTopBarTitleSync = () => {
        if (frameId) {
            window.cancelAnimationFrame(frameId);
            frameId = 0;
        }
        rootScroll.removeEventListener('scroll', requestUpdate);
        window.removeEventListener('resize', requestUpdate);
        barTitle.style.opacity = '0';
        headerTitleGroup.style.opacity = '1';
        deleteBtn.style.opacity = '1';
        deleteBtn.style.pointerEvents = 'auto';
        topBar.classList.remove('top-bar-stuck-border');
    };
}

function closeSelectedJournalRecordDetails() {
    state.selectedJournalRecord = null;
    render();
}

function deleteSelectedJournalRecordFromDetails() {
    const record = state.journal.find(r => r.id === state.selectedJournalRecord);
    if (!record) {
        state.selectedJournalRecord = null;
        render();
        return;
    }

    openConfirmModal('Удалить эту тренировку?', async () => {
        try {
            await deleteJournalRecord(getUserJournalCollection(), record.id);
            showToast('Тренировка удалена');
            state.selectedJournalRecord = null;
            render();
        } catch (error) {
            console.error(error);
            showToast('Ошибка удаления');
        }
    });
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
    const cycles = sortCyclesForAccessUi(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
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
          applyCycleSelection(foundCycle);
          console.log("📘 Автовыбран личный цикл по ближайшей дате:", foundCycle.name, best.date);
        }
      }
    } else if (cycles.length > 0) {
      const lastCycle = cycles[cycles.length - 1];
      applyCycleSelection(lastCycle);
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
    let linkedAccess = null;

    if (linkedUid) {
      const linkedAccessSnap = await getDoc(getLinkedTrainerDocRef(linkedUid, uid));
      if (linkedAccessSnap.exists()) {
        linkedAccess = normalizeTrainerCycleAccessSettings(linkedAccessSnap.data());
      }
    }

    const byId = new Map();
    if (linkedUid) {
      const clientCyclesRef = collection(db, "artifacts", appId, "users", linkedUid, "cycles");
      const snapC = await getDocs(clientCyclesRef);
      for (const d of snapC.docs) {
        const cycleData = { id: d.id, ...d.data(), _firesAtClient: true };
        if (trainerAccessAllowsCycle(linkedAccess, cycleData.id)) {
          byId.set(d.id, cycleData);
        }
      }
    } else {
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
      for (const d of snapT.docs) {
        byId.set(d.id, { id: d.id, ...d.data(), _firesAtClient: false });
      }
    }
    const cycles = sortCyclesForAccessUi(Array.from(byId.values()));
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
          applyCycleSelection(foundCycle);
          console.log("📘 Автовыбран цикл по ближайшей дате:", foundCycle.name, best.date);
        }
      }
    } else if (cycles.length > 0) {
      const lastCycle = cycles[cycles.length - 1];
      applyCycleSelection(lastCycle);
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

// Циклы и связанные данные теперь загружаются только через attachCycleDataListeners()/setupDynamicListeners().
// Старый одноразовый loadUserCycles/loadClientCycles здесь убран, чтобы не было гонки между
// getDocs-подгрузкой и snapshot-потоком, из-за которой экран циклов периодически показывал пустой список.






if (state.currentMode === 'personal' && !state.selectedClientId) {
  // Если в персональном режиме клиент не выбран
  const msg = createElement('div', 'muted', 'Сначала выберите клиента для отображения календаря.');
  root.append(msg);
  return;
}

const visibleJournalRecords = filterJournalRecordsForVisibleCycles(state.journal);
if (!state.selectedJournalCategory && visibleJournalRecords.length > 0) {
  // Фильтруем только релевантные записи
  const relevantRecords = visibleJournalRecords.filter(r => {
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
        // В журнале не трогаем глобальный selectedCycleId — только локальный фильтр
        state.selectedJournalCategory = foundCycle.name;
        console.log('✅ Автовыбран цикл (только для фильтра журнала):', foundCycle.name);
      } else {
        console.warn('⚠️ Цикл из последней тренировки не найден:', lastRelevant.cycleName);
      }
    }
  }
}

    // В журнале selectedJournalCategory — это фильтр, он не обязан совпадать с глобальным selectedCycleId.

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
    let calendarRecords = visibleJournalRecords;

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
const cycleLabelIcon = createElement('span', 'active-filter-label', 'Цикл:');
const cycleLabelText = createElement('span', 'cycle-label-text',
    state.selectedJournalCategory || 'Цикл не выбран'
);
const cycleArrow = createCycleLabelArrow();
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
        visibleJournalRecords
            .filter(r => r.cycleName === state.selectedJournalCategory)
            .map(r => r.programName)
            .filter(Boolean)
    )];

    const activeFilterRow = createElement('div', 'active-filter-row');
    const activeFilterLabel = createElement('span', 'active-filter-label', 'Тренировка:');
    const activeFilterValue = createElement('span', 'active-filter-value' + (!state.selectedJournalProgram ? ' all' : ''),
        state.selectedJournalProgram || 'Все'
    );
    const filterArrow = createCycleLabelArrow();
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
let journalCalendarSuppressTapUntil = 0;
let detachTrainingDropdownOutsideClose = null;

function getJournalCalendarMonthDate() {
    if (state.calendarYear === undefined) {
        const today = new Date();
        state.calendarYear = today.getFullYear();
        state.calendarMonth = today.getMonth();
    }

    return new Date(state.calendarYear, state.calendarMonth, 1);
}

function setJournalCalendarMonthDate(monthDate) {
    state.calendarYear = monthDate.getFullYear();
    state.calendarMonth = monthDate.getMonth();
}

function addJournalCalendarMonths(monthDate, offset) {
    return new Date(monthDate.getFullYear(), monthDate.getMonth() + offset, 1);
}

function getJournalCalendarMonthTitle(monthDate) {
    const monthNames = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
    return `${monthNames[monthDate.getMonth()]} ${monthDate.getFullYear()}`;
}

function changeJournalCalendarMonth(direction) {
    const nextMonthDate = addJournalCalendarMonths(getJournalCalendarMonthDate(), direction);
    setJournalCalendarMonthDate(nextMonthDate);
    render();
}

function suppressJournalCalendarCellTap() {
    journalCalendarSuppressTapUntil = Date.now() + 340;
}

function shouldSuppressJournalCalendarCellTap() {
    return Date.now() < journalCalendarSuppressTapUntil;
}

function removeTrainingDropdown({ suppressTap = false } = {}) {
    const dropdown = document.querySelector('.training-dropdown');
    if (dropdown) dropdown.remove();

    if (typeof detachTrainingDropdownOutsideClose === 'function') {
        detachTrainingDropdownOutsideClose();
        detachTrainingDropdownOutsideClose = null;
    }

    if (suppressTap) suppressJournalCalendarCellTap();
}

function bindTrainingDropdownOutsideClose(dropdown) {
    if (!dropdown) return;

    if (typeof detachTrainingDropdownOutsideClose === 'function') {
        detachTrainingDropdownOutsideClose();
        detachTrainingDropdownOutsideClose = null;
    }

    const handleOutsidePointerDown = (event) => {
        if (!dropdown.isConnected) {
            if (typeof detachTrainingDropdownOutsideClose === 'function') {
                detachTrainingDropdownOutsideClose();
                detachTrainingDropdownOutsideClose = null;
            }
            return;
        }

        if (dropdown.contains(event.target)) return;
        removeTrainingDropdown({ suppressTap: true });
    };

    document.addEventListener('pointerdown', handleOutsidePointerDown, true);
    detachTrainingDropdownOutsideClose = () => {
        document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
    };
}

function syncJournalCalendarLayout(container, viewport, track) {
    const activePage = track?.children?.[1];
    if (!container || !viewport || !activePage) return;

    const weeksCount = Number.parseInt(activePage.dataset.weeksCount || '', 10);
    const safeWeeksCount = Number.isFinite(weeksCount) && weeksCount > 0 ? weeksCount : 6;
    syncBottomNavClearanceVar();

    const journalRoot = document.getElementById('journal-content');
    const filters = journalRoot?.querySelector('.journal-filters');

    const filtersH = filters?.getBoundingClientRect?.().height || 0;
    journalRoot?.style?.setProperty?.('--journal-filters-height', `${Math.round(filtersH)}px`);

    const containerTop = container.getBoundingClientRect().top || 0;
    const gapBeforeFilters = 18;

    // Самый надёжный способ (особенно на iOS): ограничиваем календарь фактическим верхом фиксированных фильтров.
    // Тогда нижний ряд дней физически не сможет уйти "под" `journal-filters`.
    let available = 0;
    const filtersTop = filters?.getBoundingClientRect?.().top;
    if (Number.isFinite(filtersTop) && filtersTop > 0) {
        // Небольшой зазор между календарём и fixed-блоком фильтров
        // Чуть больше буфера, чтобы нижний ряд дней никогда не заходил под фильтры
        available = Math.max(0, Math.floor(filtersTop - containerTop - gapBeforeFilters));
    } else {
        // Fallback: считаем от высоты viewport (на случай, если фильтры ещё не в DOM / не измерились).
        const vvHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        const bottomNavOccupied = typeof readCssPxVar === 'function' ? readCssPxVar('--bottom-nav-occupied', 82) : 82;
        const bottomNavGap = typeof readCssPxVar === 'function' ? readCssPxVar('--bottom-nav-gap', 10) : 10;
        // -19px тот же буфер, что и в основном пути (через filtersTop)
        available = Math.max(0, Math.floor(vvHeight - containerTop - bottomNavOccupied - bottomNavGap - filtersH - gapBeforeFilters));
    }

    const calendarHeader = container.querySelector('.calendar-header');
    const weekHeader = container.querySelector('.calendar-row.header');
    const headerBlockH = (calendarHeader?.getBoundingClientRect?.().height || 0) + (weekHeader?.getBoundingClientRect?.().height || 0);

    // Заполняем всё доступное пространство до `journal-filters` (не перекрывая фикс-блок).
    const targetCalendarHeight = Math.max(220, Math.floor(available));
    container.style.height = `${targetCalendarHeight}px`;

    const viewportH = Math.max(180, Math.floor(targetCalendarHeight - Math.round(headerBlockH)));
    viewport.style.height = `${viewportH}px`;

    const cellH = Math.max(38, Math.floor(viewportH / safeWeeksCount));
    container.style.setProperty('--journal-calendar-cell-height', `${cellH}px`);
}

function attachJournalCalendarSwipe(viewport, track) {
    let startX = 0;
    let startY = 0;
    let currentX = 0;
    let currentY = 0;
    let panAxis = null;
    let isDragging = false;
    let isAnimating = false;
    const animationDuration = 220;
    const swipeThreshold = 40;

    const animateTo = (direction) => {
        if (isAnimating) return;
        isAnimating = true;
        track.style.transition = `transform ${animationDuration}ms ease`;

        if (direction === 'next') {
            track.style.transform = 'translate3d(-200%, 0, 0)';
            navigator.vibrate?.(8);
            setTimeout(() => changeJournalCalendarMonth(1), animationDuration);
            return;
        }

        if (direction === 'prev') {
            track.style.transform = 'translate3d(0%, 0, 0)';
            navigator.vibrate?.(8);
            setTimeout(() => changeJournalCalendarMonth(-1), animationDuration);
            return;
        }

        track.style.transform = 'translate3d(-100%, 0, 0)';
        setTimeout(() => {
            isAnimating = false;
        }, animationDuration);
    };

    viewport.addEventListener('touchstart', (event) => {
        if (isAnimating || !event.touches?.length) return;
        const touch = event.touches[0];
        startX = touch.clientX;
        startY = touch.clientY;
        currentX = startX;
        currentY = startY;
        panAxis = null;
        isDragging = true;
        track.style.transition = 'none';
    }, { passive: true });

    viewport.addEventListener('touchmove', (event) => {
        if (!isDragging || isAnimating || !event.touches?.length) return;

        const touch = event.touches[0];
        const diffX = touch.clientX - startX;
        const diffY = touch.clientY - startY;
        currentX = touch.clientX;
        currentY = touch.clientY;

        if (!panAxis) {
            panAxis = resolveSwipePanAxis(diffX, diffY);
            if (panAxis == null) return;
            if (panAxis === 'y') {
                isDragging = false;
                track.style.transition = `transform ${animationDuration}ms ease`;
                track.style.transform = 'translate3d(-100%, 0, 0)';
                return;
            }
        }

        if (panAxis !== 'x') return;
        if (event.cancelable) event.preventDefault();

        const width = viewport.offsetWidth || 1;
        const percent = (diffX / width) * 100;
        track.style.transform = `translate3d(calc(-100% + ${percent}%), 0, 0)`;
    }, { passive: false });

    viewport.addEventListener('touchend', () => {
        const wasHorizontalSwipe = panAxis === 'x';
        panAxis = null;
        if (!isDragging || isAnimating) return;
        isDragging = false;

        const diffX = currentX - startX;

        if (wasHorizontalSwipe) {
            suppressJournalCalendarCellTap();
        }

        if (diffX <= -swipeThreshold) {
            animateTo('next');
            return;
        }

        if (diffX >= swipeThreshold) {
            animateTo('prev');
            return;
        }

        animateTo('current');
    });

    viewport.addEventListener('touchcancel', () => {
        panAxis = null;
        isDragging = false;
        if (!isAnimating) {
            track.style.transition = `transform ${animationDuration}ms ease`;
            track.style.transform = 'translate3d(-100%, 0, 0)';
        }
    });
}

function renderCalendar(container, journalRecords) {
    container.innerHTML = '';

    const monthDate = getJournalCalendarMonthDate();
    const calendarHeader = createElement('div', 'calendar-header');

    const prevBtn = createElement('button', 'calendar-nav-btn');
    prevBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M13.83 19a1 1 0 0 1-.78-.37l-4.83-6a1 1 0 0 1 0-1.27l5-6a1 1 0 0 1 1.54 1.28L10.29 12l4.32 5.36a1 1 0 0 1-.78 1.64"/></svg>`;
    prevBtn.addEventListener('click', () => changeJournalCalendarMonth(-1));

    const nextBtn = createElement('button', 'calendar-nav-btn');
    nextBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="currentColor" d="M10 19a1 1 0 0 1-.64-.23a1 1 0 0 1-.13-1.41L13.71 12L9.39 6.63a1 1 0 0 1 .15-1.41a1 1 0 0 1 1.46.15l4.83 6a1 1 0 0 1 0 1.27l-5 6A1 1 0 0 1 10 19"/></svg>`;
    nextBtn.addEventListener('click', () => changeJournalCalendarMonth(1));

    const title = createElement('div', 'calendar-title', getJournalCalendarMonthTitle(monthDate));

    calendarHeader.append(prevBtn, title, nextBtn);
    container.append(calendarHeader);

    const daysOfWeek = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
    const headerRow = createElement('div', 'calendar-row header');
    daysOfWeek.forEach(d => headerRow.append(createElement('div', 'calendar-cell header-cell', d)));
    container.append(headerRow);

    const viewport = createElement('div', 'calendar-months-viewport');
    const track = createElement('div', 'calendar-months-track');
    track.style.transform = 'translate3d(-100%, 0, 0)';

    [-1, 0, 1].forEach((offset) => {
        const page = createElement('div', 'calendar-month-page');
        renderJournalCalendarMonthPage(page, addJournalCalendarMonths(monthDate, offset), journalRecords);
        track.append(page);
    });

    viewport.append(track);
    attachJournalCalendarSwipe(viewport, track);
    container.append(viewport);
    requestAnimationFrame(() => syncJournalCalendarLayout(container, viewport, track));

    if (viewport.dataset.journalCalendarLayoutBound !== '1') {
        viewport.dataset.journalCalendarLayoutBound = '1';
        const resync = () => syncJournalCalendarLayout(container, viewport, track);
        window.addEventListener('resize', resync, { passive: true });
        window.addEventListener('orientationchange', resync, { passive: true });
    }

}

function renderJournalCalendarMonthPage(page, monthDate, journalRecords) {
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const startOffset = (firstDay.getDay() + 6) % 7;
    const totalDays = lastDay.getDate();
    page.dataset.weeksCount = String(Math.ceil((startOffset + totalDays) / 7));
    const now = new Date();
    const grid = createElement('div', 'calendar-grid');

    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(7, 1fr)';

    // Дни предыдущего месяца (видимые "пустышки" с датами)
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    for (let i = 0; i < startOffset; i++) {
        const dayNum = prevMonthLastDay - startOffset + 1 + i;
        const cell = createElement('div', 'calendar-cell other-month');
        cell.innerHTML = `<div class="day-number">${dayNum}</div>`;
        grid.append(cell);
    }

    for (let day = 1; day <= totalDays; day++) {
        const dateStr = `${String(day).padStart(2, '0')}.${String(month + 1).padStart(2, '0')}.${year}`;
        const dayRecords = journalRecords.filter((record) => record.date === dateStr);
        const cell = createElement('div', 'calendar-cell');
        cell.dataset.date = dateStr;
        cell.innerHTML = `<div class="day-number">${day}</div>`;

        if (day === now.getDate() && month === now.getMonth() && year === now.getFullYear()) {
            cell.classList.add('today');
        }

        if (dayRecords.length > 0) {
            if (dayRecords.some((record) => record.isPlanned)) cell.classList.add('planned');
            if (dayRecords.some((record) => !record.isPlanned)) cell.classList.add('has-training');

            const label = createElement('div', 'training-label', dayRecords.map((record) => record.programName).join(', '));
            cell.append(label);

            const openJournalDayRecord = async () => {
                if (shouldSuppressJournalCalendarCellTap()) return;

                const record = dayRecords[0];
                if (!record.isPlanned) {
                    state.selectedJournalRecord = record.id;
                    state.currentPage = 'journal';
                    render();
                    return;
                }

                const cycle = state.cycles.find((cycleItem) => cycleItem.name === record.cycleName);
                // Журнал не меняет глобальный цикл. Для открытия запланированной тренировки
                // требуется, чтобы глобально выбран был нужный цикл (на странице циклов).
                if (cycle && state.selectedCycleId !== cycle.id) {
                    showToast('Чтобы открыть запланированную тренировку, выберите нужный цикл на странице «Циклы»');
                    state.currentPage = 'programs';
                    render();
                    return;
                }

                await openPlannedTraining(record);
            };

            cell.addEventListener('click', async (event) => {
                event.stopPropagation();
                await openJournalDayRecord();
            });

            let longPressTimer = null;
            let isLongPress = false;
            let touchMoved = false;
            let touchStartX = 0;
            let touchStartY = 0;

            cell.addEventListener('touchstart', (event) => {
                if (shouldSuppressJournalCalendarCellTap()) return;
                // Не глушим события: свайп месяца должен работать даже если палец на ячейке с тренировкой.

                const touch = event.touches?.[0];
                touchStartX = touch?.clientX || 0;
                touchStartY = touch?.clientY || 0;
                touchMoved = false;
                isLongPress = false;

                longPressTimer = setTimeout(() => {
                    isLongPress = true;
                    openConfirmModal(
                        `Удалить запланированную тренировку "${dayRecords[0].programName}"?`,
                        async () => {
                            await deleteJournalRecord(getUserJournalCollection(), dayRecords[0].id);
                            showToast('Тренировка удалена!');
                            render();
                        }
                    );
                }, 800);
            }, { passive: true });

            cell.addEventListener('touchmove', (event) => {
                const touch = event.touches?.[0];
                if (!touch) return;
                if (Math.abs(touch.clientX - touchStartX) > 10 || Math.abs(touch.clientY - touchStartY) > 10) {
                    touchMoved = true;
                    clearTimeout(longPressTimer);
                    longPressTimer = null;
                }
            }, { passive: true });

            cell.addEventListener('touchend', async (event) => {
                clearTimeout(longPressTimer);
                longPressTimer = null;
                if (touchMoved || isLongPress || shouldSuppressJournalCalendarCellTap()) return;
                await openJournalDayRecord();
            });

            cell.addEventListener('touchcancel', () => {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            });
        } else {
            cell.addEventListener('click', () => {
                if (shouldSuppressJournalCalendarCellTap()) return;
                openPlanTrainingDropdown(cell, dateStr);
            });
        }

        grid.append(cell);
    }

    // Дни следующего месяца (добиваем сетку до полных недель)
    const totalCells = startOffset + totalDays;
    const remainder = totalCells % 7;
    const trailing = remainder === 0 ? 0 : 7 - remainder;
    for (let i = 1; i <= trailing; i++) {
        const cell = createElement('div', 'calendar-cell other-month');
        cell.innerHTML = `<div class="day-number">${i}</div>`;
        grid.append(cell);
    }

    page.append(grid);
}




// ------------------------------------------------
// 📌 Меню планирования тренировки в пустой ячейке
// ------------------------------------------------

function openPlanTrainingDropdown(cell, dateStr) {
    removeTrainingDropdown();

    // 1️⃣ Определяем выбранный цикл (по названию из select-display)
    let currentCycleName = state.selectedJournalCategory;
    let currentCycle = state.cycles.find(c => c.name === currentCycleName);

    // 2️⃣ Если цикл найден — при расхождении id с активным циклом обновляем подписки
    if (currentCycle) {
        applyCycleSelection(currentCycle, {
            reloadData: state.selectedCycleId !== currentCycle.id
        });
    }

    // 3️⃣ Если всё ещё нет ID → предупреждаем
    if (!state.selectedCycleId) {
        showToast('Сначала выберите цикл');
        return;
    }

    // ✅ Тянем программы из Firestore для этого цикла:
    getDocs(getUserProgramsCollection()).then(programsSnap => {
        const stateProgramOrder = new Map(state.programs.map((program, index) => [program.id, index]));
        const programList = programsSnap.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        })).sort((a, b) => {
            const aOrder = typeof a.order === 'number' && Number.isFinite(a.order) ? a.order : Number.POSITIVE_INFINITY;
            const bOrder = typeof b.order === 'number' && Number.isFinite(b.order) ? b.order : Number.POSITIVE_INFINITY;
            if (aOrder !== bOrder) return aOrder - bOrder;

            const aStateOrder = stateProgramOrder.get(a.id) ?? Number.POSITIVE_INFINITY;
            const bStateOrder = stateProgramOrder.get(b.id) ?? Number.POSITIVE_INFINITY;
            if (aStateOrder !== bStateOrder) return aStateOrder - bStateOrder;

            return String(a.name || '').localeCompare(String(b.name || ''), 'ru');
        });

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
                await createJournalRecord(getUserJournalCollection(), {
                    date: dateStr,
                    cycleName: currentCycleName,
                    programName: program.name,
                    programId: program.id,
                    isPlanned: true,
                    exercises: []
                });
                removeTrainingDropdown();
                showToast('Тренировка запланирована!');
            });
            dropdown.append(li);
        });

        document.body.append(dropdown);
        bindTrainingDropdownOutsideClose(dropdown);
         // ✅ 4. Умное позиционирование (вниз/вверх если не помещается)
            smartPositionDropdown(dropdown, cell);

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
    removeTrainingDropdown();

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
                // Не меняем глобальный цикл из журнала.
                // Если глобально выбран другой цикл — просим выбрать нужный на странице «Циклы».
                if (state.selectedCycleId !== cycle.id) {
                    showToast('Чтобы открыть запланированную тренировку, выберите нужный цикл на странице «Циклы»');
                    state.currentPage = 'programs';
                    render();
                    return;
                }

                // Глобальный цикл уже выбран верно — просто открываем программы в цикле.
                state.currentPage = 'programsInCycle';
                state.lastProgramsPage = 'programsInCycle';

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
                    await deleteJournalRecord(getUserJournalCollection(), rec.id);  // Удаление записи из дневника
                }
                showToast('План удалён');
                removeTrainingDropdown();
                render(); // Обновляем страницу после удаления
            }
        });
        dropdown.append(deleteLi);
    }

    // Показываем в DOM
    document.body.append(dropdown);
    bindTrainingDropdownOutsideClose(dropdown);

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
    // Не переключаем глобальный цикл из журнала.
    // Запланированную тренировку можно открыть только если глобально выбран нужный цикл.
    if (cycle && state.selectedCycleId !== cycle.id) {
        showToast('Чтобы открыть запланированную тренировку, выберите нужный цикл на странице «Циклы»');
        state.currentPage = 'programs';
        render();
        return;
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
export function openDateModal(currentDate, onSave, options = {}) {
  return openCustomDateModal(currentDate, onSave, options);
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
const DATE_MODAL_MONTH_NAMES = [
    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
];
const DATE_MODAL_WEEKDAY_SHORT_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function parseDateModalSource(dateStr) {
    if (typeof dateStr !== 'string' || !dateStr.trim()) {
        const today = new Date();
        return new Date(today.getFullYear(), today.getMonth(), today.getDate());
    }

    if (/^\d{2}\.\d{2}\.\d{4}$/.test(dateStr)) {
        const [day, month, year] = dateStr.split('.').map(Number);
        return new Date(year, month - 1, day);
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const [year, month, day] = dateStr.split('-').map(Number);
        return new Date(year, month - 1, day);
    }

    const parsed = new Date(dateStr);
    if (!Number.isNaN(parsed.getTime())) {
        return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
    }

    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), today.getDate());
}

function formatDateModalIso(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatDateModalHuman(date) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${day}.${month}.${date.getFullYear()}`;
}

function getDateModalMonthStart(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addDateModalMonths(date, delta) {
    return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

function isSameDateModalDay(dateA, dateB) {
    return (
        dateA.getFullYear() === dateB.getFullYear() &&
        dateA.getMonth() === dateB.getMonth() &&
        dateA.getDate() === dateB.getDate()
    );
}

function isSameDateModalMonth(dateA, dateB) {
    return (
        dateA.getFullYear() === dateB.getFullYear() &&
        dateA.getMonth() === dateB.getMonth()
    );
}

function getDateModalMonthMatrix(monthDate) {
    const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const startWeekday = (firstDay.getDay() + 6) % 7;
    const gridStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1 - startWeekday);
    const cells = [];

    for (let index = 0; index < 42; index += 1) {
        const cellDate = new Date(gridStart);
        cellDate.setDate(gridStart.getDate() + index);
        cells.push(cellDate);
    }

    return cells;
}

function getDateModalMonthTitle(date) {
    return `${DATE_MODAL_MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

function openCustomDateModal(currentDate, onSave, options = {}) {
    const initialDate = parseDateModalSource(currentDate);
    const today = parseDateModalSource(formatDateModalIso(new Date()));
    let selectedDate = new Date(initialDate.getFullYear(), initialDate.getMonth(), initialDate.getDate());
    let visibleMonth = getDateModalMonthStart(selectedDate);
    const requireConfirm = options?.requireConfirm === true;
    const confirmLabel = options?.confirmLabel || 'Изменить дату';

    {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay modal-overlay--date-picker';

        const modal = document.createElement('div');
        modal.className = 'date-modal-sheet';

        const header = document.createElement('div');
        header.className = 'date-modal-header';

        const eyebrow = document.createElement('span');
        eyebrow.className = 'date-modal-eyebrow';
        eyebrow.textContent = 'Изменение даты';

        const title = document.createElement('h3');
        title.className = 'date-modal-title';
        title.textContent = 'Выбери дату';

        const selectedValue = document.createElement('div');
        selectedValue.className = 'date-modal-selected-value';
        header.append(eyebrow, title, selectedValue);

        const monthNav = document.createElement('div');
        monthNav.className = 'date-modal-month-nav';

        const prevBtn = document.createElement('button');
        prevBtn.type = 'button';
        prevBtn.className = 'date-modal-nav-btn date-modal-nav-btn--prev';
        prevBtn.setAttribute('aria-label', 'Предыдущий месяц');
        prevBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M14.53 5.47a.75.75 0 0 1 0 1.06L9.06 12l5.47 5.47a.75.75 0 1 1-1.06 1.06l-6-6a.75.75 0 0 1 0-1.06l6-6a.75.75 0 0 1 1.06 0"/></svg>';

        const monthTitle = document.createElement('div');
        monthTitle.className = 'date-modal-month-title';

        const nextBtn = document.createElement('button');
        nextBtn.type = 'button';
        nextBtn.className = 'date-modal-nav-btn date-modal-nav-btn--next';
        nextBtn.setAttribute('aria-label', 'Следующий месяц');
        nextBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M9.47 18.53a.75.75 0 0 1 0-1.06L14.94 12L9.47 6.53a.75.75 0 1 1 1.06-1.06l6 6a.75.75 0 0 1 0 1.06l-6 6a.75.75 0 0 1-1.06 0"/></svg>';

        monthNav.append(prevBtn, monthTitle, nextBtn);

        const weekdayRow = document.createElement('div');
        weekdayRow.className = 'date-modal-weekdays';
        DATE_MODAL_WEEKDAY_SHORT_NAMES.forEach((weekdayName) => {
            const weekday = document.createElement('span');
            weekday.className = 'date-modal-weekday';
            weekday.textContent = weekdayName;
            weekdayRow.append(weekday);
        });

        const calendarBody = document.createElement('div');
        calendarBody.className = 'date-modal-calendar-body';

        const monthsViewport = document.createElement('div');
        monthsViewport.className = 'date-modal-months-viewport';

        const monthsTrack = document.createElement('div');
        monthsTrack.className = 'date-modal-months-track';
        monthsViewport.append(monthsTrack);
        calendarBody.append(weekdayRow, monthsViewport);

        const quickActions = document.createElement('div');
        quickActions.className = 'date-modal-quick-actions';

        const todayBtn = document.createElement('button');
        todayBtn.type = 'button';
        todayBtn.className = 'date-modal-today-btn';
        todayBtn.textContent = 'Сегодня';
        quickActions.append(todayBtn);

        const actions = document.createElement('div');
        actions.className = 'date-modal-actions';

        const confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.className = 'btn date-modal-action-btn date-modal-action-btn--save';
        confirmBtn.textContent = confirmLabel;
        actions.append(confirmBtn);

        modal.append(header, monthNav, calendarBody, quickActions);
        if (requireConfirm) {
            modal.append(actions);
        }
        overlay.append(modal);
        document.body.append(overlay);

        let suppressDayTapUntil = 0;

        function syncConfirmButtonState() {
            if (!requireConfirm) return;
            const hasChanged = !isSameDateModalDay(selectedDate, initialDate);
            confirmBtn.disabled = !hasChanged;
            confirmBtn.setAttribute('aria-disabled', hasChanged ? 'false' : 'true');
        }

        function closeModal(result = null) {
            document.removeEventListener('keydown', handleKeydown);
            overlay.classList.remove('visible');
            setTimeout(() => {
                overlay.remove();
                onSave(result);
            }, 200);
        }

        function handleKeydown(event) {
            if (event.key === 'Escape') {
                closeModal(null);
            }
        }

        function buildMonthPage(monthDate) {
            const page = document.createElement('div');
            page.className = 'date-modal-month-page';

            const pageGrid = document.createElement('div');
            pageGrid.className = 'date-modal-grid';

            getDateModalMonthMatrix(monthDate).forEach((cellDate) => {
                const dayBtn = document.createElement('button');
                dayBtn.type = 'button';
                dayBtn.className = 'date-modal-day';
                dayBtn.textContent = String(cellDate.getDate());

                if (!isSameDateModalMonth(cellDate, monthDate)) {
                    dayBtn.classList.add('is-outside');
                }
                if (isSameDateModalDay(cellDate, today)) {
                    dayBtn.classList.add('is-today');
                }
                if (isSameDateModalDay(cellDate, selectedDate)) {
                    dayBtn.classList.add('is-selected');
                }

                dayBtn.addEventListener('click', () => {
                    if (Date.now() < suppressDayTapUntil) {
                        return;
                    }
                    selectedDate = new Date(cellDate.getFullYear(), cellDate.getMonth(), cellDate.getDate());
                    visibleMonth = getDateModalMonthStart(selectedDate);
                    if (requireConfirm) {
                        renderTriplet();
                        return;
                    }
                    closeModal(formatDateModalIso(selectedDate));
                });

                pageGrid.append(dayBtn);
            });

            page.append(pageGrid);
            return page;
        }

        function renderTriplet() {
            selectedValue.textContent = formatDateModalHuman(selectedDate);
            monthTitle.textContent = getDateModalMonthTitle(visibleMonth);
            syncConfirmButtonState();
            todayBtn.style.display = isSameDateModalDay(selectedDate, today) ? 'none' : 'inline-flex';

            monthsTrack.replaceChildren(
                buildMonthPage(addDateModalMonths(visibleMonth, -1)),
                buildMonthPage(visibleMonth),
                buildMonthPage(addDateModalMonths(visibleMonth, 1))
            );
            monthsTrack.style.transition = 'none';
            monthsTrack.style.transform = 'translate3d(-100%, 0, 0)';
            requestAnimationFrame(() => {
                monthsTrack.style.transition = 'transform 220ms ease';
            });
        }

        function shiftMonth(delta) {
            visibleMonth = addDateModalMonths(visibleMonth, delta);
            renderTriplet();
            try {
                navigator.vibrate?.(8);
            } catch (_) {}
        }

        prevBtn.addEventListener('click', () => shiftMonth(-1));
        nextBtn.addEventListener('click', () => shiftMonth(1));

        todayBtn.addEventListener('click', () => {
            selectedDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
            visibleMonth = getDateModalMonthStart(selectedDate);
            if (requireConfirm) {
                renderTriplet();
                return;
            }
            closeModal(formatDateModalIso(selectedDate));
        });

        if (requireConfirm) {
            confirmBtn.addEventListener('click', () => {
                closeModal(formatDateModalIso(selectedDate));
            });
        }

        attachMonthCarouselSwipe(monthsViewport, monthsTrack, {
            animationDuration: 220,
            swipeThreshold: 40,
            onCommitNext: () => {
                visibleMonth = addDateModalMonths(visibleMonth, 1);
                renderTriplet();
            },
            onCommitPrev: () => {
                visibleMonth = addDateModalMonths(visibleMonth, -1);
                renderTriplet();
            },
            onHorizontalSwipeEnd: () => {
                suppressDayTapUntil = Date.now() + 280;
            }
        });

        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) {
                closeModal(null);
            }
        });

        document.addEventListener('keydown', handleKeydown);
        renderTriplet();
        requestAnimationFrame(() => overlay.classList.add('visible'));
        return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay modal-overlay--date-picker';

    const modal = document.createElement('div');
    modal.className = 'date-modal-sheet';

    const header = document.createElement('div');
    header.className = 'date-modal-header';

    const eyebrow = document.createElement('span');
    eyebrow.className = 'date-modal-eyebrow';
    eyebrow.textContent = 'Изменение даты';

    const title = document.createElement('h3');
    title.className = 'date-modal-title';
    title.textContent = 'Выбери дату';

    const selectedValue = document.createElement('div');
    selectedValue.className = 'date-modal-selected-value';
    header.append(eyebrow, title, selectedValue);

    const monthNav = document.createElement('div');
    monthNav.className = 'date-modal-month-nav';

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'date-modal-nav-btn date-modal-nav-btn--prev';
    prevBtn.setAttribute('aria-label', 'Предыдущий месяц');
    prevBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M14.53 5.47a.75.75 0 0 1 0 1.06L9.06 12l5.47 5.47a.75.75 0 1 1-1.06 1.06l-6-6a.75.75 0 0 1 0-1.06l6-6a.75.75 0 0 1 1.06 0"/></svg>';

    const monthTitle = document.createElement('div');
    monthTitle.className = 'date-modal-month-title';

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'date-modal-nav-btn date-modal-nav-btn--next';
    nextBtn.setAttribute('aria-label', 'Следующий месяц');
    nextBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M9.47 18.53a.75.75 0 0 1 0-1.06L14.94 12L9.47 6.53a.75.75 0 1 1 1.06-1.06l6 6a.75.75 0 0 1 0 1.06l-6 6a.75.75 0 0 1-1.06 0"/></svg>';

    monthNav.append(prevBtn, monthTitle, nextBtn);

    const weekdayRow = document.createElement('div');
    weekdayRow.className = 'date-modal-weekdays';
    DATE_MODAL_WEEKDAY_SHORT_NAMES.forEach((weekdayName) => {
        const weekday = document.createElement('span');
        weekday.className = 'date-modal-weekday';
        weekday.textContent = weekdayName;
        weekdayRow.append(weekday);
    });

    const calendarBody = document.createElement('div');
    calendarBody.className = 'date-modal-calendar-body';

    const grid = document.createElement('div');
    grid.className = 'date-modal-grid';
    calendarBody.append(weekdayRow, grid);

    const quickActions = document.createElement('div');
    quickActions.className = 'date-modal-quick-actions';

    const todayBtn = document.createElement('button');
    todayBtn.type = 'button';
    todayBtn.className = 'date-modal-today-btn';
    todayBtn.textContent = 'Сегодня';
    quickActions.append(todayBtn);

    const actions = document.createElement('div');
    actions.className = 'date-modal-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn date-modal-action-btn date-modal-action-btn--cancel';
    cancelBtn.textContent = 'Отмена';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'btn date-modal-action-btn date-modal-action-btn--save';
    saveBtn.textContent = 'Сохранить';

    actions.append(cancelBtn, saveBtn);
    modal.append(header, monthNav, calendarBody, quickActions);
    overlay.append(modal);
    document.body.append(overlay);

    const swipeState = {
        startX: 0,
        startY: 0,
        deltaX: 0,
        deltaY: 0,
        active: false,
        panAxis: null,
        suppressClickUntil: 0
    };

    function shiftMonth(delta) {
        visibleMonth = addDateModalMonths(visibleMonth, delta);
        renderCalendar();
        try {
            navigator.vibrate?.(8);
        } catch (_) {}
    }

    function renderCalendar() {
        selectedValue.textContent = formatDateModalHuman(selectedDate);
        monthTitle.textContent = getDateModalMonthTitle(visibleMonth);
        grid.innerHTML = '';

        getDateModalMonthMatrix(visibleMonth).forEach((cellDate) => {
            const dayBtn = document.createElement('button');
            dayBtn.type = 'button';
            dayBtn.className = 'date-modal-day';
            dayBtn.textContent = String(cellDate.getDate());

            if (!isSameDateModalMonth(cellDate, visibleMonth)) {
                dayBtn.classList.add('is-outside');
            }
            if (isSameDateModalDay(cellDate, today)) {
                dayBtn.classList.add('is-today');
            }
            if (isSameDateModalDay(cellDate, selectedDate)) {
                dayBtn.classList.add('is-selected');
            }

            dayBtn.addEventListener('click', () => {
                if (Date.now() < swipeState.suppressClickUntil) {
                    return;
                }
                selectedDate = new Date(cellDate.getFullYear(), cellDate.getMonth(), cellDate.getDate());
                closeModal(formatDateModalIso(selectedDate));
            });

            grid.append(dayBtn);
        });
    }

    function handleKeydown(event) {
        if (event.key === 'Escape') {
            closeModal(null);
        }
    }

    function cleanup() {
        document.removeEventListener('keydown', handleKeydown);
    }

    function closeModal(result = null) {
        cleanup();
        overlay.classList.remove('visible');
        setTimeout(() => {
            overlay.remove();
            onSave(result);
        }, 200);
    }

    prevBtn.addEventListener('click', () => {
        shiftMonth(-1);
    });

    nextBtn.addEventListener('click', () => {
        shiftMonth(1);
    });

    todayBtn.addEventListener('click', () => {
        selectedDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        closeModal(formatDateModalIso(selectedDate));
    });

    calendarBody.addEventListener('touchstart', (event) => {
        if (event.touches.length !== 1) return;
        const touch = event.touches[0];
        swipeState.startX = touch.clientX;
        swipeState.startY = touch.clientY;
        swipeState.deltaX = 0;
        swipeState.deltaY = 0;
        swipeState.active = true;
        swipeState.panAxis = null;
    }, { passive: true });

    calendarBody.addEventListener('touchmove', (event) => {
        if (!swipeState.active || event.touches.length !== 1) return;
        const touch = event.touches[0];
        swipeState.deltaX = touch.clientX - swipeState.startX;
        swipeState.deltaY = touch.clientY - swipeState.startY;

        if (!swipeState.panAxis) {
            swipeState.panAxis = resolveSwipePanAxis(swipeState.deltaX, swipeState.deltaY);
        }

        if (swipeState.panAxis === 'x') {
            event.preventDefault();
        }
    }, { passive: false });

    function finishSwipe() {
        if (!swipeState.active) return;
        const deltaX = swipeState.deltaX;
        const deltaY = swipeState.deltaY;
        const isHorizontal = swipeState.panAxis === 'x' && Math.abs(deltaX) > Math.abs(deltaY);

        swipeState.active = false;
        swipeState.panAxis = null;
        swipeState.deltaX = 0;
        swipeState.deltaY = 0;

        if (!isHorizontal || Math.abs(deltaX) < 36) {
            return;
        }

        swipeState.suppressClickUntil = Date.now() + 280;
        shiftMonth(deltaX < 0 ? 1 : -1);
    }

    calendarBody.addEventListener('touchend', finishSwipe);
    calendarBody.addEventListener('touchcancel', finishSwipe);
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
            closeModal(null);
        }
    });

    document.addEventListener('keydown', handleKeydown);
    renderCalendar();
    requestAnimationFrame(() => overlay.classList.add('visible'));
}

function renderJournalRecordDetails(container) {
    const record = state.journal.find(r => r.id === state.selectedJournalRecord);
    if (!record) {
        state.selectedJournalRecord = null;
        render();
        return;
    }

    container.className = 'journal-record-details';

    const goBack = () => {
        state.selectedJournalRecord = null;
        render();
    };

    const deleteTraining = () => {
        openConfirmModal('Удалить эту тренировку?', async () => {
            try {
                await deleteJournalRecord(getUserJournalCollection(), record.id);
                showToast('Тренировка удалена');
                state.selectedJournalRecord = null;
                render();
            } catch (error) {
                console.error(error);
                showToast('Ошибка удаления');
            }
        });
    };

    // Верхнее меню (как было): назад + удалить
    const menuRecord = createElement('div', 'menu-record');

    const backBtn = createElement('button', 'btn back-btn');
    backBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"><title>Ios-arrow-ltr-24-filled SVG Icon</title><path fill="currentColor" d="M12.727 3.687a1 1 0 1 0-1.454-1.374l-8.5 9a1 1 0 0 0 0 1.374l8.5 9.001a1 1 0 1 0 1.454-1.373L4.875 12z"></path></svg>';
    backBtn.addEventListener('click', goBack);

    const deleteBtn = createElement('button', 'btn delete-record-btn');
    deleteBtn.innerHTML = ' <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><title>Trash-24 SVG Icon</title><path fill="currentColor" d="M16 1.75V3h5.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H8V1.75C8 .784 8.784 0 9.75 0h4.5C15.216 0 16 .784 16 1.75m-6.5 0V3h5V1.75a.25.25 0 0 0-.25-.25h-4.5a.25.25 0 0 0-.25.25M4.997 6.178a.75.75 0 1 0-1.493.144L4.916 20.92a1.75 1.75 0 0 0 1.742 1.58h10.684a1.75 1.75 0 0 0 1.742-1.581l1.413-14.597a.75.75 0 0 0-1.494-.144l-1.412 14.596a.25.25 0 0 1-.249.226H6.658a.25.25 0 0 1-.249-.226z"></path><path fill="currentColor" d="M9.206 7.501a.75.75 0 0 1 .793.705l.5 8.5A.75.75 0 1 1 9 16.794l-.5-8.5a.75.75 0 0 1 .705-.793Zm6.293.793A.75.75 0 1 0 14 8.206l-.5 8.5a.75.75 0 0 0 1.498.088l.5-8.5Z"></path></svg> ';
    deleteBtn.addEventListener('click', deleteTraining);

    menuRecord.append(backBtn, deleteBtn);
    container.append(menuRecord);

    // Заголовок
// 🔹 Заголовок с редактированием даты
const titleWrapper = createElement('div', 'record-header');
const titleDel = createElement('div', 'title-del');
const dateEdit = createElement('div', 'date-edit');




let nameElement = createElement('span', 'record-name', `${record.programName}`);
let dateElement = createElement('span', 'record-date', `${record.date}`);
const editBtn = createElement('button', 'edit-date-btn');
editBtn.innerHTML =
        '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><title>Edit-settings-24-filled SVG Icon</title><path fill="currentColor" d="M15.891 3.048a3.578 3.578 0 1 1 5.061 5.06l-.892.893L15 3.94zM13.94 5.001L3.94 15a3.1 3.1 0 0 0-.825 1.476L2.02 21.078a.75.75 0 0 0 .904.903l4.601-1.096a3.1 3.1 0 0 0 1.477-.825l1.151-1.151a6.5 6.5 0 0 1 7.754-7.755L19 10.06zm-.662 8.975a2 2 0 0 1-1.441 2.497l-.584.144a5.7 5.7 0 0 0 .006 1.807l.54.13a2 2 0 0 1 1.45 2.51l-.187.632c.44.386.94.699 1.485.922l.493-.52a2 2 0 0 1 2.899.001l.499.525a5.3 5.3 0 0 0 1.482-.913l-.198-.686a2 2 0 0 1 1.442-2.496l.583-.144a5.7 5.7 0 0 0-.006-1.808l-.54-.13a2 2 0 0 1-1.449-2.51l.186-.63a5.3 5.3 0 0 0-1.484-.923l-.493.519a2 2 0 0 1-2.9 0l-.498-.525c-.544.22-1.044.53-1.483.912zm3.222 5.025c-.8 0-1.45-.672-1.45-1.5c0-.829.65-1.5 1.45-1.5s1.45.671 1.45 1.5c0 .828-.65 1.5-1.45 1.5"/></svg>';

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
      await updateJournalRecord(getUserJournalCollection(), record.id, { date: formatted });
      showToast('Дата обновлена!');
      render();
    } catch (e) {
      console.error(e);
      showToast('Ошибка обновления даты');
    }
  }, {
    requireConfirm: true,
    confirmLabel: 'Изменить дату'
  });
});





    // 🔹 Комментарий к тренировке + медиа
    if (record.comment || (record.trainingMedia?.length > 0)) {
        container.append(createElement('h3', 'training-comment-heading', 'Комментарий к тренировке'));

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
                    applyOfflineMediaSource(img, file.url, 'photo');
                    img.onclick = () => openPhotoFullScreen(file.url);
                    mediaWrap.append(img);
                } else {
                    const video = createElement('video', 'media-thumb');
                    applyOfflineMediaSource(video, file.url, 'video');
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
        const blockRegular = createElement('div', 'sets-line-block sets-line-block--regular');
        const blockMain = createElement('div', 'sets-line-block sets-line-block--main');

        const fullSets = exercise.sets || [];
        const setsRef = { sets: fullSets };
        let si = 0;
        while (si < fullSets.length) {
            if (!(fullSets[si].weight || fullSets[si].reps)) {
                si++;
                continue;
            }
            if (fullSets[si].continuation) {
                si++;
                continue;
            }
            const [gStart, gEnd] = __getDropSetGroupBounds(setsRef, si);
            const parts = [];
            for (let k = gStart; k <= gEnd; k++) {
                const sk = fullSets[k];
                if (sk.weight || sk.reps) parts.push(sk);
            }
            if (!parts.length) {
                si = gEnd + 1;
                continue;
            }
            const headSet = fullSets[gStart];
            const ord = __getApproachOrdinalForSet(fullSets, gStart);
            const isMainGroup = !!headSet.isMain;
            const hasExtraSetsInMain = isMainGroup && parts.length > 1;
            let chipClasses = 'set-item';
            if (isMainGroup) chipClasses += ' main-set';
            if (hasExtraSetsInMain) chipClasses += ' gap';
            const span = createElement('span', chipClasses);
            span.append(createElement('span', 'set-item__ord', `${ord}.`));
            parts.forEach((part, pi) => {
                if (pi > 0) span.append(createElement('span', 'set-item__compact-gap', ' · '));
                __appendJournalTrainingCompact(span, part.weight, part.reps);
            });
            if (isMainGroup) {
                blockMain.append(span);
            } else {
                blockRegular.append(span);
            }
            si = gEnd + 1;
        }

        if (blockRegular.childElementCount > 0) {
            const groupRegular = createElement('div', 'sets-line-group sets-line-group--regular');
            groupRegular.append(
                createElement('div', 'sets-line-group__title', 'Разминочные'),
                blockRegular
            );
            sets.append(groupRegular);
        }
        if (blockMain.childElementCount > 0) {
            const groupMain = createElement('div', 'sets-line-group sets-line-group--main');
            groupMain.append(
                createElement('div', 'sets-line-group__title', 'Рабочие'),
                blockMain
            );
            sets.append(groupMain);
        }

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
                    applyOfflineMediaSource(img, file.url, 'photo');
                    img.onclick = () => openPhotoFullScreen(file.url);
                    mediaWrap.append(img);
                } else {
                    const video = createElement('video', 'media-thumb');
                    applyOfflineMediaSource(video, file.url, 'video');
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
    setupJournalRecordDetailsTopBarTitleSync();
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
                 applyCycleSelection(cycle, { reloadData: true });
                 console.log('✅ Цикл выбран:', cycle.name);
                 document.body.removeChild(modal);
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
    applyOfflineMediaSource(fullImg, url, 'photo');
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
    applyOfflineMediaSource(fullImg, url, 'photo');
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
    linkedTrainerAccessUnsubscribe();
    cyclesTrainerBuffer = [];
    cyclesClientBuffer = [];

    const mergeCyclesAndMaybeRender = () => {
        mergeCyclesTrainerClientBuffers();
        if (['programs', 'programsInCycle', 'programDetails', 'journal', 'meal', 'reports', 'supplements'].includes(state.currentPage)) {
            render();
        }
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
            linkedTrainerAccessUnsubscribe();
        };
    } else if (state.currentMode === 'personal' && state.selectedClientId) {
        const linkedUid = getActiveLinkedClientUid();
        if (linkedUid) {
            cyclesUnsubscribeTrainer = () => {};
            cyclesTrainerBuffer = [];
            // До прихода ОБОИХ снимков (доступ + циклы) не мержим: иначе пустой merge
            // сбрасывает выбранный цикл через syncSelectedCycleAfterVisibilityChange и тренер
            // не может зайти в разрешённый цикл после applyCycleSelection → setupDynamicListeners.
            let linkedAccessSnapReceived = false;
            let clientCyclesSnapReceived = false;

            const mergeLinkedTrainerCyclesAndMaybeRender = () => {
                mergeCyclesTrainerClientBuffers();
                if (
                    ['programs', 'programsInCycle', 'programDetails', 'journal', 'meal', 'reports', 'supplements'].includes(
                        state.currentPage
                    )
                ) {
                    render();
                }
            };

            const tryMergeLinkedTrainerCycles = () => {
                if (!linkedAccessSnapReceived || !clientCyclesSnapReceived) return;
                mergeLinkedTrainerCyclesAndMaybeRender();
            };

            const linkedAccessRef = getLinkedTrainerDocRef(linkedUid, userId);
            linkedTrainerAccessUnsubscribe = onSnapshot(linkedAccessRef, (snapshot) => {
                state.selectedClientTrainerAccess = snapshot.exists()
                    ? normalizeTrainerCycleAccessSettings(snapshot.data())
                    : null;
                linkedAccessSnapReceived = true;
                tryMergeLinkedTrainerCycles();
            });

            const clientCanonRef = collection(db, `artifacts/${appId}/users/${linkedUid}/cycles`);
            cyclesUnsubscribeClient = onSnapshot(clientCanonRef, (snapshot) => {
                cyclesClientBuffer = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
                clientCyclesSnapReceived = true;
                tryMergeLinkedTrainerCycles();
            });
        } else {
            const trainerCardRef = collection(
                db,
                `artifacts/${appId}/users/${userId}/clients/${state.selectedClientId}/cycles`
            );
            cyclesUnsubscribeTrainer = onSnapshot(trainerCardRef, (snapshot) => {
                cyclesTrainerBuffer = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
                mergeCyclesAndMaybeRender();
            });
            linkedTrainerAccessUnsubscribe = () => {};
            cyclesUnsubscribeClient = () => {};
            cyclesClientBuffer = [];
        }
        cyclesUnsubscribe = () => {
            cyclesUnsubscribeTrainer();
            cyclesUnsubscribeClient();
            linkedTrainerAccessUnsubscribe();
        };
    } else {
        cyclesUnsubscribe = () => {};
        linkedTrainerAccessUnsubscribe = () => {};
        state.cycles = [];
    }

    const programsRef = getUserProgramsCollection();
    if (programsRef && state.selectedCycleId) {
        state.isProgramsLoading = true;
        programsUnsubscribe = onSnapshot(programsRef, (snapshot) => {
            const nextPrograms = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
            const hasOrder = nextPrograms.some((p) => typeof p.order === 'number' && Number.isFinite(p.order));
            state.programs = hasOrder
                ? nextPrograms.sort((a, b) => (a.order ?? Number.POSITIVE_INFINITY) - (b.order ?? Number.POSITIVE_INFINITY))
                : nextPrograms;
            state.isProgramsLoading = false;
            if (['programsInCycle', 'programDetails', 'supplements', 'journal', 'meal', 'reports'].includes(state.currentPage)) render();
        });
    } else {
        state.isProgramsLoading = false;
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

                    if (usedCycle && (!state.selectedCycleId || state.selectedCycleId !== usedCycle.id)) {
                        applyCycleSelection(usedCycle, { preserveJournalSelection: true });
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
                const rawPlan = {
                    supplements: Array.isArray(supplementPlan.supplements) ? supplementPlan.supplements : [],
                    data: Array.isArray(supplementPlan.data) ? supplementPlan.data : [],
                    doseMerges: Array.isArray(supplementPlan.doseMerges) ? supplementPlan.doseMerges : []
                };
                const { plan: nextPlan, changed } = sanitizeSupplementPlan(rawPlan);
                state.supplementPlan = nextPlan;
                syncSupplementsBottomNavBadge(nextPlan);
                const canPersistSupplementPlanCleanup =
                    state.currentMode === 'own'
                    || (state.currentMode === 'personal' && state.selectedClientId && !getActiveLinkedClientUid());

                if (changed && cycleRef && canPersistSupplementPlanCleanup) {
                    updateDoc(cycleRef, { supplementPlan: nextPlan }).catch((error) => {
                        console.error('Supplement plan cleanup failed:', error);
                    });
                }
                const nextSignature = getSupplementPlanSnapshotSignature(nextPlan);
                if (state._supplementsSkipNextRenderSignature === nextSignature) {
                    delete state._supplementsSkipNextRenderSignature;
                    return;
                }
                delete state._supplementsSkipNextRenderSignature;
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

function applyPendingAppleHealthSyncReturn() {
    const pending = state.appleHealthSyncReturn;
    if (!pending || pending._handled) return;
    if (pending.target !== 'mealBurned') return;
    if (!state.selectedCycleId) return;

    state.currentPage = 'meal';
    state.mealView = 'burnedSummary';
    if (pending.date) {
        state.mealBurnedSummaryDate = pending.date;
        state.selectedDate = pending.date;
    }
    pending._handled = true;
}

function unsubscribeAll() {
    programsUnsubscribe();
    journalUnsubscribe();
    clientsUnsubscribe();
    cyclesUnsubscribe();
    linkedTrainerAccessUnsubscribe();
    ownLinkedTrainersUnsubscribe();
    // 🔥 НОВЫЕ ОТПИСКИ
    supplementsUnsubscribe();
    reportsUnsubscribe();
}

function setupDynamicListeners() {
    unsubscribeAll();

    if (!userId) return;

    state.ownLinkedTrainersAccess = [];
    if (state.currentMode === 'own') {
        const linkedTrainersRef = collection(db, 'artifacts', appId, 'users', userId, 'linkedTrainers');
        ownLinkedTrainersUnsubscribe = onSnapshot(linkedTrainersRef, (snapshot) => {
            state.ownLinkedTrainersAccess = snapshot.docs
                .map((item) => normalizeTrainerCycleAccessSettings(item.data()))
                .filter((access) => access.active);
            if (state.currentPage === 'programs') render();
        });
    } else {
        ownLinkedTrainersUnsubscribe = () => {};
    }

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
    teardownProgramDetailsTopBarTitleSync();
    teardownJournalRecordDetailsTopBarTitleSync();
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
    if (state.currentPage === 'programDetails') {
        topBar.classList.add('top-bar--program-details');
    }
    if (state.currentPage === 'journal' && state.selectedJournalRecord) {
        topBar.classList.add('top-bar--journal-record-details');
    }


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
                    console.log('?? supplements');
                    openPdfDateModal(cycle);
                }

                if (state.currentPage === 'meal') {
                    console.log('?? meal');
                    openMealsPdfModal(cycle);
                }
            };

            if (state.currentPage === 'meal') {
                const summaryBtn = document.createElement('button');
                summaryBtn.type = 'button';
                summaryBtn.className = 'calendar-btn meal-kcal-summary-btn';
                summaryBtn.id = 'meal-kcal-summary-btn';
                summaryBtn.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><title>Round-graph-broken SVG Icon</title><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.5"><path d="M12 2c5.523 0 10 4.477 10 10c0 1.821-.487 3.53-1.338 5M5 4.859A9.97 9.97 0 0 0 2 12c0 5.523 4.477 10 10 10c1.821 0 3.53-.487 5-1.338"/><path d="M5 12c0 1.487.464 2.866 1.255 4M12 5a7 7 0 1 1-3 13.326"/><path d="M12 16a4 4 0 0 0 0-8"/></g></svg>
                `;
                summaryBtn.onclick = () => {
                    if (isOfflineModeActive()) {
                        showToast('Сводка активности доступна только онлайн. Подключитесь к интернету и повторите.');
                        return;
                    }
                    const now = new Date();
                    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
                    state.mealSummarySelectedDate = todayStr;
                    state.mealSummaryMonth = String(todayStr).slice(0, 7);
                    state.mealBurnedSummaryDate = null;
                    state.mealView = 'monthSummary';
                    renderMealPage();
                };

                const targetBtn = document.createElement('button');
                targetBtn.type = 'button';
                targetBtn.className = 'calendar-btn meal-target-btn';
                targetBtn.id = 'meal-target-btn';
                targetBtn.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><title>Target-arrow-16-regular SVG Icon</title><path fill="currentColor" d="M11.691 1.038A.5.5 0 0 1 12 1.5V4h2.5a.5.5 0 0 1 .354.854l-2 2A.5.5 0 0 1 12.5 7H9.707l-.74.741A1 1 0 0 1 8 9a1 1 0 0 1-1-1l.001-.046a1 1 0 0 1 1.258-.92L9 6.293V3.5a.5.5 0 0 1 .146-.354l2-2a.5.5 0 0 1 .545-.108M12.293 6l1-1H11.5a.5.5 0 0 1-.5-.5V2.707l-1 1V6zm1.652 1.176q.056.405.056.825a6 6 0 1 1-5.178-5.945l-.383.383a1.5 1.5 0 0 0-.354.562L8 3a5 5 0 1 0 5 4.914a1.5 1.5 0 0 0 .56-.353zM8 4.5A3.5 3.5 0 1 0 11.5 8h-1A2.5 2.5 0 1 1 8 5.5z"/></svg>
                `;
                targetBtn.onclick = () => {
                    state.mealView = 'goal';
                    renderMealPage();
                };
                wrap.append(pdfButton, summaryBtn, targetBtn);
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
        backBtn.innerHTML = TOPBAR_BACK_ARROW_MARKUP;
        backBtn.onclick = () => { state.currentPage = 'programs'; render(); };
        showBack = true;
    }

    if (state.currentPage === 'programDetails') {
        backBtn.innerHTML = TOPBAR_BACK_ARROW_MARKUP;
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
    }


    if (state.currentPage === 'journal' && state.selectedJournalRecord) {
        backBtn.innerHTML = TOPBAR_BACK_ARROW_MARKUP;
        backBtn.onclick = closeSelectedJournalRecordDetails;
        showBack = true;
    }

    if (showBack) topBar.appendChild(backBtn);

    // ------- ГАМБУРГЕР (ВСЕГДА СПРАВА) -------
    if (state.currentPage === 'programDetails' || (state.currentPage === 'journal' && state.selectedJournalRecord)) {
        let titleText = '';
        if (state.currentPage === 'programDetails') {
            const selectedProgram = state.programs.find(p => p.id === state.selectedProgramIdForDetails);
            titleText = selectedProgram?.name || '';
        } else {
            const selectedRecord = state.journal.find(r => r.id === state.selectedJournalRecord);
            titleText = selectedRecord?.programName || '';
        }

        const barTitle = document.createElement('div');
        barTitle.className = 'top-bar-program-title';
        barTitle.textContent = titleText;
        topBar.appendChild(barTitle);
    }

    if (state.currentPage === 'journal' && state.selectedJournalRecord) {
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'top-menu-btn top-delete-btn';
        deleteBtn.textContent = 'Удалить';
        deleteBtn.onclick = deleteSelectedJournalRecordFromDetails;
        topBar.appendChild(deleteBtn);
        root.prepend(topBar);
        setupFloatingTimer(topBar);
        return;
    }

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
        await performExplicitSignOut('Вы вышли.'); return;
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
const isViteDevServer = Boolean(import.meta?.env?.DEV);
const DEV_SW_RESET_FLAG = 'trainingDiary:devSwReset:v1';

async function syncWebServiceWorkerRegistration() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  if (isCapacitorNativePlatform()) return;

  try {
    if (isViteDevServer) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
      try {
        const cacheKeys = await window.caches?.keys?.();
        if (Array.isArray(cacheKeys) && cacheKeys.length) {
          await Promise.all(cacheKeys.map((key) => window.caches.delete(key)));
        }
      } catch (_) {}

      const hasController = Boolean(navigator.serviceWorker.controller);
      if (hasController && !window.sessionStorage?.getItem?.(DEV_SW_RESET_FLAG)) {
        try {
          window.sessionStorage?.setItem?.(DEV_SW_RESET_FLAG, '1');
        } catch (_) {}
        window.location.reload();
        return;
      }
      try {
        window.sessionStorage?.removeItem?.(DEV_SW_RESET_FLAG);
      } catch (_) {}
      console.log('Service Worker disabled in Vite dev mode');
      return;
    }
    await navigator.serviceWorker.register('./sw.js', { scope: './' });
    console.log('Service Worker registered');
    return;
    try {
      navigator.serviceWorker
        .register('./sw.js', { scope: './' })
        .then(() => console.log('✅ Service Worker зарегистрирован'))
        .catch((err) => console.error('Ошибка регистрации SW', err));
    } catch (err) {
      console.error('Ошибка регистрации SW', err);
    }
  } catch (err) {
    console.error('Service Worker registration failed', err);
  }
}

void syncWebServiceWorkerRegistration();

// =================================================================
// 🔄 ГЛАВНЫЙ РЕНДЕР: Определяет, что показать (ИСПРАВЛЕНО)
// =================================================================
let appViewportBindingsReady = false;
let keyboardBottomNavBindingsReady = false;
let lastKnownKeyboardInsetHeight = 0;
let lastKnownKeyboardViewportShift = 0;
let activeKeyboardShiftHost = null;
let activeKeyboardScrollHost = null;
let rootScrollLockFrameId = 0;
let rootScrollLockTimeoutId = 0;
let rootScrollLockBindingsReady = false;
let rootScrollLockObserver = null;
let lastKnownNativeStatusBarHeight = 0;
let authBootstrapRunId = 0;
function isMealOverlaySubpageActive() {
    return state.currentPage === 'meal' && Boolean(state.mealView && state.mealView !== 'main');
}

const MEAL_VIEWS_WITH_HIDDEN_NATIVE_STATUSBAR = new Set([
    'search',
    'quickAdd',
    'create',
    'recipe',
    'editFood',
    'editRecipe',
    'foodDetails',
    'recipeDetails',
    'recipeFoodSearch',
    'recipeFoodPreview',
    'monthSummary',
    'burnedSummary',
    'goal'
]);

function shouldHideNativeStatusBarForMealView() {
    if (state.currentPage !== 'meal') return false;
    return MEAL_VIEWS_WITH_HIDDEN_NATIVE_STATUSBAR.has(String(state.mealView || ''));
}

function isSupplementsDetailSubpageActive() {
    return state.currentPage === 'supplements' && Boolean(state.supplementCalendarDetailDate);
}

function shouldShowNativeStatusBarForCurrentView() {
    if (!userId || state.currentMode === null) return false;

    if (state.currentPage === 'auth' || state.currentPage === 'modeSelect') return false;
    if (state.currentPage === 'profile' || state.currentPage === 'journalRecordDetails') return false;
    if (state.currentPage === 'meal') {
        if (shouldHideNativeStatusBarForMealView()) return false;
        return !isMealOverlaySubpageActive();
    }
    if (state.currentPage === 'supplements') {
        if (isSupplementsTableViewActive()) return false;
        return !isSupplementsDetailSubpageActive();
    }

    return ['programs', 'programsInCycle', 'programDetails', 'journal', 'reports', 'cycleReport', 'mealsReport'].includes(state.currentPage);
}

function shouldApplyStandaloneTopGapForCurrentView() {
    if (state.currentPage === 'auth' || state.currentPage === 'modeSelect') return true;
    if (state.currentPage === 'journalRecordDetails') return true;
    if (shouldHideNativeStatusBarForMealView()) return true;
    if (isMealOverlaySubpageActive()) return true;
    if (isSupplementsTableViewActive()) return true;
    if (isSupplementsDetailSubpageActive()) return true;
    return false;
}

function syncAppChromeClasses() {
    const docEl = document.documentElement;
    const bodyEl = document.body;
    const isNativePlatform = isCapacitorNativePlatform();
    const shouldShowNativeStatusBar = shouldShowNativeStatusBarForCurrentView();
    const shouldApplyStandaloneTopGap = shouldApplyStandaloneTopGapForCurrentView();

    docEl.classList.toggle('app-capacitor-native', isNativePlatform);
    docEl.classList.toggle('app-native-statusbar-visible', shouldShowNativeStatusBar);
    docEl.classList.toggle('app-native-statusbar-hidden', !shouldShowNativeStatusBar);
    docEl.classList.toggle('app-standalone-top-gap', shouldApplyStandaloneTopGap);

    if (bodyEl) {
        bodyEl.classList.toggle('app-capacitor-native', isNativePlatform);
        bodyEl.classList.toggle('app-native-statusbar-visible', shouldShowNativeStatusBar);
        bodyEl.classList.toggle('app-native-statusbar-hidden', !shouldShowNativeStatusBar);
        bodyEl.classList.toggle('app-standalone-top-gap', shouldApplyStandaloneTopGap);
    }
}

async function syncNativeStatusBarMetrics(StatusBar) {
    if (!StatusBar?.getInfo) return;

    try {
        const info = await StatusBar.getInfo();
        const nextHeight = Number(info?.height || 0);
        if (Number.isFinite(nextHeight) && nextHeight > 0) {
            lastKnownNativeStatusBarHeight = nextHeight;
        }
    } catch (err) {
        console.error('StatusBar.getInfo error:', err);
    }

    const cssHeight = Math.max(0, Math.round(lastKnownNativeStatusBarHeight || 0));
    document.documentElement.style.setProperty('--native-statusbar-height', `${cssHeight}px`);
}

async function syncAppChrome() {
    syncAppChromeClasses();

    if (!isCapacitorNativePlatform()) {
        if (!lastKnownNativeStatusBarHeight) {
            document.documentElement.style.setProperty('--native-statusbar-height', '0px');
        }
        return;
    }

    try {
        const StatusBar = window.Capacitor?.Plugins?.StatusBar;
        if (!StatusBar) return;

        if (StatusBar.setOverlaysWebView) {
            await StatusBar.setOverlaysWebView({ overlay: true });
        }

        await syncNativeStatusBarMetrics(StatusBar);

        if (shouldShowNativeStatusBarForCurrentView()) {
            if (StatusBar.setStyle) {
                await StatusBar.setStyle({ style: 'LIGHT' });
            }
            await StatusBar.show({ animation: 'NONE' });
        } else {
            await StatusBar.hide({ animation: 'NONE' });
        }

        await syncNativeStatusBarMetrics(StatusBar);
    } catch (err) {
        console.error('StatusBar error:', err);
    }
}

let appChromeSyncQueued = false;

export function requestAppChromeSync() {
    if (appChromeSyncQueued) return;
    appChromeSyncQueued = true;

    requestAnimationFrame(() => {
        appChromeSyncQueued = false;
        void syncAppChrome();
        syncTopBarSyncStatusIndicator();
    });
}

function syncAppViewportHeightVar() {
    const viewportHeight = Math.round(
        window.innerHeight ||
        document.documentElement.clientHeight ||
        0
    );

    if (!viewportHeight) return;
    document.documentElement.style.setProperty('--app-height', `${viewportHeight}px`);
}

function readCssPxVar(name, fallback = 0) {
    try {
        const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
        const parsed = Number.parseFloat(String(raw || '').trim());
        return Number.isFinite(parsed) ? parsed : fallback;
    } catch (error) {
        return fallback;
    }
}

function syncBottomNavClearanceVar() {
    const nav = document.querySelector('.navigation');
    if (!nav) return;

    const navStyles = window.getComputedStyle?.(nav);
    if (navStyles?.display === 'none' || navStyles?.visibility === 'hidden') return;

    const navRect = nav.getBoundingClientRect();
    const viewportHeight = Math.round(
        window.innerHeight ||
        document.documentElement.clientHeight ||
        0
    );
    const safeBottom = readCssPxVar('--safe-bottom', 0);
    const extraPadding = 16; // небольшой зазор для контента над меню
    const occupiedFromBottom = Number.isFinite(navRect.top)
        ? Math.max(0, viewportHeight - navRect.top)
        : 0;
    const effectiveNavBlock = Math.max(navRect.height || 0, occupiedFromBottom);
    const clearance = Math.max(0, Math.round(effectiveNavBlock + safeBottom + extraPadding));
    if (!clearance) return;
    document.documentElement.style.setProperty('--bottom-nav-occupied', `${Math.max(0, Math.round(effectiveNavBlock))}px`);
    document.documentElement.style.setProperty('--bottom-nav-gap', '10px');
    document.documentElement.style.setProperty('--bottom-nav-clearance', `${clearance}px`);
}

function ensureAppViewportHeightBinding() {
    if (appViewportBindingsReady) return;

    const resyncAppViewportHeight = () => {
        syncAppViewportHeightVar();
        syncBottomNavClearanceVar();
    };
    resyncAppViewportHeight();

    window.addEventListener('resize', resyncAppViewportHeight);
    window.addEventListener('orientationchange', resyncAppViewportHeight);

    appViewportBindingsReady = true;
}

function isCapacitorIosPlatform() {
    const platform = String(window.Capacitor?.getPlatform?.() || '').toLowerCase();
    if (platform) return platform === 'ios';
    return isCapacitorNativePlatform() && /iPhone|iPad|iPod/i.test(window.navigator?.userAgent || '');
}

const KEYBOARD_MODAL_HOST_SELECTOR = [
    '.modal-set',
    '.modal-content',
    '.modal-cicle',
    '.modal-edit',
    '.supplement-edit-modal',
    '.supplement-delete-modal'
].join(', ');

const KEYBOARD_SHIFT_HOST_SELECTOR = [
    KEYBOARD_MODAL_HOST_SELECTOR,
    '.create-food-form-scroll-host--keyboard-padding-only',
    '.meal-overlay-subpage',
    '.meal-overlay-layer',
    '.modal-overlay-remove-edit',
    '.modal-overlay-edit',
    '.modal-overlay-exercise',
    '.modal-overlay-cicle',
    '.modal-overlay',
    '#auth-screen',
    '#mode-select-screen',
    '.container'
].join(', ');

const KEYBOARD_VIEWPORT_TARGET_SELECTOR = [
    '.modal-set-row',
    '.create-food-row',
].join(', ');

function clearKeyboardShiftHost(host) {
    if (!host) return;
    try {
        host.classList.remove('keyboard-viewport-shift-host');
        host.style.removeProperty('--keyboard-local-shift');
    } catch (_) {}
}

function resolveKeyboardShiftHost(node) {
    return node?.closest?.(KEYBOARD_SHIFT_HOST_SELECTOR) || null;
}

function resolveKeyboardViewportTarget(node) {
    return node?.closest?.(KEYBOARD_VIEWPORT_TARGET_SELECTOR) || node || null;
}

function shouldUseKeyboardPaddingOnlyHost(host) {
    return Boolean(
        host?.classList?.contains('create-food-form-page--keyboard-padding-only')
        || host?.classList?.contains('create-food-form-scroll-host--keyboard-padding-only')
    );
}

function isKeyboardModalHost(host) {
    return Boolean(host?.matches?.(KEYBOARD_MODAL_HOST_SELECTOR));
}

function isKeyboardDockedModalHost(host) {
    return Boolean(host?.classList?.contains('keyboard-docked-modal-host'));
}

function clearKeyboardScrollHost(host) {
    if (!host) return;
    try {
        host.classList.remove('keyboard-scroll-space-host');
        host.style.removeProperty('--keyboard-extra-scroll-space');
        host.style.removeProperty('--keyboard-scroll-space-base');
    } catch (_) {}
}

function setKeyboardScrollHost(host, extraScrollSpacePx = 0) {
    const nextExtra = Math.max(0, Math.round(Number(extraScrollSpacePx) || 0));

    if (activeKeyboardScrollHost && activeKeyboardScrollHost !== host) {
        clearKeyboardScrollHost(activeKeyboardScrollHost);
    }

    if (host && nextExtra > 0) {
        const storedBasePadding = Number.parseFloat(host.style.getPropertyValue('--keyboard-scroll-space-base') || '');
        const storedExtraPadding = Number.parseFloat(host.style.getPropertyValue('--keyboard-extra-scroll-space') || '');
        const computedPaddingBottom = Number.parseFloat(window.getComputedStyle?.(host)?.paddingBottom || '0') || 0;
        const basePadding = Math.max(
            0,
            Math.round(
                Number.isFinite(storedBasePadding)
                    ? storedBasePadding
                    : computedPaddingBottom - (Number.isFinite(storedExtraPadding) ? storedExtraPadding : 0)
            )
        );

        try {
            host.classList.add('keyboard-scroll-space-host');
            host.style.setProperty('--keyboard-extra-scroll-space', `${nextExtra}px`);
            host.style.setProperty('--keyboard-scroll-space-base', `${basePadding}px`);
        } catch (_) {}

        activeKeyboardScrollHost = host;
        return;
    }

    clearKeyboardScrollHost(activeKeyboardScrollHost);
    if (host && host !== activeKeyboardScrollHost) {
        clearKeyboardScrollHost(host);
    }
    activeKeyboardScrollHost = null;
}

function resolveKeyboardScrollHost(node, shiftHost = null) {
    if (shouldUseKeyboardPaddingOnlyHost(shiftHost)) {
        return shiftHost;
    }

    if (isKeyboardModalHost(shiftHost)) {
        return shiftHost;
    }

    let current = node?.parentElement || null;

    while (current && current !== document.body) {
        const styles = window.getComputedStyle?.(current);
        const overflowY = String(styles?.overflowY || '').toLowerCase();
        const canScroll =
            (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
            current.scrollHeight > current.clientHeight + 1;

        if (canScroll) return current;
        current = current.parentElement;
    }

    if (shiftHost?.matches?.('.container')) {
        return document.getElementById('root') || document.scrollingElement || document.documentElement;
    }

    return null;
}

function getKeyboardScrollHostContentBottom(scrollHost) {
    if (!scrollHost) return 0;

    const hostRect = scrollHost.getBoundingClientRect?.();
    const top = Number.isFinite(hostRect?.top) ? hostRect.top : 0;
    const scrollTop = Math.max(0, Number(scrollHost.scrollTop || 0));
    const scrollHeight = Math.max(0, Number(scrollHost.scrollHeight || 0));
    return top + scrollHeight - scrollTop;
}

function setKeyboardViewportShift(host, offsetPx, overlayHeightPx = lastKnownKeyboardInsetHeight) {
    const nextOffset = Math.max(0, Math.round(Number(offsetPx) || 0));
    const nextOverlayHeight = Math.max(0, Math.round(Number(overlayHeightPx) || 0));

    lastKnownKeyboardInsetHeight = nextOverlayHeight;

    if (activeKeyboardShiftHost && activeKeyboardShiftHost !== host) {
        clearKeyboardShiftHost(activeKeyboardShiftHost);
    }

    if (host && nextOffset > 0) {
        try {
            host.classList.add('keyboard-viewport-shift-host');
            host.style.setProperty('--keyboard-local-shift', `${nextOffset}px`);
        } catch (_) {}
        activeKeyboardShiftHost = host;
        lastKnownKeyboardViewportShift = nextOffset;
    } else {
        clearKeyboardShiftHost(activeKeyboardShiftHost);
        if (host && host !== activeKeyboardShiftHost) {
            clearKeyboardShiftHost(host);
        }
        activeKeyboardShiftHost = null;
        lastKnownKeyboardViewportShift = 0;
    }

    document.documentElement.style.setProperty('--keyboard-offset', `${nextOffset}px`);
    document.documentElement.style.setProperty('--keyboard-height', `${nextOverlayHeight}px`);
    document.body?.classList.toggle('app-keyboard-shift-active', nextOffset > 0);
}

function dispatchAppKeyboardViewportChange(visible, keyboardHeight = lastKnownKeyboardInsetHeight) {
    try {
        window.dispatchEvent(new CustomEvent('app-keyboardviewportchange', {
            detail: {
                visible: Boolean(visible),
                keyboardHeight: Math.max(0, Math.round(Number(keyboardHeight) || 0))
            }
        }));
    } catch (_) {}
}

function ensureNativeKeyboardBottomNavBinding() {
    if (keyboardBottomNavBindingsReady) return;
    keyboardBottomNavBindingsReady = true;

    if (!isCapacitorNativePlatform()) return;

    const Keyboard = window.Capacitor?.Plugins?.Keyboard;
    if (!Keyboard?.addListener) return;
    const useManualViewportShift = isCapacitorIosPlatform();
    let keyboardViewportSyncFrameId = 0;
    let keyboardHideFallbackTimer = 0;

    const clearKeyboardHideFallbackTimer = () => {
        if (!keyboardHideFallbackTimer) return;
        window.clearTimeout(keyboardHideFallbackTimer);
        keyboardHideFallbackTimer = 0;
    };

    const setKeyboardVisible = (visible, keyboardHeight = 0) => {
        if (visible) {
            clearKeyboardHideFallbackTimer();
        }
        document.body?.classList.toggle('app-keyboard-visible', Boolean(visible));
        if (useManualViewportShift && visible) {
            const nextKeyboardHeight = Math.max(0, Math.round(Number(keyboardHeight) || 0));
            lastKnownKeyboardInsetHeight = nextKeyboardHeight;
            document.documentElement.style.setProperty('--keyboard-height', `${nextKeyboardHeight}px`);
            dispatchAppKeyboardViewportChange(true, nextKeyboardHeight);
            return;
        }

        if (!visible || lastKnownKeyboardViewportShift || activeKeyboardShiftHost) {
            setKeyboardViewportShift(null, 0, 0);
        }
        if (!visible || activeKeyboardScrollHost) {
            setKeyboardScrollHost(null, 0);
        }
        dispatchAppKeyboardViewportChange(Boolean(visible), visible ? keyboardHeight : 0);
    };

    const scheduleKeyboardHideFallback = () => {
        clearKeyboardHideFallbackTimer();
        keyboardHideFallbackTimer = window.setTimeout(() => {
            keyboardHideFallbackTimer = 0;
            if (getFocusedKeyboardControl()) return;
            setKeyboardVisible(false, 0);
        }, 180);
    };

    const getFocusedKeyboardControl = () => {
        const active = document.activeElement;
        if (!active || active === document.body || active === document.documentElement) return null;
        if (!active.matches?.('input:not([type="hidden"]), textarea, select, [contenteditable="true"]')) return null;
        return active;
    };

    const requestFocusedKeyboardControlViewportSync = (keyboardHeight = lastKnownKeyboardInsetHeight) => {
        if (keyboardViewportSyncFrameId) {
            cancelAnimationFrame(keyboardViewportSyncFrameId);
        }
        keyboardViewportSyncFrameId = requestAnimationFrame(() => {
            keyboardViewportSyncFrameId = 0;
            syncFocusedKeyboardControlViewport(keyboardHeight);
        });
    };

    const syncFocusedKeyboardControlViewport = (keyboardHeight = lastKnownKeyboardInsetHeight) => {
        const active = getFocusedKeyboardControl();
        if (!active || !useManualViewportShift) return;

        const target = resolveKeyboardViewportTarget(active);
        const host = resolveKeyboardShiftHost(active);
        const scrollHost = resolveKeyboardScrollHost(active, host);
        const usePaddingOnlyHost = shouldUseKeyboardPaddingOnlyHost(host);
        const useModalHost = isKeyboardModalHost(host);
        const useDockedModalHost = isKeyboardDockedModalHost(host);
        if (!target || !host) {
            setKeyboardViewportShift(null, 0, keyboardHeight);
            setKeyboardScrollHost(null, 0);
            return;
        }

        const rect = target.getBoundingClientRect();
        const currentShift = host === activeKeyboardShiftHost ? Math.max(0, lastKnownKeyboardViewportShift || 0) : 0;
        const baseBottom = rect.bottom + currentShift;
        const viewportHeight = Math.round(
            window.innerHeight ||
            document.documentElement.clientHeight ||
            0
        );
        const safeKeyboardHeight = Math.max(0, Math.round(Number(keyboardHeight) || 0));

        if (!viewportHeight || !safeKeyboardHeight) {
            setKeyboardViewportShift(host, 0, safeKeyboardHeight);
            setKeyboardScrollHost(null, 0);
            return;
        }

        const keyboardClearance = 14;
        const visibleBottom = Math.max(0, viewportHeight - safeKeyboardHeight - keyboardClearance);

        if (usePaddingOnlyHost) {
            const paddingHost = scrollHost || host;
            const overlap = Math.max(0, Math.round(rect.bottom - visibleBottom));

            setKeyboardViewportShift(null, 0, safeKeyboardHeight);
            setKeyboardScrollHost(paddingHost, safeKeyboardHeight);

            if (paddingHost && overlap > 0) {
                const currentScrollTop = Math.max(0, Number(paddingHost.scrollTop || 0));
                const maxScrollTop = Math.max(
                    0,
                    Number((paddingHost.scrollHeight || 0) - (paddingHost.clientHeight || 0))
                );
                const nextScrollTop = Math.min(maxScrollTop, currentScrollTop + overlap);
                if (Math.abs(nextScrollTop - currentScrollTop) > 1) {
                    paddingHost.scrollTop = nextScrollTop;
                }
            }
            return;
        }

        if (useModalHost) {
            const hostRect = host.getBoundingClientRect();
            const hostBaseBottom = Math.max(
                0,
                (Number.isFinite(hostRect?.bottom) ? hostRect.bottom : 0) + currentShift
            );
            const desiredShift = Math.max(0, Math.max(baseBottom, hostBaseBottom) - visibleBottom);
            const nextShift = Math.min(safeKeyboardHeight, Math.round(desiredShift));

            if (useDockedModalHost) {
                setKeyboardScrollHost(null, 0);
                if (host === activeKeyboardShiftHost && Math.abs(nextShift - currentShift) < 4) {
                    return;
                }
                setKeyboardViewportShift(host, nextShift, safeKeyboardHeight);
                return;
            }

            const modalScrollHost = scrollHost || host;
            const contentBottom = getKeyboardScrollHostContentBottom(modalScrollHost);
            const projectedContentBottom = Math.max(0, contentBottom - nextShift);
            const contentHiddenByKeyboard = Math.max(0, projectedContentBottom - visibleBottom);
            const shouldExposeExtraScroll = contentHiddenByKeyboard > 24;

            setKeyboardScrollHost(
                modalScrollHost,
                shouldExposeExtraScroll ? safeKeyboardHeight + keyboardClearance : 0
            );
            if (host === activeKeyboardShiftHost && Math.abs(nextShift - currentShift) < 4) {
                return;
            }
            setKeyboardViewportShift(host, nextShift, safeKeyboardHeight);

            const projectedTargetBottom = Math.max(0, rect.bottom - nextShift);
            const overlap = Math.max(0, Math.round(projectedTargetBottom - visibleBottom));

            if (modalScrollHost && shouldExposeExtraScroll && overlap > 0) {
                const currentScrollTop = Math.max(0, Number(modalScrollHost.scrollTop || 0));
                const maxScrollTop = Math.max(
                    0,
                    Number((modalScrollHost.scrollHeight || 0) - (modalScrollHost.clientHeight || 0))
                );
                const nextScrollTop = Math.min(maxScrollTop, currentScrollTop + overlap);
                if (Math.abs(nextScrollTop - currentScrollTop) > 1) {
                    modalScrollHost.scrollTop = nextScrollTop;
                }
            }
            return;
        }

        const desiredShift = Math.max(0, baseBottom - visibleBottom);
        const nextShift = Math.min(safeKeyboardHeight, Math.round(desiredShift));

        const contentBottom = getKeyboardScrollHostContentBottom(scrollHost);
        const scrollHostContainsShiftHost = Boolean(
            scrollHost &&
            host &&
            (scrollHost === host || scrollHost.contains?.(host))
        );
        const projectedContentBottom = Math.max(
            0,
            contentBottom - (scrollHostContainsShiftHost ? nextShift : 0)
        );
        const contentHiddenByKeyboard = Math.max(0, projectedContentBottom - visibleBottom);
        const shouldExposeExtraScroll = contentHiddenByKeyboard > 24;

        setKeyboardScrollHost(
            scrollHost,
            shouldExposeExtraScroll ? safeKeyboardHeight + keyboardClearance : 0
        );
        if (host === activeKeyboardShiftHost && Math.abs(nextShift - currentShift) < 4) {
            return;
        }
        setKeyboardViewportShift(host, nextShift, safeKeyboardHeight);
    };

    const scheduleFocusedKeyboardControlViewportSync = (...delays) => {
        delays.forEach((delay) => {
            window.setTimeout(() => {
                requestFocusedKeyboardControlViewportSync();
            }, Math.max(0, Number(delay) || 0));
        });
    };

    const bindKeyboardEvent = (eventName, handler) => {
        try {
            const result = Keyboard.addListener(eventName, handler);
            result?.catch?.(() => {});
        } catch (_) {}
    };

    if (useManualViewportShift && Keyboard.setResizeMode) {
        Promise.resolve(Keyboard.setResizeMode({ mode: 'none' })).catch(() => {});
    }

    const handleKeyboardShow = (info = {}) => {
        const keyboardHeight = Math.max(0, Math.round(Number(info?.keyboardHeight) || 0));
        const active = getFocusedKeyboardControl();
        const activeHost = resolveKeyboardShiftHost(active);
        const useDockedModalHost = isKeyboardDockedModalHost(activeHost);
        setKeyboardVisible(true, keyboardHeight);
        requestFocusedKeyboardControlViewportSync(keyboardHeight);
        if (!useDockedModalHost) {
            scheduleFocusedKeyboardControlViewportSync(120, 260);
        }
    };

    bindKeyboardEvent('keyboardWillShow', handleKeyboardShow);
    bindKeyboardEvent('keyboardDidShow', handleKeyboardShow);
    bindKeyboardEvent('keyboardWillHide', () => {
        clearKeyboardDockedCaretRefresh();
        setKeyboardVisible(false, 0);
    });
    bindKeyboardEvent('keyboardDidHide', () => {
        clearKeyboardDockedCaretRefresh();
        setKeyboardVisible(false, 0);
    });

    document.addEventListener('focusin', (event) => {
        if (!event.target?.matches?.('input:not([type="hidden"]), textarea, select, [contenteditable="true"]')) return;
        clearKeyboardHideFallbackTimer();
        const host = resolveKeyboardShiftHost(event.target);
        const useDockedModalHost = isKeyboardDockedModalHost(host);
        if (document.body?.classList.contains('app-keyboard-visible')) {
            requestFocusedKeyboardControlViewportSync();
            if (!useDockedModalHost) {
                scheduleFocusedKeyboardControlViewportSync(120);
            }
            return;
        }
        if (useDockedModalHost) return;
        scheduleFocusedKeyboardControlViewportSync(40, 180);
    });
    document.addEventListener('focusout', (event) => {
        if (!event.target?.matches?.('input:not([type="hidden"]), textarea, select, [contenteditable="true"]')) return;
        scheduleKeyboardHideFallback();
    });

    window.addEventListener('resize', () => {
        if (!useManualViewportShift || !document.body?.classList.contains('app-keyboard-visible')) return;
        requestFocusedKeyboardControlViewportSync();
    });
    window.addEventListener('pagehide', () => {
        clearKeyboardHideFallbackTimer();
        setKeyboardVisible(false, 0);
    });
}

function syncRootScrollLockState() {
    const root = document.getElementById('root');
    if (!root) return;

    const hasScrollableOverflow = root.scrollHeight > root.clientHeight + 1;
    root.classList.toggle('root-no-scroll', !hasScrollableOverflow);

    if (!hasScrollableOverflow) {
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
    }
}

function scheduleRootScrollLockState() {
    if (rootScrollLockFrameId) {
        cancelAnimationFrame(rootScrollLockFrameId);
    }
    if (rootScrollLockTimeoutId) {
        clearTimeout(rootScrollLockTimeoutId);
    }

    rootScrollLockFrameId = requestAnimationFrame(() => {
        rootScrollLockFrameId = requestAnimationFrame(() => {
            rootScrollLockFrameId = 0;
            syncRootScrollLockState();
        });
    });

    rootScrollLockTimeoutId = window.setTimeout(() => {
        rootScrollLockTimeoutId = 0;
        syncRootScrollLockState();
    }, 120);
}

function ensureRootScrollLockBinding() {
    const root = document.getElementById('root');
    if (!root) return;

    if (!rootScrollLockBindingsReady) {
        const resyncRootScrollLock = () => scheduleRootScrollLockState();
        window.addEventListener('resize', resyncRootScrollLock);
        window.addEventListener('orientationchange', resyncRootScrollLock);
        window.addEventListener('load', resyncRootScrollLock);
        rootScrollLockBindingsReady = true;
    }

    if (!rootScrollLockObserver) {
        rootScrollLockObserver = new MutationObserver(() => {
            scheduleRootScrollLockState();
        });
        rootScrollLockObserver.observe(root, {
            childList: true,
            subtree: true,
            characterData: true
        });
    }
}

let initialBootstrapSettled = false;
let bootstrapFallbackShown = false;

function hideInitialLoadingScreen() {
    initialBootstrapSettled = true;
    const loading = document.getElementById('loading-screen');
    if (loading) {
        loading.classList.add('hide');
    }
}

function showBootstrapFallbackScreen(user) {
    bootstrapFallbackShown = true;

    try {
        if (user) {
            userId = user.uid;
            state.currentMode = null;
            state.currentPage = 'modeSelect';
            toggleAppVisibility(true);
        } else {
            userId = null;
            state.currentMode = null;
            state.selectedClientId = null;
            state.currentPage = 'auth';
            state.userProfile = null;
            toggleAppVisibility(false);
        }

        render();
    } catch (fallbackError) {
        console.error('[bootstrap] fallback render failed:', fallbackError);
    } finally {
        hideInitialLoadingScreen();
    }
}

function recoverFromBootstrapError(label, detail, user = auth?.currentUser ?? null) {
    if (initialBootstrapSettled || bootstrapFallbackShown) {
        hideInitialLoadingScreen();
        return;
    }

    console.error(`[bootstrap] ${label} failed:`, detail);
    showBootstrapFallbackScreen(user);
}

function runBootstrapStep(label, fn) {
    try {
        return fn();
    } catch (error) {
        recoverFromBootstrapError(label, error);
        return null;
    }
}

window.addEventListener('error', (event) => {
    recoverFromBootstrapError('window.error', event?.error || event?.message || event);
});

window.addEventListener('unhandledrejection', (event) => {
    recoverFromBootstrapError('window.unhandledrejection', event?.reason || event);
});

runBootstrapStep('ensureAppViewportHeightBinding', ensureAppViewportHeightBinding);
runBootstrapStep('ensureNativeKeyboardBottomNavBinding', ensureNativeKeyboardBottomNavBinding);
runBootstrapStep('scheduleLocalBuildTrialCountdownTick', scheduleLocalBuildTrialCountdownTick);
syncStatusUnsubscribe = subscribeSyncStatus(() => {
    applyAppConnectivityState();
    const syncSnapshot = getAppSyncStatus();
    if (getAppNetworkStatus().online !== false && !syncSnapshot.hasPendingWrites) {
        void schedulePendingMediaUploadFlush();
    }
});
networkStatusUnsubscribe = subscribeNetworkStatus(() => {
    applyAppConnectivityState();
    const snapshot = getAppNetworkStatus();
    const isOnline = snapshot.online !== false;
    if (isOnline && !exclusiveSessionWasOnline) {
        maybeClaimExclusiveSessionAfterReconnect();
        maybePreloadSelectedCycleAfterReconnect();
        void schedulePendingMediaUploadFlush({ force: true });
    }
    exclusiveSessionWasOnline = isOnline;
});
void Promise.resolve()
    .then(() => initNetworkMonitoring())
    .then((cleanup) => {
        if (typeof cleanup === 'function') {
            networkMonitoringCleanup = cleanup;
        }
        applyAppConnectivityState();
    })
    .catch((error) => {
        console.warn('[network] init failed:', error);
        applyAppConnectivityState();
    });
applyAppConnectivityState();

export function render() {
    const root = document.getElementById('root');
    ensureAppViewportHeightBinding();
    ensureNativeKeyboardBottomNavBinding();
    ensureRootScrollLockBinding();
    cleanupSupplementTransientUi();

    // Сохраняем scrollTop текущего экрана перед перерисовкой.
    if (__lastViewKeyForScrollMemory) {
        try {
            __scrollTopByViewKey.set(__lastViewKeyForScrollMemory, root?.scrollTop ?? 0);
        } catch (_) {}
    }

    root.innerHTML = '';

    renderTopBar();
    syncTopBarSyncStatusIndicator();

    removeTrainingDropdown();

    toggleAppVisibility(!!userId);

    if (!userId || state.currentMode === null) {
        void syncAppChrome();
        syncBottomNavAfterRender(state.currentPage);
        scheduleRootScrollLockState();
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

    applyPendingAppleHealthSyncReturn();

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
        scheduleRootScrollLockState();
        void syncAppChrome();
        return;
    } else if (state.currentPage === 'mealsReport') {
        renderMealsReportPage(state.reportHtmlCache);
        syncBottomNavAfterRender(state.currentPage);
        scheduleRootScrollLockState();
        void syncAppChrome();
        return;
    } else if (state.currentPage === 'modeSelect') {
        syncBottomNavAfterRender(state.currentPage);
        scheduleRootScrollLockState();
        void syncAppChrome();
        return;
    }

    syncBottomNavAfterRender(state.currentPage);
    scheduleRootScrollLockState();

    void syncAppChrome();

    // Восстанавливаем scrollTop для нового экрана (или сбрасываем в 0).
    const nextKey = getScrollMemoryViewKey();
    const nextTop = __scrollTopByViewKey.has(nextKey) ? (__scrollTopByViewKey.get(nextKey) ?? 0) : 0;
    requestAnimationFrame(() => {
        try {
            const el = document.getElementById('root');
            if (el) el.scrollTop = nextTop;
        } catch (_) {}
    });

    __lastViewKeyForScrollMemory = nextKey;
}
window.render = render;

runBootstrapStep('initBottomNav', initBottomNav);
void Promise.resolve()
    .then(() => installCapacitorAppleHealthReturnListener())
    .catch((error) => {
        console.error('[bootstrap] installCapacitorAppleHealthReturnListener failed:', error);
        hideInitialLoadingScreen();
    });

async function hideStatusBarEverywhere() {
    try {
        const StatusBar = window.Capacitor?.Plugins?.StatusBar;
        if (!StatusBar) return;
        if (StatusBar.setOverlaysWebView) {
            await StatusBar.setOverlaysWebView({ overlay: true });
        }
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
const authScreenEl = document.getElementById('auth-screen');
const AUTH_LOGIN_FIELD_IDS = ['auth-email', 'auth-password'];
const AUTH_REGISTER_FIELD_IDS = ['auth-first-name', 'auth-last-name', 'auth-patronymic', 'auth-birth-date', 'auth-email', 'auth-password'];
let isAuthSubmitPending = false;

function getAuthSubmitButtonIdleLabel() {
    return isLoginMode ? 'Войти' : 'Зарегистрироваться';
}

function getAuthSubmitButtonPendingLabel() {
    return isLoginMode ? 'Входим...' : 'Создаем аккаунт...';
}

function setAuthSubmitPendingState(isPending) {
    isAuthSubmitPending = isPending === true;

    if (authLoginBtn) {
        authLoginBtn.disabled = isAuthSubmitPending;
        authLoginBtn.textContent = isAuthSubmitPending
            ? getAuthSubmitButtonPendingLabel()
            : getAuthSubmitButtonIdleLabel();
        authLoginBtn.setAttribute('aria-busy', isAuthSubmitPending ? 'true' : 'false');
    }

    if (authToggleBtn) {
        authToggleBtn.disabled = isAuthSubmitPending;
    }
}

function getAuthFieldIdsInOrder() {
    return isLoginMode ? AUTH_LOGIN_FIELD_IDS : AUTH_REGISTER_FIELD_IDS;
}

function getVisibleAuthFields() {
    return getAuthFieldIdsInOrder()
        .map((fieldId) => document.getElementById(fieldId))
        .filter((field) => field && !field.disabled && field.offsetParent !== null);
}

function blurActiveAuthField() {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return;
    if (!authScreenEl?.contains(active)) return;
    active.blur();
    if (document.activeElement instanceof HTMLElement && authScreenEl.contains(document.activeElement)) {
        document.activeElement.blur();
    }
    const keyboardPlugin = window.Capacitor?.Plugins?.Keyboard;
    if (typeof keyboardPlugin?.hide === 'function') {
        Promise.resolve(keyboardPlugin.hide()).catch(() => {});
    }
}

function focusAuthFieldByIndex(index) {
    const field = getVisibleAuthFields()[index];
    if (!field) return false;
    field.focus();
    return true;
}

function updateAuthKeyboardHints() {
    const fields = getVisibleAuthFields();
    fields.forEach((field, index) => {
        const isLast = index === fields.length - 1;
        field.setAttribute('enterkeyhint', isLast ? 'go' : 'next');
        if (field.id === 'auth-email') {
            field.setAttribute('autocapitalize', 'none');
            field.setAttribute('autocorrect', 'off');
            field.setAttribute('spellcheck', 'false');
        }
    });
}

async function submitEmailPasswordLogin(email, password) {
    pendingExclusiveSessionLoginAttempt = {
        mode: 'email-password-login',
        startedAt: Date.now()
    };

    try {
        await signInWithEmailAndPassword(auth, email, password);
        showToast('Вход выполнен успешно!');
        return { ok: true };
    } catch (error) {
        if (error?.code === 'exclusive_session_takeover_cancelled' || error?.message === 'exclusive_session_takeover_cancelled') {
            return { ok: false, cancelled: true };
        }
        throw error;
    } finally {
        pendingExclusiveSessionLoginAttempt = null;
    }
}

async function submitRegistrationFlow(email, password, messages = {}) {
    const firstName = document.getElementById('auth-first-name')?.value?.trim() || '';
    const lastName = document.getElementById('auth-last-name')?.value?.trim() || '';
    const patronymic = document.getElementById('auth-patronymic')?.value?.trim() || '';
    const birthDate = document.getElementById('auth-birth-date')?.value || '';

    if (!firstName || !lastName || !patronymic || !birthDate) {
        showToast(messages.fillProfile || 'Заполните имя, фамилию, отчество и дату рождения.');
        return;
    }
    if (!email || !password) {
        showToast(messages.missingCredentials || 'Укажите email и пароль.');
        return;
    }

    const cred = await createUserWithEmailAndPassword(auth, email, password);
    await ensureExclusiveSessionClaim(cred.user, {
        reason: 'register',
        forceTokenRefresh: true,
        ignoreOfflineGuard: true
    });
    if (auth.currentUser?.uid !== cred.user.uid) {
        return;
    }

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

async function handleAuthSubmit() {
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    try {
        if (isLoginMode) {
            await submitEmailPasswordLogin(email, password); return;
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
            await ensureExclusiveSessionClaim(cred.user, {
                reason: 'register',
                forceTokenRefresh: true,
                ignoreOfflineGuard: true
            });
            if (auth.currentUser?.uid !== cred.user.uid) {
                return;
            }
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
}

async function handleAuthSubmitWithPending() {
    if (isAuthSubmitPending) return;

    const email = document.getElementById('auth-email')?.value?.trim() || '';
    const password = document.getElementById('auth-password')?.value || '';

    let keepPendingUntilBootstrap = false;
    setAuthSubmitPendingState(true);
    try {
        if (isLoginMode) {
            const loginResult = await submitEmailPasswordLogin(email, password);
            if (loginResult?.cancelled) {
                return;
            }
            keepPendingUntilBootstrap = true;
            return;
        }

        await submitRegistrationFlow(email, password);
        keepPendingUntilBootstrap = true;
    } catch (error) {
        if (error?.code === 'exclusive_session_takeover_cancelled' || error?.message === 'exclusive_session_takeover_cancelled') {
            return;
        }
        console.error("Ошибка аутентификации:", error);
        showToast('Ошибка: ' + (error.message.includes('auth/invalid-credential') ? 'Неверный email или пароль.' : error.message));
    } finally {
        if (!keepPendingUntilBootstrap) {
            setAuthSubmitPendingState(false);
        }
    }
}

if (authToggleBtn && authLoginBtn) {
    authToggleBtn.addEventListener('click', () => {
        isLoginMode = !isLoginMode;
        authLoginBtn.innerText = isLoginMode ? 'Войти' : 'Зарегистрироваться';
        authToggleBtn.innerText = isLoginMode ? 'Зарегистрироваться' : 'Войти';
        const titleEl = document.querySelector('.auth-box__title') || document.querySelector('.auth-box h3');
        if (titleEl) titleEl.textContent = isLoginMode ? 'Вход в Дневник' : 'Регистрация';
        syncAuthRegisterFieldsVisibility(isLoginMode);
        updateAuthKeyboardHints();
    });

    syncAuthRegisterFieldsVisibility(isLoginMode);
    updateAuthKeyboardHints();

    authLoginBtn.addEventListener('click', (event) => {
        event.preventDefault();
        if (isAuthSubmitPending) return;
        void handleAuthSubmitWithPending();
    });

    authScreenEl?.addEventListener('pointerdown', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (target.closest('input, textarea, select')) return;
        blurActiveAuthField();
    }, true);

    authScreenEl?.addEventListener('touchstart', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (target.closest('input, textarea, select')) return;
        blurActiveAuthField();
    }, true);

    authScreenEl?.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (target.closest('input, textarea, select')) return;
        blurActiveAuthField();
    }, true);

    authScreenEl?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (!target.matches('input, textarea, select')) return;
        if (!authScreenEl.contains(target)) return;

        const fields = getVisibleAuthFields();
        const currentIndex = fields.indexOf(target);
        if (currentIndex === -1) return;

        event.preventDefault();
        const nextIndex = currentIndex + 1;
        if (focusAuthFieldByIndex(nextIndex)) return;

        blurActiveAuthField();
        authLoginBtn.click();
    });
    setAuthSubmitPendingState(false);
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
        await performExplicitSignOut(); state.currentMode = null; state.selectedClientId = null; state.selectedCycleId = null; state.selectedJournalCategory = null; state.selectedJournalProgram = null; return;
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
    const bootstrapRunId = ++authBootstrapRunId;
    const loading = document.getElementById('loading-screen');

    // Пока грузится — показываем лоадер
    bootstrapFallbackShown = false;
    initialBootstrapSettled = false;

    if (loading) {
        loading.classList.remove('hide');
    }

    try {

    unsubscribeAll();
    teardownExclusiveSessionListener();

    if (user) {
        clearExclusiveSessionReadOnly();
        userId = user.uid;
        console.log('🔑 Пользователь вошёл:', userId);

        await ensureExclusiveSessionMeta(user).catch((error) => {
            console.warn('[session] initial token bootstrap failed:', error);
            return null;
        });
        attachExclusiveSessionListener(user);
        const sessionClaim = await ensureExclusiveSessionClaim(user, { reason: 'bootstrap' }).catch((error) => {
            console.warn('[session] bootstrap claim failed:', error);
            return null;
        });
        if (sessionClaim?.error === 'stale_session' || auth.currentUser?.uid !== user.uid) {
            return;
        }
        if (sessionClaim?.reauthenticated) {
            return;
        }

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
        clearExclusiveSessionReadOnly();
        clearExclusiveSessionRuntime();
        state.currentMode = null;
        state.selectedClientId = null;
        state.currentPage = 'auth';
        state.userProfile = null;
        toggleAppVisibility(false);
    }

    // Первичный рендер
    render();

    // ❗ Даем приложению дорендериться → и скрываем загрузку
    if (!user) {
        showPendingExclusiveSessionNotice();
    }
    } catch (error) {
        console.error('[bootstrap] onAuthStateChanged failed:', error);
        showBootstrapFallbackScreen(user);
    } finally {
        if (bootstrapRunId === authBootstrapRunId) {
            window.setTimeout(() => {
                if (bootstrapRunId !== authBootstrapRunId) return;
                setAuthSubmitPendingState(false);
                hideInitialLoadingScreen();
                scheduleRootScrollLockState();
            }, 300); // можно увеличить если захочешь плавности
        }
    }
});

