import {
    doc,
    setDoc,
    getDoc,
    getDocFromCache,
    getDocs,
    updateDoc,
    arrayUnion,
    collection,
    onSnapshot,
    addDoc,
    deleteDoc,
    deleteField,
    query,
    where,
    documentId,
    orderBy,
    limit,
    startAfter,
    startAt,
    endAt,
    writeBatch
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
const mealOpenState = JSON.parse(localStorage.getItem('mealOpenState') || '{}');
import {
    getCycleDocRef,
    getCurrentAuthUid,
    getCurrentUserHealthDailyCollection,
    getCurrentUserHealthDailyDocRef,
    getGlobalFoodCatalogCollection,
    getMealLibraryContextKey,
    getMealLibraryFoodsCollection,
    getMealLibraryRecipesCollection,
    isAppleShortcutsLaunchSupported,
    isStandalonePwaDisplayMode,
    launchAppleHealthShortcut,
    openCycleSelectModal,
    openConfirmModal,
    openDateModal,
    openMediaFullScreen,
    renderTopBar,
    ensureCycleSelected,
    render,
    showToast,
    uploadUserMediaFileWithProgress,
    deleteUserFirebaseStorageFileByDownloadUrl
} from '../script.js';
import { debounce } from './supplement.js';
import { resolveSwipePanAxis } from '../gestures.js';
import { attachMonthCarouselSwipe } from '../calendar-month-carousel.js';
import { bindSwipeBlock, closeSwipeRowVisual } from '../swipe-engine.js';
import {
    syncMealSearchBottomNavFromOverlay,
    setMealBottomNavOverlayMode,
    clearMealBottomNavOverlayMode
} from '../nav/bottom-nav.js';
let unsubscribeMeals = null;
let foodsMapCache = null;
let foodsMapLibraryKey = null;
let recipesCache = null;
let recipesCacheLibraryKey = null;
let recipesCachePromise = null;
let foodsPreviewCache = null;
let foodsPreviewCacheKey = null;
let recipesPreviewCache = null;
let recipesPreviewCacheKey = null;
let historyPreviewCache = null;
let historyPreviewCacheKey = null;
let lastRenderedMealStructure = '';
let mealTotalsCache = {};
let mealSwipeDocumentBound = false;
let monthMealsPresenceCache = {};
let monthMealsPresenceCycleId = null;
let monthMealsDailySummaryCache = {};
let monthMealsDailySummaryCycleId = null;
let mealPageScrollY = 0;
let mealScrollRestorePending = false;
let mealMainMounted = false;
let mealMainEl = null;
let mealOverlayEl = null;
let mealShellEl = null;
let mealOverlayStack = [];
let cleanupMealMacrosBorderObserver = null;
let cleanupTopBarMealBorderObserver = null;
let weekMealsPresenceCache = {};
let mealsDataLoadedDate = null;
const MEAL_NO_GOAL_SUMMARY_VIEW_KEY = 'mealNoGoalSummaryView';
let mealNoGoalSummaryCurrentMode = localStorage.getItem(MEAL_NO_GOAL_SUMMARY_VIEW_KEY) === 'current';
const MEAL_GOAL_SUMMARY_VIEW_KEY = 'mealGoalSummaryView';
let mealGoalSummaryCurrentMode = localStorage.getItem(MEAL_GOAL_SUMMARY_VIEW_KEY) === 'current';


// функция сброса
function resetMealsListener() {
    if (unsubscribeMeals) {
        unsubscribeMeals();
        unsubscribeMeals = null;
    }
}
//  Когда меняею цикл, надо ещё сбрасывать подписку и кэш продуктов.
export function resetMealsState() {
    resetMealsListener();
    foodsMapCache = null;
    foodsMapLibraryKey = null;
    recipesCache = null;
    recipesCacheLibraryKey = null;
    recipesCachePromise = null;
    weekMealsPresenceCache = {};
    mealsDataLoadedDate = null;
    monthMealsPresenceCache = {};
    monthMealsPresenceCycleId = null;
    monthMealsDailySummaryCache = {};
    monthMealsDailySummaryCycleId = null;
    historyPreviewCache = null;
    historyPreviewCacheKey = null;
    foodsPreviewCache = null;
    foodsPreviewCacheKey = null;
    recipesPreviewCache = null;
    recipesPreviewCacheKey = null;
}

export function destroyMealShellState() {
    mealMainMounted = false;
    mealMainEl = null;
    mealOverlayEl = null;
    mealShellEl = null;
}

function getMealScrollTarget() {
    return document.getElementById('root')
        || document.scrollingElement
        || document.documentElement
        || document.body;
}

function getMealScrollY() {
    const target = getMealScrollTarget();
    return target ? target.scrollTop : (window.scrollY || window.pageYOffset || 0);
}

function setMealScrollY(y) {
    const target = getMealScrollTarget();

    if (target) {
        target.scrollTop = y;
    }

    window.scrollTo(0, y);
}

function saveMealPageScroll() {
    const searchScreen = document.querySelector('.meal-search-screen');
    if (searchScreen && state.mealSearchScrollByTab) {
        const tab = state.mealSearchTab || 'all';
        const panel = searchScreen.querySelector(`.meal-search-tab-panel[data-tab="${tab}"]`);
        const list = panel && panel.querySelector('.meal-search-list');
        if (list) {
            state.mealSearchScrollByTab[tab] = list.scrollTop;
        }
    }
    mealPageScrollY = getMealScrollY();
}

function restoreMealPageScroll() {
    if (!mealScrollRestorePending) return;

    const y = Number(mealPageScrollY || 0);

    requestAnimationFrame(() => {
        setMealScrollY(y);

        requestAnimationFrame(() => {
            setMealScrollY(y);

            setTimeout(() => setMealScrollY(y), 0);
            setTimeout(() => setMealScrollY(y), 40);
            setTimeout(() => {
                setMealScrollY(y);
                mealScrollRestorePending = false;
            }, 120);
        });
    });
}

function syncMealRootScrollAvailability() {
    const root = document.getElementById('root');
    if (!root) return;

    const hasScrollableOverflow = root.scrollHeight > root.clientHeight + 1;
    root.classList.toggle('root-no-scroll', !hasScrollableOverflow);

    if (!hasScrollableOverflow) {
        root.scrollTop = 0;
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
    }
}

function scheduleMealRootScrollAvailabilitySync() {
    requestAnimationFrame(() => {
        syncMealRootScrollAvailability();
        requestAnimationFrame(syncMealRootScrollAvailability);
    });
    window.setTimeout(syncMealRootScrollAvailability, 160);
    window.setTimeout(syncMealRootScrollAvailability, 360);
}

function getWeekDates(dateStr) {
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);

    const weekday = (date.getDay() + 6) % 7;

    const monday = new Date(year, month - 1, day);
    monday.setDate(monday.getDate() - weekday);

    const week = [];

    for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        week.push(formatLocalDate(d));
    }

    return week;
}

const WEEK_DAY_CHECK_MARK = '\u2713';

function getWeekPresenceCacheKey(weekDates = []) {
    const first = weekDates[0] || 'no-start';
    const last = weekDates[weekDates.length - 1] || 'no-end';
    return `${state.selectedCycleId || 'no-cycle'}__${first}__${last}`;
}

function getWeekPresenceStorageKey(cacheKey) {
    return `mealWeekPresence:${cacheKey}`;
}

function normalizeWeekPresenceForDates(weekDates = [], presence = {}) {
    const normalized = {};
    weekDates.forEach(date => {
        normalized[date] = Boolean(presence?.[date]);
    });
    return normalized;
}

function readWeekMealsPresenceCache(weekDates = []) {
    if (!weekDates.length) return null;

    const cacheKey = getWeekPresenceCacheKey(weekDates);
    if (weekMealsPresenceCache[cacheKey]) {
        return normalizeWeekPresenceForDates(weekDates, weekMealsPresenceCache[cacheKey]);
    }

    try {
        const raw = localStorage.getItem(getWeekPresenceStorageKey(cacheKey));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        const presence = parsed?.presence || parsed;
        if (!presence || typeof presence !== 'object') return null;
        weekMealsPresenceCache[cacheKey] = normalizeWeekPresenceForDates(weekDates, presence);
        return weekMealsPresenceCache[cacheKey];
    } catch (_) {
        return null;
    }
}

function writeWeekMealsPresenceCache(weekDates = [], presence = {}) {
    if (!weekDates.length) return;

    const cacheKey = getWeekPresenceCacheKey(weekDates);
    const normalized = normalizeWeekPresenceForDates(weekDates, presence);
    weekMealsPresenceCache[cacheKey] = normalized;

    try {
        localStorage.setItem(
            getWeekPresenceStorageKey(cacheKey),
            JSON.stringify({ savedAt: Date.now(), presence: normalized })
        );
    } catch (_) {}
}

function updateCachedWeekPresenceForDate(dateStr, hasFood) {
    if (!dateStr) return;
    const weekDates = getWeekDates(dateStr);
    const cached = readWeekMealsPresenceCache(weekDates) || normalizeWeekPresenceForDates(weekDates);
    cached[dateStr] = Boolean(hasFood);
    writeWeekMealsPresenceCache(weekDates, cached);
}

function applyWeekRowPresence(presence = {}, root = mealMainEl) {
    const scope = root || document;
    scope.querySelectorAll?.('.week-day-item').forEach(btn => {
        const date = btn.dataset.date;
        if (!date || !(date in presence)) return;
        btn.classList.toggle('has-food', Boolean(presence[date]));

        const check = btn.querySelector('.week-day-check');
        if (check && check.textContent !== WEEK_DAY_CHECK_MARK) {
            check.textContent = WEEK_DAY_CHECK_MARK;
        }
    });
}


function getMealKeysFromData(mealsData = {}) {
    const defaultKeys = ['meal1', 'meal2', 'meal3'];

    const extraKeys = Object.keys(mealsData)
        .filter(key => /^meal\d+$/.test(key))
        .filter(key => !defaultKeys.includes(key))
        .sort((a, b) => {
            const aNum = parseInt(a.replace('meal', ''), 10);
            const bNum = parseInt(b.replace('meal', ''), 10);
            return aNum - bNum;
        });

    return [...defaultKeys, ...extraKeys];
}

function formatLocalDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}
function parseLocalDate(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
}

function getMonthStart(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date, delta) {
    return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

function isSameDay(dateA, dateB) {
    return (
        dateA.getFullYear() === dateB.getFullYear() &&
        dateA.getMonth() === dateB.getMonth() &&
        dateA.getDate() === dateB.getDate()
    );
}

function isSameMonth(dateA, dateB) {
    return (
        dateA.getFullYear() === dateB.getFullYear() &&
        dateA.getMonth() === dateB.getMonth()
    );
}

function getCalendarMonthMatrix(monthDate) {
    const firstDay = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const startWeekday = (firstDay.getDay() + 6) % 7; // понедельник = 0
    const gridStart = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1 - startWeekday);

    const cells = [];

    for (let i = 0; i < 42; i++) {
        const d = new Date(gridStart);
        d.setDate(gridStart.getDate() + i);
        cells.push(d);
    }

    return cells;
}

function getCalendarMonthTitle(date) {
    const months = [
        'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
        'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'
    ];
    return months[date.getMonth()];
}

const MEAL_SUMMARY_MONTH_NAMES = [
    'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
    'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'
];
const MEAL_SUMMARY_MONTH_SHORT_NAMES = [
    'янв.', 'февр.', 'март', 'апр.', 'май', 'июнь',
    'июль', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'
];
const MEAL_SUMMARY_WEEKDAY_SHORT_NAMES = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

function getMealSummaryMonthKey(monthDate) {
    return `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`;
}

function parseMealSummaryMonthKey(monthKey) {
    const match = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
    if (!match) return null;

    const year = Number(match[1]);
    const month = Number(match[2]);
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
        return null;
    }

    return new Date(year, month - 1, 1);
}

function getMealSummaryVisibleMonth() {
    const parsed = parseMealSummaryMonthKey(state.mealSummaryMonth);
    if (parsed) return parsed;

    const fallback = state.mealSummarySelectedDate ? parseLocalDate(state.mealSummarySelectedDate) : new Date();
    return getMonthStart(fallback);
}

function setMealSummaryVisibleMonth(monthDate) {
    state.mealSummaryMonth = getMealSummaryMonthKey(getMonthStart(monthDate));
}

function formatMealSummaryMonthLabel(monthDate) {
    return `${MEAL_SUMMARY_MONTH_NAMES[monthDate.getMonth()]} ${monthDate.getFullYear()}`;
}

function formatMealSummaryStubDateLabel(dateStr) {
    if (!dateStr) return '';
    const date = parseLocalDate(dateStr);
    return `${date.getDate()} ${MEAL_SUMMARY_MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

function getMealSummaryMonthDays(monthDate) {
    const lastDay = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
    const result = [];

    for (let day = 1; day <= lastDay; day += 1) {
        result.push(formatLocalDate(new Date(monthDate.getFullYear(), monthDate.getMonth(), day)));
    }

    return result;
}

function formatMacro(value, digits = 1) {
    const num = Number(value || 0);
    return num.toFixed(digits).replace(/\.0+$|(\.\d*[1-9])0+$/, '$1');
}

function getSelectedCycle() {
    return state.cycles?.find(c => c.id === state.selectedCycleId) || null;
}

function patchMealGoalConfigInLocalState(nextMealGoalConfig) {
    if (!Array.isArray(state.cycles)) return;

    const normalizedConfig = nextMealGoalConfig
        ? normalizeMealGoalConfigForState(nextMealGoalConfig)
        : null;

    state.cycles = state.cycles.map(cycle => {
        if (cycle.id !== state.selectedCycleId) return cycle;

        return {
            ...cycle,
            mealGoalConfig: normalizedConfig
        };
    });
}

function normalizeMealGoalConfigForState(config = {}) {
    const next = { ...config };

    if (typeof next.baseGoal === 'undefined') {
        delete next.baseGoal;
    }

    if (typeof next.intervalPreset === 'undefined') {
        delete next.intervalPreset;
    }

    if (!Array.isArray(next.weekdayPresets)) {
        next.weekdayPresets = [];
    }

    return next;
}

function normalizeDays(days = []) {
    return [...new Set(days.map(Number).filter(Boolean))].sort((a, b) => a - b);
}

function areSameDays(a = [], b = []) {
    const aNorm = normalizeDays(a);
    const bNorm = normalizeDays(b);

    if (aNorm.length !== bNorm.length) return false;
    return aNorm.every((day, index) => day === bNorm[index]);
}

function hasDaysOverlap(a = [], b = []) {
    const setB = new Set(normalizeDays(b));
    return normalizeDays(a).some(day => setB.has(day));
}

function getMealGoalConfigFromSelectedCycle() {
    const currentCycle = getSelectedCycle();
    return currentCycle?.mealGoalConfig || null;
}

function getWeekdayNumberFromDateStr(dateStr) {
    const d = parseLocalDate(dateStr);
    const jsDay = d.getDay(); // вс=0, пн=1...
    return jsDay === 0 ? 7 : jsDay; // пн=1 ... вс=7
}

function normalizeGoal(goal = {}) {
    return {
        calories: Number(goal.calories || 0),
        protein: Number(goal.protein || 0),
        fat: Number(goal.fat || 0),
        carbs: Number(goal.carbs || 0)
    };
}

function getDaysDiff(startDateStr, targetDateStr) {
    const start = parseLocalDate(startDateStr);
    const target = parseLocalDate(targetDateStr);

    const startUTC = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
    const targetUTC = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate());

    return Math.floor((targetUTC - startUTC) / 86400000);
}

function resolveIntervalGoal(intervalPreset, dateStr) {
    if (!intervalPreset?.startDate) return null;

    const periods = Array.isArray(intervalPreset.periods)
        ? intervalPreset.periods
        : (
            intervalPreset.firstSpanDays && intervalPreset.secondSpanDays
                ? [
                    {
                        days: Number(intervalPreset.firstSpanDays || 0),
                        goal: normalizeGoal(intervalPreset.firstGoal || {})
                    },
                    {
                        days: Number(intervalPreset.secondSpanDays || 0),
                        goal: normalizeGoal(intervalPreset.secondGoal || {})
                    }
                ]
                : []
        );

    if (!periods.length) return null;

    const normalizedPeriods = periods
        .map(period => ({
            days: Number(period?.days || 0),
            goal: normalizeGoal(period?.goal || {})
        }))
        .filter(period => period.days > 0 && Number(period.goal.calories || 0) > 0);

    if (!normalizedPeriods.length) return null;

    const diff = getDaysDiff(intervalPreset.startDate, dateStr);
    if (diff < 0) return null;

    const cycleLen = normalizedPeriods.reduce((sum, period) => sum + period.days, 0);
    if (!cycleLen) return null;

    let dayInCycle = diff % cycleLen;

    for (const period of normalizedPeriods) {
        if (dayInCycle < period.days) {
            return normalizeGoal(period.goal);
        }
        dayInCycle -= period.days;
    }

    return normalizeGoal(normalizedPeriods[0].goal);
}

function resolveWeekdayGoal(weekdayPresets = [], dateStr) {
    const weekday = getWeekdayNumberFromDateStr(dateStr);

    const matched = weekdayPresets.find(preset =>
        Array.isArray(preset.days) && preset.days.includes(weekday)
    );

    return matched ? normalizeGoal(matched.goal) : null;
}

function getActiveMealGoalForDate(dateStr = state.selectedDate) {
    const config = getMealGoalConfigFromSelectedCycle();
    if (!config) return null;

    if (config.intervalPreset) {
        const intervalGoal = resolveIntervalGoal(config.intervalPreset, dateStr);
        if (intervalGoal?.calories) return intervalGoal;
    }

    const weekdayGoal = resolveWeekdayGoal(config.weekdayPresets || [], dateStr);
    if (weekdayGoal?.calories) return weekdayGoal;

    if (config.baseGoal?.calories) {
        return normalizeGoal(config.baseGoal);
    }

    return null;
}

function getSavedMealGoalFromSelectedCycle() {
    return getActiveMealGoalForDate(state.selectedDate);
}

function clampMealPercent(value) {
    return Math.max(0, Math.min(100, Number(value || 0)));
}

function getMealGoalProgress(current, target) {
    const currentNum = Number(current || 0);
    const targetNum = Number(target || 0);

    if (!targetNum) {
        return {
            current: currentNum,
            target: 0,
            eaten: currentNum,
            remaining: 0,
            percent: 0
        };
    }

    return {
        current: currentNum,
        target: targetNum,
        eaten: currentNum,
        remaining: Math.max(0, targetNum - currentNum),
        percent: clampMealPercent((currentNum / targetNum) * 100)
    };
}

function buildMealProgressArc({ eaten, target }) {
    const percent = target > 0 ? clampMealPercent((eaten / target) * 100) : 0;

    const arcPath = `
        M 62 122
        A 60 60 0 1 1 158 122
    `;

    return `
        <div class="meal-summary-arc-wrap">
            <svg class="meal-summary-arc" viewBox="0 0 220 150" width="220" height="150" aria-hidden="true">
                <path
                    class="meal-summary-arc-track"
                    d="${arcPath}"
                    pathLength="100"
                ></path>
                <path
                    class="meal-summary-arc-progress"
                    d="${arcPath}"
                    pathLength="100"
                    stroke-dasharray="${percent} 100"
                ></path>
            </svg>
        </div>
    `;
}

function buildMealSplitArc({ carbsKcal, fatKcal, proteinKcal, totalKcal }) {
    const total = Math.max(1, Number(totalKcal || 0));

    const carbsPct = (Number(carbsKcal || 0) / total) * 100;
    const fatPct = (Number(fatKcal || 0) / total) * 100;
    const proteinPct = (Number(proteinKcal || 0) / total) * 100;

    const safeCarbs = clampMealPercent(carbsPct);
    const safeFat = clampMealPercent(fatPct);
    const safeProtein = clampMealPercent(proteinPct);

    const arcPath = `
        M 62 122
        A 60 60 0 1 1 158 122
    `;

    return `
        <div class="meal-summary-arc-wrap">
            <svg class="meal-summary-arc" viewBox="0 0 220 150" width="220" height="150" aria-hidden="true">
                <path
                    class="meal-summary-arc-track"
                    d="${arcPath}"
                    pathLength="100"
                ></path>

                <path
                    class="meal-summary-arc-progress meal-summary-arc-carbs"
                    d="${arcPath}"
                    pathLength="100"
                    stroke-dasharray="${safeCarbs} 100"
                    stroke-dashoffset="0"
                ></path>

                <path
                    class="meal-summary-arc-progress meal-summary-arc-fat"
                    d="${arcPath}"
                    pathLength="100"
                    stroke-dasharray="${safeFat} 100"
                    stroke-dashoffset="-${safeCarbs}"
                ></path>

                <path
                    class="meal-summary-arc-progress meal-summary-arc-protein"
                    d="${arcPath}"
                    pathLength="100"
                    stroke-dasharray="${safeProtein} 100"
                    stroke-dashoffset="-${safeCarbs + safeFat}"
                ></path>
            </svg>
        </div>
    `;
}

function buildMealSummaryCurrentCard({
    eatenCalories,
    eatenProtein,
    eatenFat,
    eatenCarbs,
    carbsPercent,
    fatPercent,
    proteinPercent
}) {
    const circumference = 301.59;
    const carbsLen = (clampMealPercent(carbsPercent) / 100) * circumference;
    const fatLen = (clampMealPercent(fatPercent) / 100) * circumference;
    const proteinLen = (clampMealPercent(proteinPercent) / 100) * circumference;

    return `
        <div class="meal-summary-current-card food-current-card">
            <div class="food-current-ring-block">
                <div class="food-current-ring">
                    <svg viewBox="0 0 120 120" class="food-ring-svg">
                        <circle class="food-ring-bg" cx="60" cy="60" r="48"></circle>

                        <circle
                            class="food-ring-segment food-ring-carbs"
                            cx="60"
                            cy="60"
                            r="48"
                            stroke-dasharray="${carbsLen} ${circumference}"
                            stroke-dashoffset="0"
                        ></circle>

                        <circle
                            class="food-ring-segment food-ring-fat"
                            cx="60"
                            cy="60"
                            r="48"
                            stroke-dasharray="${fatLen} ${circumference}"
                            stroke-dashoffset="-${carbsLen}"
                        ></circle>

                        <circle
                            class="food-ring-segment food-ring-protein"
                            cx="60"
                            cy="60"
                            r="48"
                            stroke-dasharray="${proteinLen} ${circumference}"
                            stroke-dashoffset="-${carbsLen + fatLen}"
                        ></circle>
                    </svg>

                    <div class="food-ring-center">
                        <div class="food-ring-kcal">${eatenCalories}</div>
                        <div class="food-ring-label">ккал</div>
                    </div>
                </div>
            </div>

            <div class="food-current-macros">
                <div class="food-current-macro food-current-macro-carbs">
                    <div class="food-current-percent">${Math.round(carbsPercent)} %</div>
                    <div class="food-current-grams">${String(formatMacro(eatenCarbs, 1)).replace('.', ',')} г</div>
                    <div class="food-current-name">Углев.</div>
                </div>

                <div class="food-current-macro food-current-macro-fat">
                    <div class="food-current-percent">${Math.round(fatPercent)} %</div>
                    <div class="food-current-grams">${String(formatMacro(eatenFat, 1)).replace('.', ',')} г</div>
                    <div class="food-current-name">Жиры</div>
                </div>

                <div class="food-current-macro food-current-macro-protein">
                    <div class="food-current-percent">${Math.round(proteinPercent)} %</div>
                    <div class="food-current-grams">${String(formatMacro(eatenProtein, 1)).replace('.', ',')} г</div>
                    <div class="food-current-name">Белки</div>
                </div>
            </div>
        </div>
    `;
}

function bindMealNoGoalSummaryToggle(root = document) {
    const card = root.querySelector?.('.meal-summary-card-no-goal');
    if (!card) return;

    const setMode = (enabled) => {
        mealNoGoalSummaryCurrentMode = Boolean(enabled);
        localStorage.setItem(
            MEAL_NO_GOAL_SUMMARY_VIEW_KEY,
            mealNoGoalSummaryCurrentMode ? 'current' : 'arc'
        );
        card.classList.toggle('meal-summary-card-no-goal--current', mealNoGoalSummaryCurrentMode);
        card.setAttribute('aria-pressed', mealNoGoalSummaryCurrentMode ? 'true' : 'false');
    };

    card.addEventListener('click', () => {
        setMode(!mealNoGoalSummaryCurrentMode);
    });

    card.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        setMode(!mealNoGoalSummaryCurrentMode);
    });
}

function formatMealCompactValue(value) {
    return String(formatMacro(value, 1)).replace('.', ',');
}

function buildMealGoalCompactMacro({ title, eaten, target, percent }) {
    return `
        <div class="meal-summary-goal-compact-macro">
            <div class="meal-summary-goal-compact-title">${title}</div>
            <div class="meal-summary-bar-track meal-summary-goal-compact-track">
                <div class="meal-summary-bar-fill" style="width:${clampMealPercent(percent)}%;"></div>
            </div>
            <div class="meal-summary-goal-compact-eaten">${formatMealCompactValue(eaten)}</div>
            <div class="meal-summary-goal-compact-target">
                <span>/</span>
                <strong>${formatMealCompactValue(target)}</strong>
            </div>
        </div>
    `;
}

function buildMealGoalCompactCard({
    eatenCalories,
    caloriesGoal,
    caloriesData,
    proteinData,
    fatData,
    carbsData
}) {
    return `
        <div class="meal-summary-goal-compact-card">
            <div class="meal-summary-goal-compact-energy">
                <div class="meal-summary-center meal-summary-goal-compact-center">
                    ${buildMealProgressArc({
                        eaten: caloriesData.eaten,
                        target: caloriesData.target
                    })}
                    <div class="meal-summary-center-text meal-summary-goal-compact-center-text">
                        <div class="meal-summary-center-value">${eatenCalories}</div>
                        <div class="meal-summary-center-label">Ккал</div>
                    </div>
                </div>
                <div class="meal-summary-goal-compact-energy-target">
                    <span>/</span>
                    <strong>${Math.round(Number(caloriesGoal || 0))}</strong>
                </div>
            </div>

            ${buildMealGoalCompactMacro({
                title: 'Белки',
                eaten: proteinData.eaten,
                target: proteinData.target,
                percent: proteinData.percent
            })}

            ${buildMealGoalCompactMacro({
                title: 'Жиры',
                eaten: fatData.eaten,
                target: fatData.target,
                percent: fatData.percent
            })}

            ${buildMealGoalCompactMacro({
                title: 'Углеводы',
                eaten: carbsData.eaten,
                target: carbsData.target,
                percent: carbsData.percent
            })}
        </div>
    `;
}

function bindMealGoalSummaryToggle(root = document) {
    const card = root.querySelector?.('.meal-summary-card-goal');
    if (!card) return;

    const setMode = (enabled) => {
        mealGoalSummaryCurrentMode = Boolean(enabled);
        localStorage.setItem(
            MEAL_GOAL_SUMMARY_VIEW_KEY,
            mealGoalSummaryCurrentMode ? 'current' : 'arc'
        );
        card.classList.toggle('meal-summary-card-goal--current', mealGoalSummaryCurrentMode);
        card.setAttribute('aria-pressed', mealGoalSummaryCurrentMode ? 'true' : 'false');
    };

    card.querySelectorAll('.meal-summary-top-goal, .meal-summary-goal-compact-card').forEach((target) => {
        target.addEventListener('click', () => {
            setMode(!mealGoalSummaryCurrentMode);
        });
    });

    card.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        setMode(!mealGoalSummaryCurrentMode);
    });
}

function buildMealGoalBar({ title, eaten, target, percent }) {
    return `
        <div class="meal-summary-bar-item">
            <div class="meal-summary-bar-title">${title}</div>
            <div class="meal-summary-bar-track">
                <div class="meal-summary-bar-fill" style="width:${clampMealPercent(percent)}%;"></div>
            </div>
            <div class="meal-summary-bar-value">
                <span class="meal-summary-bar-value-current">
                ${formatMacro(eaten, 1)}
                </span>
                <span class="meal-summary-bar-value-separator"> / </span>
                <span class="meal-summary-bar-value-target">
                ${formatMacro(target, 1)} г
                </span>
            </div>
        </div>
    `;
}

function buildMealFactBar({ title, value, percent }) {
    return `
        <div class="meal-summary-bar-item meal-summary-bar-item-fact">
            <div class="meal-summary-bar-title">${title}</div>

            <div class="meal-summary-bar-value meal-summary-bar-value-fact">
                ${String(formatMacro(value, 1)).replace('.', ',')} г
            </div>

            <div class="meal-summary-bar-percent meal-summary-bar-percent-fact">
                ${Math.round(percent)} %
            </div>
        </div>
    `;
}

function getMealMacrosSkeletonHtml() {
    return `
        <div class="meal-summary-card meal-summary-skeleton">
            <div class="meal-summary-top meal-summary-top-goal">
                <div class="meal-summary-side meal-summary-side-left">
                    <div class="meal-summary-side-value"></div>
                    <div class="meal-summary-side-label"></div>
                </div>

                <div class="meal-summary-center">
                    <div class="meal-summary-arc-wrap"></div>
                </div>

                <div class="meal-summary-side meal-summary-side-right">
                    <div class="meal-summary-side-value"></div>
                    <div class="meal-summary-side-label"></div>
                </div>
            </div>

            <div class="meal-summary-bars">
                <div class="meal-summary-bar-item"></div>
                <div class="meal-summary-bar-item"></div>
                <div class="meal-summary-bar-item"></div>
            </div>
        </div>
    `;
}


function renderMealMacrosRow(total = { p: 0, f: 0, c: 0, cal: 0 }) {
    const row = document.getElementById('meal-macros-row');
    if (!row) return;

    const goal = getSavedMealGoalFromSelectedCycle();

    const eatenCalories = Math.round(Number(total.cal || 0));
    const eatenProtein = Number(total.p || 0);
    const eatenFat = Number(total.f || 0);
    const eatenCarbs = Number(total.c || 0);

    const hasGoal = !!Number(goal?.calories || 0);

    if (hasGoal) {
        const caloriesGoal = Number(goal.calories || 0);
        const proteinGoal = Number(goal.protein || 0);
        const fatGoal = Number(goal.fat || 0);
        const carbsGoal = Number(goal.carbs || 0);

        const caloriesData = getMealGoalProgress(eatenCalories, caloriesGoal);
        const proteinData = getMealGoalProgress(eatenProtein, proteinGoal);
        const fatData = getMealGoalProgress(eatenFat, fatGoal);
        const carbsData = getMealGoalProgress(eatenCarbs, carbsGoal);

        row.innerHTML = `
            <div
                class="meal-summary-card meal-summary-card-goal ${mealGoalSummaryCurrentMode ? 'meal-summary-card-goal--current' : ''}"
                role="button"
                tabindex="0"
                aria-label="Переключить вид цели питания"
                aria-pressed="${mealGoalSummaryCurrentMode ? 'true' : 'false'}"
            >
                <div class="meal-summary-top meal-summary-top-goal">
                    <div class="meal-summary-side meal-summary-side-left">
                        <div class="meal-summary-side-value">${eatenCalories}</div>
                        <div class="meal-summary-side-label">Съедено</div>
                    </div>

                    <div class="meal-summary-center">
                        ${buildMealProgressArc({
                            eaten: caloriesData.eaten,
                            target: caloriesData.target
                        })}
                        <div class="meal-summary-center-text">
                            <div class="meal-summary-center-value">${caloriesGoal}</div>
                            <div class="meal-summary-center-label">Цель</div>
                        </div>
                    </div>

                    <div class="meal-summary-side meal-summary-side-right">
                        <div class="meal-summary-side-value">—</div>
                        <div class="meal-summary-side-label">&nbsp;</div>
                    </div>
                </div>

                <div class="meal-summary-bars">
                    ${buildMealGoalBar({
                        title: 'Белки',
                        eaten: proteinData.eaten,
                        target: proteinData.target,
                        percent: proteinData.percent
                    })}

                    ${buildMealGoalBar({
                        title: 'Жиры',
                        eaten: fatData.eaten,
                        target: fatData.target,
                        percent: fatData.percent
                    })}

                    ${buildMealGoalBar({
                        title: 'Углеводы',
                        eaten: carbsData.eaten,
                        target: carbsData.target,
                        percent: carbsData.percent
                    })}
                </div>

                ${buildMealGoalCompactCard({
                    eatenCalories,
                    caloriesGoal,
                    caloriesData,
                    proteinData,
                    fatData,
                    carbsData
                })}
            </div>
        `;
        bindMealGoalSummaryToggle(row);
        return;
    }

    const carbsKcal = eatenCarbs * 4;
    const fatKcal = eatenFat * 9;
    const proteinKcal = eatenProtein * 4;

    const totalFactKcal = Math.max(1, proteinKcal + fatKcal + carbsKcal);

    const proteinPercent = (proteinKcal / totalFactKcal) * 100;
    const fatPercent = (fatKcal / totalFactKcal) * 100;
    const carbsPercent = (carbsKcal / totalFactKcal) * 100;

    row.innerHTML = `
        <div
            class="meal-summary-card meal-summary-card-no-goal ${mealNoGoalSummaryCurrentMode ? 'meal-summary-card-no-goal--current' : ''}"
            role="button"
            tabindex="0"
            aria-label="Переключить вид БЖУ"
            aria-pressed="${mealNoGoalSummaryCurrentMode ? 'true' : 'false'}"
        >
            <div class="meal-summary-top meal-summary-top-no-goal">
                <div class="meal-summary-center meal-summary-center-no-goal">
                    ${buildMealSplitArc({
                        carbsKcal,
                        fatKcal,
                        proteinKcal,
                        totalKcal: eatenCalories
                    })}
                    <div class="meal-summary-center-text">
                        <div class="meal-summary-center-value">${eatenCalories}</div>
                        <div class="meal-summary-center-label">Всего</div>
                    </div>
                </div>
            </div>

            <div class="meal-summary-bars meal-summary-bars-fact">


                ${buildMealFactBar({
                    title: 'Белки',
                    value: eatenProtein,
                    percent: proteinPercent
                })}

                ${buildMealFactBar({
                    title: 'Жиры',
                    value: eatenFat,
                    percent: fatPercent
                })}

                ${buildMealFactBar({
                    title: 'Углеводы',
                    value: eatenCarbs,
                    percent: carbsPercent
                })}
            </div>

            ${buildMealSummaryCurrentCard({
                eatenCalories,
                eatenProtein,
                eatenFat,
                eatenCarbs,
                carbsPercent,
                fatPercent,
                proteinPercent
            })}
        </div>
    `;

    bindMealNoGoalSummaryToggle(row);
}


function calcFoodMacrosByAmount(food, amount) {
    const baseAmount = Number(food?.baseAmount || 100) || 100;
    const currentAmount = Number(amount || 0);

    const factor = currentAmount / baseAmount;

    return {
        calories: (Number(food?.calories || 0) * factor),
        protein: (Number(food?.protein || 0) * factor),
        fat: (Number(food?.fat || 0) * factor),
        carbs: (Number(food?.carbs || 0) * factor)
    };
}

/** Документ продукта: библиотека пользователя, иначе старый путь внутри цикла. */
async function getFoodDocumentRef(foodId) {
    if (!foodId) return null;
    const libCol = getMealLibraryFoodsCollection();
    const cycleRef = getCycleDocRef();
    if (libCol) {
        const r = doc(libCol, foodId);
        const s = await getDoc(r);
        if (s.exists()) return r;
    }
    if (cycleRef) return doc(cycleRef, 'foods', foodId);
    return null;
}

/** Документ рецепта: библиотека пользователя, иначе старый путь внутри цикла. */
async function getRecipeDocumentRef(recipeId) {
    if (!recipeId) return null;
    const libCol = getMealLibraryRecipesCollection();
    const cycleRef = getCycleDocRef();
    if (libCol) {
        const r = doc(libCol, recipeId);
        const s = await getDoc(r);
        if (s.exists()) return r;
    }
    if (cycleRef) return doc(cycleRef, 'recipes', recipeId);
    return null;
}

async function saveFoodEntity(foodId, payload) {
    if (!foodId) return null;

    const cleanPayload = {
        name: String(payload.name || '').trim(),
        nameLower: normalizeSearchText(payload.name),
        searchTokens: buildMealSearchTokens(payload.name),
        description: String(payload.description || '').trim(),
        baseAmount: Number(payload.baseAmount || 0),
        baseUnit: String(payload.baseUnit || 'г').trim(),
        defaultAmount: Number(payload.defaultAmount || payload.baseAmount || 0),
        nutritionBasis: String(payload.nutritionBasis || payload.baseUnit || 'г').trim(),
        portionSizeUnit: String(payload.portionSizeUnit || payload.baseUnit || 'г').trim(),
        protein: Number(payload.protein || 0),
        fat: Number(payload.fat || 0),
        carbs: Number(payload.carbs || 0),
        calories: Number(payload.calories || 0)
    };

    const foodRef = await getFoodDocumentRef(foodId);
    if (!foodRef) return null;
    await updateDoc(foodRef, cleanPayload);
    await syncSharedFoodToGlobalCatalogIfNeeded(foodId, cleanPayload);

    if (foodsMapCache && foodsMapLibraryKey === getMealLibraryContextKey()) {
        foodsMapCache[foodId] = {
            ...(foodsMapCache[foodId] || {}),
            ...cleanPayload
        };
    }

    return cleanPayload;
}

const FOOD_NUTRITION_BASIS_OPTIONS = ['г', 'мл', 'порция'];
const FOOD_PORTION_MEASURE_OPTIONS = ['г', 'мл'];
const FOOD_LOCKED_PORTION_AMOUNT = 100;

function normalizeFoodPortionUnit(unit) {
    return String(unit || '').trim() === 'мл' ? 'мл' : 'г';
}

function resolveFoodNutritionBasis(food) {
    const savedBasis = String(food?.nutritionBasis || '').trim();
    if (FOOD_NUTRITION_BASIS_OPTIONS.includes(savedBasis)) {
        return savedBasis;
    }

    const baseUnit = String(food?.baseUnit || '').trim();
    if (baseUnit === 'мл') return 'мл';
    if (baseUnit === 'г') return 'г';
    return 'порция';
}

function buildFoodNutritionPayload(selectedBasis, portionValue, portionMeasureUnit) {
    const nutritionBasis = FOOD_NUTRITION_BASIS_OPTIONS.includes(selectedBasis) ? selectedBasis : 'г';
    const baseUnit = nutritionBasis === 'порция'
        ? normalizeFoodPortionUnit(portionMeasureUnit)
        : (nutritionBasis === 'мл' ? 'мл' : 'г');
    const baseAmount = nutritionBasis === 'порция'
        ? Number(portionValue || 0)
        : FOOD_LOCKED_PORTION_AMOUNT;

    return {
        nutritionBasis,
        portionSizeUnit: baseUnit,
        baseUnit,
        baseAmount,
        defaultAmount: baseAmount
    };
}

function getFoodGlobalCatalogId(food = {}) {
    return String(food.sharedGlobalCatalogId || food.globalCatalogSourceId || '').trim();
}

function isFoodLinkedToGlobalCatalog(food = {}) {
    return getFoodGlobalCatalogId(food).length > 0 || food.source === 'globalCatalogImport';
}

function isFoodImportedFromGlobalCatalog(food = {}) {
    return food.source === 'globalCatalogImport' || Boolean(food.globalCatalogImported);
}

function getMealSearchSharedBadgeMarkup() {
    return `
        <span class="meal-search-shared-badge" title="В общей базе" aria-label="В общей базе">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="currentColor" d="M9.55 18.55 3.8 12.8l1.4-1.4 4.35 4.35 9.25-9.25 1.4 1.4z"/>
            </svg>
        </span>
    `;
}

function escapeMealHtml(value) {
    return String(value || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function buildMealSearchFoodNameMarkup(name, isShared = false) {
    return `
        <div class="meal-search-item-name">
            <span class="meal-search-item-name-text">${escapeMealHtml(name || 'Продукт')}</span>
            ${isShared ? getMealSearchSharedBadgeMarkup() : ''}
        </div>
    `;
}

function invalidateFoodPreviewCaches() {
    foodsPreviewCache = null;
    foodsPreviewCacheKey = null;
    historyPreviewCache = null;
    historyPreviewCacheKey = null;
}

function patchFoodSearchCardSharedBadge(foodId) {
    if (!mealOverlayEl || !foodId) return;
    const food = foodsMapCache?.[foodId];
    if (!food) return;

    mealOverlayEl.querySelectorAll(`.meal-search-item[data-food-id="${foodId}"]`).forEach(card => {
        const nameEl = card.querySelector('.meal-search-item-name');
        if (!nameEl) return;
        nameEl.outerHTML = buildMealSearchFoodNameMarkup(food.name, isFoodLinkedToGlobalCatalog(food));
    });
}

async function findLocalFoodIdByGlobalCatalogId(catalogId) {
    const id = String(catalogId || '').trim();
    if (!id) return null;

    const foodsMap = await getFoodsMap();
    const entry = Object.entries(foodsMap || {}).find(([, row]) => getFoodGlobalCatalogId(row) === id);
    return entry ? entry[0] : null;
}

function buildGlobalCatalogImportPayload(row = {}, catalogId, defaultAmount = null) {
    const amount = defaultAmount != null
        ? Number(defaultAmount)
        : Number(row.defaultAmount ?? row.baseAmount ?? 100);

    return {
        name: String(row.name || 'Продукт').trim(),
        description: String(row.description || '').trim(),
        baseAmount: Number(row.baseAmount || 100),
        baseUnit: String(row.baseUnit || 'г'),
        protein: Number(row.protein || 0),
        fat: Number(row.fat || 0),
        carbs: Number(row.carbs || 0),
        calories: Number(row.calories || 0),
        defaultAmount: Number(amount || row.baseAmount || 100),
        source: 'globalCatalogImport',
        globalCatalogImported: true,
        globalCatalogSourceId: String(catalogId || '').trim(),
        sharedGlobalCatalogId: String(catalogId || '').trim(),
        sharedGlobalImportedAt: Date.now(),
        globalCatalogCreatedByUid: String(row.createdByUid || '').trim()
    };
}

async function ensureGlobalCatalogFoodSaved(row = {}, catalogId, defaultAmount = null) {
    const existingId = await findLocalFoodIdByGlobalCatalogId(catalogId);
    if (existingId) return existingId;

    return addFood(buildGlobalCatalogImportPayload(row, catalogId, defaultAmount), { skipGlobalMirror: true });
}

async function unlinkLocalFoodFromGlobalCatalog(foodId) {
    const libCol = getMealLibraryFoodsCollection();
    const id = String(foodId || '').trim();
    if (!libCol || !id) return;

    const libRef = doc(libCol, id);
    await updateDoc(libRef, {
        sharedGlobalCatalogId: deleteField(),
        sharedGlobalSharedAt: deleteField(),
        sharedGlobalCreatedByUid: deleteField()
    });

    if (foodsMapCache && foodsMapLibraryKey === getMealLibraryContextKey() && foodsMapCache[id]) {
        delete foodsMapCache[id].sharedGlobalCatalogId;
        delete foodsMapCache[id].sharedGlobalSharedAt;
        delete foodsMapCache[id].sharedGlobalCreatedByUid;
    }

    invalidateFoodPreviewCaches();
    patchFoodSearchCardSharedBadge(id);
}

async function syncSharedFoodToGlobalCatalogIfNeeded(foodId, patch) {
    try {
        const libCol = getMealLibraryFoodsCollection();
        const gCol = getGlobalFoodCatalogCollection();
        const uid = getCurrentAuthUid();
        if (!libCol || !gCol || !uid || !foodId) return;

        const libRef = doc(libCol, foodId);
        const libSnap = await getDoc(libRef);
        if (!libSnap.exists()) return;
        const data = libSnap.data() || {};
        if (isFoodImportedFromGlobalCatalog(data)) return;

        const ownerUid = String(data.sharedGlobalCreatedByUid || '').trim();
        if (ownerUid && ownerUid !== uid) return;

        const sharedId = getFoodGlobalCatalogId(data);
        if (!sharedId) return;

        const gRef = doc(gCol, sharedId);
        const upd = { ...(patch || {}) };
        if (upd.name != null) {
            upd.nameLower = normalizeSearchText(upd.name);
            upd.searchTokens = buildMealSearchTokens(upd.name);
        }
        if (upd.defaultAmount != null) upd.defaultAmount = Number(upd.defaultAmount || 0);
        await updateDoc(gRef, upd);
    } catch (e) {
        console.warn('syncSharedFoodToGlobalCatalogIfNeeded failed', e?.code || e);
    }
}

async function addFoodSnapshotToCurrentMeal(food, grams) {
    const cycleRef = getCycleDocRef();
    if (!cycleRef) return;

    const mealRef = doc(cycleRef, 'meals', state.selectedDate);

    await setDoc(mealRef, {
        [state.currentMealId]: arrayUnion({
            id: crypto.randomUUID(),
            foodId: state.currentFoodId,
            grams: Number(grams || food.defaultAmount || food.baseAmount || 100),

            name: food.name || '',
            description: food.description || '',
            baseAmount: Number(food.baseAmount || 100),
            baseUnit: food.baseUnit || 'г',

            protein: Number(food.protein || 0),
            fat: Number(food.fat || 0),
            carbs: Number(food.carbs || 0),
            calories: Number(food.calories || 0)
        })
    }, { merge: true });
}

function parseMealDecimalInput(value, fallback = null) {
    const raw = String(value ?? '').trim().replace(',', '.');
    if (!raw) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
}

async function addQuickFoodToCurrentMeal(payload = {}) {
    const cycleRef = getCycleDocRef();
    if (!cycleRef || !state.currentMealId || !state.selectedDate) return false;

    const name = String(payload.name || '').trim();
    if (!name) return false;

    const portionSize = parseMealDecimalInput(payload.portionSize, null);
    const protein = Math.max(0, parseMealDecimalInput(payload.protein, 0) || 0);
    const fat = Math.max(0, parseMealDecimalInput(payload.fat, 0) || 0);
    const carbs = Math.max(0, parseMealDecimalInput(payload.carbs, 0) || 0);
    const manualCalories = parseMealDecimalInput(payload.calories, null);
    const hasPortionSize = portionSize != null && portionSize > 0;
    const baseAmount = hasPortionSize ? portionSize : 1;
    const baseUnit = hasPortionSize ? 'г' : 'порц';
    const calories = Math.max(
        0,
        manualCalories != null
            ? manualCalories
            : Number((protein * 4 + fat * 9 + carbs * 4).toFixed(1))
    );

    const mealRef = doc(cycleRef, 'meals', state.selectedDate);

    await setDoc(mealRef, {
        [state.currentMealId]: arrayUnion({
            id: crypto.randomUUID(),
            isQuickAdded: true,
            hideWeightDisplay: !hasPortionSize,
            planned: false,
            name,
            description: '',
            grams: baseAmount,
            baseAmount,
            baseUnit,
            protein,
            fat,
            carbs,
            calories,
            createdAt: Date.now()
        })
    }, { merge: true });

    return true;
}

async function addRecipeToCurrentMeal(recipe, servings) {
    const cycleRef = getCycleDocRef();
    if (!cycleRef || !state.currentMealId) return;

    const mealRef = doc(cycleRef, 'meals', state.selectedDate);

    const baseServings = Math.max(0.1, Number(recipe.servings || 1));
    const currentServings = Math.max(0.1, Number(servings || baseServings));
    const factor = currentServings / baseServings;

    const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];

    const totals = ingredients.reduce((acc, item) => {
        acc.protein += Number(item.protein || 0) * factor;
        acc.fat += Number(item.fat || 0) * factor;
        acc.carbs += Number(item.carbs || 0) * factor;
        acc.calories += Number(item.calories || 0) * factor;
        return acc;
    }, {
        protein: 0,
        fat: 0,
        carbs: 0,
        calories: 0
    });

    await setDoc(mealRef, {
        [state.currentMealId]: arrayUnion({
            id: crypto.randomUUID(),
            recipeId: recipe.id,
            isRecipe: true,
            name: recipe.title || '',
            description: recipe.description || '',
            servings: currentServings,
            baseServings,
            grams: currentServings,
            baseAmount: 1,
            baseUnit: 'порц',
            protein: totals.protein / currentServings,
            fat: totals.fat / currentServings,
            carbs: totals.carbs / currentServings,
            calories: totals.calories / currentServings,
            ingredients: ingredients
        })
    }, { merge: true });

    const recipeRef = await getRecipeDocumentRef(recipe.id);
    if (recipeRef) {
        await updateDoc(recipeRef, { defaultServings: currentServings });
    }
    if (recipesCache && recipesCacheLibraryKey === getMealLibraryContextKey()) {
        const cached = recipesCache.find(r => r && r.id === recipe.id);
        if (cached) cached.defaultServings = currentServings;
    }
    recipesPreviewCache = null;
    recipesPreviewCacheKey = null;
    historyPreviewCache = null;
    historyPreviewCacheKey = null;
}

function isMealPhotoItem(item = {}) {
    return item?.isMealPhoto === true && typeof item?.photoUrl === 'string' && item.photoUrl.trim().length > 0;
}

async function addMealPhotoToCurrentMeal(mealId, photoUrl) {
    const cycleRef = getCycleDocRef();
    if (!cycleRef || !mealId || !state.selectedDate || !photoUrl) return;

    const mealRef = doc(cycleRef, 'meals', state.selectedDate);

    await setDoc(mealRef, {
        [mealId]: arrayUnion({
            id: crypto.randomUUID(),
            isMealPhoto: true,
            photoUrl: String(photoUrl).trim(),
            name: 'Фото продукта',
            planned: false,
            createdAt: Date.now()
        })
    }, { merge: true });
}

function getMealCameraIconMarkup() {
    return `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><title>Outline-photo-camera SVG Icon</title><path fill="currentColor" d="m14.12 4l1.83 2H20v12H4V6h4.05l1.83-2zM15 2H9L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17zm-3 7c1.65 0 3 1.35 3 3s-1.35 3-3 3s-3-1.35-3-3s1.35-3 3-3m0-2c-2.76 0-5 2.24-5 5s2.24 5 5 5s5-2.24 5-5s-2.24-5-5-5"/></svg>
    `;
}

function getMealQuickAddIconMarkup() {
    return `
        <svg xmlns="http://www.w3.org/2000/svg" version="1.1" xmlns:xlink="http://www.w3.org/1999/xlink" id="РВконка 7" viewBox="0 0 17 12">
          <g>
            <path fill="none" fill-rule="evenodd" d="M6.5,12.39 L6.5,12.39 L6.44,12.4 L6.43,12.4 L6.43,12.4 L6.38,12.39 C6.38,12.37 6.38,12.39 6.37,12.39 L6.37,12.39 L6.36,12.64 L6.37,12.65 L6.37,12.65 L6.43,12.7 L6.44,12.7 L6.44,12.7 L6.51,12.65 L6.51,12.65 L6.52,12.64 L6.51,12.39 C6.51,12.39 6.5,12.39 6.5,12.39 M6.65,12.31 L6.65,12.31 L6.53,12.37 L6.53,12.37 L6.53,12.39 L6.53,12.62 L6.54,12.64 L6.54,12.64 L6.66,12.69 C6.68,12.7 6.68,12.7 6.69,12.69 L6.69,12.68 L6.66,12.32 C6.66,12.32 6.66,12.31 6.65,12.31 M6.23,12.31 C6.23,12.31 6.22,12.31 6.22,12.32 L6.22,12.32 L6.19,12.68 C6.19,12.69 6.2,12.69 6.2,12.7 L6.22,12.69 L6.34,12.64 L6.35,12.64 L6.35,12.62 L6.35,12.39 L6.35,12.37 L6.35,12.37 Z"/>
          </g>
          <path fill="currentColor" d="M14.26,0C14.61,0,14.83,.25,14.83,.57L14.83,2.03L16.39,2.03C16.75,2.03,17,2.26,17,2.61C17,2.94,16.75,3.18,16.39,3.18L14.83,3.18L14.83,4.65C14.83,4.97,14.61,5.22,14.26,5.22C13.89,5.22,13.65,4.97,13.65,4.65L13.65,3.18L12.1,3.18C11.74,3.18,11.49,2.94,11.49,2.61C11.49,2.26,11.74,2.03,12.1,2.03L13.65,2.03L13.65,.57C13.65,.25,13.89,0,14.26,0"/>
          <g>
            <path fill="none" fill-rule="evenodd" d="M6.44,12.09 L6.44,12.09 L6.39,12.1 L6.38,12.1 L6.38,12.1 L6.34,12.09 C6.34,12.08 6.34,12.09 6.31,12.09 L6.31,12.09 L6.3,12.34 L6.31,12.36 L6.31,12.36 L6.38,12.4 L6.39,12.4 L6.39,12.4 L6.46,12.36 L6.46,12.36 L6.47,12.34 L6.46,12.09 C6.46,12.09 6.44,12.09 6.44,12.09 M6.6,12.02 L6.6,12.02 L6.48,12.08 L6.48,12.08 L6.48,12.09 L6.48,12.32 L6.49,12.34 L6.49,12.34 L6.61,12.39 C6.63,12.4 6.63,12.4 6.63,12.39 L6.63,12.38 L6.61,12.03 C6.61,12.03 6.61,12.02 6.6,12.02 M6.18,12.02 C6.18,12.02 6.17,12.02 6.17,12.03 L6.17,12.03 L6.15,12.38 C6.15,12.39 6.16,12.39 6.16,12.4 L6.17,12.39 L6.29,12.34 L6.29,12.34 L6.29,12.32 L6.29,12.09 L6.29,12.08 L6.29,12.08 Z"/>
            <g>
              <path fill="none" fill-rule="evenodd" d="M6.35,12.48 L6.35,12.48 L6.29,12.51 L6.28,12.51 L6.28,12.51 L6.24,12.48 C6.24,12.47 6.24,12.48 6.23,12.48 L6.23,12.48 L6.22,12.74 L6.23,12.75 L6.23,12.75 L6.28,12.8 L6.29,12.8 L6.29,12.8 L6.36,12.75 L6.36,12.75 L6.37,12.74 L6.36,12.48 C6.36,12.48 6.35,12.48 6.35,12.48 M6.51,12.41 L6.51,12.41 L6.38,12.47 L6.38,12.47 L6.38,12.48 L6.38,12.73 L6.39,12.74 L6.39,12.74 L6.52,12.79 C6.54,12.8 6.54,12.8 6.55,12.79 L6.55,12.78 L6.52,12.43 C6.52,12.43 6.52,12.41 6.51,12.41 M6.08,12.41 C6.08,12.41 6.06,12.41 6.06,12.43 L6.06,12.43 L6.04,12.78 C6.04,12.79 6.05,12.79 6.05,12.8 L6.06,12.79 L6.18,12.74 L6.2,12.74 L6.2,12.73 L6.2,12.48 L6.2,12.47 L6.2,12.47 Z"/>
              <path fill="currentColor" fill-rule="evenodd" d="M3.5,1.4L1.5,5.6L3.6,5.6C4,5.6,4.32,5.83,4.2,6.2L3.1,9.3L7.7,4.8L6.1,4.8C5.89,4.8,5.69,4.77,5.58,4.61C5.47,4.44,5.47,4.23,5.56,4.05L7,1.4zM2.6,.65C2.7,.44,2.9,.3,3.15,.3L7.82,.3C8.27,.3,8.56,.74,8.36,1.14L7.04,3.75L9.01,3.75C9.53,3.75,9.81,4.37,9.42,4.73L2.39,11.57C1.96,12.01,1.21,11.56,1.41,10.99L2.91,6.6L.8,6.6C.59,6.6,.4,6.5,.3,6.34C.19,6.18,.17,5.97,.24,5.78z"/>
            </g>
          </g>
        </svg>
    `;
}

function getMealAddIconMarkup() {
    return `
        <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 14 14"><title>Add-1-solid SVG Icon</title><path fill="currentColor" fill-rule="evenodd" d="M8 1a1 1 0 0 0-2 0v5H1a1 1 0 0 0 0 2h5v5a1 1 0 1 0 2 0V8h5a1 1 0 1 0 0-2H8z" clip-rule="evenodd"/></svg>
    `;
}

function openQuickAddForm(backTarget = 'search', mealId = null) {
    if (mealId) {
        state.currentMealId = mealId;
    }
    state.quickAddBackTarget = backTarget;
    state.mealView = 'quickAdd';
    renderMealPage();
}

function openMealSearchForMeal(mealId) {
    if (!mealId) return;

    const now = Date.now();
    if (
        lastMealSearchOpenFromCardMealId === mealId &&
        now - lastMealSearchOpenFromCardAt < 380
    ) {
        return;
    }

    lastMealSearchOpenFromCardAt = now;
    lastMealSearchOpenFromCardMealId = mealId;

    saveMealPageScroll();
    mealScrollRestorePending = true;

    state.currentMealId = mealId;
    state.mealView = 'search';
    renderMealPage();
    installMealHeaderSearchGhostClickGuard();
}

function openMealPhotoCaptureFlow(mealId) {
    if (!mealId) return;

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.capture = 'environment';
    fileInput.style.display = 'none';
    document.body.append(fileInput);

    let overlay = null;
    let currentFile = null;
    let currentPreviewUrl = '';

    const cleanupPreviewUrl = () => {
        if (currentPreviewUrl) {
            URL.revokeObjectURL(currentPreviewUrl);
            currentPreviewUrl = '';
        }
    };

    const closeFlow = () => {
        cleanupPreviewUrl();
        overlay?.remove();
        overlay = null;
        fileInput.remove();
    };

    const openPicker = () => {
        fileInput.value = '';
        fileInput.click();
    };

    const ensureOverlay = () => {
        if (overlay) return overlay;

        overlay = createElement('div', 'modal-overlay');
        const modal = createElement('div', 'modal-content modal-compact');
        modal.style.maxWidth = '420px';
        modal.style.width = 'calc(100% - 32px)';

        const title = createElement('h3', null, 'Фото продукта');
        const hint = createElement('p', 'muted', 'Подтвердите снимок или сделайте новый.');

        const preview = createElement('img');
        preview.className = 'meal-photo-capture-preview';
        preview.style.width = '100%';
        preview.style.maxHeight = '320px';
        preview.style.objectFit = 'cover';
        preview.style.borderRadius = '14px';
        preview.style.display = 'block';
        preview.style.margin = '0 0 14px 0';
        preview.style.background = '#f3f4f6';

        const controls = createElement('div', 'modal-controls');
        const retakeBtn = createElement('button', 'btn btn-outline', 'Сделать новый');
        const saveBtn = createElement('button', 'btn btn-primary', 'Сохранить');
        controls.append(retakeBtn, saveBtn);

        retakeBtn.onclick = (e) => {
            e.stopPropagation();
            openPicker();
        };

        saveBtn.onclick = async (e) => {
            e.stopPropagation();
            if (!currentFile) return;

            retakeBtn.disabled = true;
            saveBtn.disabled = true;

            try {
                const uploadedUrl = await uploadUserMediaFileWithProgress(currentFile, 'meal-photos', (percent) => {
                    saveBtn.textContent = percent >= 100 ? 'Сохранение...' : `Загрузка ${percent}%`;
                });

                await addMealPhotoToCurrentMeal(mealId, uploadedUrl);
                closeFlow();
                showToast('Фото добавлено в прием');
            } catch (error) {
                console.error(error);
                showToast('Не удалось сохранить фото');
                retakeBtn.disabled = false;
                saveBtn.disabled = false;
                saveBtn.textContent = 'Сохранить';
            }
        };

        overlay.addEventListener('click', (event) => {
            if (event.target === overlay) {
                closeFlow();
            }
        });
        modal.addEventListener('click', (event) => event.stopPropagation());

        modal.append(title, hint, preview, controls);
        overlay.append(modal);
        overlay._previewEl = preview;
        document.body.append(overlay);
        return overlay;
    };

    fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        if (!file) {
            if (!overlay) {
                closeFlow();
            }
            return;
        }

        currentFile = file;
        cleanupPreviewUrl();
        currentPreviewUrl = URL.createObjectURL(file);

        const currentOverlay = ensureOverlay();
        const previewEl = currentOverlay._previewEl;
        if (previewEl) {
            previewEl.src = currentPreviewUrl;
        }
    });

    openPicker();
}

function calcMealsTotalsFast(mealsData = {}, foodsMap = null) {
    const total = { cal: 0, p: 0, f: 0, c: 0 };
    const mealTotals = {};

    Object.keys(mealsData || {}).forEach(mealId => {
        if (!/^meal\d+$/.test(mealId)) return;

        mealTotals[mealId] = { cal: 0, p: 0, f: 0, c: 0 };

        (mealsData[mealId] || []).forEach(item => {
            if (isMealPhotoItem(item)) return;

            const snapshotFood = {
                name: item.name,
                description: item.description,
                baseAmount: Number(item.baseAmount),
                baseUnit: item.baseUnit,
                protein: Number(item.protein),
                fat: Number(item.fat),
                carbs: Number(item.carbs),
                calories: Number(item.calories)
            };

            const hasSnapshotFood =
                snapshotFood.name &&
                Number.isFinite(snapshotFood.baseAmount) &&
                !!snapshotFood.baseUnit;

            const food = hasSnapshotFood ? snapshotFood : foodsMap?.[item.foodId];
            if (!food) return;

            let cal, p, f, c;

            if (item.isRecipe && Number(item.grams) === 0) {
                cal = Number(item.calories || 0);
                p = Number(item.protein || 0);
                f = Number(item.fat || 0);
                c = Number(item.carbs || 0);
            } else {
                const amount = Number(item.grams || 0);
                const baseAmount = Number(food.baseAmount || 100) || 100;
                const factor = amount / baseAmount;

                cal = (Number(food.calories) || 0) * factor;
                p = (Number(food.protein) || 0) * factor;
                f = (Number(food.fat) || 0) * factor;
                c = (Number(food.carbs) || 0) * factor;
            }

            total.cal += cal;
            total.p += p;
            total.f += f;
            total.c += c;

            mealTotals[mealId].cal += cal;
            mealTotals[mealId].p += p;
            mealTotals[mealId].f += f;
            mealTotals[mealId].c += c;
        });
    });

    return { total, mealTotals };
}
function setupMealMacrosBorderObserver() {
    const macrosRow = document.getElementById('meal-macros-row');
    const mealsContainer = document.getElementById('meals-container');
    const scrollRoot = document.getElementById('root');

    if (typeof cleanupMealMacrosBorderObserver === 'function') {
        cleanupMealMacrosBorderObserver();
        cleanupMealMacrosBorderObserver = null;
    }
    if (!macrosRow || !mealsContainer || !scrollRoot) return;

    let ticking = false;
    let isBorderVisible = false;

    const EPS = 0.5;

    const updateBorderState = () => {
        ticking = false;

        const macrosRect = macrosRow.getBoundingClientRect();
        const mealsRect = mealsContainer.getBoundingClientRect();

        const hasOverlap = mealsRect.top < macrosRect.bottom - EPS;

        if (hasOverlap !== isBorderVisible) {
            isBorderVisible = hasOverlap;
            macrosRow.classList.toggle('meal-macros-row-stuck-border', hasOverlap);
        }
    };

    const onScroll = () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(updateBorderState);
    };

    const onTouchEnd = () => {
        requestAnimationFrame(updateBorderState);
    };

    const onResize = () => {
        updateBorderState();
    };

    updateBorderState();

    scrollRoot.addEventListener('scroll', onScroll, { passive: true });
    scrollRoot.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('resize', onResize);

    cleanupMealMacrosBorderObserver = () => {
        scrollRoot.removeEventListener('scroll', onScroll);
        scrollRoot.removeEventListener('touchend', onTouchEnd);
        window.removeEventListener('resize', onResize);
        macrosRow.classList.remove('meal-macros-row-stuck-border');
    };
}

function setupTopBarMealBorderObserver() {
    const topBar = document.querySelector('.top-bar');
    const scrollRoot = document.getElementById('root');

    if (typeof cleanupTopBarMealBorderObserver === 'function') {
        cleanupTopBarMealBorderObserver();
        cleanupTopBarMealBorderObserver = null;
    }
    if (!topBar || !scrollRoot) return;

    const title = document.querySelector('.meal-page > h3');
    const weekHeader = document.querySelector('.week-strip-header');
    const weekRow = document.querySelector('.week-row');
    const macrosRow = document.getElementById('meal-macros-row');

    if (!title) return;

    let ticking = false;
    let isBorderVisible = false;
    let latched = false;
    let prevMacrosIsStuck = false;
    const EPS = 0.5;

    const updateBorderState = () => {
        ticking = false;

        const topRect = topBar.getBoundingClientRect();
        const topBottom = topRect.bottom;

        const macrosRect = macrosRow ? macrosRow.getBoundingClientRect() : null;
        const macrosIsStuck = !!(macrosRect && macrosRect.top <= topBottom + EPS);

        const titleRect = title.getBoundingClientRect();
        const titleIsUnderTopBar = titleRect.top < topBottom - EPS; // как только заголовок "заехал" под top-bar
        const titleFullyOutFromUnder = titleRect.top >= topBottom - EPS; // полностью вышел из-под top-bar (сверху)

        // 1) Пристыкованный macrosRow имеет приоритет: бордер у top-bar скрываем.
        if (macrosIsStuck) {
            latched = false;
        } else {
            // 2) Как только h3 заехал под top-bar — защёлкиваем бордер.
            if (titleIsUnderTopBar) {
                latched = true;
            }

            // 3) При обратном скролле: как только macrosRow отстыковался — бордер включаем сразу,
            //    но держим его только до момента, когда h3 полностью выйдет из-под top-bar.
            if (prevMacrosIsStuck && !macrosIsStuck) {
                latched = !titleFullyOutFromUnder;
            }

            // 4) Если h3 полностью вышел из-под top-bar — можно отпустить защёлку.
            if (latched && titleFullyOutFromUnder) {
                latched = false;
            }
        }

        const shouldShow = latched && !macrosIsStuck;

        if (shouldShow !== isBorderVisible) {
            isBorderVisible = shouldShow;
            topBar.classList.toggle('top-bar-stuck-border', shouldShow);
        }

        prevMacrosIsStuck = macrosIsStuck;
    };

    const onScroll = () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(updateBorderState);
    };

    const onTouchEnd = () => {
        requestAnimationFrame(updateBorderState);
    };

    const onResize = () => {
        updateBorderState();
    };

    updateBorderState();

    scrollRoot.addEventListener('scroll', onScroll, { passive: true });
    scrollRoot.addEventListener('touchend', onTouchEnd, { passive: true });
    window.addEventListener('resize', onResize);

    cleanupTopBarMealBorderObserver = () => {
        scrollRoot.removeEventListener('scroll', onScroll);
        scrollRoot.removeEventListener('touchend', onTouchEnd);
        window.removeEventListener('resize', onResize);
        topBar.classList.remove('top-bar-stuck-border');
    };
}

function teardownMealBorderObservers() {
    if (typeof cleanupMealMacrosBorderObserver === 'function') {
        cleanupMealMacrosBorderObserver();
        cleanupMealMacrosBorderObserver = null;
    }
    if (typeof cleanupTopBarMealBorderObserver === 'function') {
        cleanupTopBarMealBorderObserver();
        cleanupTopBarMealBorderObserver = null;
    }
    document.getElementById('meal-macros-row')?.classList.remove('meal-macros-row-stuck-border');
    document.querySelector('.top-bar')?.classList.remove('top-bar-stuck-border');
}

function renderMealMacrosImmediately() {
    const row = document.getElementById('meal-macros-row');
    if (!row) return false;

    const cacheKey = getMealTotalsCacheKey();
    const cached = mealTotalsCache[cacheKey];

    if (cached) {
        renderMealMacrosRow(cached);
        return true;
    }

    const localMealsData = state.mealsData || {};
    const mealKeys = Object.keys(localMealsData).filter(key => /^meal\d+$/.test(key));

    if (mealKeys.length > 0) {
        const { total } = calcMealsTotalsFast(localMealsData);
        renderMealMacrosRow(total);
        return true;
    }

    renderMealMacrosRow({ cal: 0, p: 0, f: 0, c: 0 });
    return true;
}



function getFoodSubtitleByAmount(food, amount) {
    const currentAmount = Number(amount || food?.defaultAmount || food?.baseAmount || 100);
    const unit = food?.baseUnit || 'г';
    const macros = calcFoodMacrosByAmount(food, currentAmount);

    return `${Math.round(macros.calories)} ккал, ${currentAmount}${unit}`;
}

function getMealTotalsCacheKey(dateStr = state.selectedDate) {
    return `${state.selectedCycleId || 'no-cycle'}__${dateStr || 'no-date'}`;
}

function getSelectedDayTitle(dateStr) {
    const today = new Date();
    const yesterday = new Date();
    const tomorrow = new Date();

    yesterday.setDate(today.getDate() - 1);
    tomorrow.setDate(today.getDate() + 1);

    const todayStr = formatLocalDate(today);
    const yesterdayStr = formatLocalDate(yesterday);
    const tomorrowStr = formatLocalDate(tomorrow);

    if (dateStr === todayStr) return 'Сегодня';
    if (dateStr === yesterdayStr) return 'Вчера';
    if (dateStr === tomorrowStr) return 'Завтра';

    const d = new Date(`${dateStr}T00:00:00`);
    const days = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
    const months = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

    return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]}`;
}

function hasAnyFoodInDoc(data = {}) {
    return Object.keys(data).some(key => {
        return /^meal\d+$/.test(key) && Array.isArray(data[key]) && data[key].length > 0;
    });
}

function getMonthPresenceKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
}

function getMonthDateRange(monthDate) {
    const start = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const end = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);

    return {
        startStr: formatLocalDate(start),
        endStr: formatLocalDate(end)
    };
}

async function getMonthMealsPresence(monthDate) {
    const cycleId = state.selectedCycleId;
    const monthKey = getMonthPresenceKey(monthDate);

    if (monthMealsPresenceCycleId !== cycleId) {
        monthMealsPresenceCache = {};
        monthMealsPresenceCycleId = cycleId;
    }

    if (monthMealsPresenceCache[monthKey]) {
        return monthMealsPresenceCache[monthKey];
    }

    const cycleRef = getCycleDocRef();
    const mealsCol = collection(cycleRef, 'meals');
    const { startStr, endStr } = getMonthDateRange(monthDate);

    const result = {};

    const q = query(
        mealsCol,
        where(documentId(), '>=', startStr),
        where(documentId(), '<=', endStr)
    );

    const snap = await getDocs(q);

    snap.forEach(docSnap => {
        result[docSnap.id] = hasAnyFoodInDoc(docSnap.data());
    });

    // чтобы текущий выбранный день сразу был актуален,
    // даже если он еще не совпал с серверным состоянием
    if (state.selectedDate && mealsDataLoadedDate === state.selectedDate && state.mealsData) {
        const selectedMonthKey = state.selectedDate.slice(0, 7);
        if (selectedMonthKey === monthKey) {
            result[state.selectedDate] = hasAnyFoodInDoc(state.mealsData);
        }
    }

    monthMealsPresenceCache[monthKey] = result;
    return result;
}

function buildMonthMealsDailySummaryEntry(dateStr, mealsDoc = {}, foodsMap = null, healthDaily = null) {
    const { total } = calcMealsTotalsFast(mealsDoc, foodsMap);
    const hasFood = hasAnyFoodInDoc(mealsDoc);
    const eatenCalories = Math.round(Number(total.cal || 0));
    const activeGoal = getActiveMealGoalForDate(dateStr);
    const goalCalories = Number(activeGoal?.calories || 0);
    const eatenPercent = hasFood && goalCalories > 0
        ? Math.max(0, Math.round((eatenCalories / goalCalories) * 100))
        : null;

    return {
        date: dateStr,
        hasFood,
        eatenCalories,
        burnedCalories: healthDaily?.totalBurned ?? null,
        healthDaily,
        goalCalories,
        eatenPercent
    };
}

function normalizeAppleHealthDailyEntry(dateStr, raw = {}) {
    const steps = Math.max(0, Math.round(Number(raw?.steps || 0) || 0));
    const activeKcalRaw = Number(raw?.activeKcal || 0);
    const activeKcal = Number.isFinite(activeKcalRaw) && activeKcalRaw > 0
        ? Math.round(activeKcalRaw * 10) / 10
        : 0;
    const restingKcalRaw = Number(raw?.restingKcal || 0);
    const restingKcal = Number.isFinite(restingKcalRaw) && restingKcalRaw > 0
        ? Math.round(restingKcalRaw * 10) / 10
        : 0;
    const exerciseMinutes = Math.max(0, Math.round(Number(raw?.exerciseMinutes || 0) || 0));
    const distanceKmRaw = Number(raw?.distanceKm || 0);
    const distanceKm = Number.isFinite(distanceKmRaw) && distanceKmRaw > 0
        ? Math.round(distanceKmRaw * 100) / 100
        : 0;
    const heartRateAvg = Math.max(0, Math.round(Number(raw?.heartRateAvg || 0) || 0));
    const standHoursRaw = Number(raw?.standHours);
    const standHours = Number.isFinite(standHoursRaw) && standHoursRaw >= 0
        ? Math.round(standHoursRaw)
        : null;

    return {
        date: dateStr,
        steps,
        activeKcal,
        restingKcal,
        totalBurned: Math.round((activeKcal + restingKcal) * 10) / 10,
        exerciseMinutes,
        distanceKm,
        heartRateAvg,
        standHours,
        updatedAt: raw?.updatedAt || null,
        source: raw?.source || ''
    };
}

async function getAppleHealthDailyForDate(dateStr) {
    if (state.currentMode !== 'own') return null;
    const ref = getCurrentUserHealthDailyDocRef(dateStr);
    if (!ref) return null;
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    return normalizeAppleHealthDailyEntry(dateStr, snap.data() || {});
}

async function getAppleHealthMonthMap(monthDate) {
    if (state.currentMode !== 'own') return {};
    const healthCol = getCurrentUserHealthDailyCollection();
    if (!healthCol) return {};

    const { startStr, endStr } = getMonthDateRange(monthDate);
    const result = {};
    const q = query(
        healthCol,
        where(documentId(), '>=', startStr),
        where(documentId(), '<=', endStr)
    );
    const snap = await getDocs(q);
    snap.forEach((docSnap) => {
        result[docSnap.id] = normalizeAppleHealthDailyEntry(docSnap.id, docSnap.data() || {});
    });
    return result;
}

function getMonthMealsDailySummaryCacheKey(monthDate) {
    return `${state.selectedCycleId || 'no-cycle'}__${getMealSummaryMonthKey(monthDate)}`;
}

function updateCachedMonthMealsDailySummaryForDate(dateStr, mealsDoc = {}) {
    if (!dateStr) return;

    const cycleId = state.selectedCycleId;
    if (monthMealsDailySummaryCycleId !== cycleId) {
        monthMealsDailySummaryCache = {};
        monthMealsDailySummaryCycleId = cycleId;
        return;
    }

    const monthDate = getMonthStart(parseLocalDate(dateStr));
    const cacheKey = getMonthMealsDailySummaryCacheKey(monthDate);
    if (!monthMealsDailySummaryCache[cacheKey]) return;

    const foodsMap = foodsMapCache && foodsMapLibraryKey === getMealLibraryContextKey()
        ? foodsMapCache
        : null;
    const cachedHealth = monthMealsDailySummaryCache[cacheKey]?.[dateStr]?.healthDaily || null;

    monthMealsDailySummaryCache[cacheKey] = {
        ...monthMealsDailySummaryCache[cacheKey],
        [dateStr]: buildMonthMealsDailySummaryEntry(dateStr, mealsDoc, foodsMap, cachedHealth)
    };
}

function updateCachedMonthMealsDailySummaryHealthForDate(dateStr, healthDaily = null) {
    if (!dateStr) return;

    const cycleId = state.selectedCycleId;
    if (monthMealsDailySummaryCycleId !== cycleId) {
        monthMealsDailySummaryCache = {};
        monthMealsDailySummaryCycleId = cycleId;
        return;
    }

    const monthDate = getMonthStart(parseLocalDate(dateStr));
    const cacheKey = getMonthMealsDailySummaryCacheKey(monthDate);
    const cachedMonthSummary = monthMealsDailySummaryCache[cacheKey];
    if (!cachedMonthSummary) return;

    const existingEntry = cachedMonthSummary[dateStr] || null;
    if (existingEntry) {
        monthMealsDailySummaryCache[cacheKey] = {
            ...cachedMonthSummary,
            [dateStr]: {
                ...existingEntry,
                burnedCalories: healthDaily?.totalBurned ?? null,
                healthDaily: healthDaily || null
            }
        };
        return;
    }

    if (!healthDaily) return;

    const foodsMap = foodsMapCache && foodsMapLibraryKey === getMealLibraryContextKey()
        ? foodsMapCache
        : null;
    const localMealsDoc =
        state.selectedDate === dateStr &&
        mealsDataLoadedDate === state.selectedDate &&
        state.mealsData
            ? state.mealsData
            : {};

    monthMealsDailySummaryCache[cacheKey] = {
        ...cachedMonthSummary,
        [dateStr]: buildMonthMealsDailySummaryEntry(dateStr, localMealsDoc, foodsMap, healthDaily)
    };
}

async function getMonthMealsDailySummary(monthDate) {
    const cycleId = state.selectedCycleId;
    const monthKey = getMealSummaryMonthKey(monthDate);

    if (monthMealsDailySummaryCycleId !== cycleId) {
        monthMealsDailySummaryCache = {};
        monthMealsDailySummaryCycleId = cycleId;
    }

    const cacheKey = getMonthMealsDailySummaryCacheKey(monthDate);
    if (monthMealsDailySummaryCache[cacheKey]) {
        return monthMealsDailySummaryCache[cacheKey];
    }

    const cycleRef = getCycleDocRef();
    if (!cycleRef) return {};

    const [foodsMap, healthMap] = await Promise.all([
        getFoodsMap(),
        getAppleHealthMonthMap(monthDate)
    ]);
    const mealsCol = collection(cycleRef, 'meals');
    const { startStr, endStr } = getMonthDateRange(monthDate);
    const result = {};

    const q = query(
        mealsCol,
        where(documentId(), '>=', startStr),
        where(documentId(), '<=', endStr)
    );

    const snap = await getDocs(q);
    snap.forEach(docSnap => {
        result[docSnap.id] = buildMonthMealsDailySummaryEntry(
            docSnap.id,
            docSnap.data(),
            foodsMap,
            healthMap[docSnap.id] || null
        );
    });

    Object.entries(healthMap).forEach(([dateStr, healthDaily]) => {
        if (result[dateStr]) return;
        result[dateStr] = buildMonthMealsDailySummaryEntry(dateStr, {}, foodsMap, healthDaily);
    });

    if (state.selectedDate && mealsDataLoadedDate === state.selectedDate && state.mealsData) {
        if (state.selectedDate.slice(0, 7) === monthKey) {
            result[state.selectedDate] = buildMonthMealsDailySummaryEntry(
                state.selectedDate,
                state.mealsData,
                foodsMap,
                healthMap[state.selectedDate] || null
            );
        }
    }

    monthMealsDailySummaryCache[cacheKey] = result;
    return result;
}

function getMonthMealsDailySummaryStats(monthDate, dailySummary = {}) {
    let totalEaten = 0;
    let totalBurned = 0;
    let eatenDaysCount = 0;
    let percentSum = 0;
    let percentCount = 0;

    getMealSummaryMonthDays(monthDate).forEach(dateStr => {
        const entry = dailySummary[dateStr];
        if (!entry) return;

        totalEaten += Number(entry.eatenCalories || 0);
        totalBurned += Number(entry.burnedCalories || 0);

        if (entry.hasFood) {
            eatenDaysCount += 1;
        }

        if (Number.isFinite(entry.eatenPercent)) {
            percentSum += Number(entry.eatenPercent || 0);
            percentCount += 1;
        }
    });

    return {
        totalEaten: Math.round(totalEaten),
        averageEaten: eatenDaysCount ? Math.round(totalEaten / eatenDaysCount) : 0,
        averagePercent: percentCount ? Math.round(percentSum / percentCount) : null,
        totalBurned: totalBurned > 0 ? Math.round(totalBurned) : null,
        averageBurned: eatenDaysCount && totalBurned > 0 ? Math.round(totalBurned / eatenDaysCount) : null,
        totalDifference: Math.round(totalEaten - totalBurned),
        averageDifference: eatenDaysCount ? Math.round((totalEaten - totalBurned) / eatenDaysCount) : null
    };
}

async function getWeekMealsPresence(weekDates) {
    const cycleRef = getCycleDocRef();
    const mealsCol = collection(cycleRef, 'meals');

    const result = {};
    weekDates.forEach(date => {
        result[date] = false;
    });

    if (!weekDates.length) return result;

    const q = query(mealsCol, where(documentId(), 'in', weekDates));
    const snap = await getDocs(q);

    snap.forEach(docSnap => {
        result[docSnap.id] = hasAnyFoodInDoc(docSnap.data());
    });

    // чтобы текущий выбранный день сразу был актуален, даже если снапшот еще не дошел
    if (state.selectedDate && mealsDataLoadedDate === state.selectedDate && state.mealsData) {
        result[state.selectedDate] = hasAnyFoodInDoc(state.mealsData);
    }

    writeWeekMealsPresenceCache(weekDates, result);
    return result;
}

function getMealKeysForRender() {
    return getMealKeysFromData(state.mealsData || {});
}

function switchMealDate(newDate) {
    if (!newDate || state.selectedDate === newDate) return;

    state.selectedDate = newDate;

    // ❗ 1. сбрасываем старую подписку
    resetMealsListener();

    // ❗ 2. очищаем старые данные (важно)
    state.mealsData = {};
    mealsDataLoadedDate = null;

    // ❗ 3. перерисовываем экран
    renderMealMainScreen();
}


function animateMealArrow(arrow, isOpen) {
    if (!arrow) return;

    arrow.classList.remove('arrow-rotate-open', 'arrow-rotate-close');

    // форсим перезапуск анимации
    void arrow.offsetWidth;

    if (isOpen) {
        arrow.classList.add('arrow-rotate-open');
    } else {
        arrow.classList.add('arrow-rotate-close');
    }
}

async function handleAddMealSection() {
    const currentKeys = getMealKeysFromData(state.mealsData || {});

    if (currentKeys.length >= 6) return;

    const nextNumber = Math.max(
        ...currentKeys.map(k => parseInt(k.replace('meal', ''), 10))
    ) + 1;

    const newMealId = `meal${nextNumber}`;

    const cycleRef = getCycleDocRef();
    const mealRef = doc(cycleRef, 'meals', state.selectedDate);

    await setDoc(mealRef, {
        [newMealId]: []
    }, { merge: true });
}

/** Не открывать поиск дважды за один жест (pointer pure-tap + click) для той же карточки. */
let lastMealSearchOpenFromCardAt = 0;
let lastMealSearchOpenFromCardMealId = null;

/** pure-tap + click по meal-card-header — один toggle за жест. */
let lastMealHeaderToggleAt = 0;
let lastMealHeaderToggleMealId = null;

/**
 * После синхронного renderMealPage() (meal → search) часть браузеров всё же шлёт click
 * по тем же координатам; цель оказывается уже новым DOM (строка поиска или строка приёма).
 * Один такой клик в коротком окне гасим в capture-фазе.
 */
function installMealHeaderSearchGhostClickGuard() {
    const t0 = Date.now();
    const maxMs = 420;

    const detach = () => {
        clearTimeout(detachTimer);
        document.removeEventListener('click', handler, true);
    };

    const detachTimer = setTimeout(detach, maxMs + 80);

    const handler = e => {
        detach();

        if (Date.now() - t0 > maxMs) return;

        const el = e.target;
        if (!el || !el.closest) return;

        const allowed = el.closest(
            [
                '.meal-search-back-btn',
                '.meal-search-tab',
                '.meal-search-meal-trigger',
                '.meal-search-picker-item',
                '.meal-search-picker-backdrop',
                '.meal-search-tab-sort-backdrop',
                '.meal-search-tab-sort-item',
                'input',
                'textarea',
                'label'
            ].join(', ')
        );
        if (allowed) return;

        const ghostTarget =
            el.closest('.meal-search-screen .food-item.meal-search-item') ||
            el.closest('#meals-container .meal-food-text');

        if (ghostTarget) {
            e.preventDefault();
            e.stopImmediatePropagation();
        }
    };

    document.addEventListener('click', handler, true);
}

//  создание карточки приема
function createMealCard(meal) {
    const swipeWrap = createElement('div', 'meal-swipe meal-swipe--inline-header');
    swipeWrap.dataset.mealId = meal.id;

    const isBaseMeal = ['meal1', 'meal2', 'meal3'].includes(meal.id);

    const actionsSlot = createElement('div', 'meal-card-header-actions-slot');
    const stubBtn = createElement('button', 'action-btn action-edit meal-action-stub');
    stubBtn.type = 'button';
    stubBtn.innerHTML = `
         <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 512 512"><title>Copy-outline SVG Icon</title><rect width="336" height="336" x="128" y="128" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="32" rx="57" ry="57"></rect><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="m383.5 128l.5-24a56.16 56.16 0 0 0-56-56H112a64.19 64.19 0 0 0-64 64v216a56.16 56.16 0 0 0 56 56h24"></path></svg>
         `;
    actionsSlot.append(stubBtn);

    const card = createElement('div', 'meal-card');
    const swipeContent = createElement('div', 'swipe-content');
    const headerContent = createElement('div', 'meal-card-header-content');
    const header = createElement('div', 'meal-card-header');

    const macros = createElement('div', 'meal-card-macros');
    macros.id = `${meal.id}-macros`;
    macros.style.display = 'none';

    const macrosContent = createElement('div', 'meal-macros-content');
    macrosContent.id = `${meal.id}-macros-content`;
    const photoIndicator = createElement('div', 'meal-photo-indicator');
    photoIndicator.id = `${meal.id}-photo-indicator`;
    photoIndicator.style.display = 'none';
    photoIndicator.innerHTML = `
        <span class="meal-photo-indicator-icon" aria-hidden="true">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><title>Outline-photo-camera SVG Icon</title><path fill="currentColor" d="m14.12 4l1.83 2H20v12H4V6h4.05l1.83-2zM15 2H9L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17zm-3 7c1.65 0 3 1.35 3 3s-1.35 3-3 3s-3-1.35-3-3s1.35-3 3-3m0-2c-2.76 0-5 2.24-5 5s2.24 5 5 5s5-2.24 5-5s-2.24-5-5-5"/></svg>
        </span>
        <span class="meal-photo-indicator-count">0</span>
    `;
    macrosContent.innerHTML = `
        <div><span>б-</span> 0,</div>
        <div><span>ж-</span> 0,</div>
        <div><span>у-</span> 0</div>
    `;

    const arrow = createElement('div', 'meal-arrow');
    arrow.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24"><title>Ios-arrow-ltr-24-filled SVG Icon</title><path fill="currentColor" d="M12.727 3.687a1 1 0 1 0-1.454-1.374l-8.5 9a1 1 0 0 0 0 1.374l8.5 9.001a1 1 0 1 0 1.454-1.373L4.875 12z"></path></svg>
                `;

    arrow.id = `${meal.id}-arrow`;

    macros.append(macrosContent, photoIndicator, arrow);

    const headerMain = createElement('div', 'meal-card-header-main');
    const title = createElement('div', 'meal-title', meal.name);
    const headerKcal = createElement('div', 'meal-header-kcal');
    headerKcal.id = `${meal.id}-header-kcal`;
    headerKcal.innerHTML = '';

    const addIconBtn = createElement('div', 'meal-add-icon');
    addIconBtn.setAttribute('aria-label', 'Добавить продукт');
    addIconBtn.innerHTML = getMealAddIconMarkup();

    function toggleMealFromHeader(ev) {
        if (ev) {
            ev.preventDefault();
            ev.stopPropagation();
        }
        const now = Date.now();
        if (
            lastMealHeaderToggleMealId === meal.id &&
            now - lastMealHeaderToggleAt < 450
        ) {
            return;
        }
        lastMealHeaderToggleAt = now;
        lastMealHeaderToggleMealId = meal.id;
        toggleMeal(ev || null);
    }

    header.addEventListener('click', toggleMealFromHeader);

    addIconBtn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        openMealSearchForMeal(meal.id);
    });

    headerMain.append(title, headerKcal);
    header.append(headerMain, addIconBtn);

    const list = createElement('div', 'meal-food-list');
    list.id = `${meal.id}-list`;

    function getCurrentOpenKey() {
        return getMealOpenKey(state.selectedDate, meal.id);
    }

        function applyOpenState() {
            const isOpen = !!mealOpenState[getCurrentOpenKey()];
            const macrosWrap = document.getElementById(`${meal.id}-macros`);
            const canOpen = macrosWrap && macrosWrap.style.display !== 'none';
            const finalOpen = isOpen && canOpen;

            list.style.display = finalOpen ? 'block' : 'none';

            if (macrosWrap && macrosWrap.style.display !== 'none') {
                macrosWrap.classList.toggle('meal-card-macros--expanded', finalOpen);
            }

            arrow.classList.remove('arrow-rotate-open', 'arrow-rotate-close');
            arrow.style.transform = finalOpen ? 'rotate(90deg)' : 'rotate(270deg)';
        }

    function toggleMeal(e) {
        if (e) e.stopPropagation();

        const macrosWrap = document.getElementById(`${meal.id}-macros`);
        if (!macrosWrap || macrosWrap.style.display === 'none') return;

        const openKey = getCurrentOpenKey();
        const nextOpen = !mealOpenState[openKey];

        mealOpenState[openKey] = nextOpen;
        localStorage.setItem('mealOpenState', JSON.stringify(mealOpenState));

        list.style.display = nextOpen ? 'block' : 'none';
        macrosWrap.classList.toggle('meal-card-macros--expanded', nextOpen);
        animateMealArrow(arrow, nextOpen);
    }

    applyOpenState();

    swipeWrap.addEventListener('meal-header-pure-tap', () => {
        toggleMealFromHeader();
    });

    macros.addEventListener('click', toggleMeal);

    stubBtn.onclick = (e) => {
        e.stopPropagation();
        openCopyMealSheet(meal.id);
    };

    if (!isBaseMeal) {
        const deleteBtn = createElement('button', 'action-btn action-delete meal-action-delete');
        deleteBtn.type = 'button';
        deleteBtn.innerHTML = `
             <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
                 <path fill="currentColor" d="M16 1.75V3h5.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H8V1.75C8 .784 8.784 0 9.75 0h4.5C15.216 0 16 .784 16 1.75m-6.5 0V3h5V1.75a.25.25 0 0 0-.25-.25h-4.5a.25.25 0 0 0-.25.25M4.997 6.178a.75.75 0 1 0-1.493.144L4.916 20.92a1.75 1.75 0 0 0 1.742 1.58h10.684a1.75 1.75 0 0 0 1.742-1.581l1.413-14.597a.75.75 0 0 0-1.494-.144l-1.412 14.596a.25.25 0 0 1-.249.226H6.658a.25.25 0 0 1-.249-.226z"/>
                 <path fill="currentColor" d="M9.206 7.501a.75.75 0 0 1 .793.705l.5 8.5A.75.75 0 1 1 9 16.794l-.5-8.5a.75.75 0 0 1 .705-.793Zm6.293.793A.75.75 0 1 0 14 8.206l-.5 8.5a.75.75 0 0 0 1.498.088l.5-8.5Z"/>
             </svg>
         `;
        deleteBtn.onclick = async (e) => {
            e.stopPropagation();

            openConfirmModal(`Удалить ${meal.name}?`, async () => {
                const cycleRef = getCycleDocRef();
                const mealRef = doc(cycleRef, 'meals', state.selectedDate);

                await updateDoc(mealRef, {
                    [meal.id]: deleteField()
                });
                await cleanupEmptyMealsDoc(mealRef);

                delete mealOpenState[getMealOpenKey(state.selectedDate, meal.id)];
                localStorage.setItem('mealOpenState', JSON.stringify(mealOpenState));
            });
        };
        actionsSlot.append(deleteBtn);
    }

    headerContent.append(header, actionsSlot);
    swipeContent.append(headerContent);
    card.append(swipeContent, macros, list);
    swipeWrap.append(card);

    return swipeWrap;
}



function rebuildMealsSection() {
    const mealsContainer = document.getElementById('meals-container');
    if (!mealsContainer) return;

    mealsContainer.innerHTML = '';

    const mealKeys = getMealKeysFromData(state.mealsData || {});
    lastRenderedMealStructure = mealKeys.join('|');

    const meals = mealKeys.map((id, index) => ({
        id,
        name: `Прием ${index + 1}`
    }));

    meals.forEach(meal => {
        mealsContainer.append(createMealCard(meal));
    });

    const existingBtn = document.getElementById('add-meal-section-btn');
    const shouldShowAddBtn = mealKeys.length < 6;

    if (shouldShowAddBtn) {
        if (!existingBtn) {
            const addMealWrap = createElement('div', 'add-meal-wrap');

            const addMealSectionBtn = createElement('button', 'tab-shape-btn');
            addMealSectionBtn.id = 'add-meal-section-btn';

            addMealSectionBtn.innerHTML = ` добавить прием `;



            addMealSectionBtn.onclick = handleAddMealSection;

            addMealWrap.append(addMealSectionBtn);

            mealsContainer.insertAdjacentElement('afterend', addMealWrap);
        }
    } else {
        if (existingBtn) {
            existingBtn.remove();
        }
    }

    setTimeout(() => {
        initMealSwipe();
        scheduleMealRootScrollAvailabilitySync();
    }, 0);
}

function initOpenStateForCurrentDay(mealsData) {
    const todayStr = formatLocalDate(new Date());
    const isToday = state.selectedDate === todayStr;

    getMealKeysFromData(mealsData || {}).forEach(mealId => {
        const openKey = getMealOpenKey(state.selectedDate, mealId);

        if (mealOpenState[openKey] !== undefined) return;

        const hasItems = Array.isArray(mealsData[mealId]) && mealsData[mealId].length > 0;
        mealOpenState[openKey] = isToday ? hasItems : false;
    });

    localStorage.setItem('mealOpenState', JSON.stringify(mealOpenState));
}

function getMealOpenKey(dateStr, mealId) {
    return `${dateStr}__${mealId}`;
}

function bindMealCalendarButton() {
    const btn = document.getElementById('meal-calendar-btn');
    if (!btn) return;
    if (btn.dataset.calendarBound === '1') return;

    btn.dataset.calendarBound = '1';
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openMealCalendarSheet();
    });
}

let mealCalendarSuppressTapUntil = 0;

function suppressMealCalendarDayTap() {
    mealCalendarSuppressTapUntil = Date.now() + 340;
}

function shouldSuppressMealCalendarDayTap() {
    return Date.now() < mealCalendarSuppressTapUntil;
}

function getFilledMealIdsFromData(mealsData = {}) {
    return getMealKeysFromData(mealsData).filter(mealId => {
        return Array.isArray(mealsData[mealId]) && mealsData[mealId].length > 0;
    });
}

function formatCopyMealDayLabel(dateStr) {
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    const todayStr = formatLocalDate(today);
    const yesterdayStr = formatLocalDate(yesterday);

    if (dateStr === todayStr) return 'Сегодня';
    if (dateStr === yesterdayStr) return 'Вчера';

    const d = new Date(`${dateStr}T00:00:00`);
    const days = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
    const months = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

    return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]}`;
}

async function getDaysWithMealsForCopy() {
    const cycleRef = getCycleDocRef();
    const mealsCol = collection(cycleRef, 'meals');
    const snap = await getDocs(mealsCol);

    const result = [];

    snap.forEach(docSnap => {
        const data = docSnap.data();
        const filledMealIds = getFilledMealIdsFromData(data);

        if (!filledMealIds.length) return;

        result.push({
            date: docSnap.id,
            mealsData: data,
            filledMealIds
        });
    });

    result.sort((a, b) => b.date.localeCompare(a.date));

    return result;
}

function cloneMealItemsForCopy(items = []) {
    return items.map(item => ({
        ...item,
        id: crypto.randomUUID()
    }));
}

async function copyMealFromAnotherDay(targetMealId, sourceDate, sourceMealId) {
    if (!targetMealId || !sourceDate || !sourceMealId) return;

    if (sourceDate === state.selectedDate && sourceMealId === targetMealId) {
        showToast('Нельзя копировать прием в самого себя');
        return;
    }

    const cycleRef = getCycleDocRef();

    const sourceRef = doc(cycleRef, 'meals', sourceDate);
    const sourceSnap = await getDoc(sourceRef);

    if (!sourceSnap.exists()) {
        showToast('Источник не найден');
        return;
    }

    const sourceData = sourceSnap.data();
    const sourceItems = Array.isArray(sourceData[sourceMealId]) ? sourceData[sourceMealId] : [];

    if (!sourceItems.length) {
        showToast('В выбранном приеме нет еды');
        return;
    }

    const targetRef = doc(cycleRef, 'meals', state.selectedDate);
    const targetSnap = await getDoc(targetRef);
    const targetData = targetSnap.exists() ? targetSnap.data() : {};

    const targetItems = Array.isArray(targetData[targetMealId]) ? targetData[targetMealId] : [];
    const copiedItems = cloneMealItemsForCopy(sourceItems);

    await setDoc(targetRef, {
        [targetMealId]: [...targetItems, ...copiedItems]
    }, { merge: true });

    showToast('Еда скопирована');
}

function openCopyMealSheet(targetMealId) {
    const ITEM_HEIGHT = 52;
    const VISIBLE_ROWS = 5;
    const SIDE_PADDING_ROWS = 2;

    const overlay = document.createElement('div');
    overlay.className = 'copy-meal-sheet-overlay';

    const sheet = document.createElement('div');
    sheet.className = 'copy-meal-sheet';

    const header = document.createElement('div');
    header.className = 'copy-meal-sheet-header';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'copy-meal-sheet-close';
    closeBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24">
                                  <path fill="currentColor" d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59L7.11 5.7A1 1 0 1 0 5.7 7.11L10.59 12L5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4z"></path>
                                </svg>
    `;

    const title = document.createElement('div');
    title.className = 'copy-meal-sheet-title';
    title.textContent = 'Копировать из другого дня';

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'copy-meal-sheet-confirm';
    confirmBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 512 512">
                  <title>Checkmark-sharp SVG Icon</title>
                  <path fill="none" stroke="currentColor" stroke-linecap="square" stroke-miterlimit="10" stroke-width="44" d="M416 128L192 384l-96-96"></path>
                </svg>
    `;

    header.append(closeBtn, title, confirmBtn);

    const wheelsWrap = document.createElement('div');
    wheelsWrap.className = 'copy-meal-sheet-wheels';

    const selectionFrame = document.createElement('div');
    selectionFrame.className = 'copy-meal-sheet-selection-frame';

    const mealCol = document.createElement('div');
    mealCol.className = 'copy-meal-sheet-col copy-meal-sheet-col-left';

    const dayCol = document.createElement('div');
    dayCol.className = 'copy-meal-sheet-col copy-meal-sheet-col-right';

    const mealWheel = document.createElement('div');
    mealWheel.className = 'copy-meal-sheet-wheel';

    const dayWheel = document.createElement('div');
    dayWheel.className = 'copy-meal-sheet-wheel';

    mealWheel.style.height = `${ITEM_HEIGHT * VISIBLE_ROWS}px`;
    dayWheel.style.height = `${ITEM_HEIGHT * VISIBLE_ROWS}px`;

    mealCol.append(mealWheel);
    dayCol.append(dayWheel);
    wheelsWrap.append(selectionFrame, mealCol, dayCol);

    sheet.append(header, wheelsWrap);
    overlay.append(sheet);
    document.body.append(overlay);

    let allDays = [];
    let selectedDayIndex = 0;
    let selectedMealIndex = 0;
    let isClosing = false;

    function closeSheet() {
        if (isClosing) return;
        isClosing = true;

        overlay.classList.remove('open');
        sheet.classList.remove('open');

        setTimeout(() => {
            overlay.remove();
        }, 240);
    }

    function getMealsForSelectedDay() {
        const day = allDays[selectedDayIndex];
        if (!day) return [];
        return day.filledMealIds || [];
    }

    function createSpacer() {
        const spacer = document.createElement('div');
        spacer.className = 'copy-meal-sheet-spacer';
        spacer.style.height = `${ITEM_HEIGHT * SIDE_PADDING_ROWS}px`;
        return spacer;
    }

    function scrollWheelToIndex(wheel, index, smooth = true) {
        wheel.scrollTo({
            top: index * ITEM_HEIGHT,
            behavior: smooth ? 'smooth' : 'auto'
        });
    }

    function bindWheelSelection(wheel, getItems, onIndexChange) {
        let scrollTimer = null;

        wheel.addEventListener('scroll', () => {
            clearTimeout(scrollTimer);

            scrollTimer = setTimeout(() => {
                const items = getItems();
                if (!items.length) return;

                let index = Math.round(wheel.scrollTop / ITEM_HEIGHT);
                index = Math.max(0, Math.min(index, items.length - 1));

                scrollWheelToIndex(wheel, index);
                onIndexChange(index);
            }, 60);
        });
    }

    function renderDayWheel() {
        dayWheel.innerHTML = '';
        dayWheel.append(createSpacer());

        allDays.forEach((day, index) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'copy-meal-sheet-item copy-meal-sheet-day-item';
            item.dataset.index = String(index);
            item.style.height = `${ITEM_HEIGHT}px`;
            item.textContent = formatCopyMealDayLabel(day.date);

            item.onclick = () => {
                selectedDayIndex = index;
                selectedMealIndex = 0;
                scrollWheelToIndex(dayWheel, selectedDayIndex);
                renderMealWheel();
                updateActiveStyles();
            };

            dayWheel.append(item);
        });

        dayWheel.append(createSpacer());

        requestAnimationFrame(() => {
            scrollWheelToIndex(dayWheel, selectedDayIndex, false);
            updateActiveStyles();
        });
    }

    function renderMealWheel() {
        const meals = getMealsForSelectedDay();

        mealWheel.innerHTML = '';
        mealWheel.append(createSpacer());

        meals.forEach((mealId, index) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'copy-meal-sheet-item copy-meal-sheet-meal-item';
            item.dataset.index = String(index);
            item.style.height = `${ITEM_HEIGHT}px`;
            item.textContent = getMealLabelById(mealId, allDays[selectedDayIndex]?.mealsData || {});

            item.onclick = () => {
                selectedMealIndex = index;
                scrollWheelToIndex(mealWheel, selectedMealIndex);
                updateActiveStyles();
            };

            mealWheel.append(item);
        });

        mealWheel.append(createSpacer());

        if (selectedMealIndex > meals.length - 1) {
            selectedMealIndex = 0;
        }

        requestAnimationFrame(() => {
            scrollWheelToIndex(mealWheel, selectedMealIndex, false);
            updateActiveStyles();
        });
    }

    function updateActiveStyles() {
        dayWheel.querySelectorAll('.copy-meal-sheet-item').forEach(item => {
            item.classList.toggle('active', Number(item.dataset.index) === selectedDayIndex);
        });

        mealWheel.querySelectorAll('.copy-meal-sheet-item').forEach(item => {
            item.classList.toggle('active', Number(item.dataset.index) === selectedMealIndex);
        });
    }

    bindWheelSelection(
        dayWheel,
        () => allDays,
        (index) => {
            if (selectedDayIndex === index) return;
            selectedDayIndex = index;
            selectedMealIndex = 0;
            renderMealWheel();
            updateActiveStyles();
        }
    );

    bindWheelSelection(
        mealWheel,
        () => getMealsForSelectedDay(),
        (index) => {
            selectedMealIndex = index;
            updateActiveStyles();
        }
    );

    closeBtn.onclick = closeSheet;

    confirmBtn.onclick = async () => {
        const day = allDays[selectedDayIndex];
        const meals = getMealsForSelectedDay();
        const sourceMealId = meals[selectedMealIndex];

        if (!day || !sourceMealId) {
            showToast('Нет данных для копирования');
            return;
        }

        await copyMealFromAnotherDay(targetMealId, day.date, sourceMealId);
        closeSheet();
    };

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            closeSheet();
        }
    });

    getDaysWithMealsForCopy().then(days => {
        allDays = days;

        if (!allDays.length) {
            showToast('Нет дней с сохраненной едой');
            closeSheet();
            return;
        }

        const currentDateIndex = allDays.findIndex(day => day.date === state.selectedDate);

        if (currentDateIndex > 0) {
            selectedDayIndex = currentDateIndex - 1;
        } else {
            selectedDayIndex = 0;
        }

        selectedMealIndex = 0;

        renderDayWheel();
        renderMealWheel();

        requestAnimationFrame(() => {
            overlay.classList.add('open');
            sheet.classList.add('open');
        });
    });
}


function ensureMealShell() {
    const root = document.getElementById('root');
    if (!root) return null;

    let shell = document.getElementById('meal-shell');

    if (!shell) {
        root.innerHTML = '';

        shell = createElement('div', 'meal-shell');
        shell.id = 'meal-shell';

        const mainLayer = createElement('div', 'meal-main-layer');
        mainLayer.id = 'meal-main-layer';

        const overlayLayer = createElement('div', 'meal-overlay-layer');
        overlayLayer.id = 'meal-overlay-layer';
        overlayLayer.style.display = 'none';

        shell.append(mainLayer, overlayLayer);
        root.append(shell);
    }

    mealShellEl = shell;
    mealMainEl = shell.querySelector('#meal-main-layer');
    mealOverlayEl = shell.querySelector('#meal-overlay-layer');

    return shell;
}

function openMealOverlay(content) {
    ensureMealShell();
    if (!mealOverlayEl) return;

    // Legacy behavior: replace everything.
    mealOverlayStack.forEach(cleanupMealOverlayNode);
    mealOverlayEl.classList.remove('meal-overlay-layer--search');
    mealOverlayEl.classList.remove('meal-overlay-layer--contained-scroll');
    mealOverlayEl.innerHTML = '';
    mealOverlayEl.style.display = 'block';
    mealOverlayEl.append(content);
    mealOverlayStack = [content];
    syncMealOverlayScrollMode();
    syncMealOverlayBottomNav();
}

function closeMealOverlay() {
    if (!mealOverlayEl) return;
    mealOverlayStack.forEach(cleanupMealOverlayNode);
    mealOverlayEl.classList.remove('meal-overlay-layer--search');
    mealOverlayEl.classList.remove('meal-overlay-layer--contained-scroll');
    mealOverlayEl.innerHTML = '';
    mealOverlayEl.style.display = 'none';
    mealOverlayStack = [];
    syncMealOverlayBottomNav();
}

function attachMealOverlayBottomNavSync(target, syncFn) {
    if (!target) return;
    target._mealBottomNavSync = typeof syncFn === 'function' ? syncFn : null;
}

function appendMealOverlayCleanup(target, cleanupFn) {
    if (!target || typeof cleanupFn !== 'function') return;
    const previousCleanup = typeof target._mealOverlayCleanup === 'function'
        ? target._mealOverlayCleanup
        : null;

    target._mealOverlayCleanup = () => {
        if (previousCleanup) {
            try {
                previousCleanup();
            } catch (_) {}
        }

        try {
            cleanupFn();
        } catch (_) {}
    };
}

function getCreateFoodKeyboardHeight() {
    const viewport = window.visualViewport;
    if (!viewport) return 0;

    const layoutHeight = window.innerHeight || document.documentElement.clientHeight || viewport.height || 0;
    const visibleBottom = viewport.height + (viewport.offsetTop || 0);
    return Math.max(0, Math.round(layoutHeight - visibleBottom));
}

function getCreateFoodScrollRoot(container) {
    return container || null;
}

function attachCreateFoodKeyboardAvoidance(container) {
    if (!container) return;

    let frameId = 0;
    const focusTimers = new Set();
    let isFocusedInside = false;

    const clearTimers = () => {
        if (frameId) {
            cancelAnimationFrame(frameId);
            frameId = 0;
        }
        focusTimers.forEach((timerId) => clearTimeout(timerId));
        focusTimers.clear();
    };

    const findFocusedControl = () => {
        const active = document.activeElement;
        if (!active || !container.contains(active)) return null;
        if (!active.matches?.('input, textarea, select, [contenteditable="true"]')) return null;
        return active;
    };

    const syncViewportFrame = () => {
        const viewport = window.visualViewport;
        const viewportHeight = Math.round(
            viewport?.height ||
            window.innerHeight ||
            document.documentElement.clientHeight ||
            0
        );

        if (!viewportHeight) return;

        container.style.setProperty('--create-food-viewport-height', `${viewportHeight}px`);
    };

    const syncKeyboardState = () => {
        const keyboardHeight = getCreateFoodKeyboardHeight();
        const focusedControl = findFocusedControl();
        const keyboardOpen = keyboardHeight > 80 || Boolean(focusedControl);

        syncViewportFrame();

        container.classList.toggle('create-food-keyboard-open', keyboardOpen);
        document.body.classList.toggle('meal-create-form-keyboard-open', keyboardOpen);
    };

    const keepFocusedControlVisible = () => {
        const focusedControl = findFocusedControl();
        if (!focusedControl) {
            syncKeyboardState();
            return;
        }

        syncKeyboardState();

        const scrollRoot = getCreateFoodScrollRoot(container);
        if (!scrollRoot) return;

        const row = focusedControl.closest?.('.create-food-row') || focusedControl;
        const containerRect = container.getBoundingClientRect();
        const stickyHeader = container.querySelector('.create-food-sticky-header');
        const stickyBottom = stickyHeader?.getBoundingClientRect?.().bottom || containerRect.top;
        const nav = document.querySelector('.navigation.navigation--meal-search');
        const navRect = nav?.getBoundingClientRect?.();
        const visibleTop = Math.max(containerRect.top, stickyBottom) + 12;
        const visibleBottomBase = navRect && navRect.height > 0
            ? Math.min(containerRect.bottom, navRect.top)
            : containerRect.bottom;
        const visibleBottom = visibleBottomBase - 14;
        const rowRect = row.getBoundingClientRect();

        if (rowRect.bottom > visibleBottom) {
            scrollRoot.scrollTop += Math.ceil(rowRect.bottom - visibleBottom);
            return;
        }

        if (rowRect.top < visibleTop) {
            scrollRoot.scrollTop -= Math.ceil(visibleTop - rowRect.top);
        }
    };

    const scheduleKeepVisible = (delay = 0) => {
        const timerId = window.setTimeout(() => {
            focusTimers.delete(timerId);
            if (frameId) cancelAnimationFrame(frameId);
            frameId = requestAnimationFrame(keepFocusedControlVisible);
        }, delay);
        focusTimers.add(timerId);
    };

    const handleFocusIn = (event) => {
        if (!event.target?.matches?.('input, textarea, select, [contenteditable="true"]')) return;
        isFocusedInside = true;
        scheduleKeepVisible(40);
        scheduleKeepVisible(180);
    };

    const handleFocusOut = () => {
        window.setTimeout(() => {
            isFocusedInside = Boolean(findFocusedControl());
            if (!isFocusedInside) {
                container.classList.remove('create-food-keyboard-open');
                document.body.classList.remove('meal-create-form-keyboard-open');
                syncViewportFrame();
                return;
            }
            scheduleKeepVisible(40);
        }, 80);
    };

    const handleViewportChange = () => {
        if (!isFocusedInside && !findFocusedControl()) {
            syncKeyboardState();
            return;
        }
        scheduleKeepVisible(20);
        scheduleKeepVisible(160);
    };

    container.addEventListener('focusin', handleFocusIn);
    container.addEventListener('focusout', handleFocusOut);
    window.visualViewport?.addEventListener?.('resize', handleViewportChange, { passive: true });
    window.visualViewport?.addEventListener?.('scroll', handleViewportChange, { passive: true });
    window.addEventListener('resize', handleViewportChange, { passive: true });
    syncViewportFrame();
    syncKeyboardState();

    appendMealOverlayCleanup(container, () => {
        clearTimers();
        container.removeEventListener('focusin', handleFocusIn);
        container.removeEventListener('focusout', handleFocusOut);
        window.visualViewport?.removeEventListener?.('resize', handleViewportChange);
        window.visualViewport?.removeEventListener?.('scroll', handleViewportChange);
        window.removeEventListener('resize', handleViewportChange);
        document.body.classList.remove('meal-create-form-keyboard-open');
        container.style.removeProperty('--create-food-viewport-height');
    });
}

function cleanupMealOverlayNode(node) {
    if (typeof node?._mealOverlayCleanup !== 'function') return;

    try {
        node._mealOverlayCleanup();
    } catch (_) {}

    node._mealOverlayCleanup = null;
}

function syncMealOverlayBottomNav() {
    const top = mealOverlayStack.length ? mealOverlayStack[mealOverlayStack.length - 1] : null;

    if (!top) {
        clearMealBottomNavOverlayMode();
        return;
    }

    if (typeof top._mealBottomNavSync === 'function') {
        top._mealBottomNavSync();
        return;
    }

    syncMealSearchBottomNavFromOverlay(top);
}

function shouldUseContainedMealOverlayScroll(node) {
    if (!node?.classList) return false;
    return node.classList.contains('meal-monthly-summary-screen')
        || node.classList.contains('meal-burned-summary-stub-screen')
        || node.classList.contains('meal-goal-overlay-wrap');
}

function syncMealOverlayScrollMode() {
    if (!mealOverlayEl) return;
    const top = mealOverlayStack.length ? mealOverlayStack[mealOverlayStack.length - 1] : null;
    mealOverlayEl.classList.toggle(
        'meal-overlay-layer--contained-scroll',
        shouldUseContainedMealOverlayScroll(top)
    );
}

function getMealTransitionMs(varName) {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    const n = parseFloat(raw);
    if (!n || n <= 0) return 0;
    return raw.endsWith('ms') ? n : n * 1000;
}

function pushMealOverlay(content, { isSearch = false } = {}) {
    ensureMealShell();
    if (!mealOverlayEl || !content) return;

    mealOverlayEl.style.display = 'block';

    const prev = mealOverlayStack.length ? mealOverlayStack[mealOverlayStack.length - 1] : null;
    if (prev && prev.style) prev.style.display = 'none';

    const hasSearchInStack = isSearch || mealOverlayStack.some((n) => n?.classList?.contains('meal-search-screen'));
    mealOverlayEl.classList.toggle('meal-overlay-layer--search', Boolean(hasSearchInStack));

    if (!isSearch) {
        try { content.classList.add('meal-overlay-subpage'); } catch (_) {}
    }

    const dur = getMealTransitionMs(isSearch ? '--meal-search-appear' : '--meal-detail-appear');
    if (dur > 0) {
        content.style.opacity = '0';
        content.style.transition = `opacity ${dur}ms ease`;
        requestAnimationFrame(() => { content.style.opacity = '1'; });
    }

    mealOverlayEl.append(content);
    mealOverlayStack.push(content);
    syncMealOverlayScrollMode();
    syncMealOverlayBottomNav();
}

function popMealOverlay() {
    if (!mealOverlayEl || !mealOverlayStack.length) return;
    const top = mealOverlayStack.pop();

    const prev = mealOverlayStack.length ? mealOverlayStack[mealOverlayStack.length - 1] : null;

    const isSearch = top?.classList?.contains('meal-search-screen');
    const dur = getMealTransitionMs(isSearch ? '--meal-search-disappear' : '--meal-detail-disappear');

    const cleanup = () => {
        cleanupMealOverlayNode(top);
        try { top?.remove?.(); } catch (_) {}
        if (prev && prev.style) prev.style.display = '';
        if (!prev) {
            mealOverlayEl.classList.remove('meal-overlay-layer--search');
            mealOverlayEl.classList.remove('meal-overlay-layer--contained-scroll');
            mealOverlayEl.innerHTML = '';
            mealOverlayEl.style.display = 'none';
        } else {
            const hasSearch = mealOverlayStack.some((n) => n?.classList?.contains('meal-search-screen'));
            mealOverlayEl.classList.toggle('meal-overlay-layer--search', Boolean(hasSearch));
            syncMealOverlayScrollMode();
        }
        syncMealOverlayBottomNav();
    };

    if (dur > 0) {
        top.style.transition = `opacity ${dur}ms ease`;
        top.style.pointerEvents = 'none';
        top.style.opacity = '0';
        setTimeout(cleanup, dur);
    } else {
        cleanup();
    }
}

function hasUnderlyingMealSearch() {
    // Для UX возврата: достаточно факта, что есть слой под текущим.
    // (класс может измениться, но стек всё равно означает "не пересоздавать поиск").
    return mealOverlayStack.length >= 2;
}
function setMealBaseTopBarVisible(visible) {
    const topBar = document.querySelector('.top-bar');
    if (!topBar) return;
    topBar.style.display = visible ? '' : 'none';
}

/** Закрыть оверлей и показать базовый top-bar. */
function closeMealOverlayAndShowMealMain() {
    state.mealView = null;
    clearMealBottomNavOverlayMode();

    const visible = mealOverlayStack.length
        ? mealOverlayStack[mealOverlayStack.length - 1]
        : null;

    const isSearch = visible?.classList?.contains('meal-search-screen');
    const dur = visible
        ? getMealTransitionMs(isSearch ? '--meal-search-disappear' : '--meal-detail-disappear')
        : 0;

    if (dur > 0 && visible) {
        visible.style.transition = `opacity ${dur}ms ease`;
        visible.style.pointerEvents = 'none';
        visible.style.opacity = '0';
        setTimeout(() => {
            closeMealOverlay();
            clearMealBottomNavOverlayMode();
            setMealBaseTopBarVisible(true);
            void renderMealPage();
        }, dur);
    } else {
        closeMealOverlay();
        clearMealBottomNavOverlayMode();
        setMealBaseTopBarVisible(true);
        void renderMealPage();
    }
}

function setupCreateFoodStickyTitleBorder({ titleEl, watchEl }) {
    let scrollRoot = titleEl.closest('.meal-overlay-subpage')
        || titleEl.closest('.meal-overlay-layer')
        || titleEl.closest('.meal-goal-overlay-wrap')?.parentElement
        || document.getElementById('root');
    if (!scrollRoot || !titleEl || !watchEl) return;

    if (titleEl._cleanupStickyBorder) {
        titleEl._cleanupStickyBorder();
    }

    let ticking = false;
    const MIN_SCALE = 0.88;

    const update = () => {
        ticking = false;

        const titleRect = titleEl.getBoundingClientRect();
        const watchRect = watchEl.getBoundingClientRect();

        // Сколько px верх следующего блока уже «под» нижней границей заголовка (полоска).
        const overlapPx = titleRect.bottom - watchRect.top;
        const progress = overlapPx > 0 ? 1 : MIN_SCALE;

        titleEl.style.setProperty('--sticky-border-progress', String(progress));
    };

    const onScroll = () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(update);
    };

    const onResize = () => update();

    update();

    scrollRoot.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);

    titleEl._cleanupStickyBorder = () => {
        scrollRoot.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onResize);
        titleEl.style.removeProperty('--sticky-border-progress');
    };
}

function setupMealMonthlySummaryStickyBorder(stickyEl, watchEl) {
    const scrollRoot = stickyEl?.closest('.meal-monthly-summary-screen')
        || stickyEl?.closest('.meal-overlay-layer')
        || stickyEl?.closest('.meal-overlay-subpage')
        || document.getElementById('root');
    if (!scrollRoot || !stickyEl || !watchEl) return;

    if (typeof stickyEl._cleanupMonthlySummaryStickyBorder === 'function') {
        stickyEl._cleanupMonthlySummaryStickyBorder();
    }

    let ticking = false;
    const EPS = 0.5;

    const update = () => {
        ticking = false;
        const stickyRect = stickyEl.getBoundingClientRect();
        const watchRect = watchEl.getBoundingClientRect();
        const overlapPx = stickyRect.bottom - watchRect.top;
        stickyEl.classList.toggle('meal-monthly-summary-sticky--stuck', overlapPx > EPS);
    };

    const onScroll = () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(update);
    };

    const onResize = () => update();

    update();

    scrollRoot.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);

    stickyEl._cleanupMonthlySummaryStickyBorder = () => {
        scrollRoot.removeEventListener('scroll', onScroll);
        window.removeEventListener('resize', onResize);
        stickyEl.classList.remove('meal-monthly-summary-sticky--stuck');
    };
}


function renderMealMainScreen() {
    if (!mealMainEl) return;

    const currentCycle = state.cycles?.find(c => c.id === state.selectedCycleId);

    mealMainEl.innerHTML = '';

    const contentContainer = createElement('div', 'meal-page');
    mealMainEl.append(contentContainer);

    if (!currentCycle) {
        contentContainer.append(
            createElement('h3'),
            createElement('div', 'muted', 'Цикл не найден')
        );
        return;
    }

    const title = createElement('h3');
    title.innerHTML = `Питание: <span>${currentCycle.name}</span>`;
    contentContainer.append(title);

    const weekDates = getWeekDates(state.selectedDate);
    const todayStr = formatLocalDate(new Date());

    const cachedWeekPresence = readWeekMealsPresenceCache(weekDates);
    const weekPresence = cachedWeekPresence || normalizeWeekPresenceForDates(weekDates);

    if (state.selectedDate && mealsDataLoadedDate === state.selectedDate && state.mealsData) {
        weekPresence[state.selectedDate] = hasAnyFoodInDoc(state.mealsData);
    }

    const weekHeader = createElement('div', 'week-strip-header');

    const calendarBtn = document.createElement('button');
    calendarBtn.type = 'button';
    calendarBtn.className = 'calendar-btn';
    calendarBtn.id = 'meal-calendar-btn';
    calendarBtn.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"><title>Calendar SVG Icon</title><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 4V2m0 2v2m0-2h-4.5M3 10v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-9zm0 0V6a2 2 0 0 1 2-2h2m0-2v4m14 4V6a2 2 0 0 0-2-2h-.5"></path></svg>
                `;

    const weekTitle = createElement('div', 'week-strip-title', getSelectedDayTitle(state.selectedDate));
    weekTitle.id = 'week-strip-title';
    weekHeader.append(calendarBtn, weekTitle);

    const goTodayBtn = createElement('button', 'week-strip-today-btn', 'Сегодня');
    goTodayBtn.type = 'button';
    goTodayBtn.id = 'week-strip-today-btn';
    goTodayBtn.style.display = state.selectedDate === todayStr ? 'none' : 'inline-flex';
    goTodayBtn.onclick = () => switchMealDate(todayStr);
    weekHeader.append(goTodayBtn);

    contentContainer.append(weekHeader);

    const weekRow = createElement('div', 'week-row');

    weekDates.forEach(date => {
        const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

        const d = new Date(`${date}T00:00:00`);
        const dayIndex = (d.getDay() + 6) % 7;
        const dateStr = formatLocalDate(d);
        const hasFood = !!weekPresence[dateStr];

        const item = createElement('button', 'week-day-item');
        item.type = 'button';
        item.dataset.date = dateStr;

        const circle = createElement('div', 'week-day-circle');
        const check = createElement('div', 'week-day-check', WEEK_DAY_CHECK_MARK);

        circle.append(check);

        const label = createElement('div', 'week-day-name', dayNames[dayIndex]);

        item.append(circle, label);

        if (dateStr === state.selectedDate) item.classList.add('active');
        if (dateStr === todayStr) item.classList.add('today');
        if (hasFood) item.classList.add('has-food');

        item.onclick = () => switchMealDate(dateStr);
        weekRow.append(item);
    });

    contentContainer.append(weekRow);
    applyWeekRowPresence(weekPresence, contentContainer);

    const macrosRow = createElement('div', 'meal-macros-row');
    macrosRow.id = 'meal-macros-row';
    contentContainer.append(macrosRow);

    renderMealMacrosImmediately();

    const mealKeys = getMealKeysForRender();
    lastRenderedMealStructure = mealKeys.join('|');

    const meals = mealKeys.map((id, index) => ({
        id,
        name: `Прием ${index + 1}`
    }));



    const mealsContainer = createElement('div', 'meals-container');
    mealsContainer.id = 'meals-container';
    const mealsContainerWrap = createElement('div', 'meals-container-wrap');
    mealsContainerWrap.append(mealsContainer);
    contentContainer.append(mealsContainerWrap);

    meals.forEach(meal => {
        mealsContainer.append(createMealCard(meal));
    });

    setupMealMacrosBorderObserver();
    setupTopBarMealBorderObserver();

    const existingMealKeys = getMealKeysFromData(state.mealsData || {});
    if (existingMealKeys.length < 6) {
        const addMealWrap = createElement('div', 'add-meal-wrap');

        const addMealSectionBtn = createElement('button', 'tab-shape-btn');
        addMealSectionBtn.id = 'add-meal-section-btn';

        addMealSectionBtn.innerHTML = ` добавить прием`;


        addMealSectionBtn.onclick = handleAddMealSection;
        addMealWrap.append(addMealSectionBtn);
        contentContainer.append(addMealWrap);
    }

    setTimeout(() => {
        initMealSwipe();
        scheduleMealRootScrollAvailabilitySync();
    }, 0);

    getFoodsMap();
    subscribeMeals();

    const expectedWeekCacheKey = getWeekPresenceCacheKey(weekDates);
    getWeekMealsPresence(weekDates).then((presence) => {
        const currentWeekDates = getWeekDates(state.selectedDate);
        if (expectedWeekCacheKey !== getWeekPresenceCacheKey(currentWeekDates)) return;
        applyWeekRowPresence(presence);
    });

    bindMealCalendarButton();
    scheduleMealRootScrollAvailabilitySync();
}

function openMealMainOnDateFromSummary(dateStr) {
    state.mealView = null;
    clearMealBottomNavOverlayMode();
    closeMealOverlay();
    setMealBaseTopBarVisible(true);

    if (!dateStr || state.selectedDate === dateStr) {
        void renderMealPage();
        return;
    }

    switchMealDate(dateStr);
}

function renderMealMonthlySummaryPage() {
    ensureMealShell();
    setMealBaseTopBarVisible(false);

    let visibleMonth = getMealSummaryVisibleMonth();
    let monthPickerYear = visibleMonth.getFullYear();
    let renderToken = 0;
    let cleanupSticky = null;

    const todayStr = formatLocalDate(new Date());
    if (!state.mealSummarySelectedDate) {
        state.mealSummarySelectedDate = todayStr;
    }
    const screen = createElement('div', 'meal-monthly-summary-screen');
    const sticky = createElement('div', 'meal-monthly-summary-sticky');
    const title = createElement('h3', 'create-food-sticky-h3 meal-monthly-summary-title', 'Сводка калорий');

    const selector = createElement('div', 'meal-monthly-summary-selector');

    const prevBtn = createElement('button', 'meal-monthly-summary-nav-btn meal-monthly-summary-nav-btn--prev');
    prevBtn.type = 'button';
    prevBtn.setAttribute('aria-label', 'Предыдущий месяц');
    prevBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="m14.06 19.06l-7-7a1.5 1.5 0 0 1 0-2.12l7-7a.75.75 0 1 1 1.06 1.06L8.19 10.94a.75.75 0 0 0 0 1.06L15.12 19a.75.75 0 0 1-1.06 1.06"/>
        </svg>
    `;

    const monthBtn = createElement('button', 'meal-monthly-summary-month-btn');
    monthBtn.type = 'button';
    monthBtn.setAttribute('aria-label', 'Выбрать месяц');

    const nextBtn = createElement('button', 'meal-monthly-summary-nav-btn meal-monthly-summary-nav-btn--next');
    nextBtn.type = 'button';
    nextBtn.setAttribute('aria-label', 'Следующий месяц');
    nextBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="currentColor" d="m9.94 19.06l7-7a1.5 1.5 0 0 0 0-2.12l-7-7a.75.75 0 1 0-1.06 1.06l6.93 6.94a.75.75 0 0 1 0 1.06L8.88 19a.75.75 0 1 0 1.06 1.06"/>
        </svg>
    `;

    selector.append(prevBtn, monthBtn, nextBtn);

    const head = createElement('div', 'meal-monthly-summary-head');
    head.innerHTML = `
        <div class="meal-monthly-summary-head-spacer"></div>
        <div class="meal-monthly-summary-head-cell">Съедено</div>
        <div class="meal-monthly-summary-head-cell">Потрачено</div>
    `;

    const body = createElement('div', 'meal-monthly-summary-body');

    const monthPickerBackdrop = createElement('button', 'meal-monthly-summary-picker-backdrop');
    monthPickerBackdrop.type = 'button';
    monthPickerBackdrop.style.display = 'none';

    const monthPicker = createElement('div', 'meal-monthly-summary-picker');
    monthPicker.style.display = 'none';

    const monthPickerHead = createElement('div', 'meal-monthly-summary-picker-head');
    const yearPrevBtn = createElement('button', 'meal-monthly-summary-picker-year-btn');
    yearPrevBtn.type = 'button';
    yearPrevBtn.setAttribute('aria-label', 'Предыдущий год');
    yearPrevBtn.textContent = '−';

    const yearLabel = createElement('div', 'meal-monthly-summary-picker-year');

    const yearNextBtn = createElement('button', 'meal-monthly-summary-picker-year-btn');
    yearNextBtn.type = 'button';
    yearNextBtn.setAttribute('aria-label', 'Следующий год');
    yearNextBtn.textContent = '+';

    monthPickerHead.append(yearPrevBtn, yearLabel, yearNextBtn);

    const monthPickerGrid = createElement('div', 'meal-monthly-summary-picker-grid');
    monthPicker.append(monthPickerHead, monthPickerGrid);

    sticky.append(title, selector, head);
    screen.append(sticky, body, monthPickerBackdrop, monthPicker);
    setupMealMonthlySummaryStickyBorder(sticky, body);

    const handleBackToMeal = () => {
        closeMealOverlayAndShowMealMain();
    };

    const openBurnedStub = (dateStr) => {
        state.mealSummarySelectedDate = dateStr;
        state.mealBurnedSummaryDate = dateStr;
        state.mealView = 'burnedSummary';
        renderMealPage();
    };

    function syncMonthButtonLabel() {
        monthBtn.innerHTML = `
            <span>${formatMealSummaryMonthLabel(visibleMonth)}</span>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="currentColor" d="M12 15.375q-.2 0-.375-.075t-.325-.225l-4.6-4.6a.93.93 0 0 1-.288-.687q0-.4.288-.688a.94.94 0 0 1 .688-.287q.4 0 .687.287L12 13.025L15.925 9.1a.94.94 0 0 1 .688-.287q.4 0 .687.287t.288.688a.93.93 0 0 1-.288.687l-4.6 4.6q-.15.15-.325.225t-.375.075"/>
            </svg>
        `;
    }

    function formatMealSummaryDifferenceLabel(value) {
        if (!Number.isFinite(value)) return '';
        const rounded = Math.round(value);
        const sign = rounded > 0 ? '+' : rounded < 0 ? '-' : '';
        const absValue = String(Math.abs(rounded));
        return `(${sign}${formatNumberWithSpaces(Math.abs(rounded))} Всего)`;
    }

    function closeMonthPicker() {
        monthPicker.classList.remove('open');
        monthPickerBackdrop.classList.remove('open');
        monthPicker.style.display = 'none';
        monthPickerBackdrop.style.display = 'none';
    }

    function formatMealSummaryDifferenceMarkup(value) {
        if (!Number.isFinite(value)) return '';
        const rounded = Math.round(value);
        const sign = rounded > 0 ? '+' : rounded < 0 ? '-' : '';
        return `
            <span class="meal-monthly-summary-difference">
                <span class="meal-monthly-summary-difference-bracket">(</span>
                <span class="meal-monthly-summary-difference-value">${sign}${Math.abs(rounded)}</span>
                <span class="meal-monthly-summary-difference-label">Всего</span>
                <span class="meal-monthly-summary-difference-bracket">)</span>
            </span>
        `;
    }

    function formatMealSummarySideArrowMarkup(value) {
        if (!Number.isFinite(value)) return '';
        const rounded = Math.round(value);
        const directionClass = rounded < 0
            ? 'meal-monthly-summary-side-arrow--down'
            : rounded > 0
                ? 'meal-monthly-summary-side-arrow--up'
                : 'meal-monthly-summary-side-arrow--flat';
        return `
            <span class="meal-monthly-summary-side-arrow ${directionClass}" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="14" height="14">
                    <path d="M12 4v16m0 0 6-6m-6 6-6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </span>
        `;
    }

    function renderMonthPicker() {
        yearLabel.textContent = String(monthPickerYear);
        monthPickerGrid.innerHTML = '';

        MEAL_SUMMARY_MONTH_SHORT_NAMES.forEach((label, monthIndex) => {
            const btn = createElement(
                'button',
                `meal-monthly-summary-picker-month${monthPickerYear === visibleMonth.getFullYear() && monthIndex === visibleMonth.getMonth() ? ' active' : ''}`,
                label
            );
            btn.type = 'button';
            btn.onclick = () => {
                visibleMonth = new Date(monthPickerYear, monthIndex, 1);
                setMealSummaryVisibleMonth(visibleMonth);
                screen.scrollTop = 0;
                syncMonthButtonLabel();
                closeMonthPicker();
                void loadAndRenderMonth();
            };
            monthPickerGrid.append(btn);
        });
    }

    function openMonthPicker() {
        monthPickerYear = visibleMonth.getFullYear();
        renderMonthPicker();
        monthPickerBackdrop.style.display = 'block';
        monthPicker.style.display = 'block';
        requestAnimationFrame(() => {
            monthPickerBackdrop.classList.add('open');
            monthPicker.classList.add('open');
        });
    }

    function buildEatenCardMarkup(entry) {
        if (!entry?.hasFood) {
            return `
                <span class="meal-monthly-summary-card-icon" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M7 2a1 1 0 0 1 1 1v6.28a2.72 2.72 0 0 1-2 2.62V21a1 1 0 1 1-2 0v-9.1a2.72 2.72 0 0 1-2-2.62V3a1 1 0 1 1 2 0v6.5a.5.5 0 0 0 1 0V3a1 1 0 1 1 2 0v6.5a.5.5 0 0 0 1 0V3a1 1 0 0 1 1-1m9 0a1 1 0 0 1 1 1v18a1 1 0 1 1-2 0v-6h-2a2 2 0 0 1-2-2V8a6 6 0 0 1 5-6"/></svg>
                </span>
                <span class="meal-monthly-summary-card-empty">+</span>
            `;
        }

        return `
            <span class="meal-monthly-summary-card-icon" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M7 2a1 1 0 0 1 1 1v6.28a2.72 2.72 0 0 1-2 2.62V21a1 1 0 1 1-2 0v-9.1a2.72 2.72 0 0 1-2-2.62V3a1 1 0 1 1 2 0v6.5a.5.5 0 0 0 1 0V3a1 1 0 1 1 2 0v6.5a.5.5 0 0 0 1 0V3a1 1 0 0 1 1-1m9 0a1 1 0 0 1 1 1v18a1 1 0 1 1-2 0v-6h-2a2 2 0 0 1-2-2V8a6 6 0 0 1 5-6"/></svg>
            </span>
            <span class="meal-monthly-summary-card-main">
                <strong>${formatNumberWithSpaces(entry.eatenCalories || 0)}</strong>
                ${Number.isFinite(entry.eatenPercent) ? `<span>(${entry.eatenPercent}%)</span>` : '<span></span>'}
            </span>
        `;
    }

    function buildBurnedCardMarkup(entry) {
        const burned = Number(entry?.burnedCalories || 0);
        if (!burned) {
            return `
                <span class="meal-monthly-summary-card-icon" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><title>Workout-sport SVG Icon</title><g fill="none" stroke="currentColor" stroke-width="1.5"><path d="M16 4.5a1.5 1.5 0 1 1-3 0a1.5 1.5 0 0 1 3 0Z"/><path stroke-linecap="round" stroke-linejoin="round" d="m5 12l1.476-2.326c.26-.41.391-.616.562-.783c.17-.167.374-.29.782-.534l.922-.553c.862-.518 1.293-.777 1.77-.802s.93.187 1.839.61l1.695.792c.373.174.56.26.723.383q.174.13.318.295c.135.156.24.34.45.708c.37.647.555.97.816 1.199c.184.16.394.285.62.368c.32.118.68.118 1.398.118H19M11.5 7.5L8 14m0 0l1.447 2.026a2 2 0 0 1-.31 2.667L6.5 21M8 14h3.5m5.5 4l-2.4-3.2A2 2 0 0 0 13 14h-1.5m0 0L15 9"/></g></svg>
                </span>
                <span class="meal-monthly-summary-card-empty">+</span>
            `;
        }

        const difference = Number(entry?.eatenCalories || 0) - burned;

        return `
            <span class="meal-monthly-summary-card-icon" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><title>Workout-sport SVG Icon</title><g fill="none" stroke="currentColor" stroke-width="1.5"><path d="M16 4.5a1.5 1.5 0 1 1-3 0a1.5 1.5 0 0 1 3 0Z"/><path stroke-linecap="round" stroke-linejoin="round" d="m5 12l1.476-2.326c.26-.41.391-.616.562-.783c.17-.167.374-.29.782-.534l.922-.553c.862-.518 1.293-.777 1.77-.802s.93.187 1.839.61l1.695.792c.373.174.56.26.723.383q.174.13.318.295c.135.156.24.34.45.708c.37.647.555.97.816 1.199c.184.16.394.285.62.368c.32.118.68.118 1.398.118H19M11.5 7.5L8 14m0 0l1.447 2.026a2 2 0 0 1-.31 2.667L6.5 21M8 14h3.5m5.5 4l-2.4-3.2A2 2 0 0 0 13 14h-1.5m0 0L15 9"/></g></svg>
            </span>
            <span class="meal-monthly-summary-card-main">
                <strong>${formatNumberWithSpaces(burned)}</strong>
                <span>${formatMealSummaryDifferenceMarkup(difference)}</span>
            </span>
            ${formatMealSummarySideArrowMarkup(difference)}
        `;
    }

    function buildMonthRow(dateStr, dailySummary) {
        const entry = dailySummary[dateStr] || {
            date: dateStr,
            hasFood: false,
            eatenCalories: 0,
            burnedCalories: null,
            goalCalories: 0,
            eatenPercent: null
        };

        const date = parseLocalDate(dateStr);
        const isSelected = dateStr === state.mealSummarySelectedDate;
        const isToday = dateStr === todayStr;

        const row = createElement(
            'div',
            `meal-monthly-summary-row${isToday ? ' meal-monthly-summary-row--today' : ''}`
        );

        const dateBtn = createElement(
            'button',
            `meal-monthly-summary-date${isSelected ? ' is-selected' : ''}${isToday ? ' is-today' : ''}`
        );
        dateBtn.type = 'button';
        dateBtn.innerHTML = `
            <span class="meal-monthly-summary-date-num">${date.getDate()}</span>
            <span class="meal-monthly-summary-date-weekday">${MEAL_SUMMARY_WEEKDAY_SHORT_NAMES[date.getDay()]}</span>
        `;
        dateBtn.onclick = () => openMealMainOnDateFromSummary(dateStr);

        const eatenBtn = createElement(
            'button',
            `meal-monthly-summary-card meal-monthly-summary-card--eaten${isSelected ? ' is-selected' : ''}`
        );
        eatenBtn.type = 'button';
        eatenBtn.innerHTML = buildEatenCardMarkup(entry);
        eatenBtn.onclick = () => openMealMainOnDateFromSummary(dateStr);

        const burnedBtn = createElement(
            'button',
            `meal-monthly-summary-card meal-monthly-summary-card--burned${isSelected ? ' is-selected' : ''}`
        );
        burnedBtn.type = 'button';
        burnedBtn.innerHTML = buildBurnedCardMarkup(entry);
        burnedBtn.onclick = () => openBurnedStub(dateStr);

        row.append(dateBtn, eatenBtn, burnedBtn);
        return row;
    }

    function buildMonthFooter(monthStats) {
        const footer = createElement('div', 'meal-monthly-summary-footer');
        footer.innerHTML = `
            <div class="meal-monthly-summary-footer-title">Сводка за месяц</div>
            <div class="meal-monthly-summary-footer-head">
                <span></span>
                <span>Съедено</span>
                <span>Потрачено</span>
            </div>
            <div class="meal-monthly-summary-footer-row">
                <strong>Средний</strong>
                <div class="meal-monthly-summary-footer-value">
                    <b>${formatNumberWithSpaces(monthStats.averageEaten || 0)}</b>
                    ${Number.isFinite(monthStats.averagePercent) ? `<span>(${monthStats.averagePercent}%)</span>` : '<span></span>'}
                </div>
                <div class="meal-monthly-summary-footer-value meal-monthly-summary-footer-value--burned">
                    <b>${monthStats.averageBurned ? formatNumberWithSpaces(monthStats.averageBurned) : '—'}</b>
                    <span>${Number.isFinite(monthStats.averageDifference) ? formatMealSummaryDifferenceMarkup(monthStats.averageDifference) : ''}</span>
                </div>
            </div>
            <div class="meal-monthly-summary-footer-row">
                <strong>Всего</strong>
                <div class="meal-monthly-summary-footer-value meal-monthly-summary-footer-value--burned">
                    <b>${formatNumberWithSpaces(monthStats.totalEaten || 0)}</b>
                    <span></span>
                </div>
                <div class="meal-monthly-summary-footer-value">
                    <b>${monthStats.totalBurned ? formatNumberWithSpaces(monthStats.totalBurned) : '—'}</b>
                    <span>${Number.isFinite(monthStats.totalDifference) ? formatMealSummaryDifferenceMarkup(monthStats.totalDifference) : ''}</span>
                </div>
            </div>
        `;
        return footer;
    }

    function renderLoadingState() {
        body.innerHTML = `
            <div class="meal-monthly-summary-loading">
                <div class="meal-monthly-summary-loading-card"></div>
                <div class="meal-monthly-summary-loading-card"></div>
                <div class="meal-monthly-summary-loading-card"></div>
                <div class="meal-monthly-summary-loading-card"></div>
            </div>
        `;
    }

    function isSummaryMonthShowingToday() {
        const t = parseLocalDate(todayStr);
        return t.getFullYear() === visibleMonth.getFullYear() && t.getMonth() === visibleMonth.getMonth();
    }

    /** Без анимации: после отрисовки выставляет scroll так, чтобы строка «сегодня» была по центру видимой области. */
    function scrollSummaryViewportToTodayCentered() {
        if (!isSummaryMonthShowingToday()) return;
        const row = body.querySelector('.meal-monthly-summary-row--today');
        if (!row || !screen.isConnected) return;
        void screen.offsetHeight;
        const scrRect = screen.getBoundingClientRect();
        const rowRect = row.getBoundingClientRect();
        const delta = rowRect.top + rowRect.height / 2 - (scrRect.top + scrRect.height / 2);
        screen.scrollTop += delta;
    }

    function renderMonthContent(dailySummary) {
        body.innerHTML = '';

        const list = createElement('div', 'meal-monthly-summary-list');
        getMealSummaryMonthDays(visibleMonth).forEach(dateStr => {
            list.append(buildMonthRow(dateStr, dailySummary));
        });

        const monthStats = getMonthMealsDailySummaryStats(visibleMonth, dailySummary);
        body.append(list, buildMonthFooter(monthStats));
        scrollSummaryViewportToTodayCentered();
    }

    async function loadAndRenderMonth() {
        const currentToken = ++renderToken;
        syncMonthButtonLabel();
        renderLoadingState();

        try {
            const dailySummary = await getMonthMealsDailySummary(visibleMonth);
            if (currentToken !== renderToken || !screen.isConnected) return;
            renderMonthContent(dailySummary);
        } catch (error) {
            console.error('meal monthly summary load failed', error);
            if (currentToken !== renderToken || !screen.isConnected) return;
            body.innerHTML = '<div class="meal-monthly-summary-error">Не удалось загрузить сводку</div>';
        }
    }

    function shiftMonth(delta) {
        visibleMonth = addMonths(visibleMonth, delta);
        setMealSummaryVisibleMonth(visibleMonth);
        screen.scrollTop = 0;
        closeMonthPicker();
        syncMonthButtonLabel();
        void loadAndRenderMonth();
    }

    prevBtn.onclick = () => shiftMonth(-1);
    nextBtn.onclick = () => shiftMonth(1);
    monthBtn.onclick = () => {
        if (monthPicker.classList.contains('open')) {
            closeMonthPicker();
            return;
        }
        openMonthPicker();
    };
    monthPickerBackdrop.onclick = closeMonthPicker;
    yearPrevBtn.onclick = () => {
        monthPickerYear -= 1;
        renderMonthPicker();
    };
    yearNextBtn.onclick = () => {
        monthPickerYear += 1;
        renderMonthPicker();
    };

    attachMealOverlayBottomNavSync(screen, () => {
        setMealBottomNavOverlayMode({
            visible: true,
            onBack: handleBackToMeal,
            actionVisible: false,
            secondaryActionVisible: false
        });
    });

    screen._mealOverlayCleanup = () => {
        closeMonthPicker();
        cleanupSticky?.();
    };

    openMealOverlay(screen);
    setupCreateFoodStickyTitleBorder({ titleEl: title, watchEl: selector });
    cleanupSticky = () => {
        if (typeof title._cleanupStickyBorder === 'function') {
            title._cleanupStickyBorder();
            title._cleanupStickyBorder = null;
        }
    };
    syncMonthButtonLabel();
    void loadAndRenderMonth();
}

function formatAppleHealthUpdatedAt(value) {
    if (!value) return '—';
    try {
        const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
        if (Number.isNaN(date.getTime())) return '—';
        return new Intl.DateTimeFormat('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }).format(date);
    } catch (_) {
        return '—';
    }
}

async function getMealEatenCaloriesForDate(dateStr) {
    const foodsMap = await getFoodsMap();
    const localMealsDoc =
        state.selectedDate === dateStr &&
        mealsDataLoadedDate === state.selectedDate &&
        state.mealsData
            ? state.mealsData
            : null;

    if (localMealsDoc) {
        return Math.round(Number(calcMealsTotalsFast(localMealsDoc, foodsMap).total.cal || 0));
    }

    const cycleRef = getCycleDocRef();
    if (!cycleRef) return 0;
    const snap = await getDoc(doc(cycleRef, 'meals', dateStr));
    if (!snap.exists()) return 0;
    return Math.round(Number(calcMealsTotalsFast(snap.data(), foodsMap).total.cal || 0));
}

function renderMealBurnedSummaryStubPage() {
    ensureMealShell();
    setMealBaseTopBarVisible(false);

    const dateStr = state.mealBurnedSummaryDate || state.mealSummarySelectedDate || formatLocalDate(new Date());
    const screen = createElement('div', 'meal-burned-summary-stub-screen meal-apple-health-screen');
    const title = createElement('h3', 'create-food-sticky-h3 meal-burned-summary-stub-title', 'Потраченные калории');
    const subtitle = createElement('div', 'meal-burned-summary-stub-date', formatMealSummaryStubDateLabel(dateStr));
    const actionRow = createElement('div', 'meal-apple-health-action-row');
    const syncBtn = createElement('button', 'btn btn-primary meal-apple-health-sync-btn', 'Получить данные Apple Watch');
    syncBtn.type = 'button';
    const notice = createElement('div', 'meal-apple-health-notice');
    const iosHint = createElement(
        'div',
        'meal-apple-health-hint',
        'Запуск команды доступен на iPhone или iPad через приложение Команды.'
    );
    const content = createElement('div', 'meal-apple-health-content');
    const watchCard = createElement('div', 'meal-burned-summary-stub-card meal-apple-health-watch-card');

    actionRow.append(syncBtn);
    screen.append(title, subtitle, actionRow, notice, iosHint, content);

    const pendingSync = state.appleHealthSyncReturn
        && state.appleHealthSyncReturn.target === 'mealBurned'
        && (!state.appleHealthSyncReturn.date || state.appleHealthSyncReturn.date === dateStr)
            ? state.appleHealthSyncReturn
            : null;

    if (!isAppleShortcutsLaunchSupported()) {
        iosHint.style.display = '';
    } else {
        iosHint.style.display = 'none';
    }

    function formatNumber(value, maximumFractionDigits = 0) {
        if (!Number.isFinite(Number(value))) return '—';
        return new Intl.NumberFormat('ru-RU', {
            minimumFractionDigits: 0,
            maximumFractionDigits
        }).format(Number(value));
    }

    function setNotice(kind, text) {
        if (!text) {
            notice.style.display = 'none';
            notice.textContent = '';
            notice.className = 'meal-apple-health-notice';
            return;
        }
        notice.style.display = '';
        notice.textContent = text;
        notice.className = `meal-apple-health-notice ${kind ? `meal-apple-health-notice--${kind}` : ''}`.trim();
    }

    function renderLoading() {
        content.innerHTML = `
            <div class="meal-apple-health-loading">
                <div class="meal-apple-health-loading-card"></div>
                <div class="meal-apple-health-loading-card meal-apple-health-loading-card--small"></div>
            </div>
        `;
    }

    function renderMessageCard(titleText, bodyText, modifier = '') {
        watchCard.className = `meal-burned-summary-stub-card meal-apple-health-watch-card ${modifier}`.trim();
        watchCard.innerHTML = `
            <div class="meal-burned-summary-stub-icon meal-apple-health-watch-icon" aria-hidden="true">
                <svg xmlns="http://www.w3.org/2000/svg" width="34" height="34" viewBox="0 0 24 24">
                    <path fill="currentColor" d="M7 2.75A2.75 2.75 0 0 1 9.75 0h4.5A2.75 2.75 0 0 1 17 2.75v1.32A3.75 3.75 0 0 1 20.75 7.8v8.4A3.75 3.75 0 0 1 17 19.93v1.32A2.75 2.75 0 0 1 14.25 24h-4.5A2.75 2.75 0 0 1 7 21.25v-1.32a3.75 3.75 0 0 1-3.75-3.73V7.8A3.75 3.75 0 0 1 7 4.07zM8.5 4h7V2.75c0-.69-.56-1.25-1.25-1.25h-4.5c-.69 0-1.25.56-1.25 1.25zm7 16h-7v1.25c0 .69.56 1.25 1.25 1.25h4.5c.69 0 1.25-.56 1.25-1.25zm-8.5-1.57c.08 0 .16 0 .24-.01h9.52c.08.01.16.01.24.01a2.25 2.25 0 0 0 2.25-2.23V7.8A2.25 2.25 0 0 0 17 5.57c-.08 0-.16 0-.24.01H7.24c-.08-.01-.16-.01-.24-.01A2.25 2.25 0 0 0 4.75 7.8v8.4A2.25 2.25 0 0 0 7 18.43"/>
                </svg>
            </div>
            <div class="meal-burned-summary-stub-title-text">${titleText}</div>
            <div class="meal-burned-summary-stub-text">${bodyText}</div>
        `;
        content.replaceChildren(watchCard);
    }

    function renderHealthCard(healthDaily, eatenKcal) {
        const totalBurned = Number(healthDaily?.totalBurned || 0);
        const activeKcal = Number(healthDaily?.activeKcal || 0);
        const restingKcal = Number(healthDaily?.restingKcal || 0);
        const exerciseMinutes = Number(healthDaily?.exerciseMinutes || 0);
        const distanceKm = Number(healthDaily?.distanceKm || 0);
        const heartRateAvg = Number(healthDaily?.heartRateAvg || 0);
        const standHours = healthDaily?.standHours;
        const steps = Number(healthDaily?.steps || 0);
        const balance = Number(eatenKcal || 0) - totalBurned;

        const wrap = createElement('div', 'meal-apple-health-panel');
        wrap.innerHTML = `
            <div class="meal-apple-health-summary-card">
                <div class="meal-apple-health-summary-kicker">Apple Health / Здоровье</div>
                <div class="meal-apple-health-summary-main">
                    <div class="meal-apple-health-summary-value">${formatNumber(totalBurned, 1)} <span>ккал</span></div>
                    <div class="meal-apple-health-summary-label">Всего расход за день</div>
                </div>
            </div>
            <div class="meal-apple-health-balance-grid">
                <div class="meal-apple-health-balance-card">
                    <span>Съедено</span>
                    <strong>${formatNumber(eatenKcal)} ккал</strong>
                </div>
                <div class="meal-apple-health-balance-card">
                    <span>Потрачено</span>
                    <strong>${formatNumber(totalBurned, 1)} ккал</strong>
                </div>
                <div class="meal-apple-health-balance-card ${balance > 0 ? 'is-positive' : balance < 0 ? 'is-negative' : ''}">
                    <span>Баланс</span>
                    <strong>${balance > 0 ? '+' : ''}${formatNumber(balance, 1)} ккал</strong>
                </div>
            </div>
            <div class="meal-apple-health-stats-grid">
                <div class="meal-apple-health-stat">
                    <span>Шаги</span>
                    <strong>${formatNumber(steps)}</strong>
                </div>
                <div class="meal-apple-health-stat">
                    <span>Активные калории</span>
                    <strong>${formatNumber(activeKcal, 1)} ккал</strong>
                </div>
                <div class="meal-apple-health-stat">
                    <span>Базовый расход</span>
                    <strong>${formatNumber(restingKcal, 1)} ккал</strong>
                </div>
                <div class="meal-apple-health-stat">
                    <span>Минуты активности</span>
                    <strong>${formatNumber(exerciseMinutes)} мин</strong>
                </div>
                <div class="meal-apple-health-stat">
                    <span>Дистанция</span>
                    <strong>${formatNumber(distanceKm, 2)} км</strong>
                </div>
                <div class="meal-apple-health-stat">
                    <span>Средний пульс</span>
                    <strong>${formatNumber(heartRateAvg)} уд/мин</strong>
                </div>
                ${standHours != null ? `
                    <div class="meal-apple-health-stat">
                        <span>Часы стояния</span>
                        <strong>${formatNumber(standHours)} ч</strong>
                    </div>
                ` : ''}
            </div>
            <div class="meal-apple-health-footer">
                Последнее обновление: <strong>${formatAppleHealthUpdatedAt(healthDaily?.updatedAt)}</strong>
            </div>
        `;
        content.replaceChildren(wrap);
    }

    function updateNotice(healthDaily) {
        if (state.currentMode !== 'own') {
            setNotice('muted', 'Apple Health доступен только в вашем личном режиме.');
            return;
        }

        if (!pendingSync) {
            setNotice(null, '');
            return;
        }

        if (pendingSync.status === 'cancel') {
            setNotice('muted', 'Запуск команды был отменён.');
            return;
        }

        if (pendingSync.status === 'error') {
            setNotice('error', 'Команда завершилась с ошибкой. Проверьте Shortcut и токен Apple Health.');
            return;
        }

        if (healthDaily) {
            setNotice('success', 'Данные Apple Health обновлены и загружены в приложение.');
            if (!state.appleHealthSyncToastShown) {
                showToast('Данные Apple Health обновлены');
                state.appleHealthSyncToastShown = true;
            }
            return;
        }

        setNotice('muted', 'Команда завершена, но данные за этот день пока не найдены. Проверьте Shortcut и токен.');
    }

    async function loadDailyHealth() {
        if (state.currentMode !== 'own') {
            syncBtn.disabled = true;
            renderMessageCard(
                'Apple Health доступен в личном режиме',
                'Если вы открыли питание как тренер, синхронизация с Apple Watch недоступна. Переключитесь в свой аккаунт.'
            );
            updateNotice(null);
            return;
        }

        syncBtn.disabled = false;
        renderLoading();

        try {
            const [healthDaily, eatenKcal] = await Promise.all([
                getAppleHealthDailyForDate(dateStr),
                getMealEatenCaloriesForDate(dateStr)
            ]);

            updateCachedMonthMealsDailySummaryHealthForDate(dateStr, healthDaily);

            updateNotice(healthDaily);

            if (!healthDaily) {
                renderMessageCard(
                    'Нет данных Apple Health',
                    'Нажмите «Получить данные Apple Watch» или дождитесь автоматической синхронизации из приложения Команды.'
                );
                return;
            }

            renderHealthCard(healthDaily, eatenKcal);
        } catch (error) {
            console.error(error);
            setNotice('error', 'Не удалось загрузить данные Apple Health.');
            renderMessageCard(
                'Не удалось загрузить данные',
                'Попробуйте открыть страницу ещё раз или повторно запустить синхронизацию.'
            );
        }
    }

    syncBtn.onclick = () => {
        const result = launchAppleHealthShortcut({
            date: dateStr,
            target: 'mealBurned'
        });

        if (!result?.ok) {
            if (result?.reason === 'unsupported_platform') {
                showToast('Запуск команды доступен через iPhone или iPad');
                return;
            }
            if (result?.reason === 'missing_uid') {
                showToast('Не удалось определить пользователя');
                return;
            }
            showToast('Не удалось запустить команду');
            return;
        }

        if (isStandalonePwaDisplayMode()) {
            setNotice('muted', 'После выполнения команды вернитесь в приложение Training Diary. Данные перечитаются автоматически.');
        }
    };

    setupCreateFoodStickyTitleBorder({ titleEl: title, watchEl: actionRow });
    const cleanupSticky = () => {
        if (typeof title._cleanupStickyBorder === 'function') {
            title._cleanupStickyBorder();
            title._cleanupStickyBorder = null;
        }
    };

    const handleVisibilityResume = () => {
        if (document.visibilityState === 'visible') {
            void loadDailyHealth();
        }
    };

    const handleWindowFocus = () => {
        void loadDailyHealth();
    };

    document.addEventListener('visibilitychange', handleVisibilityResume);
    window.addEventListener('focus', handleWindowFocus);

    const handleBack = () => {
        state.mealView = 'monthSummary';
        renderMealPage();
    };

    attachMealOverlayBottomNavSync(screen, () => {
        setMealBottomNavOverlayMode({
            visible: true,
            onBack: handleBack,
            actionVisible: false,
            secondaryActionVisible: false
        });
    });

    screen._mealOverlayCleanup = () => {
        document.removeEventListener('visibilitychange', handleVisibilityResume);
        window.removeEventListener('focus', handleWindowFocus);
        cleanupSticky?.();
    };

    openMealOverlay(screen);
    void loadDailyHealth();
}

function createEmptyRecipeDraft() {
    return {
        title: '',
        description: '',
        servings: '',
        ingredients: [],
        photos: [],
        coverPhotoIndex: 0
    };
}

function getRecipeDraft() {
    if (!state.recipeDraft || typeof state.recipeDraft !== 'object') {
        state.recipeDraft = createEmptyRecipeDraft();
    }

    if (!Array.isArray(state.recipeDraft.ingredients)) {
        state.recipeDraft.ingredients = [];
    }

    if (!Array.isArray(state.recipeDraft.photos)) {
        state.recipeDraft.photos = [];
    }

    return state.recipeDraft;
}

function calcRecipeIngredientsTotals(ingredients = []) {
    return ingredients.reduce((acc, item) => {
        acc.protein += Number(item.protein || 0);
        acc.fat += Number(item.fat || 0);
        acc.carbs += Number(item.carbs || 0);
        acc.calories += Number(item.calories || 0);
        return acc;
    }, {
        protein: 0,
        fat: 0,
        carbs: 0,
        calories: 0
    });
}









// =================================================================
// 🍽️ ГЛАВНАЯ СТРАНИЦА
// =================================================================
export async function renderMealPage() {
    if (!ensureCycleSelected(render)) return;

    getFoodsMap();

    state.currentPage = 'meal';

    if (!state.selectedDate) {
        state.selectedDate = formatLocalDate(new Date());
    }

    ensureMealShell();

    const oldTopBar = document.querySelector('.top-bar');
    if (oldTopBar) oldTopBar.remove();

    renderTopBar();

    const needRenderMain =
        !mealMainMounted ||
        !mealMainEl ||
        !mealShellEl ||
        !document.getElementById('meal-shell') ||
        !mealMainEl.hasChildNodes();

    if (needRenderMain) {
        renderMealMainScreen();
        mealMainMounted = true;
    } else {
        bindMealCalendarButton();
    }

    if (!state.mealView || state.mealView === 'main') {
        // Гарантируем актуальную привязку бордер-обсерверов к текущему top-bar после любого возврата.
        setupMealMacrosBorderObserver();
        setupTopBarMealBorderObserver();
        closeMealOverlay();
        setMealBaseTopBarVisible(true);
        scheduleMealRootScrollAvailabilitySync();
        return;
    }

    // Для любых оверлей-страниц meal (поиск, цели и т.д.) отключаем бордер-обсерверы главной.
    teardownMealBorderObservers();
    setMealBaseTopBarVisible(false);

    if (state.mealView === 'search') return renderMealSearch();
    if (state.mealView === 'quickAdd') return renderQuickAddStub();
    if (state.mealView === 'create') return renderCreateFood();
    if (state.mealView === 'recipe') return renderCreateRecipe();
    if (state.mealView === 'recipeFoodSearch') return renderRecipeFoodSearch();
    if (state.mealView === 'recipeFoodPreview') return renderRecipeFoodPreview();
    if (state.mealView === 'foodDetails') return renderFoodDetails();
    if (state.mealView === 'monthSummary') return renderMealMonthlySummaryPage();
    if (state.mealView === 'burnedSummary') return renderMealBurnedSummaryStubPage();
    if (state.mealView === 'recipeDetails') {
        renderRecipeDetails();
        return;
    }
    if (state.mealView === 'editRecipe') {
        renderEditRecipe();
        return;
    }
    if (state.mealView === 'editFood') return renderEditFood();
    if (state.mealView === 'goal') return renderMealGoalPage();
}
// =================================================================
//  СТРАНИЦА ЦЕЛЬ
// =================================================================
function createEmptySingleGoal() {
    return {
        calories: '',
        protein: 0,
        fat: 0,
        carbs: 0
    };
}

function createDefaultIntervalPeriod() {
    return {
        id: crypto.randomUUID(),
        days: '',
        goal: createEmptySingleGoal()
    };
}

function createDefaultIntervalState() {
    return {
        periods: [
            createDefaultIntervalPeriod(),
            createDefaultIntervalPeriod()
        ]
    };
}

function getIntervalTargetKey(index) {
    return `interval-${index}`;
}

function parseIntervalTargetKey(targetKey) {
    if (!String(targetKey).startsWith('interval-')) return null;

    const index = Number(String(targetKey).replace('interval-', ''));
    return Number.isInteger(index) && index >= 0 ? index : null;
}

function canAddIntervalPeriod() {
    const goal = getMealGoalState();
    return (goal.interval?.periods?.length || 0) < 6;
}

function addIntervalPeriodDraft() {
    const goal = getMealGoalState();

    if (!goal.interval || !Array.isArray(goal.interval.periods)) {
        goal.interval = createDefaultIntervalState();
    }

    if (goal.interval.periods.length >= 6) return;

    goal.interval.periods.push(createDefaultIntervalPeriod());
}

function removeIntervalPeriodDraft(index) {
    const goal = getMealGoalState();

    if (!goal.interval?.periods) return;

    // первые 2 периода удалять нельзя
    if (index < 2) return;

    goal.interval.periods.splice(index, 1);

    const currentTargetIndex = parseIntervalTargetKey(goal.sheetTarget);

    if (currentTargetIndex === index) {
        goal.sheetTarget = null;
    } else if (currentTargetIndex !== null && currentTargetIndex > index) {
        goal.sheetTarget = getIntervalTargetKey(currentTargetIndex - 1);
    }
}

// ============   Вспомогательные расчёты
function getMealGoalState() {
    if (!state.mealGoal) {
        state.mealGoal = {};
    }

    const goal = state.mealGoal;

    // daily
    if (!goal.daily || typeof goal.daily !== 'object') {
        goal.daily = { calories: '', protein: 0, fat: 0, carbs: 0 };
    }

    // weekday
    if (!goal.weekday || typeof goal.weekday !== 'object') {
        goal.weekday = {
            days: [],
            calories: '',
            protein: 0,
            fat: 0,
            carbs: 0
        };
    }
    if (!Array.isArray(goal.weekday.days)) {
        goal.weekday.days = [];
    }

    if (!goal.pendingKcalUpdate || typeof goal.pendingKcalUpdate !== 'object') {
        goal.pendingKcalUpdate = {
            targetKey: null,
            value: 0
        };
    }

    // interval
    if (!goal.interval || typeof goal.interval !== 'object') {
        goal.interval = createDefaultIntervalState();
    }

    if (!Array.isArray(goal.interval.periods) || goal.interval.periods.length < 2) {
        goal.interval = createDefaultIntervalState();
    }

    // interval
    if (!goal.interval || typeof goal.interval !== 'object') {
        goal.interval = createDefaultIntervalState();
    }

    if (!Array.isArray(goal.interval.periods)) {
        goal.interval.periods = [];
    }

    // ограничиваем максимум 6, но БЕЗ map-пересоздания
    if (goal.interval.periods.length > 6) {
        goal.interval.periods.length = 6;
    }

    // нормализуем каждый период В ТОМ ЖЕ ОБЪЕКТЕ
    goal.interval.periods.forEach(period => {
        if (!period || typeof period !== 'object') return;

        if (!period.id) {
            period.id = crypto.randomUUID();
        }

        period.days = period?.days || '';

        if (!period.goal || typeof period.goal !== 'object') {
            period.goal = createEmptySingleGoal();
        }

        period.goal.calories = period.goal?.calories || '';
        period.goal.protein = Number(period.goal?.protein || 0);
        period.goal.fat = Number(period.goal?.fat || 0);
        period.goal.carbs = Number(period.goal?.carbs || 0);
    });

    while (goal.interval.periods.length < 2) {
        goal.interval.periods.push(createDefaultIntervalPeriod());
    }



    // sheet target
    if (typeof goal.sheetTarget === 'undefined') {
        goal.sheetTarget = null; // 'daily' | 'weekday' | 'interval-first' | 'interval-second'
    }
    if (typeof goal.activeBlock === 'undefined') {
        goal.activeBlock = null; // 'daily' | 'weekday' | 'interval'
    }

    return goal;
}
// ============ helpers для валидации и сохранения цели

function calcMealGoalKcalFromMacros(goal) {
    return Math.round(
        (Number(goal.protein || 0) * 4) +
        (Number(goal.carbs || 0) * 4) +
        (Number(goal.fat || 0) * 9)
    );
}

function isSingleGoalValid(goal) {
    const targetCalories = Number(goal?.calories || 0);
    if (!targetCalories) return false;

    const calculatedCalories = calcMealGoalKcalFromMacros(goal);
    return calculatedCalories === targetCalories;
}

function isIntervalPeriodEmpty(period) {
    if (!period) return true;

    const days = Number(period.days || 0);
    const calories = Number(period.goal?.calories || 0);
    const protein = Number(period.goal?.protein || 0);
    const fat = Number(period.goal?.fat || 0);
    const carbs = Number(period.goal?.carbs || 0);

    return !days && !calories && !protein && !fat && !carbs;
}

function isIntervalPeriodComplete(period) {
    if (!period) return false;

    const days = Number(period.days || 0);
    if (!days) return false;

    return isSingleGoalValid(period.goal || {});
}

function isLastIntervalPeriodComplete(periods = []) {
    if (!Array.isArray(periods) || !periods.length) return false;

    const last = periods[periods.length - 1];
    return isIntervalPeriodComplete(last);
}

function canEditIntervalPeriod(goalState, index) {
    if (index === 0) return true;

    const prevPeriod = goalState.interval?.periods?.[index - 1];
    return isIntervalPeriodComplete(prevPeriod);
}

function getFirstInvalidIntervalPeriodIndex(periods = []) {
    return periods.findIndex(period => !isIntervalPeriodComplete(period));
}

function hasExtraEmptyIntervalPeriod(periods = []) {
    return periods.some((period, index) => index >= 1 && isIntervalPeriodEmpty(period));
}
function formatGoalSummary(goal) {
    return `${goal.calories} ккал • Б ${goal.protein} / Ж ${goal.fat} / У ${goal.carbs}`;
}

function clearSingleGoal(goal) {
    goal.calories = '';
    goal.protein = 0;
    goal.fat = 0;
    goal.carbs = 0;
}

function resetIntervalDraft(interval) {
    interval.periods = [
        createDefaultIntervalPeriod(),
        createDefaultIntervalPeriod()
    ];
}

function activateMealGoalBlock(blockKey) {
    const goal = getMealGoalState();

    if (goal.activeBlock && goal.activeBlock !== blockKey) {
        if (blockKey !== 'daily') {
            clearSingleGoal(goal.daily);
        }

        if (blockKey !== 'weekday') {
            goal.weekday.days = [];
            clearSingleGoal(goal.weekday);
        }

        if (blockKey !== 'interval') {
            resetIntervalDraft(goal.interval);
        }

        goal.sheetTarget = null;
    }

    goal.activeBlock = blockKey;
}

function updateMacrosPickerState(row, active, label, clearBtn = null) {
    if (!row) return;

    row.classList.toggle('active', !!active);
    row.classList.toggle('disabled', !active);

    const valueBtn = row.querySelector('.meal-goal-macros-value-btn');

    if (valueBtn) {
        valueBtn.disabled = !active;

        if (typeof label === 'string') {
            valueBtn.textContent = label;
        }
    }


}

function updateMealGoalClearButtonState(clearBtn, active) {
    if (!clearBtn) return;

    clearBtn.classList.toggle('disabled', !active);
    clearBtn.disabled = !active;
}

function getEditableGoalByTarget(targetKey) {
    const goal = getMealGoalState();

    if (targetKey === 'daily') return goal.daily;
    if (targetKey === 'weekday') return goal.weekday;

    const intervalIndex = parseIntervalTargetKey(targetKey);
    if (intervalIndex !== null) {
        return goal.interval?.periods?.[intervalIndex]?.goal || null;
    }

    return null;
}

function setPendingKcalUpdate(targetKey, value) {
    const goal = getMealGoalState();
    goal.pendingKcalUpdate = {
        targetKey,
        value: Number(value || 0)
    };
}

function clearPendingKcalUpdate(targetKey = null) {
    const goal = getMealGoalState();

    if (!targetKey || goal.pendingKcalUpdate?.targetKey === targetKey) {
        goal.pendingKcalUpdate = {
            targetKey: null,
            value: 0
        };
    }
}

function getPendingKcalUpdate(targetKey) {
    const goal = getMealGoalState();
    if (goal.pendingKcalUpdate?.targetKey !== targetKey) return 0;
    return Number(goal.pendingKcalUpdate?.value || 0);
}

function applyPendingKcalUpdate(targetKey) {
    const goal = getMealGoalState();
    const nextValue = getPendingKcalUpdate(targetKey);

    if (!nextValue) return;

    const intervalIndex = parseIntervalTargetKey(targetKey);

    // ===== interval =====
    if (intervalIndex !== null) {
        const period = goal.interval?.periods?.[intervalIndex];
        if (!period || !period.goal) return;

        goal.activeBlock = 'interval';
        goal.sheetTarget = targetKey;

        period.goal.calories = String(nextValue);

        clearPendingKcalUpdate(targetKey);
        renderMealGoalPage();
        return;
    }

    // ===== daily =====
    if (targetKey === 'daily') {
        goal.activeBlock = 'daily';
        goal.sheetTarget = 'daily';
        goal.daily.calories = String(nextValue);

        clearPendingKcalUpdate(targetKey);
        renderMealGoalPage();
        return;
    }

    // ===== weekday =====
    if (targetKey === 'weekday') {
        goal.activeBlock = 'weekday';
        goal.sheetTarget = 'weekday';
        goal.weekday.calories = String(nextValue);

        clearPendingKcalUpdate(targetKey);
        renderMealGoalPage();
        return;
    }
}


function isMealGoalValid() {
    return getMealGoalSaveValidity();
}

function isWeekdayGoalReadyForSave(goalState) {
    const selectedDays = normalizeDays(goalState.weekday?.days || []);
    if (!selectedDays.length) return false;

    return isSingleGoalValid(goalState.weekday);
}

function isIntervalGoalReadyForSave(goalState) {
    const periods = goalState.interval?.periods || [];
    if (!periods.length) return false;

    let hasAtLeastOneComplete = false;

    for (let i = 0; i < periods.length; i++) {
        const period = periods[i];

        // пустые хвостовые периоды после заполненных не считаем валидными
        if (isIntervalPeriodEmpty(period)) {
            // если после пустого есть заполненный — структура сломана
            const hasFilledAfter = periods.slice(i + 1).some(p => !isIntervalPeriodEmpty(p));
            if (hasFilledAfter) return false;
            break;
        }

        // каждый непустой период обязан быть полным и валидным
        if (!isIntervalPeriodComplete(period)) {
            return false;
        }

        hasAtLeastOneComplete = true;
    }

    return hasAtLeastOneComplete;
}

function getMealGoalSaveValidity() {
    const goalState = getMealGoalState();

    if (goalState.sheetTarget === 'daily') {
        return isSingleGoalValid(goalState.daily);
    }

    if (goalState.sheetTarget === 'weekday') {
        return isWeekdayGoalReadyForSave(goalState);
    }

    const intervalIndex = parseIntervalTargetKey(goalState.sheetTarget);
    if (intervalIndex !== null || goalState.activeBlock === 'interval') {
        return isIntervalGoalReadyForSave(goalState);
    }

    return false;
}

function updateMealGoalSaveButtonState() {
    const saveBtn = document.querySelector('.meal-goal-top-btn-save');
    const valid = getMealGoalSaveValidity();

    if (saveBtn) {
        saveBtn.disabled = !valid;
        saveBtn.classList.toggle('disabled', !valid);
    }

    if (state.currentPage === 'meal' && state.mealView === 'goal') {
        setMealBottomNavOverlayMode({
            visible: true,
            onBack: () => closeMealOverlayAndShowMealMain(),
            actionText: 'Сохранить цель',
            onAction: async () => {
                try {
                    const ok = await saveMealGoalToCycle();
                    if (!ok) return;

                    showToast('Пресет сохранён');
                    renderMealGoalPage();
                    renderMealMainScreen();
                } catch (e) {
                    console.error(e);
                    showToast('Не удалось сохранить');
                }
            },
            actionDisabled: !valid
        });
    }
}


async function saveMealGoalToCycle() {
    const goalState = getMealGoalState();
    const cycleRef = getCycleDocRef();
    const currentCycle = getSelectedCycle();
    const currentConfig = currentCycle?.mealGoalConfig || {};

    // daily
    if (goalState.sheetTarget === 'daily') {
        if (!isSingleGoalValid(goalState.daily)) {
            showToast('Сначала приведи Б/Ж/У точно к калориям');
            return false;
        }

        const nextConfig = {
            ...currentConfig,
            baseGoal: {
                calories: Number(goalState.daily.calories || 0),
                protein: Number(goalState.daily.protein || 0),
                fat: Number(goalState.daily.fat || 0),
                carbs: Number(goalState.daily.carbs || 0),
                updatedAt: Date.now()
            }
        };

        await setDoc(cycleRef, {
            mealGoalConfig: nextConfig
        }, { merge: true });

        patchMealGoalConfigInLocalState(nextConfig);

        clearSingleGoal(goalState.daily);
        goalState.sheetTarget = null;
        return true;
    }

    // weekday
    if (goalState.sheetTarget === 'weekday') {
        const selectedDays = normalizeDays(goalState.weekday.days);

        if (!selectedDays.length) {
            showToast('Выбери хотя бы один день');
            return false;
        }

        if (!isSingleGoalValid(goalState.weekday)) {
            showToast('Сначала приведи Б/Ж/У точно к калориям');
            return false;
        }

        const existing = Array.isArray(currentConfig.weekdayPresets)
            ? currentConfig.weekdayPresets
            : [];

        const exactMatch = existing.find(preset => areSameDays(preset.days, selectedDays));

        const partialConflict = existing.find(preset => {
            if (exactMatch && preset.id === exactMatch.id) return false;
            return hasDaysOverlap(preset.days, selectedDays);
        });

        if (partialConflict) {
            showToast('На один из выбранных дней уже задан пресет');
            return false;
        }

        const newPreset = {
            id: exactMatch?.id || `wd_${selectedDays.join('_')}_${Date.now()}`,
            days: selectedDays,
            goal: {
                calories: Number(goalState.weekday.calories || 0),
                protein: Number(goalState.weekday.protein || 0),
                fat: Number(goalState.weekday.fat || 0),
                carbs: Number(goalState.weekday.carbs || 0)
            },
            updatedAt: Date.now()
        };

        const nextWeekdayPresets = exactMatch
            ? existing.map(preset => preset.id === exactMatch.id ? newPreset : preset)
            : [...existing, newPreset];

        const nextConfig = normalizeMealGoalConfigForState({
            ...currentConfig,
            weekdayPresets: nextWeekdayPresets
        });

        await setDoc(cycleRef, {
            mealGoalConfig: {
                ...currentConfig,
                weekdayPresets: nextWeekdayPresets,
                intervalPreset: deleteField()
            }
        }, { merge: true });

        patchMealGoalConfigInLocalState(nextConfig);

        goalState.weekday.days = [];
        clearSingleGoal(goalState.weekday);
        goalState.sheetTarget = null;
        return true;
    }


    // interval
    const intervalTargetIndex = parseIntervalTargetKey(goalState.sheetTarget);

    if (intervalTargetIndex !== null) {
        const periods = Array.isArray(goalState.interval?.periods)
            ? goalState.interval.periods
            : [];

        if (periods.length < 2) {
            showToast('Нужно минимум 2 периода');
            return false;
        }

        const emptyPeriodIndex = periods.findIndex((period, index) => {
            return index >= 1 && isIntervalPeriodEmpty(period);
        });

        if (emptyPeriodIndex !== -1) {
            showToast(`Период ${emptyPeriodIndex + 1} пустой. Заполните его или удалите пустой период`);
            return false;
        }

        const incompletePeriodIndex = periods.findIndex(period => !isIntervalPeriodComplete(period));

        if (incompletePeriodIndex !== -1) {
            showToast(`Период ${incompletePeriodIndex + 1} заполнен не до конца. Сначала приведи Б/Ж/У точно к калориям`);
            return false;
        }

        const normalizedPeriods = periods.map((period, index) => ({
            id: period.id || `period_${index + 1}_${Date.now()}`,
            days: Number(period.days || 0),
            goal: {
                calories: Number(period.goal?.calories || 0),
                protein: Number(period.goal?.protein || 0),
                fat: Number(period.goal?.fat || 0),
                carbs: Number(period.goal?.carbs || 0)
            }
        }));

        const nextConfig = normalizeMealGoalConfigForState({
            ...currentConfig,
            intervalPreset: {
                startDate: state.selectedDate || formatLocalDate(new Date()),
                periods: normalizedPeriods,
                updatedAt: Date.now()
            },
            weekdayPresets: []
        });

        await setDoc(cycleRef, {
            mealGoalConfig: {
                ...currentConfig,
                intervalPreset: nextConfig.intervalPreset,
                weekdayPresets: []
            }
        }, { merge: true });

        patchMealGoalConfigInLocalState(nextConfig);

        resetIntervalDraft(goalState.interval);
        goalState.sheetTarget = null;

        return true;
    }

    showToast('Нечего сохранять');
    return false;
}

async function clearMealGoalFromCycle() {
    const cycleRef = getCycleDocRef();

    await updateDoc(cycleRef, {
        mealGoalConfig: deleteField()
    });

    state.mealGoal = null;
}



function calcPercentFromMacros(goal) {
    const calories = Number(goal.calories || 0);
    if (!calories) {
        return { protein: 0, fat: 0, carbs: 0, total: 0 };
    }

    const proteinPct = ((Number(goal.protein || 0) * 4) / calories) * 100;
    const fatPct = ((Number(goal.fat || 0) * 9) / calories) * 100;
    const carbsPct = ((Number(goal.carbs || 0) * 4) / calories) * 100;

    return {
        protein: proteinPct,
        fat: fatPct,
        carbs: carbsPct,
        total: proteinPct + fatPct + carbsPct
    };
}


function getMacroLabel(macroKey) {
    if (macroKey === 'protein') return 'Белки';
    if (macroKey === 'fat') return 'Жиры';
    return 'Углеводы';
}

// ======== функция форматирования числа с пробелами

function formatNumberWithSpaces(value) {
    return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// ======== top bar для страницы цели

function renderMealGoalTopBar() {
    const target = mealOverlayEl || document.getElementById('root');
    const title = createElement('h3', 'meal-goal-page-title', 'Цели');

    target.querySelector('.meal-goal-sticky-header')?.remove();
    target.querySelector('.meal-goal-page-title')?.remove();
    target.querySelector('.meal-goal-top-bar')?.remove();

    const stickyHeader = document.createElement('div');
    stickyHeader.className = 'meal-goal-sticky-header';

    const topBar = document.createElement('div');
    topBar.className = 'meal-goal-top-bar';
    stickyHeader.append(topBar, title);
    target.prepend(stickyHeader);
    updateMealGoalSaveButtonState();

    requestAnimationFrame(() => {
        const watchEl = target.querySelector('.meal-goal-page');
        if (watchEl) {
            setupCreateFoodStickyTitleBorder({
                titleEl: title,
                watchEl
            });
        }
    });
}


function buildGoalChipTitle(goal) {
    return `${goal.calories} ккал • Б ${goal.protein} / Ж ${goal.fat} / У ${goal.carbs}`;
}



function renderMealGoalWeekdaysBlock() {
    const goal = getMealGoalState();
    const wrap = createElement('div', 'meal-goal-weekdays-wrap');

    const days = [
        { num: 1, label: 'Пн' },
        { num: 2, label: 'Вт' },
        { num: 3, label: 'Ср' },
        { num: 4, label: 'Чт' },
        { num: 5, label: 'Пт' },
        { num: 6, label: 'Сб' },
        { num: 7, label: 'Вс' }
    ];

    const selectedDays = Array.isArray(goal.weekdayDays) ? goal.weekdayDays : [];

    days.forEach(day => {
        const btn = createElement(
            'button',
            `meal-goal-weekday-btn ${selectedDays.includes(day.num) ? 'active' : ''}`,
            day.label
        );
        btn.type = 'button';

        btn.onclick = () => {
            const currentDays = Array.isArray(goal.weekdayDays) ? goal.weekdayDays : [];
            const exists = currentDays.includes(day.num);

            if (exists) {
                goal.weekdayDays = currentDays.filter(item => item !== day.num);
            } else {
                goal.weekdayDays = [...currentDays, day.num].sort((a, b) => a - b);
            }

            goal.mode = goal.weekdayDays.length ? 'weekday' : 'base';
            renderMealGoalPage();
        };

        wrap.append(btn);
    });

    return wrap;
}

function renderMealGoalIntervalBlock() {
    const goal = getMealGoalState();
    const wrap = createElement('div', 'meal-goal-interval-wrap');

    const firstInput = createElement('input', 'meal-goal-interval-input');
    firstInput.type = 'text';
    firstInput.inputMode = 'numeric';
    firstInput.placeholder = '1';
    firstInput.value = goal.intervalFirstSpan || '';

    const secondInput = createElement('input', 'meal-goal-interval-input');
    secondInput.type = 'text';
    secondInput.inputMode = 'numeric';
    secondInput.placeholder = '1';
    secondInput.value = goal.intervalSecondSpan || '';

    firstInput.oninput = (e) => {
        goal.intervalFirstSpan = e.target.value.replace(/[^\d]/g, '');
        if (goal.intervalFirstSpan) {
            goal.mode = 'interval-first';
        }
    };

    secondInput.oninput = (e) => {
        goal.intervalSecondSpan = e.target.value.replace(/[^\d]/g, '');
        if (goal.intervalFirstSpan && goal.intervalSecondSpan) {
            goal.mode = 'interval-second';
        }
    };

    const label = createElement('div', 'meal-goal-interval-label', 'через');

    wrap.append(firstInput, label, secondInput);
    return wrap;
}


function buildGoalSummaryNode(goal) {
    const g = normalizeGoal(goal || {});
    const root = createElement('span', 'meal-goal-summary-inline');

    const kcal = createElement('span', 'meal-goal-summary-kcal', `${g.calories} Ккал`);
    const dot = createElement('span', 'meal-goal-summary-dot', '•');

    const pLabel = createElement('span', 'meal-goal-summary-macro-label meal-goal-summary-macro-label-protein', 'белки-');
    const pValue = createElement('span', 'meal-goal-summary-macro-value meal-goal-summary-macro-value-protein', `${g.protein},`);

    const sep1 = createElement('span', 'meal-goal-summary-separator', '/');

    const fLabel = createElement('span', 'meal-goal-summary-macro-label meal-goal-summary-macro-label-fat', 'жиры-');
    const fValue = createElement('span', 'meal-goal-summary-macro-value meal-goal-summary-macro-value-fat', `${g.fat},`);

    const sep2 = createElement('span', 'meal-goal-summary-separator', '/');

    const cLabel = createElement('span', 'meal-goal-summary-macro-label meal-goal-summary-macro-label-carbs', 'углеводы-');
    const cValue = createElement('span', 'meal-goal-summary-macro-value meal-goal-summary-macro-value-carbs', `${g.carbs}`);

    root.append(kcal, dot, pLabel, pValue, sep1, fLabel, fValue, sep2, cLabel, cValue);
    return root;
}

function buildWeekdayTitleNode(days = []) {
    const root = createElement('span', 'meal-goal-preset-title-days-wrap');
    const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

    normalizeDays(days).forEach((day, index) => {
        if (index > 0) {
            root.append(createElement('span', 'meal-goal-preset-title-separator', ','));
        }

        root.append(createElement('span', 'meal-goal-preset-title-day', dayNames[day - 1] || ''));
    });

    return root;
}

function buildIntervalTitleNode(periods = []) {
    const root = createElement('span', 'meal-goal-preset-title-interval-wrap');
    root.append(createElement('span', 'meal-goal-preset-title-label', 'Чередование'));

    periods.forEach((item, index) => {
        root.append(createElement('span', 'meal-goal-preset-title-separator', index === 0 ? ' ' : '/'));
        root.append(createElement('span', 'meal-goal-preset-title-days', String(item.days)));
    });

    return root;
}

function buildIntervalSubtitleNode(periods = []) {
    const root = createElement('span', 'meal-goal-preset-interval-subtitle-wrap');

    periods.forEach((item, index) => {
        if (index > 0) {
            root.append(createElement('span', 'meal-goal-preset-chip-part-separator', '·'));
        }

        const periodWrap = createElement('span', 'meal-goal-preset-interval-part');
        const idx = createElement('span', 'meal-goal-preset-interval-index', `${index + 1}:`);
        const summary = buildGoalSummaryNode(item.goal);

        periodWrap.append(idx, summary);
        root.append(periodWrap);
    });

    return root;
}

function renderSavedMealGoalPresets() {
    const config = getMealGoalConfigFromSelectedCycle();
    const wrap = createElement('div', 'meal-goal-presets');

    if (!config) {
        wrap.append(createElement('div', 'meal-goal-presets-empty', 'Пресеты не заданы'));
        return wrap;
    }

    if (config.baseGoal?.calories) {
        const chip = createPresetChip(
            createElement('span', 'meal-goal-preset-title-text', 'Каждый день'),
            buildGoalSummaryNode(config.baseGoal),
            async () => {
                const cycleRef = getCycleDocRef();
                const current = getSelectedCycle()?.mealGoalConfig || {};

                const nextConfig = { ...current };
                delete nextConfig.baseGoal;

                await setDoc(cycleRef, {
                    mealGoalConfig: {
                        ...current,
                        baseGoal: deleteField()
                    }
                }, { merge: true });

                patchMealGoalConfigInLocalState(nextConfig);

                renderMealGoalPage();
                renderMealMainScreen();
            }
        );
        wrap.append(chip);
    }

    (config.weekdayPresets || []).forEach(preset => {
        const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
        const title = (preset.days || []).map(day => dayNames[day - 1]).join(', ');

        const chip = createPresetChip(
            buildWeekdayTitleNode(preset.days || []),
            buildGoalSummaryNode(preset.goal),
            async () => {
                const cycleRef = getCycleDocRef();
                const current = getSelectedCycle()?.mealGoalConfig || {};

                const filtered = (current.weekdayPresets || []).filter(item => item.id !== preset.id);

                const nextConfig = {
                    ...current,
                    weekdayPresets: filtered
                };

                await setDoc(cycleRef, {
                    mealGoalConfig: {
                        ...current,
                        weekdayPresets: filtered
                    }
                }, { merge: true });

                patchMealGoalConfigInLocalState(nextConfig);

                renderMealGoalPage();
                renderMealMainScreen();
            }
        );

        wrap.append(chip);
    });

    if (config.intervalPreset) {
        const p = config.intervalPreset;

        const periods = Array.isArray(p.periods)
            ? p.periods
            : (
                p.firstSpanDays && p.secondSpanDays
                    ? [
                        { days: p.firstSpanDays, goal: p.firstGoal },
                        { days: p.secondSpanDays, goal: p.secondGoal }
                    ]
                    : []
            );

        const safePeriods = periods
            .map(item => ({
                days: Number(item?.days || 0),
                goal: normalizeGoal(item?.goal || {})
            }))
            .filter(item => item.days > 0 && Number(item.goal.calories || 0) > 0);

        if (safePeriods.length) {
            const chip = createPresetChip(
                buildIntervalTitleNode(safePeriods),
                buildIntervalSubtitleNode(safePeriods),
                async () => {
                    const cycleRef = getCycleDocRef();
                    const current = getSelectedCycle()?.mealGoalConfig || {};

                    const nextConfig = { ...current };
                    delete nextConfig.intervalPreset;

                    await setDoc(cycleRef, {
                        mealGoalConfig: {
                            ...current,
                            intervalPreset: deleteField()
                        }
                    }, { merge: true });

                    patchMealGoalConfigInLocalState(nextConfig);

                    renderMealGoalPage();
                    renderMealMainScreen();
                }
            );

            wrap.append(chip);
        }
    }

    return wrap;
}

function createPresetChip(titleContent, subtitleContent, onDelete) {
    const chip = createElement('div', 'meal-goal-preset-chip');

    const content = createElement('div', 'meal-goal-preset-chip-content');

    const titleEl = createElement('div', 'meal-goal-preset-chip-title');
    if (titleContent instanceof Node) {
        titleEl.append(titleContent);
    } else {
        titleEl.textContent = String(titleContent || '');
    }

    const subEl = createElement('div', 'meal-goal-preset-chip-subtitle');
    if (subtitleContent instanceof Node) {
        subEl.append(subtitleContent);
    } else {
        subEl.textContent = String(subtitleContent || '');
    }

    const delBtn = createElement('button', 'meal-goal-preset-chip-delete');
    delBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24">
                             <path fill="currentColor" d="M16 1.75V3h5.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H8V1.75C8 .784 8.784 0 9.75 0h4.5C15.216 0 16 .784 16 1.75m-6.5 0V3h5V1.75a.25.25 0 0 0-.25-.25h-4.5a.25.25 0 0 0-.25.25M4.997 6.178a.75.75 0 1 0-1.493.144L4.916 20.92a1.75 1.75 0 0 0 1.742 1.58h10.684a1.75 1.75 0 0 0 1.742-1.581l1.413-14.597a.75.75 0 0 0-1.494-.144l-1.412 14.596a.25.25 0 0 1-.249.226H6.658a.25.25 0 0 1-.249-.226z"></path>
                             <path fill="currentColor" d="M9.206 7.501a.75.75 0 0 1 .793.705l.5 8.5A.75.75 0 1 1 9 16.794l-.5-8.5a.75.75 0 0 1 .705-.793Zm6.293.793A.75.75 0 1 0 14 8.206l-.5 8.5a.75.75 0 0 0 1.498.088l.5-8.5Z"></path>
                         </svg>
        `;
    delBtn.type = 'button';
    delBtn.onclick = (e) => {
            e.stopPropagation();

            openConfirmModal('Удалить пресет?', () => {
                if (typeof onDelete === 'function') {
                    onDelete();
                }
            });
        };

    content.append(titleEl, subEl);
    chip.append(content, delBtn);

    return chip;
}

function renderDailyGoalBlock(goalState) {
    const block = createElement('div', 'meal-goal-section avryday');

    const isActive = Number(goalState.daily.calories || 0) > 0;

    const clearBtn = createMealGoalClearButton({
        active: isActive,
        onClear: () => {
            clearSingleGoal(goalState.daily);
            clearPendingKcalUpdate('daily');
            goalState.sheetTarget = null;
            kcalInput.value = '';

            updateMacrosPickerState(
                macrosRow,
                false,
                buildGoalSummaryShort(goalState.daily)
            );

            updateMealGoalClearButtonState(clearBtn, false);

            if (dailyHint) {
                dailyHint.style.display = 'none';
            }
        }
    });

    const title = createElement('div', 'meal-goal-section-title', 'Цель на каждый день');

    const kcalInput = createElement('input', 'meal-goal-kcal-input');
    const dailyHint = createPendingKcalHintBlock('daily');
    kcalInput.type = 'text';
    kcalInput.inputMode = 'numeric';
    kcalInput.placeholder = 'ккал';
    kcalInput.value = goalState.daily.calories || '';

    const kcalWrap = createElement('div', 'meal-goal-kcal-wrap');
    kcalWrap.append(kcalInput);

    const macrosRow = createMealGoalMacrosPickerRow({
        label: buildGoalSummaryShort(goalState.daily),
        active: isActive,
        onOpen: () => {
            activateMealGoalBlock('daily');
            goalState.sheetTarget = 'daily';

            if (!Number(goalState.daily.calories || 0)) {
                showToast('Сначала введи калории');
                return;
            }

            openMealGoalSheet('daily');
        }
    });

    const content = createMealGoalSectionContent(macrosRow, kcalWrap);

    kcalInput.oninput = (e) => {
        activateMealGoalBlock('daily');

        const clean = e.target.value.replace(/[^\d]/g, '');
        goalState.daily.calories = clean;

        if (e.target.value !== clean) {
            e.target.value = clean;
        }

        updateMacrosPickerState(
            macrosRow,
            Number(clean) > 0,
            buildGoalSummaryShort(goalState.daily)
        );

        updateMealGoalClearButtonState(clearBtn, Number(clean) > 0);
    };

    title.append(clearBtn);
    block.append(title, content, dailyHint);
    return block;
}

function renderWeekdayGoalBlock(goalState) {
    const block = createElement('div', 'meal-goal-section');
    const title = createElement('div', 'meal-goal-section-title', 'Задать цель на определённый день');

    const daysWrap = createElement('div', 'meal-goal-days-wrap');
    const dayNames = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

    const hasDays = goalState.weekday.days.length > 0;
    const hasFullWeekdayGoal = hasDays && Number(goalState.weekday.calories || 0) > 0;

    const clearBtn = createMealGoalClearButton({
        active: hasDays,
        onClear: () => {
            goalState.weekday.days = [];
            clearSingleGoal(goalState.weekday);
            clearPendingKcalUpdate('weekday');
            goalState.sheetTarget = null;
            kcalInput.value = '';
            kcalInput.disabled = true;

            daysWrap.querySelectorAll('.meal-goal-day-btn').forEach(btn => {
                btn.classList.remove('active');
            });

            updateMacrosPickerState(
                macrosRow,
                false,
                buildGoalSummaryShort(goalState.weekday),

            );
            updateMealGoalClearButtonState(clearBtn, false);

            if (weekdayHint) {
                weekdayHint.style.display = 'none';
            }
        }
    });

    const kcalInput = createElement('input', 'meal-goal-kcal-input');
    kcalInput.type = 'text';
    kcalInput.inputMode = 'numeric';
    kcalInput.placeholder = 'ккал';
    kcalInput.value = goalState.weekday.calories || '';
    kcalInput.disabled = !goalState.weekday.days.length;

    const kcalWrap = createElement('div', 'meal-goal-kcal-wrap');
    const weekdayHint = createPendingKcalHintBlock('weekday');
    kcalWrap.append(kcalInput);

    const macrosRow = createMealGoalMacrosPickerRow({
        label: buildGoalSummaryShort(goalState.weekday),
        active: hasFullWeekdayGoal,
        onOpen: () => {
            activateMealGoalBlock('weekday');
            goalState.sheetTarget = 'weekday';

            if (!goalState.weekday.days.length || !Number(goalState.weekday.calories || 0)) {
                showToast('Сначала введи калории');
                return;
            }

            openMealGoalSheet('weekday');
        }
    });

    const content = createMealGoalSectionContent(macrosRow, kcalWrap);

    dayNames.forEach((label, index) => {
        const dayNum = index + 1;
        const active = goalState.weekday.days.includes(dayNum);

        const btn = createElement(
            'button',
            `meal-goal-day-btn ${active ? 'active' : ''}`,
            label
        );
        btn.type = 'button';

        btn.onclick = () => {
            activateMealGoalBlock('weekday');

            if (goalState.weekday.days.includes(dayNum)) {
                goalState.weekday.days = goalState.weekday.days.filter(item => item !== dayNum);
                btn.classList.remove('active');
            } else {
                goalState.weekday.days = [...goalState.weekday.days, dayNum].sort((a, b) => a - b);
                btn.classList.add('active');
            }

            const hasDays = goalState.weekday.days.length > 0;
            kcalInput.disabled = !hasDays;

            if (!hasDays) {
                goalState.weekday.calories = '';
                kcalInput.value = '';
            }

            const hasSelectedDays = goalState.weekday.days.length > 0;
            const hasFullGoal = hasSelectedDays && Number(goalState.weekday.calories || 0) > 0;

            updateMacrosPickerState(
                macrosRow,
                hasFullGoal,
                buildGoalSummaryShort(goalState.weekday)
            );

            updateMealGoalClearButtonState(clearBtn, hasSelectedDays);
        };

        daysWrap.append(btn);
    });

    kcalInput.oninput = (e) => {
        activateMealGoalBlock('weekday');

        const clean = e.target.value.replace(/[^\d]/g, '');
        goalState.weekday.calories = clean;

        if (e.target.value !== clean) {
            e.target.value = clean;
        }

        const hasSelectedDays = goalState.weekday.days.length > 0;
        const hasFullGoal = hasSelectedDays && Number(clean) > 0;

        updateMacrosPickerState(
            macrosRow,
            hasFullGoal,
            buildGoalSummaryShort(goalState.weekday)
        );

        updateMealGoalClearButtonState(clearBtn, hasSelectedDays);
    };
    title.append(clearBtn);
    block.append( title, daysWrap, content, weekdayHint);
    return block;
}

function renderIntervalGoalBlock(goalState) {
    const block = createElement('div', 'meal-goal-section');
    const title = createElement('div', 'meal-goal-section-title', 'Чередование');

    const grid = createElement('div', 'meal-goal-interval-grid');

    const periods = Array.isArray(goalState.interval?.periods)
        ? goalState.interval.periods
        : [];

    periods.forEach((period, index) => {
        const getCurrentPeriod = () => goalState.interval.periods[index];
        const periodLocked = !canEditIntervalPeriod(goalState, index);

        const card = renderIntervalSideCard({
            title: `${index + 1}-й период`,
            targetKey: getIntervalTargetKey(index),
            daysValue: period.days,
            kcalValue: period.goal.calories,
            getSummary: () => buildGoalSummaryShort(getCurrentPeriod().goal),

            daysDisabled: periodLocked,
            lockedMessage: 'Сначала полностью заполни предыдущий период',

            onDaysInput: (value) => {
                activateMealGoalBlock('interval');
                getCurrentPeriod().days = value;

                if (!value) {
                    clearSingleGoal(getCurrentPeriod().goal);
                }

                updateMealGoalPageState();
            },

            onKcalInput: (value) => {
                activateMealGoalBlock('interval');
                getCurrentPeriod().goal.calories = value;
                updateMealGoalPageState();
            },

            canOpenMacros: !periodLocked
                && !!getCurrentPeriod().days
                && Number(getCurrentPeriod().goal.calories || 0) > 0,

            onOpenMacros: () => {
                if (periodLocked) {
                    showToast('Сначала полностью заполни предыдущий период');
                    return;
                }

                activateMealGoalBlock('interval');

                const currentPeriod = getCurrentPeriod();
                const days = currentPeriod?.days;
                const calories = Number(currentPeriod?.goal?.calories || 0);

                if (!days) {
                    showToast('Сначала введи дни');
                    return;
                }

                if (!calories) {
                    showToast('Сначала введи калории');
                    return;
                }

                goalState.sheetTarget = getIntervalTargetKey(index);
                openMealGoalSheet(getIntervalTargetKey(index));
            },

            onClearMacros: () => {
                const period = getCurrentPeriod();
                if (!period) return;

                period.days = '';
                clearSingleGoal(period.goal);
                clearPendingKcalUpdate(getIntervalTargetKey(index));

                if (goalState.sheetTarget === getIntervalTargetKey(index)) {
                    goalState.sheetTarget = null;
                }

                renderMealGoalPage();
            },

            deletable: index >= 2,
            onDelete: () => {
                removeIntervalPeriodDraft(index);
                renderMealGoalPage();
            }
        });

        grid.append(card);
    });

    block.append(title, grid);

    if (periods.length < 6) {
        const isLastComplete = isLastIntervalPeriodComplete(periods);

        const addBtn = createElement(
                'button',
                `btn btn-primary meal-goal-add-period-btn ${isLastComplete ? '' : 'disabled'}`
            );

        addBtn.innerHTML = `
                        добавить период
                    `;
        addBtn.type = 'button';
            addBtn.disabled = !isLastComplete;

            addBtn.onclick = () => {
                if (!isLastIntervalPeriodComplete(goalState.interval?.periods || [])) {
                    showToast('Сначала полностью заполни последний период');
                    return;
                }

                activateMealGoalBlock('interval');

            addIntervalPeriodDraft();
            renderMealGoalPage();
        };

        block.append(addBtn);
    }

    return block;
}


function buildGoalSummaryShort(goal) {
    const hasAny = Number(goal.calories || 0) || Number(goal.protein || 0) || Number(goal.fat || 0) || Number(goal.carbs || 0);
    if (!hasAny) return 'Б/Ж/У';

    return `Б ${goal.protein || 0} · Ж ${goal.fat || 0} · У ${goal.carbs || 0}`;
}

function createMealGoalMacrosPickerRow({ label, active, onOpen }) {
    const row = createElement(
        'div',
        `meal-goal-macros-row ${active ? 'active' : 'disabled'}`
    );

    const valueBtn = createElement('button', 'meal-goal-macros-value-btn', label);
    valueBtn.type = 'button';
    valueBtn.disabled = !active;
    valueBtn.onclick = onOpen;

    row.append(valueBtn);
    return row;
}

function createMealGoalClearButton({ active, onClear }) {
    const clearBtn = createElement(
        'button',
        `meal-goal-macros-clear-btn ${active ? '' : 'disabled'}`
        );
        clearBtn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 56 56"><title>Arrow-2-circlepath SVG Icon</title><path fill="currentColor" d="M53.949 26.303h-3.087c-1.24-11.47-11.11-20.597-22.873-20.597c-6.851 0-13.07 3.11-17.307 8c-.857.97-.722 2.163.157 2.794c.902.631 1.96.429 2.705-.405a19.12 19.12 0 0 1 14.445-6.558a19.074 19.074 0 0 1 18.997 16.766h-3.358c-1.6 0-2.028 1.082-1.15 2.321l5.026 7.189c.721 1.037 1.803 1.06 2.547 0l5.047-7.166c.902-1.262.474-2.344-1.149-2.344m-51.898 4.8h3.087c1.24 11.47 11.11 20.575 22.85 20.575c6.896 0 13.116-3.133 17.353-8c.811-.97.698-2.186-.158-2.817c-.901-.631-1.96-.406-2.704.428c-3.47 4.034-8.654 6.558-14.49 6.558A19.05 19.05 0 0 1 9.014 31.103h3.358c1.6 0 2.028-1.104 1.15-2.32l-5.049-7.19c-.72-1.036-1.78-1.059-2.524 0L.901 28.76C0 30 .428 31.104 2.051 31.104"/></svg>
            `;


    clearBtn.type = 'button';
    clearBtn.disabled = !active;
    clearBtn.onclick = onClear;

    return clearBtn;
}

function createMealGoalSectionContent(...children) {
    const content = createElement('div', 'meal-goal-section-content');
    content.append(...children);
    return content;
}

function createPendingKcalHintBlock(targetKey) {
    const pendingValue = getPendingKcalUpdate(targetKey);

    const wrap = createElement('div', 'meal-goal-updated-kcal-hint');
    if (!pendingValue) {
        wrap.style.display = 'none';
        return wrap;
    }

    wrap.style.display = 'flex';

    const editableGoal = getEditableGoalByTarget(targetKey);
    const currentCalories = Number(editableGoal?.calories || 0);
    const nextCalories = Number(pendingValue || 0);

    const text = createElement('div', 'meal-goal-updated-kcal-text');
    const label = createElement('div', 'meal-goal-updated-kcal-label', 'Калорийность превышена ');
    const value = createElement('div', 'meal-goal-updated-kcal-value', `на ${nextCalories} ккал`);

    const editBtn = createElement('button', 'meal-goal-updated-kcal-btn', 'Изменить');
    editBtn.type = 'button';
    editBtn.onclick = () => {
        applyPendingKcalUpdate(targetKey);
    };

    text.append(label, editBtn);
    wrap.append(text, value);

    return wrap;
}


function renderIntervalSideCard({
    title,
    targetKey,
    daysValue,
    kcalValue,
    getSummary,
    onDaysInput,
    onKcalInput,
    canOpenMacros,
    onOpenMacros,
    onClearMacros,
    onDelete = null,
    deletable = false,
    daysDisabled = false,
    lockedMessage = 'Сначала полностью заполни предыдущий период'
}) {
    const card = createElement('div', 'meal-goal-interval-card');

    const hasAnyValue =
        Number(daysValue || 0) > 0 ||
        Number(kcalValue || 0) > 0 ||
        getSummary() !== 'Б/Ж/У';

    const titleEl = createElement('div', 'meal-goal-interval-title', title);

    let deleteBtn = null;
    if (deletable && typeof onDelete === 'function') {
        deleteBtn = createElement('button', 'meal-goal-interval-delete-btn');
        deleteBtn.type = 'button';
        deleteBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24">
                <path fill="currentColor" d="M16 1.75V3h5.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H8V1.75C8 .784 8.784 0 9.75 0h4.5C15.216 0 16 .784 16 1.75m-6.5 0V3h5V1.75a.25.25 0 0 0-.25-.25h-4.5a.25.25 0 0 0-.25.25M4.997 6.178a.75.75 0 1 0-1.493.144L4.916 20.92a1.75 1.75 0 0 0 1.742 1.58h10.684a1.75 1.75 0 0 0 1.742-1.581l1.413-14.597a.75.75 0 0 0-1.494-.144l-1.412 14.596a.25.25 0 0 1-.249.226H6.658a.25.25 0 0 1-.249-.226z"></path>
                <path fill="currentColor" d="M9.206 7.501a.75.75 0 0 1 .793.705l.5 8.5A.75.75 0 1 1 9 16.794l-.5-8.5a.75.75 0 0 1 .705-.793Zm6.293.793A.75.75 0 1 0 14 8.206l-.5 8.5a.75.75 0 0 0 1.498.088l.5-8.5Z"></path>
            </svg>
        `;
        deleteBtn.type = 'button';
            deleteBtn.onclick = (e) => {
                e.stopPropagation();
                openConfirmModal('Удалить период?', () => {
                    onDelete();
                });
            };
    }

    if (deleteBtn) {
        titleEl.append(deleteBtn);
    }

    const clearBtn = createMealGoalClearButton({
        active: hasAnyValue && !daysDisabled,
        onClear: () => {
            onClearMacros();
            clearPendingKcalUpdate(targetKey);

            daysInput.value = '';
            kcalInput.value = '';
            kcalInput.disabled = true;

            updateMacrosPickerState(
                macrosRow,
                false,
                getSummary()
            );

            updateMealGoalClearButtonState(clearBtn, false);

            if (kcalHint) {
                kcalHint.style.display = 'none';
            }
        }
    });

    const daysClear = createElement('div', 'block-days-clear');
    const daysInput = createElement(
        'input',
        `meal-goal-kcal-input ${daysDisabled ? 'disabled' : ''}`
    );
    daysInput.type = 'text';
    daysInput.inputMode = 'numeric';
    daysInput.placeholder = 'дни';
    daysInput.value = daysValue || '';
    daysInput.disabled = !!daysDisabled;

    if (daysDisabled) {
        daysInput.onclick = () => showToast(lockedMessage);
    }

    const kcalInput = createElement(
        'input',
        `meal-goal-kcal-input ${daysDisabled ? 'disabled' : ''}`
    );
    kcalInput.type = 'text';
    kcalInput.inputMode = 'numeric';
    kcalInput.placeholder = 'ккал';
    kcalInput.value = kcalValue || '';
    kcalInput.disabled = !!daysDisabled || !Number(daysValue || 0);

    if (daysDisabled) {
        kcalInput.onclick = () => showToast(lockedMessage);
    }

    const kcalHint = createPendingKcalHintBlock(targetKey);

    const kcalWrap = createElement('div', 'meal-goal-kcal-wrap');
    kcalWrap.append(kcalInput);

    const macrosRow = createMealGoalMacrosPickerRow({
        label: getSummary(),
        active: canOpenMacros,
        onOpen: onOpenMacros
    });

    daysInput.oninput = (e) => {
        if (daysDisabled) {
            showToast(lockedMessage);
            return;
        }

        activateMealGoalBlock('interval');

        const clean = e.target.value.replace(/[^\d]/g, '');
        if (e.target.value !== clean) {
            e.target.value = clean;
        }

        onDaysInput(clean);
        clearPendingKcalUpdate(targetKey);

        const hasDays = Number(clean) > 0;
        kcalInput.disabled = !hasDays;

        if (!hasDays) {
            kcalInput.value = '';
            onKcalInput('');
            updateMacrosPickerState(macrosRow, false, getSummary());
            updateMealGoalClearButtonState(clearBtn, false);

            if (kcalHint) {
                kcalHint.style.display = 'none';
            }

            return;
        }

        const hasFullGoal = hasDays && Number(kcalInput.value || 0) > 0;

        updateMacrosPickerState(macrosRow, hasFullGoal, getSummary());
        updateMealGoalClearButtonState(clearBtn, hasDays && !daysDisabled);
        updateMealGoalSaveButtonState();
    };

    kcalInput.oninput = (e) => {
        if (daysDisabled) {
            showToast(lockedMessage);
            return;
        }

        activateMealGoalBlock('interval');

        const clean = e.target.value.replace(/[^\d]/g, '');
        if (e.target.value !== clean) {
            e.target.value = clean;
        }

        onKcalInput(clean);
        clearPendingKcalUpdate(targetKey);

        const hasDays = Number(daysInput.value || 0) > 0;
        const hasFullGoal = hasDays && Number(clean) > 0;

        updateMacrosPickerState(macrosRow, hasFullGoal, getSummary());
        updateMealGoalClearButtonState(clearBtn, hasDays && !daysDisabled);
        updateMealGoalSaveButtonState();
    };

    daysClear.append(daysInput, clearBtn);
    card.append(titleEl, daysClear, kcalWrap, macrosRow, kcalHint);

    return card;
}
// ============   Страница
function renderMealGoalPage() {
    ensureMealShell();
    setMealBaseTopBarVisible(false);

    const overlayPage = createElement('div', 'meal-goal-overlay-wrap');
    attachMealOverlayBottomNavSync(overlayPage, updateMealGoalSaveButtonState);
    openMealOverlay(overlayPage);
    renderMealGoalTopBar();

    const goal = getMealGoalState();

    const page = createElement('div', 'meal-goal-page');

    const presets = renderSavedMealGoalPresets();





    const dailyBlock = renderDailyGoalBlock(goal);
    const weekdayBlock = renderWeekdayGoalBlock(goal);
    const intervalBlock = renderIntervalGoalBlock(goal);

    const goalSectionsWrap = createElement('div', 'meal-goal-sections-wrap');
    goalSectionsWrap.append(dailyBlock, weekdayBlock, intervalBlock);

    page.append(presets, goalSectionsWrap);
    overlayPage.append(page);
}
// ==============  обновляет только состояние UI страницы цели

function updateMealGoalPageState() {
    const goalState = getMealGoalState();
    const page = document.querySelector('.meal-goal-page');
    if (!page) return;

    let activeGoal = null;

    if (goalState.sheetTarget === 'daily') {
        activeGoal = goalState.daily;
    } else if (goalState.sheetTarget === 'weekday') {
        activeGoal = goalState.weekday;
    } else {
        const intervalIndex = parseIntervalTargetKey(goalState.sheetTarget);
        if (intervalIndex !== null) {
            activeGoal = goalState.interval?.periods?.[intervalIndex]?.goal || null;
        }
    }

    const hasCalories = Number(activeGoal?.calories || 0) > 0;
    const calculatedCalories = activeGoal ? calcMealGoalKcalFromMacros(activeGoal) : 0;
    const targetCalories = Number(activeGoal?.calories || 0);
    const mismatch = hasCalories && calculatedCalories !== targetCalories;

    const macroRows = page.querySelectorAll('.meal-goal-row-macro');
    macroRows.forEach(row => {
        row.classList.toggle('disabled', !hasCalories);
    });

    const kcalRow = page.querySelector('.meal-goal-row-kcal');
    if (kcalRow) {
        kcalRow.classList.toggle('mismatch', mismatch);

        const hintWrap = kcalRow.querySelector('.meal-goal-updated-kcal-hint');

        if (hintWrap && activeGoal) {
            const pendingValue = getPendingKcalUpdate(goalState.sheetTarget);
            const shouldShowHint =
                mismatch &&
                pendingValue > 0 &&
                pendingValue !== targetCalories;

            if (shouldShowHint) {
                hintWrap.style.display = 'flex';
                hintWrap.innerHTML = `
                    <div class="meal-goal-updated-kcal-text">
                        <div class="meal-goal-updated-kcal-label">Обновлённая калорийность</div>
                        <div class="meal-goal-updated-kcal-value">${formatNumberWithSpaces(pendingValue)}</div>
                    </div>
                    <button type="button" class="meal-goal-updated-kcal-btn">Изменить</button>
                `;

                const editBtn = hintWrap.querySelector('.meal-goal-updated-kcal-btn');
                if (editBtn) {
                    editBtn.onclick = () => {
                        applyPendingKcalUpdate(goalState.sheetTarget);
                    };
                }
            } else {
                hintWrap.style.display = 'none';
                hintWrap.innerHTML = '';
            }
        }
    }

    updateMealGoalSaveButtonState();
}
// ============== Строка поля калорий
function createGoalInputRow({ label, value, placeholder, suffix, onInput }) {
    const row = createElement('div', 'meal-goal-row');
    const left = createElement('div', 'meal-goal-row-label', label);

    const right = createElement('div', 'meal-goal-row-control meal-goal-row-control-kcal');
    const inputWrap = createElement('div', 'meal-goal-input-wrap');

    const input = createElement('input', 'meal-goal-input');
    input.type = 'text';
    input.inputMode = 'numeric';
    input.placeholder = placeholder || '';
    input.value = value || '';

    input.addEventListener('input', (e) => {
        onInput?.(e.target.value, input);
    });

    const suffixEl = createElement('div', 'meal-goal-input-suffix', suffix || '');
    inputWrap.append(input, suffixEl);

    const hintWrap = createElement('div', 'meal-goal-updated-kcal-hint');
    hintWrap.style.display = 'none';

    right.append(inputWrap);
    row.append(left, right, hintWrap);

    return row;
}



// ===================
function createGoalMacroSummaryRow({ macroKey, grams, percent, disabled }) {
    const row = createElement(
        'button',
        `meal-goal-row meal-goal-row-macro ${disabled ? 'disabled' : ''}`
    );
    row.type = 'button';

    const left = createElement('div', 'meal-goal-row-label', getMacroLabel(macroKey));
    const right = createElement('div', 'meal-goal-macro-values');

    const percentEl = createElement('div', 'meal-goal-macro-main', `${formatMacro(percent)}%`);
    const gramsEl = createElement('div', 'meal-goal-macro-sub', `${formatMacro(grams)} г`);

    right.append(percentEl, gramsEl);
    row.append(left, right);

    row.onclick = () => {
        const goal = getMealGoalState();
        if (!Number(goal.calories || 0)) return;
        openMealGoalSheet();
    };

    return row;
}

function getEditableMealGoalTarget() {
    const goal = getMealGoalState();

    if (goal.mode === 'interval-first') {
        return goal.intervalFirstGoal;
    }

    if (goal.mode === 'interval-second') {
        return goal.intervalSecondGoal;
    }

    return goal;
}

// =================== Bottom sheet для выбора Б/Ж/У
function openMealGoalSheet(targetKey) {
    const ITEM_HEIGHT = 52;
    const VISIBLE_ROWS = 5;
    const SIDE_PADDING_ROWS = 2;

    const goalState = getMealGoalState();

    if (targetKey) {
        goalState.sheetTarget = targetKey;
    }

    const targetGoal = getEditableGoalByTarget(goalState.sheetTarget);
    const calories = Number(targetGoal?.calories || 0);

    if (!targetGoal) {
        showToast('Сначала выбери блок цели');
        return;
    }

    if (!calories) {
        showToast('Сначала введи калории');
        return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'copy-meal-sheet-overlay';

    const sheet = document.createElement('div');
    sheet.className = 'copy-meal-sheet meal-goal-sheet meal-goal-multi-sheet';

    const header = document.createElement('div');
    header.className = 'meal-goal-sheet-header meal-goal-sheet-header-simple';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'meal-goal-sheet-icon-btn';
    closeBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24">
            <path fill="currentColor" d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59L7.11 5.7A1 1 0 0 0 5.7 7.1l4.89 4.9l-4.9 4.89a1 1 0 1 0 1.42 1.41l4.89-4.89l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4"/>
        </svg>
    `;

    const headerTitle = createElement('div', 'meal-goal-sheet-center-title', 'Граммы');

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'meal-goal-sheet-icon-btn';
    confirmBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24">
            <path fill="currentColor" d="M9.55 18.55 3.8 12.8l1.4-1.4 4.35 4.35 9.25-9.25 1.4 1.4z"/>
        </svg>
    `;

    header.append(closeBtn, headerTitle, confirmBtn);

    const draft = {
        carbs: Math.round(Number(targetGoal?.carbs || 0)),
        protein: Math.round(Number(targetGoal?.protein || 0)),
        fat: Math.round(Number(targetGoal?.fat || 0))
    };

    const body = createElement('div', 'meal-goal-sheet-body');
    const wheelsWrap = createElement('div', 'meal-goal-wheels-wrap');
    const frame = createElement('div', 'meal-goal-shared-frame');
    const fadeTop = createElement('div', 'meal-goal-wheel-fade top');
    const fadeBottom = createElement('div', 'meal-goal-wheel-fade bottom');

    const carbsCol = createMacroWheelColumn('carbs', draft.carbs);
    const proteinCol = createMacroWheelColumn('protein', draft.protein);
    const fatCol = createMacroWheelColumn('fat', draft.fat);

    wheelsWrap.append(fadeTop, fadeBottom, frame, proteinCol.wrap, fatCol.wrap, carbsCol.wrap);

    const footer = createElement('div', 'meal-goal-sheet-footer');
    const footerTitle = createElement('div', 'meal-goal-footer-title', 'Обновлённая калорийность');
    const footerSub = createElement(
        'div',
        'meal-goal-footer-sub',
        `Исходная цель: ${formatNumberWithSpaces(targetGoal?.calories || 0)}`
    );
    const footerValue = createElement('div', 'meal-goal-footer-value');

    footer.append(footerTitle, footerSub, footerValue);
    body.append(wheelsWrap, footer);
    sheet.append(header, body);
    overlay.append(sheet);
    document.body.appendChild(overlay);

    function createSpacer() {
        const spacer = document.createElement('div');
        spacer.className = 'copy-meal-sheet-spacer';
        spacer.style.height = `${ITEM_HEIGHT * SIDE_PADDING_ROWS}px`;
        return spacer;
    }

    function gramsToKcal() {
        return (draft.carbs * 4) + (draft.protein * 4) + (draft.fat * 9);
    }

    function getItemsForMacro(macroKey) {
        const max = macroKey === 'fat' ? 250 : 999;
        return Array.from({ length: max + 1 }, (_, i) => i);
    }

    function getCurrentValue(macroKey) {
        return Math.round(draft[macroKey] || 0);
    }

    function scrollWheelToIndex(wheel, index, smooth = true) {
        wheel.scrollTo({
            top: index * ITEM_HEIGHT,
            behavior: smooth ? 'smooth' : 'auto'
        });
    }

    function updateFooter() {
        const totalKcal = Math.round(gramsToKcal());
        const target = Number(targetGoal?.calories || 0);

        footerValue.textContent = formatNumberWithSpaces(totalKcal);
        footerValue.classList.remove('over', 'under', 'exact');

        const diff = totalKcal - target;

        if (diff === 0) {
            footerSub.textContent = `Точно по цели: ${formatNumberWithSpaces(target)} ккал`;
            footerValue.classList.add('exact');
        } else if (diff > 0) {
            footerSub.textContent = `Выше цели на ${formatNumberWithSpaces(diff)} ккал`;
            footerValue.classList.add('over');
        } else {
            footerSub.textContent = `Ниже цели на ${formatNumberWithSpaces(Math.abs(diff))} ккал`;
            footerValue.classList.add('under');
        }
    }

    function updateWheelVisual(wheel) {
        const items = wheel.querySelectorAll('.meal-goal-wheel-item');
        const centerIndex = Math.round(wheel.scrollTop / ITEM_HEIGHT);

        for (let i = 0; i < items.length; i++) {
            const distance = Math.abs(i - centerIndex);
            let opacity = 0.12;

            if (distance === 0) opacity = 1;
            else if (distance === 1) opacity = 0.62;
            else if (distance === 2) opacity = 0.36;
            else if (distance === 3) opacity = 0.16;

            if (items[i]._lastOpacity !== opacity) {
                items[i].style.opacity = String(opacity);
                items[i]._lastOpacity = opacity;
            }
        }
    }

    function bindWheel(column, macroKey) {
        let scrollTimer = null;

        column.wheel.addEventListener('scroll', () => {
            requestAnimationFrame(() => {
                updateWheelVisual(column.wheel);
            });

            clearTimeout(scrollTimer);

            scrollTimer = setTimeout(() => {
                const items = getItemsForMacro(macroKey);
                let index = Math.round(column.wheel.scrollTop / ITEM_HEIGHT);
                index = Math.max(0, Math.min(index, items.length - 1));

                scrollWheelToIndex(column.wheel, index);
                draft[macroKey] = Number(items[index] || 0);
                column.sub.value = String(draft[macroKey]);
                updateFooter();
            }, 40);
        });
    }

    function renderWheel(column, macroKey) {
        const items = getItemsForMacro(macroKey);
        const currentValue = getCurrentValue(macroKey);

        column.wheel.innerHTML = '';
        column.wheel.append(createSpacer());

        items.forEach((value, index) => {
            const item = document.createElement('div');
            item.className = 'meal-goal-wheel-item';
            item.style.height = `${ITEM_HEIGHT}px`;
            item.dataset.index = String(index);
            item.textContent = `${value}`;

            item.addEventListener('click', () => {
                scrollWheelToIndex(column.wheel, index);
                draft[macroKey] = Number(value || 0);
                column.sub.value = String(draft[macroKey]);
                updateFooter();
            });

            column.wheel.append(item);
        });

        column.wheel.append(createSpacer());

        const selectedIndex = Math.max(0, items.indexOf(currentValue));

        requestAnimationFrame(() => {
            scrollWheelToIndex(column.wheel, selectedIndex, false);
            updateWheelVisual(column.wheel);
        });
    }


    function getWheelItemsForMacro(macroKey) {
        if (macroKey === 'protein') {
            return Array.from({ length: 401 }, (_, i) => i);
        }

        if (macroKey === 'fat') {
            return Array.from({ length: 251 }, (_, i) => i);
        }

        if (macroKey === 'carbs') {
            return Array.from({ length: 501 }, (_, i) => i);
        }

        return Array.from({ length: 401 }, (_, i) => i);
    }

    function createMacroWheelColumn(macroKey, initialValue) {
        const wrap = createElement('div', `meal-goal-wheel-col meal-goal-wheel-col-${macroKey}`);
        const title = createElement('div', 'meal-goal-wheel-title', getMacroLabel(macroKey));

        const subInput = createElement('input', 'meal-goal-wheel-sub meal-goal-wheel-sub-input');
        subInput.type = 'text';
        subInput.inputMode = 'numeric';
        subInput.value = String(Math.round(initialValue || 0));

        const wheel = createElement('div', 'meal-goal-wheel');
        wheel.style.height = `${ITEM_HEIGHT * VISIBLE_ROWS}px`;

        wrap.append(title, subInput, wheel);

        return {
            wrap,
            title,
            sub: subInput,
            wheel,
            macroKey
        };
    }

    function renderAllWheels() {
        renderWheel(carbsCol, 'carbs');
        renderWheel(proteinCol, 'protein');
        renderWheel(fatCol, 'fat');
    }

    function closeSheet() {
        overlay.classList.remove('open');
        sheet.classList.remove('open');
        setTimeout(() => overlay.remove(), 240);
    }

    bindWheel(carbsCol, 'carbs');
    bindWheel(proteinCol, 'protein');
    bindWheel(fatCol, 'fat');

    function bindWheelInput(column, macroKey) {
        column.sub.addEventListener('input', (e) => {
            const clean = String(e.target.value || '').replace(/[^\d]/g, '');
            if (e.target.value !== clean) {
                e.target.value = clean;
            }

            if (clean === '') return;

            const nextValue = Number(clean);
            draft[macroKey] = nextValue;

            const items = getWheelItemsForMacro(macroKey);
            const targetIndex = items.indexOf(nextValue);

            if (targetIndex !== -1) {
                scrollWheelToIndex(column.wheel, targetIndex);
                updateWheelVisual(column.wheel);
            }

            updateFooter();
        });

        column.sub.addEventListener('blur', () => {
            const currentValue = Number(draft[macroKey] || 0);
            column.sub.value = String(currentValue);
        });
    }

    bindWheelInput(carbsCol, 'carbs');
    bindWheelInput(proteinCol, 'protein');
    bindWheelInput(fatCol, 'fat');

    closeBtn.onclick = closeSheet;

    confirmBtn.onclick = () => {
        targetGoal.carbs = Math.round(draft.carbs);
        targetGoal.protein = Math.round(draft.protein);
        targetGoal.fat = Math.round(draft.fat);

        const updatedCalories = calcMealGoalKcalFromMacros(targetGoal);
        const targetCalories = Number(targetGoal.calories || 0);

        if (updatedCalories > targetCalories && targetCalories > 0) {
            setPendingKcalUpdate(targetKey, updatedCalories);
        } else {
            clearPendingKcalUpdate(targetKey);
        }

        closeSheet();
        renderMealGoalPage();
    };

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeSheet();
    });

    renderAllWheels();
    carbsCol.sub.value = String(Math.round(draft.carbs || 0));
    proteinCol.sub.value = String(Math.round(draft.protein || 0));
    fatCol.sub.value = String(Math.round(draft.fat || 0));
    updateFooter();

    requestAnimationFrame(() => {
        overlay.classList.add('open');
        sheet.classList.add('open');
    });
}

// ================================ КОНЕЦ СТРАНИЦА ЦЕЛЬ

async function addFoodToMealFromDetails(food, grams) {
    const cycleRef = getCycleDocRef();
    const mealRef = doc(cycleRef, 'meals', state.selectedDate);

    await setDoc(mealRef, {
        [state.currentMealId]: arrayUnion({
            id: crypto.randomUUID(),
            foodId: state.currentFoodId,
            grams: Number(grams || food.defaultAmount || food.baseAmount || 100),

            name: food.name || '',
            description: food.description || '',
            baseAmount: Number(food.baseAmount || 100),
            baseUnit: food.baseUnit || 'г',

            protein: Number(food.protein || 0),
            fat: Number(food.fat || 0),
            carbs: Number(food.carbs || 0),
            calories: Number(food.calories || 0)
        })
    }, { merge: true });
}

async function renderEditFood() {
        ensureMealShell();
        setMealBaseTopBarVisible(false);

    const foodsMap = await getFoodsMap();
    const food = foodsMap[state.currentFoodId];

    if (!food) {
        showToast('Продукт не найден');

        const backTarget = state.editFoodBackTarget || 'foodDetails';

        if (backTarget === 'recipeFoodPreview') {
            // Экран редактирования ещё не пушился в стек — возвращаемся через mealView.
            state.mealView = 'recipeFoodSearch';
            state.editFoodBackTarget = null;
            renderMealPage();
            return;
        }

        if (hasUnderlyingMealSearch()) {
            popMealOverlay();
            return;
        }

        state.mealView = 'search';
        state.editFoodBackTarget = null;
        renderMealPage();
        return;
    }

    const container = createElement('div', 'create-food create-food-form-page');

    const topBar = createElement('div', 'create-food-topbar');

    const backBtn = createElement('button', 'back-btn');
    backBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24">
            <path fill="currentColor" d="M12.727 3.687a1 1 0 1 0-1.454-1.374l-8.5 9a1 1 0 0 0 0 1.374l8.5 9.001a1 1 0 1 0 1.454-1.373L4.875 12z"/>
        </svg>
    `;
    backBtn.onclick = () => {
        const backTarget = state.editFoodBackTarget || 'foodDetails';

        if (backTarget === 'recipeFoodPreview') {
            if (hasUnderlyingMealSearch()) {
                popMealOverlay();
                return;
            }
            state.mealView = 'recipeFoodPreview';
            renderMealPage();
            return;
        }

        if (hasUnderlyingMealSearch()) {
            popMealOverlay();
            return;
        }

        state.mealView = 'foodDetails';
        renderMealPage();
    };

    const pageTitle = createElement('h3', 'create-food-sticky-h3', 'Редактировать продукт');

    const stickyHeader = createElement('div', 'create-food-sticky-header');
    stickyHeader.append(topBar, pageTitle);

    const formCard = createElement('div', 'create-food-form-card');

    function createFormRow(labelText, controlEl, required = true, extraClass = '') {
        const row = createElement('div', `create-food-row ${extraClass}`.trim());

        const labelWrap = createElement('div', 'create-food-row-label-wrap');
        const label = createElement('div', 'create-food-row-label', labelText);
        const hint = createElement(
            'div',
            'create-food-row-hint',
            required ? 'обязательно' : 'необязательно'
        );

        labelWrap.append(label, hint);

        const controlWrap = createElement('div', 'create-food-row-control');
        controlWrap.append(controlEl);

        row.append(labelWrap, controlWrap);
        return row;
    }

    const name = createElement('input', 'create-food-input');
    name.placeholder = 'Введите название';
    name.value = food.name || '';

    const description = document.createElement('textarea');
    description.className = 'create-food-input create-food-textarea';
    description.placeholder = 'Краткое описание';
    description.rows = 3;
    description.value = food.description || '';

    let selectedUnit = resolveFoodNutritionBasis(food);
    let selectedPortionMeasureUnit = normalizeFoodPortionUnit(food.portionSizeUnit || food.baseUnit || 'г');
    let customPortionValue = selectedUnit === 'порция'
        ? String(Number(food.baseAmount || 0) || '')
        : '';
    let isPortionModeActive = selectedUnit === 'порция';

    const unitWrap = createElement('div', 'create-food-picker-wrap');
    unitWrap.style.position = 'relative';

    const unitField = createElement('div', 'create-food-input create-food-picker-field');
    unitField.tabIndex = 0;

    const unitValue = createElement('span', 'create-food-picker-value', selectedUnit);

    const unitArrow = createElement('span', 'create-food-picker-arrow');
    unitArrow.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
    `;

    unitField.append(unitValue, unitArrow);

    const unitDropdown = createElement('div', 'create-food-unit-dropdown');
    unitDropdown.style.display = 'none';

    FOOD_NUTRITION_BASIS_OPTIONS.forEach(unit => {
        const option = createElement('button', 'create-food-unit-dropdown-item', unit);
        option.type = 'button';

        option.onclick = (e) => {
            e.stopPropagation();
            selectedUnit = unit;
            unitValue.textContent = unit;
            unitDropdown.style.display = 'none';
            unitWrap.classList.remove('open');
            syncPortionInputState();
            validateForm();
        };

        unitDropdown.append(option);
    });

    unitField.onclick = (e) => {
        e.stopPropagation();
        const isOpen = unitDropdown.style.display === 'block';
        unitDropdown.style.display = isOpen ? 'none' : 'block';
        unitWrap.classList.toggle('open', !isOpen);
    };

    const portionUnitWrap = createElement('div', 'create-food-picker-wrap create-food-portion-unit-wrap');
    portionUnitWrap.style.position = 'relative';

    const portionUnitField = createElement('div', 'create-food-input create-food-picker-field');
    portionUnitField.tabIndex = 0;

    const portionUnitValue = createElement('span', 'create-food-picker-value', selectedPortionMeasureUnit);

    const portionUnitArrow = createElement('span', 'create-food-picker-arrow');
    portionUnitArrow.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
    `;

    portionUnitField.append(portionUnitValue, portionUnitArrow);

    const portionUnitDropdown = createElement('div', 'create-food-unit-dropdown');
    portionUnitDropdown.style.display = 'none';

    FOOD_PORTION_MEASURE_OPTIONS.forEach(unit => {
        const option = createElement('button', 'create-food-unit-dropdown-item', unit);
        option.type = 'button';

        option.onclick = (e) => {
            e.stopPropagation();
            selectedPortionMeasureUnit = unit;
            portionUnitValue.textContent = unit;
            portionUnitDropdown.style.display = 'none';
            portionUnitWrap.classList.remove('open');
            validateForm();
        };

        portionUnitDropdown.append(option);
    });

    portionUnitField.onclick = (e) => {
        e.stopPropagation();
        if (selectedUnit !== 'порция') return;
        const isOpen = portionUnitDropdown.style.display === 'block';
        portionUnitDropdown.style.display = isOpen ? 'none' : 'block';
        portionUnitWrap.classList.toggle('open', !isOpen);
    };

    portionUnitWrap.append(portionUnitField, portionUnitDropdown);

    document.addEventListener('click', () => {
        unitDropdown.style.display = 'none';
        unitWrap.classList.remove('open');
        portionUnitDropdown.style.display = 'none';
        portionUnitWrap.classList.remove('open');
    });

    unitWrap.append(unitField, unitDropdown);

    const portion = createElement('input', 'create-food-input');
    portion.type = 'number';
    portion.inputMode = 'decimal';
    portion.placeholder = '';

    const portionControl = createElement('div', 'create-food-portion-control');
    portionControl.append(portion, portionUnitWrap);

    function syncPortionInputState() {
        const isPortionMode = selectedUnit === 'порция';

        if (!isPortionMode && isPortionModeActive && String(portion.value || '').trim() !== '') {
            customPortionValue = String(portion.value).trim();
        }

        if (isPortionMode) {
            portion.value = customPortionValue || '';
            portion.placeholder = '';
        } else {
            portion.value = String(FOOD_LOCKED_PORTION_AMOUNT);
            portion.placeholder = String(FOOD_LOCKED_PORTION_AMOUNT);
            portionUnitDropdown.style.display = 'none';
            portionUnitWrap.classList.remove('open');
        }

        portion.readOnly = !isPortionMode;
        portion.classList.toggle('is-locked', !isPortionMode);
        portionUnitWrap.style.display = isPortionMode ? '' : 'none';
        isPortionModeActive = isPortionMode;
    }


    const protein = createElement('input', 'create-food-input');
    protein.type = 'number';
    protein.inputMode = 'decimal';
    protein.placeholder = '0';
    protein.value = Number(food.protein || 0);

    const fat = createElement('input', 'create-food-input');
    fat.type = 'number';
    fat.inputMode = 'decimal';
    fat.placeholder = '0';
    fat.value = Number(food.fat || 0);

    const carbs = createElement('input', 'create-food-input');
    carbs.type = 'number';
    carbs.inputMode = 'decimal';
    carbs.placeholder = '0';
    carbs.value = Number(food.carbs || 0);

    const calories = createElement('input', 'create-food-input');
    calories.type = 'number';
    calories.inputMode = 'decimal';
    calories.placeholder = '0';
    calories.value = Number(food.calories || 0);

    syncPortionInputState();

    const rows = [
        createFormRow('Название', name, true),
        createFormRow('Описание', description, true, 'is-textarea'),
        createFormRow('Ед. изм.', unitWrap, true),
        createFormRow('Размер порции', portionControl, true),
        createFormRow('Белки', protein, true),
        createFormRow('Жиры', fat, true),
        createFormRow('Углеводы', carbs, true),
        createFormRow('Калории', calories, true)
    ];

    rows.forEach(row => formCard.append(row));

    const saveBtn = createElement('button', 'save-btn create-food-submit-btn', 'Сохранить');
    saveBtn.disabled = true;

    function syncCreateFoodBottomNav() {
        setMealBottomNavOverlayMode({
            visible: true,
            onBack: () => backBtn.onclick?.(),
            actionText: 'Сохранить продукт',
            onAction: () => saveBtn.onclick?.(),
            actionDisabled: saveBtn.disabled
        });
    }

    function isFilled(value) {
        return String(value ?? '').trim() !== '';
    }

    function validateForm() {
        const isPortionMode = selectedUnit === 'порция';
        const allFilled =
            isFilled(name.value) &&
            isFilled(description.value) &&
            isFilled(selectedUnit) &&
            isFilled(portion.value) &&
            (!isPortionMode || isFilled(selectedPortionMeasureUnit)) &&
            isFilled(protein.value) &&
            isFilled(fat.value) &&
            isFilled(carbs.value) &&
            isFilled(calories.value);

        saveBtn.disabled = !allFilled;
        saveBtn.classList.toggle('active', allFilled);
        syncCreateFoodBottomNav();
    }

    [
        name,
        description,
        portion,
        portionUnitField,
        protein,
        fat,
        carbs,
        calories
    ].forEach(el => {
        el.addEventListener('input', validateForm);
        el.addEventListener('change', validateForm);
    });

    saveBtn.onclick = async () => {
        if (saveBtn.disabled) return;

        const foodRef = await getFoodDocumentRef(state.currentFoodId);
        if (!foodRef) return;

        const nutritionPayload = buildFoodNutritionPayload(
            selectedUnit,
            portion.value,
            selectedPortionMeasureUnit
        );

        const updatedFood = {
            name: name.value.trim(),
            nameLower: normalizeSearchText(name.value),
            searchTokens: buildMealSearchTokens(name.value),
            description: description.value.trim(),
            ...nutritionPayload,
            protein: Number(protein.value),
            fat: Number(fat.value),
            carbs: Number(carbs.value),
            calories: Number(calories.value)
        };

        await updateDoc(foodRef, updatedFood);
        await syncSharedFoodToGlobalCatalogIfNeeded(state.currentFoodId, updatedFood);

        if (foodsMapCache && foodsMapLibraryKey === getMealLibraryContextKey()) {
            foodsMapCache[state.currentFoodId] = {
                ...foodsMapCache[state.currentFoodId],
                ...updatedFood
            };
        }

        const backTarget = state.editFoodBackTarget || 'foodDetails';

        if (backTarget === 'recipeFoodPreview') {
            if (hasUnderlyingMealSearch()) {
                state.editFoodBackTarget = null;
                popMealOverlay();
                return;
            }
            state.mealView = 'recipeFoodPreview';
            state.editFoodBackTarget = null;
            renderMealPage();
            return;
        }

        if (hasUnderlyingMealSearch()) {
            state.editFoodBackTarget = null;
            popMealOverlay();
            return;
        }

        state.mealView = 'foodDetails';
        state.editFoodBackTarget = null;
        renderMealPage();
    };

    attachMealOverlayBottomNavSync(container, syncCreateFoodBottomNav);
    container.append(stickyHeader, formCard);
    pushMealOverlay(container);
    attachCreateFoodKeyboardAvoidance(container);

    requestAnimationFrame(() => {
        setupCreateFoodStickyTitleBorder({
            titleEl: pageTitle,
            watchEl: formCard
        });
    });

    validateForm();
}

function getScaledFoodValues(food, amount) {
    const baseAmount = Number(food.baseAmount || 100) || 100;
    const currentAmount = Number(amount || food.defaultAmount || baseAmount) || baseAmount;

    const factor = currentAmount / baseAmount;

    const calories = (Number(food.calories || 0) * factor);
    const protein = (Number(food.protein || 0) * factor);
    const fat = (Number(food.fat || 0) * factor);
    const carbs = (Number(food.carbs || 0) * factor);

    const caloriesRounded = Math.round(calories);
    const proteinRounded = Number(formatMacro(protein, 1));
    const fatRounded = Number(formatMacro(fat, 1));
    const carbsRounded = Number(formatMacro(carbs, 1));

    const totalMacroCalories =
        protein * 4 +
        fat * 9 +
        carbs * 4;

    const carbsPercent = totalMacroCalories > 0 ? Math.round((carbs * 4 / totalMacroCalories) * 100) : 0;
    const fatPercent = totalMacroCalories > 0 ? Math.round((fat * 9 / totalMacroCalories) * 100) : 0;
    const proteinPercent = totalMacroCalories > 0 ? Math.round((protein * 4 / totalMacroCalories) * 100) : 0;

    return {
        amount: currentAmount,
        calories: caloriesRounded,
        protein: proteinRounded,
        fat: fatRounded,
        carbs: carbsRounded,
        carbsPercent,
        fatPercent,
        proteinPercent
    };
}

async function renderFoodDetails() {
    ensureMealShell();
    setMealBaseTopBarVisible(false);

    const source = state.foodDetailsSource || 'foods';
    const isFoodsSource = source === 'foods';
    const isMealSource = source === 'meal';
    const isRecipeFoodsSource = source === 'recipeFoods';
    const isFatSecretSource = source === 'fatsecret';
    const isGlobalCatalogSource = source === 'globalCatalog';
    const shouldShowSearchMealLabel = isFoodsSource || isFatSecretSource || isGlobalCatalogSource;

    let food = null;
    let currentAmount = 0;
    let showEditButton = false;
    let selectedMealId = null;
    let globalCatalogCreatedByUid = null;
    let isGlobalLinkedFood = false;
    let isGlobalImportedFood = false;
    let canEditLibraryFood = false;
    let canDeleteLibraryFood = false;
    let canShowShareControls = false;

    if (source === 'foods') {
        const fid = String(state.currentFoodId || '').trim();
        const cached = foodsMapCache?.[fid];
        if (cached) {
            food = { id: fid, ...cached };
        } else {
            const prefill = state.foodDetailsPrefill;
            if (prefill && String(prefill.id || '') === fid) {
                food = { ...prefill };
            } else {
                const libCol = getMealLibraryFoodsCollection();
                if (libCol && fid) {
                    try {
                        const s = await getDoc(doc(libCol, fid));
                        if (s.exists()) {
                            food = { id: s.id, ...s.data() };
                        }
                    } catch (_) {}
                }
                if (!food) {
                    const foodsMap = await getFoodsMap();
                    food = foodsMap[fid];
                }
            }
        }

        if (!food) {
            const container = createElement('div', 'create-food');
            const topBarCreateFood = createElement('div','topBar-create-food');
            const backBtn = createElement('button', 'back-btn');
                backBtn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"><title>Ios-arrow-ltr-24-filled SVG Icon</title><path fill="currentColor" d="M12.727 3.687a1 1 0 1 0-1.454-1.374l-8.5 9a1 1 0 0 0 0 1.374l8.5 9.001a1 1 0 1 0 1.454-1.373L4.875 12z"></path></svg>
                `;

            backBtn.onclick = () => {
                if (isRecipeFoodsSource) {
                    state.mealView = 'recipeFoodSearch';
                    renderMealPage();
                    return;
                }

                if (isFoodsSource) {
                    if (state.mealSearchReturnTab) {
                        state.mealSearchTab = state.mealSearchReturnTab;
                    }
                    state._mealSearchRestoreNoIndicatorAnim = true;
                    state._mealSearchRestoreSkipCarouselSyncOnce = true;
                    if (hasUnderlyingMealSearch()) {
                        popMealOverlay();
                    } else {
                        state.mealView = 'search';
                        renderMealPage();
                    }
                    return;
                }

                if (isMealSource) {
                    closeMealOverlayAndShowMealMain();
                    return;
                }
            };

            topBarCreateFood.append(backBtn);
            container.append(
                topBarCreateFood,
                createElement('h3', null, 'Продукт не найден')
            );
            pushMealOverlay(container);
            return;
        }

        currentAmount = Number(food.defaultAmount || food.baseAmount || 100);
        isGlobalLinkedFood = isFoodLinkedToGlobalCatalog(food);
        isGlobalImportedFood = isFoodImportedFromGlobalCatalog(food);
        {
            const currentUid = getCurrentAuthUid();
            const sharedOwnerUid = String(food.sharedGlobalCreatedByUid || food.globalCatalogCreatedByUid || '').trim();
            const isOwnLinkedFood = !sharedOwnerUid || (currentUid && sharedOwnerUid === currentUid);
            canEditLibraryFood = !isGlobalImportedFood && (!isGlobalLinkedFood || isOwnLinkedFood);
        }
        canDeleteLibraryFood = true;
        canShowShareControls = canEditLibraryFood && !isGlobalImportedFood;
        showEditButton = canEditLibraryFood || canDeleteLibraryFood;
    } else if (isFatSecretSource) {
        const fatId = String(state.fatsecretDetails?.foodId || '').trim();
        if (!fatId) {
            showToast('Детали продукта не найдены');
            state.mealView = 'search';
            renderMealSearch();
            return;
        }

        // Кэшируем детали в state, чтобы "назад" не сбрасывалось.
        if (!state.fatsecretDetailsCache || typeof state.fatsecretDetailsCache !== 'object') {
            state.fatsecretDetailsCache = {};
        }

        let fatFood = state.fatsecretDetailsCache[fatId]?.food || null;
        if (!fatFood) {
            try {
                const resp = await fetch('/api/fatsecret/food', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ foodId: fatId })
                });
                const data = await resp.json().catch(() => null);
                if (!resp.ok) {
                    if (resp.status === 429 && data?.error === 'quota_exhausted') {
                        showToast('Лимит базы на сегодня исчерпан');
                    } else {
                        showToast('Не удалось загрузить продукт из базы');
                    }
                    state.mealView = 'search';
                    renderMealSearch();
                    return;
                }
                fatFood = data?.food || null;
                state.fatsecretDetailsCache[fatId] = { food: fatFood };
            } catch (e) {
                console.error(e);
                showToast('Нет соединения');
                state.mealView = 'search';
                renderMealSearch();
                return;
            }
        }

        const servingsRaw = fatFood?.servings?.serving;
        const servings = Array.isArray(servingsRaw) ? servingsRaw : (servingsRaw ? [servingsRaw] : []);
        if (!servings.length) {
            showToast('Нет данных о порциях');
            state.mealView = 'search';
            renderMealSearch();
            return;
        }

        const pick =
            servings.find((s) => String(s.metric_serving_unit || '').toLowerCase() === 'g' && Number(s.metric_serving_amount || 0) === 100) ||
            servings.find((s) => String(s.metric_serving_unit || '').toLowerCase() === 'g') ||
            servings[0];

        const baseAmount = Number(pick.metric_serving_amount || 100) || 100;
        const baseUnitRaw = String(pick.metric_serving_unit || 'g');
        const baseUnit = baseUnitRaw.toLowerCase() === 'g' ? 'г' : baseUnitRaw;

        food = {
            name: String(fatFood?.food_name || state.fatsecretDetails?.fromSearch?.name || 'Продукт').trim(),
            description: String(fatFood?.food_description || state.fatsecretDetails?.fromSearch?.brand || '').trim(),
            baseAmount,
            baseUnit,
            protein: Number(pick.protein || 0),
            fat: Number(pick.fat || 0),
            carbs: Number(pick.carbohydrate || 0),
            calories: Number(pick.calories || 0)
        };

        currentAmount = Number(state.fatsecretDetails?.draftAmount || baseAmount || 100);
        showEditButton = false;
    } else if (isGlobalCatalogSource) {
        const gCol = getGlobalFoodCatalogCollection();
        const gid = String(state.currentFoodId || '').trim();
        if (!gCol || !gid) {
            showToast('Запись каталога не найдена');
            state.mealView = 'search';
            renderMealSearch();
            return;
        }

        const catSnap = await getDoc(doc(gCol, gid));
        if (!catSnap.exists()) {
            showToast('Запись каталога не найдена');
            state.mealView = 'search';
            renderMealSearch();
            return;
        }

        const row = catSnap.data() || {};
        globalCatalogCreatedByUid = String(row.createdByUid || '') || null;
        food = {
            name: String(row.name || 'Продукт').trim(),
            description: String(row.description || '').trim(),
            baseAmount: Number(row.baseAmount || 100),
            baseUnit: String(row.baseUnit || 'г'),
            protein: Number(row.protein || 0),
            fat: Number(row.fat || 0),
            carbs: Number(row.carbs || 0),
            calories: Number(row.calories || 0)
        };

        currentAmount = Number(row.defaultAmount ?? row.baseAmount ?? food.baseAmount ?? 100);
        isGlobalLinkedFood = true;
        showEditButton = false;
    } else {
        const mealId = state.currentMealDetailsId;
        const itemIndex = state.currentMealItemIndex;
        const items = state.mealsData?.[mealId] || [];
        const mealItem = items[itemIndex];
        const foodsMap = await getFoodsMap();

        if (!mealItem) {
            showToast('Продукт в приеме не найден');
            closeMealOverlayAndShowMealMain();
            return;
        }

        food = {
            name: mealItem.name || foodsMap[mealItem.foodId]?.name || 'Продукт',
            description: mealItem.description || foodsMap[mealItem.foodId]?.description || '',
            baseAmount: Number(mealItem.baseAmount || foodsMap[mealItem.foodId]?.baseAmount || 100),
            baseUnit: mealItem.baseUnit || foodsMap[mealItem.foodId]?.baseUnit || 'г',
            protein: Number(mealItem.protein || foodsMap[mealItem.foodId]?.protein || 0),
            fat: Number(mealItem.fat || foodsMap[mealItem.foodId]?.fat || 0),
            carbs: Number(mealItem.carbs || foodsMap[mealItem.foodId]?.carbs || 0),
            calories: Number(mealItem.calories || foodsMap[mealItem.foodId]?.calories || 0)
        };

        currentAmount = Number(mealItem.grams || food.baseAmount || 100);
        showEditButton = false;
        selectedMealId = mealId;
    }

    const container = createElement('div', 'create-food');
    const topBarCreateFood = createElement('div','topBar-create-food');
    const backBtn = createElement('button', 'back-btn');
    backBtn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"><title>Ios-arrow-ltr-24-filled SVG Icon</title><path fill="currentColor" d="M12.727 3.687a1 1 0 1 0-1.454-1.374l-8.5 9a1 1 0 0 0 0 1.374l8.5 9.001a1 1 0 1 0 1.454-1.373L4.875 12z"></path></svg>
    `;

    backBtn.onclick = () => {
        const source = state.foodDetailsSource;

        if (source === 'foods' || source === 'fatsecret' || source === 'globalCatalog') {
            if (state.mealSearchReturnTab) {
                state.mealSearchTab = state.mealSearchReturnTab;
            }
            state._mealSearchRestoreNoIndicatorAnim = true;
            state._mealSearchRestoreSkipCarouselSyncOnce = true;
            if (hasUnderlyingMealSearch()) {
                const foodId = state.currentFoodId;
                popMealOverlay();
                patchSearchCardSubtitle(foodId);
            } else {
                state.mealView = 'search';
                renderMealSearch();
            }
            return;
        }

        closeMealOverlayAndShowMealMain();
    };

    if (shouldShowSearchMealLabel) {
        topBarCreateFood.append(
            createElement('div', 'food-details-meal-label meal-search-meal-text', `- ${getMealSearchCurrentLabel()} -`)
        );
    }

    const title = createElement('h3', 'create-food-sticky-h3', food.name || 'Продукт');

    const stickyHeader = createElement('div', 'create-food-sticky-header');
    stickyHeader.append(topBarCreateFood, title);

    const titleDesc = food.description?.trim()
        ? createElement('div', 'food-title-description', food.description)
        : null;

    const topBlockCreateFood = createElement('div','topBlock-create-food');
    let inlineSaveBtn = null;

    if (isFoodsSource || isRecipeFoodsSource) {
        inlineSaveBtn = createElement('button', 'food-inline-save-btn');
        inlineSaveBtn.type = 'button';
        inlineSaveBtn.textContent = 'Сохранить';
    }


    const amountInput = createElement('input', 'input');
    amountInput.type = 'number';
    amountInput.placeholder = 'Порция';
    amountInput.value = currentAmount;

    const unitInput = createElement('input', 'input');
    unitInput.value = food.baseUnit || 'г';
    unitInput.disabled = true;

    const BlocksaveBtn = createElement('div', 'block-save-btn active');

    let saveBtn = null;

    if (isMealSource) {
        saveBtn = createElement('button', 'save-btn active');
        saveBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 512 512">
                <path fill="none" stroke="currentColor" stroke-linecap="square" stroke-miterlimit="10" stroke-width="44" d="M416 128L192 384l-96-96"></path>
            </svg>
        `;
    } else if (isFoodsSource || isRecipeFoodsSource || isFatSecretSource || isGlobalCatalogSource) {
        saveBtn = createElement('button', 'food-add-btn meal-search-add-btn');
        saveBtn.type = 'button';
        saveBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24">
                <title>Plus SVG Icon</title>
                <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M12 20v-8m0 0V4m0 8h8m-8 0H4"></path>
            </svg>
        `;
    }

    const useBottomNavForFoodDetails =
        isMealSource || isFoodsSource || isFatSecretSource || isGlobalCatalogSource;

    function syncFoodDetailsBottomNav() {
        if (!useBottomNavForFoodDetails || !saveBtn) {
            clearMealBottomNavOverlayMode();
            return;
        }

        setMealBottomNavOverlayMode({
            visible: true,
            onBack: () => backBtn.onclick?.(),
            actionText: isMealSource ? 'Сохранить' : 'Добавить в прием',
            onAction: () => saveBtn.onclick?.(),
            actionDisabled: false
        });
    }

    BlocksaveBtn.append(saveBtn);

    const deleteBtn = createElement('button', 'delete-food-from-meal-btn');
       deleteBtn.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"><title>Trash-24 SVG Icon</title><path fill="currentColor" d="M16 1.75V3h5.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H8V1.75C8 .784 8.784 0 9.75 0h4.5C15.216 0 16 .784 16 1.75m-6.5 0V3h5V1.75a.25.25 0 0 0-.25-.25h-4.5a.25.25 0 0 0-.25.25M4.997 6.178a.75.75 0 1 0-1.493.144L4.916 20.92a1.75 1.75 0 0 0 1.742 1.58h10.684a1.75 1.75 0 0 0 1.742-1.581l1.413-14.597a.75.75 0 0 0-1.494-.144l-1.412 14.596a.25.25 0 0 1-.249.226H6.658a.25.25 0 0 1-.249-.226z"></path><path fill="currentColor" d="M9.206 7.501a.75.75 0 0 1 .793.705l.5 8.5A.75.75 0 1 1 9 16.794l-.5-8.5a.75.75 0 0 1 .705-.793Zm6.293.793A.75.75 0 1 0 14 8.206l-.5 8.5a.75.75 0 0 0 1.498.088l.5-8.5Z"></path></svg>
            `;

            deleteBtn.onclick = () => {
                openConfirmModal('Удалить продукт из приема?', async () => {
                    await removeFoodFromMeal(state.currentMealDetailsId, state.currentMealItemIndex);
                    showToast('Продукт удалён');

                    closeMealOverlayAndShowMealMain();
                });
            };

    const currentValuesWrap = createElement('div', 'food-current-card');


    function getFoodDetailsPayload() {
        return {
            name: String(food?.name || '').trim(),
            description: String(food?.description || '').trim(),
            baseAmount: Number(food?.baseAmount || 0),
            baseUnit: String(food?.baseUnit || 'г').trim(),
            protein: Number(food?.protein || 0),
            fat: Number(food?.fat || 0),
            carbs: Number(food?.carbs || 0),
            calories: Number(food?.calories || 0)
        };
    }

    function renderCurrentValuesBlock() {
        const currentValues = getScaledFoodValues(
            food,
            Number(amountInput.value) || Number(food.defaultAmount || food.baseAmount || 100)
        );

        const circumference = 301.59;
        const carbsLen = (currentValues.carbsPercent / 100) * circumference;
        const fatLen = (currentValues.fatPercent / 100) * circumference;
        const proteinLen = (currentValues.proteinPercent / 100) * circumference;

        currentValuesWrap.innerHTML = `
            <div class="food-current-ring-block">
                <div class="food-current-ring">
                    <svg viewBox="0 0 120 120" class="food-ring-svg">
                        <circle class="food-ring-bg" cx="60" cy="60" r="48"></circle>

                        <circle
                            class="food-ring-segment food-ring-carbs"
                            cx="60"
                            cy="60"
                            r="48"
                            stroke-dasharray="${carbsLen} ${circumference}"
                            stroke-dashoffset="0"
                        ></circle>

                        <circle
                            class="food-ring-segment food-ring-fat"
                            cx="60"
                            cy="60"
                            r="48"
                            stroke-dasharray="${fatLen} ${circumference}"
                            stroke-dashoffset="-${carbsLen}"
                        ></circle>

                        <circle
                            class="food-ring-segment food-ring-protein"
                            cx="60"
                            cy="60"
                            r="48"
                            stroke-dasharray="${proteinLen} ${circumference}"
                            stroke-dashoffset="-${carbsLen + fatLen}"
                        ></circle>
                    </svg>

                    <div class="food-ring-center">
                        <div class="food-ring-kcal">${currentValues.calories}</div>
                        <div class="food-ring-label">ккал</div>
                    </div>
                </div>
            </div>

            <div class="food-current-macros">
                <div class="food-current-macro food-current-macro-carbs">
                    <div class="food-current-percent">${currentValues.carbsPercent} %</div>
                    <div class="food-current-grams">${String(currentValues.carbs).replace('.', ',')} г</div>
                    <div class="food-current-name">Углев.</div>
                </div>

                <div class="food-current-macro food-current-macro-fat">
                    <div class="food-current-percent">${currentValues.fatPercent} %</div>
                    <div class="food-current-grams">${String(currentValues.fat).replace('.', ',')} г</div>
                    <div class="food-current-name">Жиры</div>
                </div>

                <div class="food-current-macro food-current-macro-protein">
                    <div class="food-current-percent">${currentValues.proteinPercent} %</div>
                    <div class="food-current-grams">${String(currentValues.protein).replace('.', ',')} г</div>
                    <div class="food-current-name">Белки</div>
                </div>
            </div>
        `;
    }

    renderCurrentValuesBlock();

    amountInput.addEventListener('input', () => {
        renderCurrentValuesBlock();
    });

   saveBtn.onclick = async () => {
       const newAmount = Number(amountInput.value || 0);

       if (!newAmount || newAmount <= 0) {
           showToast('Введите корректное количество');
           return;
       }

       saveBtn.disabled = true;

        try {
            if (isFoodsSource) {
                if (!isGlobalImportedFood) {
                    await updateFoodDefaultAmount(state.currentFoodId, newAmount);
                }

                const foodsMap = await getFoodsMap(!isGlobalImportedFood);
                const updatedFood = {
                    ...(foodsMap[state.currentFoodId] || food || {}),
                    defaultAmount: isGlobalImportedFood
                        ? Number(food?.defaultAmount || food?.baseAmount || 100)
                        : Number(newAmount)
                };

                if (!updatedFood) {
                    showToast('Продукт не найден');
                    return;
                }

               await addFoodSnapshotToCurrentMeal(updatedFood, newAmount);

               showToast('Продукт добавлен в прием');

               if (state.mealSearchReturnTab) {
                   state.mealSearchTab = state.mealSearchReturnTab;
               }
               state._mealSearchRestoreNoIndicatorAnim = true;
               state._mealSearchRestoreSkipCarouselSyncOnce = true;
               if (hasUnderlyingMealSearch()) {
                   popMealOverlay();
                   patchSearchCardSubtitle(state.currentFoodId);
               } else {
                   state.mealView = 'search';
                   renderMealSearch();
               }
               return;
           }

           if (isRecipeFoodsSource) {
               await updateFoodDefaultAmount(state.currentFoodId, newAmount);

               const foodsMap = await getFoodsMap();
               const updatedFood = foodsMap[state.currentFoodId];

               if (!updatedFood) {
                   showToast('Продукт не найден');
                   return;
               }

               addFoodToRecipeDraft(updatedFood, newAmount);

               showToast('Ингредиент добавлен в рецепт');

               state.mealView = 'recipeFoodSearch';
               renderMealPage();
               return;
           }

           if (isFatSecretSource) {
               // Сохраняем в "мои продукты" только при явном добавлении
               const payload = {
                   name: String(food?.name || 'Продукт').trim(),
                   description: String(food?.description || '').trim(),
                   baseAmount: Number(food?.baseAmount || 100),
                   baseUnit: String(food?.baseUnit || 'г'),
                   protein: Number(food?.protein || 0),
                   fat: Number(food?.fat || 0),
                   carbs: Number(food?.carbs || 0),
                   calories: Number(food?.calories || 0),
                   defaultAmount: Number(newAmount),
                   source: 'fatsecret',
                   externalId: String(state.fatsecretDetails?.foodId || '')
               };
               const foodId = await addFood(payload);
               state.currentFoodId = foodId;
               await getFoodsMap(true);
               await addFoodSnapshotToCurrentMeal(payload, newAmount);
               showToast('Продукт добавлен в прием');
               if (state.mealSearchReturnTab) {
                   state.mealSearchTab = state.mealSearchReturnTab;
               }
               state._mealSearchRestoreNoIndicatorAnim = true;
               state._mealSearchRestoreSkipCarouselSyncOnce = true;
               if (hasUnderlyingMealSearch()) {
                   popMealOverlay();
                   patchSearchCardSubtitle(state.currentFoodId);
               } else {
                   state.mealView = 'search';
                   renderMealSearch();
               }
               return;
           }

           if (isGlobalCatalogSource) {
               const catalogFoodId = String(state.currentFoodId || '').trim();
               const payload = buildGlobalCatalogImportPayload(
                   { ...food, createdByUid: globalCatalogCreatedByUid },
                   catalogFoodId,
                   newAmount
               );
               const foodId = await ensureGlobalCatalogFoodSaved(
                   { ...food, createdByUid: globalCatalogCreatedByUid },
                   catalogFoodId,
                   newAmount
               );
               if (!foodId) return;
               state.currentFoodId = foodId;
               await getFoodsMap(true);
               await addFoodSnapshotToCurrentMeal(payload, newAmount);
               showToast('Продукт добавлен в прием');
               if (state.mealSearchReturnTab) {
                   state.mealSearchTab = state.mealSearchReturnTab;
               }
               state._mealSearchRestoreNoIndicatorAnim = true;
               state._mealSearchRestoreSkipCarouselSyncOnce = true;
               if (hasUnderlyingMealSearch()) {
                   popMealOverlay();
                   patchSearchCardSubtitle(state.currentFoodId);
               } else {
                   state.mealView = 'search';
                   renderMealSearch();
               }
               return;
           }

           if (isMealSource) {
               const oldMealId = state.currentMealDetailsId;

               await updateOrMoveFoodInMeal(
                   oldMealId,
                   state.currentMealItemIndex,
                   newAmount,
                   selectedMealId
               );

               if (selectedMealId && selectedMealId !== oldMealId) {
                   showToast('Продукт перенесён');
               } else {
                   showToast('Продукт в приеме обновлен');
               }

               closeMealOverlayAndShowMealMain();
               return;
           }
       } catch (error) {
           console.error(error);
           showToast('Ошибка при сохранении');
       } finally {
           saveBtn.disabled = false;
       }
   };

       if (inlineSaveBtn) {
           inlineSaveBtn.onclick = async () => {
               const newAmount = Number(amountInput.value || 0);

               if (!newAmount || newAmount <= 0) {
                   showToast('Введите корректное количество');
                   return;
               }

               try {
                   inlineSaveBtn.disabled = true;

                   await updateFoodDefaultAmount(state.currentFoodId, newAmount);

                   food.defaultAmount = newAmount;

                   showToast('Порция сохранена');
                   renderCurrentValuesBlock();
               } catch (error) {
                   console.error(error);
                   showToast('Ошибка при сохранении');
               } finally {
                   inlineSaveBtn.disabled = false;
               }
           };
       }


    const passportBlock = createElement('div', 'food-passport-block');
    passportBlock.innerHTML = `
        <div class="food-passport-title">Пищевая ценность</div>
        <div class="food-passport-divider"></div>

        <div class="food-passport-portion-row">
            <span>Порция</span>
            <span>${Number(food.baseAmount || 100)} ${food.baseUnit || 'г'}</span>
        </div>

        <div class="food-passport-bar"></div>

        <div class="food-passport-portion-label">в порции</div>

        <div class="food-passport-bar"></div>

        <div class="food-passport-row food-passport-row-energy">
            <div class="food-passport-name food-passport-name-energy">Энергетическая<br>ценность</div>
            <div class="food-passport-value">${Math.round(Number(food.calories || 0))} кал</div>
        </div>

        <div class="food-passport-row">
            <div class="food-passport-name">Жир</div>
            <div class="food-passport-value">${formatMacro(Number(food.fat || 0), 1)}г</div>
        </div>

        <div class="food-passport-row">
            <div class="food-passport-name">Углеводы</div>
            <div class="food-passport-value">${formatMacro(Number(food.carbs || 0), 1)}г</div>
        </div>

        <div class="food-passport-row food-passport-row-last">
            <div class="food-passport-name">Белок</div>
            <div class="food-passport-value">${formatMacro(Number(food.protein || 0), 1)}г</div>
        </div>

        <div class="food-passport-bar food-passport-bar-bottom"></div>
    `;

    const amountRow = createElement('div', 'food-input-row');
    const unitRow = createElement('div', 'food-input-row');
    const mealRow = createElement('div', 'food-input-row');
    const mealValueBtn = createElement('button', 'food-meal-select-btn');
    mealValueBtn.type = 'button';
    mealValueBtn.textContent = selectedMealId
        ? getMealLabelById(selectedMealId, state.mealsData || {})
        : 'Прием';

    const mealDropdown = createElement('div', 'food-meal-dropdown');
    mealDropdown.style.display = 'none';

    if (selectedMealId) {
        const mealKeys = getMealKeysFromData(state.mealsData || {});

        mealKeys.forEach((mealId) => {
            const option = createElement(
                'button',
                'food-meal-dropdown-item',
                getMealLabelById(mealId, state.mealsData || {})
            );

            option.type = 'button';

            option.onclick = (e) => {
                e.stopPropagation();
                selectedMealId = mealId;
                mealValueBtn.textContent = getMealLabelById(mealId, state.mealsData || {});
                mealDropdown.style.display = 'none';
            };

            mealDropdown.append(option);
        });

        mealValueBtn.onclick = (e) => {
            e.stopPropagation();
            mealDropdown.style.display = mealDropdown.style.display === 'none' ? 'block' : 'none';
        };

        mealValueBtn.onclick = (e) => {
            e.stopPropagation();
            mealDropdown.style.display = mealDropdown.style.display === 'none' ? 'block' : 'none';
        };

        mealDropdown.onclick = (e) => {
            e.stopPropagation();
        };

        container.onclick = () => {
            mealDropdown.style.display = 'none';
        };
    }

    // SVG 1 (±)
    const plusMinusIcon = document.createElement('div');
    plusMinusIcon.className = 'food-input-icon';
    plusMinusIcon.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 256 256">
      <title>Plus-minus SVG Icon</title>
      <path fill="currentColor" d="m205.66 61.66l-144 144a8 8 0 0 1-11.32-11.32l144-144a8 8 0 0 1 11.32 11.32M64 112a8 8 0 0 0 16 0V80h32a8 8 0 0 0 0-16H80V32a8 8 0 0 0-16 0v32H32a8 8 0 0 0 0 16h32Zm160 64h-80a8 8 0 0 0 0 16h80a8 8 0 0 0 0-16"/>
    </svg>
    `;

    // SVG 2 (список)
    const listIcon = document.createElement('div');
    listIcon.className = 'food-input-icon';
    listIcon.innerHTML = `
    <svg viewBox="0 0 24 24" width="20" height="20">
        <path d="M8 6h12M8 12h12M8 18h12"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              fill="none"/>
        <circle cx="4" cy="6" r="1.5" fill="currentColor"/>
        <circle cx="4" cy="12" r="1.5" fill="currentColor"/>
        <circle cx="4" cy="18" r="1.5" fill="currentColor"/>
    </svg>
    `;

// SVG 3 (список)
    const mealIcon = document.createElement('div');
    mealIcon.className = 'food-input-icon';
    mealIcon.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"><title>Calendar SVG Icon</title><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 4V2m0 2v2m0-2h-4.5M3 10v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-9zm0 0V6a2 2 0 0 1 2-2h2m0-2v4m14 4V6a2 2 0 0 0-2-2h-.5"/></svg>
    `;



    BlocksaveBtn.append(saveBtn);
    if (isRecipeFoodsSource) {
        topBarCreateFood.append(backBtn, BlocksaveBtn);
    }
    amountRow.append(plusMinusIcon, amountInput);
    unitRow.append(listIcon, unitInput);
    mealRow.append(mealIcon, mealValueBtn, mealDropdown);
    mealRow.style.position = 'relative';

    if (source === 'meal') {
        topBlockCreateFood.append(amountRow, unitRow, mealRow);
    } else {
        topBlockCreateFood.append(amountRow, unitRow, inlineSaveBtn);
    }

    container.append(
        stickyHeader,
        ...(titleDesc ? [titleDesc] : []),
        topBlockCreateFood,
        currentValuesWrap,
        passportBlock
    );

    if (isMealSource) {
        const deleteMealFoodBtn = createElement('button', 'edit-meal-search-main-action meal-food-delete-action');
        deleteMealFoodBtn.type = 'button';
        deleteMealFoodBtn.innerHTML = `
            <span class="btn-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24">
                    <path fill="currentColor" d="M16 1.75V3h5.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H8V1.75C8 .784 8.784 0 9.75 0h4.5C15.216 0 16 .784 16 1.75m-6.5 0V3h5V1.75a.25.25 0 0 0-.25-.25h-4.5a.25.25 0 0 0-.25.25M4.997 6.178a.75.75 0 1 0-1.493.144L4.916 20.92a1.75 1.75 0 0 0 1.742 1.58h10.684a1.75 1.75 0 0 0 1.742-1.581l1.413-14.597a.75.75 0 0 0-1.494-.144l-1.412 14.596a.25.25 0 0 1-.249.226H6.658a.25.25 0 0 1-.249-.226z"></path>
                    <path fill="currentColor" d="M9.206 7.501a.75.75 0 0 1 .793.705l.5 8.5A.75.75 0 1 1 9 16.794l-.5-8.5a.75.75 0 0 1 .705-.793Zm6.293.793A.75.75 0 1 0 14 8.206l-.5 8.5a.75.75 0 0 0 1.498.088l.5-8.5Z"></path>
                </svg>
            </span>
            <span class="btn-text">Удалить из приема</span>
        `;
        deleteMealFoodBtn.onclick = () => deleteBtn.onclick?.();

        const actionsBlock = createElement('div', 'food-details-actions-block food-details-actions-block--meal-food-delete');
        actionsBlock.append(deleteMealFoodBtn);
        container.append(actionsBlock);
    }

    if (showEditButton) {
        const isLibraryFoodSource = isFoodsSource; // только "мои продукты" (library) — можно делиться

        function openDeleteFoodOptionsModal(foodName, handlers) {
            const modal = createElement('div', 'modal-overlay');
            const modalContent = createElement('div', 'modal-content modal-compact');
            const title = String(foodName || 'продукт');
            const esc = (s) => String(s || '')
                .replaceAll('&', '&amp;')
                .replaceAll('<', '&lt;')
                .replaceAll('>', '&gt;')
                .replaceAll('"', '&quot;')
                .replaceAll("'", '&#39;');

            modalContent.innerHTML = `
                <p>Удалить продукт «${esc(title)}»?</p>
                <div class="modal-controls" style="display:flex;flex-direction:column;gap:10px;">
                    <button class="btn btn-danger delete-local-btn">Удалить у себя</button>
                    <button class="btn btn-danger delete-global-btn">Удалить только из общей базы</button>
                    <button class="btn btn-danger delete-both-btn">Удалить у себя и в общей базе</button>
                    <button class="btn btn-secondary cancel-btn">Отмена</button>
                </div>
            `;

            modal.append(modalContent);
            document.body.append(modal);
            setTimeout(() => modal.classList.add('active'), 50);

            const close = () => {
                modal.classList.remove('active');
                setTimeout(() => modal.remove(), 300);
            };

            const cancelBtn = modal.querySelector('.cancel-btn');
            const localBtn = modal.querySelector('.delete-local-btn');
            const globalBtn = modal.querySelector('.delete-global-btn');
            const bothBtn = modal.querySelector('.delete-both-btn');

            cancelBtn?.addEventListener('click', close);
            modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

            localBtn?.addEventListener('click', async () => {
                if (handlers?.local) await handlers.local();
                close();
            });
            globalBtn?.addEventListener('click', async () => {
                if (handlers?.global) await handlers.global();
                close();
            });
            bothBtn?.addEventListener('click', async () => {
                if (handlers?.both) await handlers.both();
                close();
            });

            return { modal, globalBtn, bothBtn };
        }

        const deleteProductBtn = createElement('button', 'edit-meal-search-main-action food-details-action-btn food-details-action-delete');
        deleteProductBtn.type = 'button';
        deleteProductBtn.innerHTML = `
            <span class="btn-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24">
                    <path fill="currentColor" d="M16 1.75V3h5.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H8V1.75C8 .784 8.784 0 9.75 0h4.5C15.216 0 16 .784 16 1.75m-6.5 0V3h5V1.75a.25.25 0 0 0-.25-.25h-4.5a.25.25 0 0 0-.25.25M4.997 6.178a.75.75 0 1 0-1.493.144L4.916 20.92a1.75 1.75 0 0 0 1.742 1.58h10.684a1.75 1.75 0 0 0 1.742-1.581l1.413-14.597a.75.75 0 0 0-1.494-.144l-1.412 14.596a.25.25 0 0 1-.249.226H6.658a.25.25 0 0 1-.249-.226z"></path>
                    <path fill="currentColor" d="M9.206 7.501a.75.75 0 0 1 .793.705l.5 8.5A.75.75 0 1 1 9 16.794l-.5-8.5a.75.75 0 0 1 .705-.793Zm6.293.793A.75.75 0 1 0 14 8.206l-.5 8.5a.75.75 0 0 0 1.498.088l.5-8.5Z"></path>
                </svg>
            </span>
            <span class="btn-text">Удалить продукт</span>
        `;

        deleteProductBtn.onclick = () => {
            const currentId = String(state.currentFoodId || '').trim();
            const currentName = String(food?.name || 'Без названия');

            const getCurrentSharedId = async () => {
                const libCol = getMealLibraryFoodsCollection();
                if (!libCol || !currentId) return '';

                const libSnap = await getDoc(doc(libCol, currentId));
                return libSnap.exists() ? getFoodGlobalCatalogId(libSnap.data() || {}) : '';
            };

            const returnToFoodSearchAfterDelete = () => {
                if (state.mealSearchReturnTab) {
                    state.mealSearchTab = state.mealSearchReturnTab;
                    state._mealSearchRestoreNoIndicatorAnim = true;
                    state._mealSearchRestoreSkipCarouselSyncOnce = true;
                }
                if (hasUnderlyingMealSearch()) {
                    popMealOverlay();
                    patchFoodSearchCardSharedBadge(currentId);
                } else {
                    state.mealView = 'search';
                    renderMealSearch();
                }
            };

            const { globalBtn, bothBtn } = openDeleteFoodOptionsModal(currentName, {
                local: async () => {
                    await deleteFood(currentId);
                    showToast('Продукт удалён');
                    if (hasUnderlyingMealSearch()) {
                        popMealOverlay();
                        removeFoodCardFromSearchDOM(currentId);
                    } else {
                        state.mealView = 'search';
                        renderMealSearch();
                    }
                },
                global: async () => {
                    const gCol = getGlobalFoodCatalogCollection();
                    const sharedId = await getCurrentSharedId();
                    if (!gCol || !sharedId || !canEditLibraryFood) {
                        showToast('Удалить из общей базы может только автор продукта');
                        return;
                    }

                    try {
                        await deleteDoc(doc(gCol, sharedId));
                        await unlinkLocalFoodFromGlobalCatalog(currentId);
                        showToast('Удалено из общей базы');
                        returnToFoodSearchAfterDelete();
                    } catch (e) {
                        console.error(e);
                        showToast('Не удалось удалить из общей базы');
                    }
                },
                both: async () => {
                    const gCol = getGlobalFoodCatalogCollection();
                    if (!gCol || !canEditLibraryFood) {
                        showToast('Не удалось удалить из общей базы');
                        return;
                    }

                    const sharedId = await getCurrentSharedId();

                    if (!sharedId) {
                        showToast('Продукт ещё не добавлен в общую базу');
                        await deleteFood(currentId);
                        showToast('Продукт удалён');
                        if (state.mealSearchReturnTab) {
                            state.mealSearchTab = state.mealSearchReturnTab;
                            state._mealSearchRestoreNoIndicatorAnim = true;
                            state._mealSearchRestoreSkipCarouselSyncOnce = true;
                        }
                        if (hasUnderlyingMealSearch()) {
                            popMealOverlay();
                            removeFoodCardFromSearchDOM(currentId);
                        } else {
                            state.mealView = 'search';
                            renderMealSearch();
                        }
                        return;
                    }

                    try {
                        await deleteDoc(doc(gCol, sharedId));
                    } catch (e) {
                        console.error(e);
                        showToast('Нет прав удалить из общей базы (доступно только создателю)');
                        return;
                    }

                    await deleteFood(currentId);
                    showToast('Продукт удалён');
                    if (state.mealSearchReturnTab) {
                        state.mealSearchTab = state.mealSearchReturnTab;
                        state._mealSearchRestoreNoIndicatorAnim = true;
                        state._mealSearchRestoreSkipCarouselSyncOnce = true;
                    }
                    if (hasUnderlyingMealSearch()) {
                        popMealOverlay();
                        removeFoodCardFromSearchDOM(currentId);
                    } else {
                        state.mealView = 'search';
                        renderMealSearch();
                    }
                }
            });

            if (!globalBtn || !bothBtn) return;
            (async () => {
                try {
                    const sharedId = await getCurrentSharedId();
                    if (!sharedId || !canEditLibraryFood) {
                        globalBtn.disabled = true;
                        globalBtn.classList.add('disabled');
                        bothBtn.disabled = true;
                        bothBtn.classList.add('disabled');
                    }
                } catch (_) {}
            })();
        };

        const editBtn = createElement('button', 'edit-meal-search-main-action food-details-action-btn food-details-action-edit');
        editBtn.innerHTML = `
            <span class="btn-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24">
                    <path fill="currentColor" d="M3.548 20.938h16.9a.5.5 0 0 0 0-1h-16.9a.5.5 0 0 0 0 1M9.71 17.18a2.587 2.587 0 0 0 1.12-.65l9.54-9.54a1.75 1.75 0 0 0 0-2.47l-.94-.93a1.788 1.788 0 0 0-2.47 0l-9.54 9.53a2.473 2.473 0 0 0-.64 1.12L6.04 17a.737.737 0 0 0 .19.72a.767.767 0 0 0 .53.22Zm.41-1.36a1.468 1.468 0 0 1-.67.39l-.97.26l-1-1l.26-.97a1.521 1.521 0 0 1 .39-.67l.38-.37l1.99 1.99Zm1.09-1.08l-1.99-1.99l6.73-6.73l1.99 1.99Zm8.45-8.45L18.65 7.3l-1.99-1.99l1.01-1.02a.748.748 0 0 1 1.06 0l.93.94a.754.754 0 0 1 0 1.06"></path>
                </svg>
            </span>
            <span class="btn-text">Изменить продукт</span>
        `;

        editBtn.onclick = () => {
            state.mealView = 'editFood';
            renderEditFood();
        };

        const actionsBlock = createElement('div', 'food-details-actions-block food-details-actions-block--product');
        const mainActionsRow = createElement('div', 'food-details-main-actions-row');
        if (canEditLibraryFood) {
            mainActionsRow.append(editBtn);
        }
        if (canDeleteLibraryFood) {
            mainActionsRow.append(deleteProductBtn);
        }
        mainActionsRow.classList.toggle('food-details-main-actions-row--single', mainActionsRow.children.length === 1);
        actionsBlock.append(mainActionsRow);
        container.append(actionsBlock);

        const sharedStatus = createElement('div', 'meal-share-status meal-share-status--global');
        if (isGlobalImportedFood) {
            sharedStatus.textContent = 'Продукт добавлен из общей базы. Редактирование доступно только автору.';
            actionsBlock.insertBefore(sharedStatus, mainActionsRow);
        } else if (isGlobalLinkedFood) {
            sharedStatus.textContent = 'Продукт добавлен в общую базу';
            actionsBlock.insertBefore(sharedStatus, mainActionsRow);
        }

        if (isLibraryFoodSource && canShowShareControls && !isGlobalLinkedFood) {
            const shareRow = createElement('div', 'meal-share-row');

            const shareBtn = createElement('button', 'edit-meal-search-main-action');
            shareBtn.type = 'button';
            shareBtn.innerHTML = `
                <span class="btn-icon">
                    <svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24">
                        <path fill="currentColor" d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7a2.5 2.5 0 0 0 0-1.39l7-4.11A2.99 2.99 0 1 0 15 5a3 3 0 0 0 .06.59l-7 4.11a3 3 0 1 0 0 4.6l7.12 4.16c-.04.19-.06.39-.06.59a3 3 0 1 0 3-3Z"/>
                    </svg>
                </span>
                <span class="btn-text">Поделиться продуктом</span>
            `;

            const infoBtn = createElement('button', 'meal-share-info-btn');
            infoBtn.type = 'button';
            infoBtn.textContent = 'i';

            const status = createElement('div', 'meal-share-status');

            const openInfo = () => {
                const modal = createElement('div', 'modal-overlay');
                const modalContent = createElement('div', 'modal-content modal-compact');
                modalContent.innerHTML = `
                    <p>
                        Нажмите «Поделиться продуктом», чтобы добавить его в общую базу пользователей.
                        Пока продукт хранится в вашей библиотеке, все ваши изменения будут обновлять и запись в общей базе.
                        Если удалить продукт у себя — он останется в общей базе, но редактировать его через ваш аккаунт уже нельзя.
                    </p>
                    <div class="modal-controls">
                        <button class="btn btn-primary confirm-btn">Понятно</button>
                    </div>
                `;
                modal.append(modalContent);
                document.body.append(modal);
                setTimeout(() => modal.classList.add('active'), 50);
                const close = () => {
                    modal.classList.remove('active');
                    setTimeout(() => modal.remove(), 300);
                };
                modal.querySelector('.confirm-btn')?.addEventListener('click', close);
                modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
            };

            infoBtn.onclick = (e) => {
                e.stopPropagation();
                openInfo();
            };

            const refreshShareUi = async () => {
                try {
                    const libCol = getMealLibraryFoodsCollection();
                    if (!libCol) return;
                    const libSnap = await getDoc(doc(libCol, state.currentFoodId));
                    const d = libSnap.exists() ? (libSnap.data() || {}) : {};
                    const sharedId = getFoodGlobalCatalogId(d);
                    if (sharedId) {
                        status.textContent = 'Продукт добавлен в общую базу';
                        shareRow.remove();
                    } else {
                        shareBtn.disabled = false;
                        shareBtn.classList.remove('disabled');
                        status.textContent = '';
                    }
                } catch (_) {}
            };

            shareBtn.onclick = async (e) => {
                e.stopPropagation();
                try {
                    shareBtn.disabled = true;
                    const libCol = getMealLibraryFoodsCollection();
                    const gCol = getGlobalFoodCatalogCollection();
                    const uid = getCurrentAuthUid();
                    const fid = String(state.currentFoodId || '').trim();
                    if (!libCol || !gCol || !uid || !fid) {
                        showToast('Не удалось поделиться продуктом');
                        return;
                    }

                    const libRef = doc(libCol, fid);
                    const libSnap = await getDoc(libRef);
                    if (!libSnap.exists()) {
                        showToast('Продукт не найден в библиотеке');
                        return;
                    }

                    const row = libSnap.data() || {};
                    if (getFoodGlobalCatalogId(row)) {
                        await refreshShareUi();
                        return;
                    }

                    const payload = {
                        name: String(row.name || '').trim(),
                        nameLower: normalizeSearchText(row.name),
                        searchTokens: buildMealSearchTokens(row.name),
                        description: String(row.description || '').trim(),
                        baseAmount: Number(row.baseAmount || 100),
                        baseUnit: String(row.baseUnit || 'г'),
                        protein: Number(row.protein || 0),
                        fat: Number(row.fat || 0),
                        carbs: Number(row.carbs || 0),
                        calories: Number(row.calories || 0),
                        defaultAmount: Number(row.defaultAmount ?? row.baseAmount ?? 100),
                        createdAt: Date.now(),
                        createdByUid: uid,
                        mirroredLibraryContext: getMealLibraryContextKey(),
                        mirroredLibraryFoodId: fid
                    };

                    // Используем стабильный id = id продукта в библиотеке, чтобы потом легко синхронизировать изменения.
                    await setDoc(doc(gCol, fid), payload, { merge: true });
                    await updateDoc(libRef, {
                        sharedGlobalCatalogId: fid,
                        sharedGlobalSharedAt: Date.now(),
                        sharedGlobalCreatedByUid: uid
                    });
                    if (foodsMapCache && foodsMapLibraryKey === getMealLibraryContextKey() && foodsMapCache[fid]) {
                        foodsMapCache[fid].sharedGlobalCatalogId = fid;
                        foodsMapCache[fid].sharedGlobalSharedAt = Date.now();
                        foodsMapCache[fid].sharedGlobalCreatedByUid = uid;
                    }
                    invalidateFoodPreviewCaches();
                    patchFoodSearchCardSharedBadge(fid);

                    showToast('Добавлено в общую базу');
                    await refreshShareUi();
                } catch (err) {
                    console.error(err);
                    showToast('Не удалось поделиться продуктом');
                    await refreshShareUi();
                } finally {
                    shareBtn.disabled = false;
                }
            };

            // первичная проверка
            void refreshShareUi();

            shareRow.append(shareBtn, infoBtn);
            actionsBlock.insertBefore(status, mainActionsRow);
            actionsBlock.insertBefore(shareRow, mainActionsRow);
        }
    }

    if (isGlobalCatalogSource) {
        container.append(
            createElement('div', 'meal-share-status meal-share-status--global', 'Продукт находится в общей базе')
        );
    }

    if (isGlobalCatalogSource) {
        const gCol = getGlobalFoodCatalogCollection();
        const gid = String(state.currentFoodId || '').trim();
        const uid = getCurrentAuthUid();
        const createdBy = globalCatalogCreatedByUid;
        if (gCol && gid && uid && createdBy && uid === createdBy) {
            const delGlobalBtn = createElement('button', 'edit-meal-search-main-action');
            delGlobalBtn.type = 'button';
            delGlobalBtn.innerHTML = `
            <span class="btn-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24">
                    <path fill="currentColor" d="M16 1.75V3h5.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H8V1.75C8 .784 8.784 0 9.75 0h4.5C15.216 0 16 .784 16 1.75m-6.5 0V3h5V1.75a.25.25 0 0 0-.25-.25h-4.5a.25.25 0 0 0-.25.25M4.997 6.178a.75.75 0 1 0-1.493.144L4.916 20.92a1.75 1.75 0 0 0 1.742 1.58h10.684a1.75 1.75 0 0 0 1.742-1.581l1.413-14.597a.75.75 0 0 0-1.494-.144l-1.412 14.596a.25.25 0 0 1-.249.226H6.658a.25.25 0 0 1-.249-.226z"></path>
                    <path fill="currentColor" d="M9.206 7.501a.75.75 0 0 1 .793.705l.5 8.5A.75.75 0 1 1 9 16.794l-.5-8.5a.75.75 0 0 1 .705-.793Zm6.293.793A.75.75 0 1 0 14 8.206l-.5 8.5a.75.75 0 0 0 1.498.088l.5-8.5Z"></path>
                </svg>
            </span>
            <span class="btn-text">Удалить из общей базы</span>
        `;
            delGlobalBtn.onclick = () => {
                openConfirmModal('Удалить эту запись из общей базы для всех пользователей?', async () => {
                    try {
                        await deleteDoc(doc(gCol, gid));
                        const localFoodId = await findLocalFoodIdByGlobalCatalogId(gid);
                        if (localFoodId) {
                            await unlinkLocalFoodFromGlobalCatalog(localFoodId);
                        }
                        showToast('Удалено из общей базы');
                        if (hasUnderlyingMealSearch()) popMealOverlay();
                        else {
                            state.mealView = 'search';
                            renderMealSearch();
                        }
                    } catch (e) {
                        console.error(e);
                        showToast('Не удалось удалить');
                    }
                });
            };
            const globalActionsBlock = createElement('div', 'food-details-actions-block');
            globalActionsBlock.append(delGlobalBtn);
            container.append(globalActionsBlock);
        }
    }

    if (useBottomNavForFoodDetails) {
        attachMealOverlayBottomNavSync(container, syncFoodDetailsBottomNav);
    }
    pushMealOverlay(container);

    requestAnimationFrame(() => {
        setupCreateFoodStickyTitleBorder({
            titleEl: title,
            watchEl: titleDesc || topBlockCreateFood
        });
    });
}


async function renderRecipeDetails() {
    ensureMealShell();
    setMealBaseTopBarVisible(false);

    if (!state.currentRecipeId) return;

    const isMealSourceEarly = state.recipeDetailsSource === 'meal';
    const mealSnap = state.recipeMealSnapshot;
    let recipe = null;
    let recipeRef = null;

    if (isMealSourceEarly && mealSnap) {
        recipe = {
            id: state.currentRecipeId,
            title: mealSnap.name || '',
            description: mealSnap.description || '',
            servings: String(mealSnap.baseServings || mealSnap.servings || 1),
            ingredients: Array.isArray(mealSnap.ingredients) ? mealSnap.ingredients : []
        };
    } else {
        recipeRef = await getRecipeDocumentRef(state.currentRecipeId);
        if (!recipeRef) return;

        const recipeSnap = await getDoc(recipeRef);

        if (!recipeSnap.exists()) {
            const container = createElement('div', 'create-food');
            const topBarCreateFood = createElement('div','topBar-create-food');
            const backBtn = createElement('button', 'back-btn');

            backBtn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24">
                    <title>Ios-arrow-ltr-24-filled SVG Icon</title>
                    <path fill="currentColor" d="M12.727 3.687a1 1 0 1 0-1.454-1.374l-8.5 9a1 1 0 0 0 0 1.374l8.5 9.001a1 1 0 1 0 1.454-1.373L4.875 12z"></path>
                </svg>
            `;

            backBtn.onclick = () => {
                state.recipeServingsDraft = null;
                state.recipeDetailsSource = null;
                state.recipeMealSnapshot = null;

                if (state.mealSearchReturnTab) {
                    state.mealSearchTab = state.mealSearchReturnTab;
                }
                state._mealSearchRestoreNoIndicatorAnim = true;
                state._mealSearchRestoreSkipCarouselSyncOnce = true;
                if (hasUnderlyingMealSearch()) {
                    popMealOverlay();
                } else {
                    state.mealView = 'search';
                    renderMealPage();
                }
            };

            topBarCreateFood.append(backBtn);
            container.append(
                topBarCreateFood,
                createElement('h3', null, 'Рецепт не найден')
            );
            pushMealOverlay(container);
            return;
        }

        recipe = {
            id: recipeSnap.id,
            ...recipeSnap.data()
        };
    }

    const recipeSource = state.recipeDetailsSource || 'search';
    const isMealSource = recipeSource === 'meal';
    const mealItemIndex = state.currentMealItemIndex;
    const mealDetailsId = state.currentMealDetailsId;

    let currentAmount = Number(state.recipeServingsDraft || recipe.defaultServings || recipe.servings || 1);
    if (!currentAmount || currentAmount <= 0) {
        currentAmount = Number(recipe.defaultServings || recipe.servings || 1) || 1;
    }

    const container = createElement('div', 'create-food');
    const topBarCreateFood = createElement('div','topBar-create-food');

    const backBtn = createElement('button', 'back-btn');
    backBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24">
            <title>Ios-arrow-ltr-24-filled SVG Icon</title>
            <path fill="currentColor" d="M12.727 3.687a1 1 0 1 0-1.454-1.374l-8.5 9a1 1 0 0 0 0 1.374l8.5 9.001a1 1 0 1 0 1.454-1.373L4.875 12z"></path>
        </svg>
    `;

    backBtn.onclick = () => {
        state.recipeServingsDraft = null;
        state.recipeDetailsSource = null;
        state.recipeMealSnapshot = null;

        if (isMealSource) {
            closeMealOverlayAndShowMealMain();
            return;
        }

        if (state.mealSearchReturnTab) {
            state.mealSearchTab = state.mealSearchReturnTab;
        }
        state._mealSearchRestoreNoIndicatorAnim = true;
        state._mealSearchRestoreSkipCarouselSyncOnce = true;
        if (hasUnderlyingMealSearch()) {
            popMealOverlay();
        } else {
            state.mealView = 'search';
            renderMealPage();
        }
    };

    if (!isMealSource) {
        topBarCreateFood.append(
            createElement('div', 'food-details-meal-label meal-search-meal-text', `- ${getMealSearchCurrentLabel()} -`)
        );
    }

    const title = createElement('h3', 'create-food-sticky-h3', recipe.title || 'Рецепт');

    const stickyHeader = createElement('div', 'create-food-sticky-header');
    stickyHeader.append(topBarCreateFood, title);

    const titleDesc = recipe.description?.trim()
        ? createElement('div', 'food-title-description', recipe.description)
        : null;

    const topBlockCreateFood = createElement('div','topBlock-create-food');

    const inlineSaveBtn = createElement('button', 'food-inline-save-btn');
    inlineSaveBtn.type = 'button';
    inlineSaveBtn.textContent = 'Сохранить';

    const amountInput = createElement('input', 'input');
    amountInput.type = 'number';
    amountInput.step = 'any';
    amountInput.min = '0.1';
    amountInput.placeholder = 'Порции';
    amountInput.value = currentAmount;

    const unitInput = createElement('input', 'input');
    unitInput.value = 'порц';
    unitInput.disabled = true;

    let topBarActionBtn = null;

    function syncRecipeDetailsBottomNav() {
        if (!topBarActionBtn) {
            clearMealBottomNavOverlayMode();
            return;
        }

        setMealBottomNavOverlayMode({
            visible: true,
            onBack: () => backBtn.onclick?.(),
            actionText: isMealSource ? 'Сохранить' : 'Добавить в прием',
            onAction: () => topBarActionBtn.onclick?.(),
            actionDisabled: Boolean(topBarActionBtn.disabled)
        });
    }

    if (!isMealSource) {
        const BlocksaveBtn = createElement('div', 'block-save-btn active');
        const saveBtn = createElement('button', 'food-add-btn meal-search-add-btn');
        saveBtn.type = 'button';
        saveBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24">
                <title>Plus SVG Icon</title>
                <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M12 20v-8m0 0V4m0 8h8m-8 0H4"></path>
            </svg>
        `;

        saveBtn.onclick = async () => {
            const newAmount = Number(amountInput.value || 0);

            if (!newAmount || newAmount <= 0) {
                showToast('Введите корректное количество порций');
                return;
            }

            try {
                saveBtn.disabled = true;

                await addRecipeToCurrentMeal(recipe, newAmount);

                showToast('Рецепт добавлен в прием');
                state.recipeServingsDraft = null;
                state.recipeDetailsSource = null;
                if (state.mealSearchReturnTab) {
                    state.mealSearchTab = state.mealSearchReturnTab;
                }
                state._mealSearchRestoreNoIndicatorAnim = true;
                state._mealSearchRestoreSkipCarouselSyncOnce = true;
                if (hasUnderlyingMealSearch()) {
                    popMealOverlay();
                    patchRecipeSearchCard(recipe.id);
                } else {
                    state.mealView = 'search';
                    renderMealPage();
                }
            } catch (error) {
                console.error(error);
                showToast('Ошибка при добавлении');
            } finally {
                saveBtn.disabled = false;
            }
        };

        topBarActionBtn = saveBtn;
        BlocksaveBtn.append(saveBtn);
    } else {
        const BlocksaveBtn = createElement('div', 'block-save-btn active');
        const saveBtn = createElement('button', 'save-btn active');
        saveBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 512 512">
                <path fill="none" stroke="currentColor" stroke-linecap="square" stroke-miterlimit="10" stroke-width="44" d="M416 128L192 384l-96-96"></path>
            </svg>
        `;

        saveBtn.onclick = async () => {
            const newAmount = Number(amountInput.value || 0);

            if (!newAmount || newAmount <= 0) {
                showToast('Введите корректное количество порций');
                return;
            }

            try {
                saveBtn.disabled = true;

                const cycleRef = getCycleDocRef();
                if (cycleRef && mealDetailsId) {
                    const mealRef = doc(cycleRef, 'meals', state.selectedDate);
                    const snap = await getDoc(mealRef);
                    if (!snap.exists()) return;

                    const data = snap.data();
                    const fromItems = [...(data[mealDetailsId] || [])];
                    const existingItem = fromItems[mealItemIndex];

                    if (existingItem) {
                        const baseServings = Math.max(0.1, Number(recipe.servings || 1));
                        const factor = newAmount / baseServings;

                        const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
                        const totals = ingredients.reduce((acc, ing) => {
                            acc.protein += Number(ing.protein || 0) * factor;
                            acc.fat += Number(ing.fat || 0) * factor;
                            acc.carbs += Number(ing.carbs || 0) * factor;
                            acc.calories += Number(ing.calories || 0) * factor;
                            return acc;
                        }, { protein: 0, fat: 0, carbs: 0, calories: 0 });

                        const updatedItem = {
                            ...existingItem,
                            servings: newAmount,
                            grams: newAmount,
                            protein: totals.protein / newAmount,
                            fat: totals.fat / newAmount,
                            carbs: totals.carbs / newAmount,
                            calories: totals.calories / newAmount
                        };

                        const toMealId = selectedRecipeMealId;

                        if (!toMealId || toMealId === mealDetailsId) {
                            fromItems[mealItemIndex] = updatedItem;
                            await updateDoc(mealRef, { [mealDetailsId]: fromItems });
                        } else {
                            const toItems = [...(data[toMealId] || [])];
                            fromItems.splice(mealItemIndex, 1);
                            toItems.push(updatedItem);

                            const updatePayload = { [toMealId]: toItems };
                            if (fromItems.length) {
                                updatePayload[mealDetailsId] = fromItems;
                            } else {
                                updatePayload[mealDetailsId] = deleteField();
                            }
                            await updateDoc(mealRef, updatePayload);
                        }
                    }
                }

                const toMealId = selectedRecipeMealId;
                if (toMealId && toMealId !== mealDetailsId) {
                    showToast('Рецепт перенесён');
                } else {
                    showToast('Рецепт в приеме обновлен');
                }

                state.recipeServingsDraft = null;
                state.recipeDetailsSource = null;
                state.recipeMealSnapshot = null;
                closeMealOverlayAndShowMealMain();
            } catch (error) {
                console.error(error);
                showToast('Ошибка при сохранении');
            } finally {
                saveBtn.disabled = false;
            }
        };

        topBarActionBtn = saveBtn;
        BlocksaveBtn.append(saveBtn);
    }

    const currentValuesWrap = createElement('div', 'food-current-card');

    function getRecipeTotals(servings) {
        const baseServings = Math.max(0.1, Number(recipe.servings || 1));
        const currentServings = Math.max(0.1, Number(servings || baseServings));
        const factor = currentServings / baseServings;

        const totals = (Array.isArray(recipe.ingredients) ? recipe.ingredients : []).reduce((acc, item) => {
            acc.protein += Number(item.protein || 0) * factor;
            acc.fat += Number(item.fat || 0) * factor;
            acc.carbs += Number(item.carbs || 0) * factor;
            acc.calories += Number(item.calories || 0) * factor;
            return acc;
        }, {
            protein: 0,
            fat: 0,
            carbs: 0,
            calories: 0
        });

        const totalMacroCalories =
            (totals.protein * 4) +
            (totals.fat * 9) +
            (totals.carbs * 4);

        let proteinPercent = 0;
        let fatPercent = 0;
        let carbsPercent = 0;

        if (totalMacroCalories > 0) {
            proteinPercent = Math.round((totals.protein * 4 / totalMacroCalories) * 100);
            fatPercent = Math.round((totals.fat * 9 / totalMacroCalories) * 100);
            carbsPercent = 100 - proteinPercent - fatPercent;
        }

        return {
            servings: currentServings,
            protein: Number(totals.protein.toFixed(1)),
            fat: Number(totals.fat.toFixed(1)),
            carbs: Number(totals.carbs.toFixed(1)),
            calories: Math.round(totals.calories),
            proteinPercent,
            fatPercent,
            carbsPercent
        };
    }

    function renderCurrentValuesBlock() {
        const currentValues = getRecipeTotals(Number(amountInput.value || recipe.servings || 1));

        const circumference = 301.59;
        const carbsLen = (currentValues.carbsPercent / 100) * circumference;
        const fatLen = (currentValues.fatPercent / 100) * circumference;
        const proteinLen = (currentValues.proteinPercent / 100) * circumference;

        currentValuesWrap.innerHTML = `
            <div class="food-current-ring-block">
                <div class="food-current-ring">
                    <svg viewBox="0 0 120 120" class="food-ring-svg">
                        <circle class="food-ring-bg" cx="60" cy="60" r="48"></circle>

                        <circle
                            class="food-ring-segment food-ring-carbs"
                            cx="60"
                            cy="60"
                            r="48"
                            stroke-dasharray="${carbsLen} ${circumference}"
                            stroke-dashoffset="0"
                        ></circle>

                        <circle
                            class="food-ring-segment food-ring-fat"
                            cx="60"
                            cy="60"
                            r="48"
                            stroke-dasharray="${fatLen} ${circumference}"
                            stroke-dashoffset="-${carbsLen}"
                        ></circle>

                        <circle
                            class="food-ring-segment food-ring-protein"
                            cx="60"
                            cy="60"
                            r="48"
                            stroke-dasharray="${proteinLen} ${circumference}"
                            stroke-dashoffset="-${carbsLen + fatLen}"
                        ></circle>
                    </svg>

                    <div class="food-ring-center">
                        <div class="food-ring-kcal">${currentValues.calories}</div>
                        <div class="food-ring-label">ккал</div>
                    </div>
                </div>
            </div>

            <div class="food-current-macros">
                <div class="food-current-macro food-current-macro-carbs">
                    <div class="food-current-percent">${currentValues.carbsPercent} %</div>
                    <div class="food-current-grams">${String(currentValues.carbs).replace('.', ',')} г</div>
                    <div class="food-current-name">Углев.</div>
                </div>

                <div class="food-current-macro food-current-macro-fat">
                    <div class="food-current-percent">${currentValues.fatPercent} %</div>
                    <div class="food-current-grams">${String(currentValues.fat).replace('.', ',')} г</div>
                    <div class="food-current-name">Жиры</div>
                </div>

                <div class="food-current-macro food-current-macro-protein">
                    <div class="food-current-percent">${currentValues.proteinPercent} %</div>
                    <div class="food-current-grams">${String(currentValues.protein).replace('.', ',')} г</div>
                    <div class="food-current-name">Белки</div>
                </div>
            </div>
        `;
    }

    amountInput.addEventListener('input', () => {
        state.recipeServingsDraft = Number(amountInput.value || recipe.servings || 1);
        renderCurrentValuesBlock();
        renderPassportBlock();
    });

    if (isMealSource) {
        inlineSaveBtn.style.display = 'none';
    } else {
        inlineSaveBtn.onclick = async () => {
            const newAmount = Number(amountInput.value || 0);

            if (!newAmount || newAmount <= 0) {
                showToast('Введите корректное количество порций');
                return;
            }

            try {
                inlineSaveBtn.disabled = true;

                await updateDoc(recipeRef, {
                    servings: String(newAmount)
                });

                recipe.servings = String(newAmount);
                state.recipeServingsDraft = newAmount;
                showToast('Порции сохранены');

                renderCurrentValuesBlock();
                renderPassportBlock();
            } catch (error) {
                console.error(error);
                showToast('Ошибка при сохранении');
            } finally {
                inlineSaveBtn.disabled = false;
            }
        };
    }

    const passportBlock = createElement('div', 'food-passport-block food-passport-block--recipe');

    function renderPassportBlock() {
        const baseServings = Math.max(0.1, Number(recipe.servings || 1));
        const currentServings = Math.max(0.1, Number(amountInput.value || baseServings));
        const factor = currentServings / baseServings;

        const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];

        passportBlock.innerHTML = `
            <div class="food-passport-title food-passport-title--recipe">Состав рецепта</div>
            <div class="food-passport-divider food-passport-divider--recipe"></div>

            <div class="food-passport-portion-row food-passport-portion-row--recipe">
                <span>Порций</span>
                <span>${currentServings}</span>
            </div>

            <div class="food-passport-bar food-passport-bar--recipe"></div>

            <div class="food-passport-portion-label food-passport-portion-label--recipe">ингредиенты</div>

            <div class="food-passport-bar food-passport-bar--recipe"></div>
        `;

        ingredients.forEach((item, index) => {
            const actualWeight = Number(item.selectedAmount || parseFloat(item.amount) || item.baseAmount || 0);
            const grams = actualWeight * factor;
            const protein = Number(item.protein || 0) * factor;
            const fat = Number(item.fat || 0) * factor;
            const carbs = Number(item.carbs || 0) * factor;
            const calories = Number(item.calories || 0) * factor;

            const row = createElement('div', `food-passport-row food-passport-row--recipe ${index === ingredients.length - 1 ? 'food-passport-row-last' : ''}`);
            row.innerHTML = `
                <div class="food-passport-name food-passport-name--recipe">${item.name || 'Без названия'}</div>
                <div class="food-passport-value food-passport-value--recipe">
                    ${formatMacro(grams, 1)}${item.baseUnit || 'г'} · Б ${formatMacro(protein, 1)} · Ж ${formatMacro(fat, 1)} · У ${formatMacro(carbs, 1)} · ${Math.round(calories)} кал
                </div>
            `;
            passportBlock.append(row);
        });

        const bottomBar = createElement('div', 'food-passport-bar food-passport-bar-bottom food-passport-bar--recipe');
        passportBlock.append(bottomBar);
    }

    const amountRow = createElement('div', 'food-input-row');
    const unitRow = createElement('div', 'food-input-row');

    const plusMinusIcon = document.createElement('div');
    plusMinusIcon.className = 'food-input-icon';
    plusMinusIcon.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 256 256">
            <title>Plus-minus SVG Icon</title>
            <path fill="currentColor" d="m205.66 61.66l-144 144a8 8 0 0 1-11.32-11.32l144-144a8 8 0 0 1 11.32 11.32M64 112a8 8 0 0 0 16 0V80h32a8 8 0 0 0 0-16H80V32a8 8 0 0 0-16 0v32H32a8 8 0 0 0 0 16h32Zm160 64h-80a8 8 0 0 0 0 16h80a8 8 0 0 0 0-16"/>
        </svg>
    `;

    const listIcon = document.createElement('div');
    listIcon.className = 'food-input-icon';
    listIcon.innerHTML = `
        <svg viewBox="0 0 24 24" width="20" height="20">
            <path d="M8 6h12M8 12h12M8 18h12"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  fill="none"/>
            <circle cx="4" cy="6" r="1.5" fill="currentColor"/>
            <circle cx="4" cy="12" r="1.5" fill="currentColor"/>
            <circle cx="4" cy="18" r="1.5" fill="currentColor"/>
        </svg>
    `;

    amountRow.append(plusMinusIcon, amountInput);
    unitRow.append(listIcon, unitInput);

    let selectedRecipeMealId = mealDetailsId;

    if (isMealSource) {
        const mealRow = createElement('div', 'food-input-row');
        mealRow.style.position = 'relative';

        const mealIcon = document.createElement('div');
        mealIcon.className = 'food-input-icon';
        mealIcon.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"><title>Calendar SVG Icon</title><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 4V2m0 2v2m0-2h-4.5M3 10v9a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-9zm0 0V6a2 2 0 0 1 2-2h2m0-2v4m14 4V6a2 2 0 0 0-2-2h-.5"/></svg>
        `;

        const mealValueBtn = createElement('button', 'food-meal-select-btn');
        mealValueBtn.type = 'button';
        mealValueBtn.textContent = getMealLabelById(selectedRecipeMealId, state.mealsData || {});

        const mealDropdown = createElement('div', 'food-meal-dropdown');
        mealDropdown.style.display = 'none';

        const mealKeys = getMealKeysFromData(state.mealsData || {});
        mealKeys.forEach((mid) => {
            const option = createElement(
                'button',
                'food-meal-dropdown-item',
                getMealLabelById(mid, state.mealsData || {})
            );
            option.type = 'button';
            option.onclick = (e) => {
                e.stopPropagation();
                selectedRecipeMealId = mid;
                mealValueBtn.textContent = getMealLabelById(mid, state.mealsData || {});
                mealDropdown.style.display = 'none';
            };
            mealDropdown.append(option);
        });

        mealValueBtn.onclick = (e) => {
            e.stopPropagation();
            mealDropdown.style.display = mealDropdown.style.display === 'none' ? 'block' : 'none';
        };

        mealDropdown.onclick = (e) => { e.stopPropagation(); };
        container.onclick = () => { mealDropdown.style.display = 'none'; };

        mealRow.append(mealIcon, mealValueBtn, mealDropdown);
        topBlockCreateFood.append(amountRow, unitRow, mealRow);
    } else {
        topBlockCreateFood.append(amountRow, unitRow, inlineSaveBtn);
    }

    renderCurrentValuesBlock();
    renderPassportBlock();

    container.append(
        stickyHeader,
        ...(titleDesc ? [titleDesc] : []),
        topBlockCreateFood,
        currentValuesWrap,
        passportBlock
    );

    if (isMealSource) {
        const deleteMealRecipeBtn = createElement('button', 'edit-meal-search-main-action meal-recipe-delete-action');
        deleteMealRecipeBtn.type = 'button';
        deleteMealRecipeBtn.innerHTML = `
            <span class="btn-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24">
                    <path fill="currentColor" d="M16 1.75V3h5.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H8V1.75C8 .784 8.784 0 9.75 0h4.5C15.216 0 16 .784 16 1.75m-6.5 0V3h5V1.75a.25.25 0 0 0-.25-.25h-4.5a.25.25 0 0 0-.25.25M4.997 6.178a.75.75 0 1 0-1.493.144L4.916 20.92a1.75 1.75 0 0 0 1.742 1.58h10.684a1.75 1.75 0 0 0 1.742-1.581l1.413-14.597a.75.75 0 0 0-1.494-.144l-1.412 14.596a.25.25 0 0 1-.249.226H6.658a.25.25 0 0 1-.249-.226z"></path>
                    <path fill="currentColor" d="M9.206 7.501a.75.75 0 0 1 .793.705l.5 8.5A.75.75 0 1 1 9 16.794l-.5-8.5a.75.75 0 0 1 .705-.793Zm6.293.793A.75.75 0 1 0 14 8.206l-.5 8.5a.75.75 0 0 0 1.498.088l.5-8.5Z"></path>
                </svg>
            </span>
            <span class="btn-text">Удалить из приема</span>
        `;

        deleteMealRecipeBtn.onclick = () => {
            openConfirmModal(`Удалить рецепт «${recipe?.title || 'Без названия'}» из приема?`, async () => {
                const cycleRef = getCycleDocRef();
                if (!cycleRef) return;

                const mealRef = doc(cycleRef, 'meals', state.selectedDate);
                const mealItems = Array.isArray(state.mealsData?.[mealDetailsId])
                    ? [...state.mealsData[mealDetailsId]]
                    : [];

                mealItems.splice(mealItemIndex, 1);

                if (mealItems.length) {
                    await updateDoc(mealRef, { [mealDetailsId]: mealItems });
                } else {
                    await updateDoc(mealRef, { [mealDetailsId]: deleteField() });
                    await cleanupEmptyMealsDoc(mealRef);
                }

                showToast('Рецепт удалён из приема');
                state.recipeServingsDraft = null;
                state.recipeDetailsSource = null;
                state.recipeMealSnapshot = null;
                closeMealOverlayAndShowMealMain();
            });
        };

        const actionsBlock = createElement('div', 'food-details-actions-block food-details-actions-block--meal-recipe-delete');
        actionsBlock.append(deleteMealRecipeBtn);
        container.append(actionsBlock);
    } else {
        const editBtn = createElement('button', 'edit-meal-search-main-action recipe-details-action-edit');
        editBtn.type = 'button';
        editBtn.innerHTML = `
            <span class="btn-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24">
                    <path fill="currentColor" d="M3.548 20.938h16.9a.5.5 0 0 0 0-1h-16.9a.5.5 0 0 0 0 1M9.71 17.18a2.587 2.587 0 0 0 1.12-.65l9.54-9.54a1.75 1.75 0 0 0 0-2.47l-.94-.93a1.788 1.788 0 0 0-2.47 0l-9.54 9.53a2.473 2.473 0 0 0-.64 1.12L6.04 17a.737.737 0 0 0 .19.72a.767.767 0 0 0 .53.22Zm.41-1.36a1.468 1.468 0 0 1-.67.39l-.97.26l-1-1l.26-.97a1.521 1.521 0 0 1 .39-.67l.38-.37l1.99 1.99Zm1.09-1.08l-1.99-1.99l6.73-6.73l1.99 1.99Zm8.45-8.45L18.65 7.3l-1.99-1.99l1.01-1.02a.748.748 0 0 1 1.06 0l.93.94a.754.754 0 0 1 0 1.06"></path>
                </svg>
            </span>
            <span class="btn-text">Изменить рецепт</span>
        `;

        editBtn.onclick = () => {
            state.recipeServingsDraft = null;
            state.recipeDetailsSource = null;
            state.mealView = 'editRecipe';
            renderMealPage();
        };

        const deleteRecipeBtn = createElement('button', 'edit-meal-search-main-action recipe-details-action-delete');
        deleteRecipeBtn.type = 'button';
        deleteRecipeBtn.innerHTML = `
            <span class="btn-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24">
                    <path fill="currentColor" d="M16 1.75V3h5.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H8V1.75C8 .784 8.784 0 9.75 0h4.5C15.216 0 16 .784 16 1.75m-6.5 0V3h5V1.75a.25.25 0 0 0-.25-.25h-4.5a.25.25 0 0 0-.25.25M4.997 6.178a.75.75 0 1 0-1.493.144L4.916 20.92a1.75 1.75 0 0 0 1.742 1.58h10.684a1.75 1.75 0 0 0 1.742-1.581l1.413-14.597a.75.75 0 0 0-1.494-.144l-1.412 14.596a.25.25 0 0 1-.249.226H6.658a.25.25 0 0 1-.249-.226z"></path>
                    <path fill="currentColor" d="M9.206 7.501a.75.75 0 0 1 .793.705l.5 8.5A.75.75 0 1 1 9 16.794l-.5-8.5a.75.75 0 0 1 .705-.793Zm6.293.793A.75.75 0 1 0 14 8.206l-.5 8.5a.75.75 0 0 0 1.498.088l.5-8.5Z"></path>
                </svg>
            </span>
            <span class="btn-text">Удалить рецепт</span>
        `;

        deleteRecipeBtn.onclick = () => {
            openConfirmModal(`Удалить рецепт «${recipe?.title || 'Без названия'}»?`, async () => {
                const deletedRecipeId = recipe.id;
                await deleteRecipe(deletedRecipeId);
                showToast('Рецепт удалён');
                state.recipeServingsDraft = null;
                state.recipeDetailsSource = null;
                if (hasUnderlyingMealSearch()) {
                    popMealOverlay();
                    removeRecipeCardFromSearchDOM(deletedRecipeId);
                } else {
                    state.mealView = 'search';
                    renderMealSearch();
                }
            });
        };

        const actionsBlock = createElement('div', 'food-details-actions-block food-details-actions-block--recipe-search');
        actionsBlock.append(deleteRecipeBtn, editBtn);
        container.append(actionsBlock);
    }

    attachMealOverlayBottomNavSync(container, syncRecipeDetailsBottomNav);
    pushMealOverlay(container);

    requestAnimationFrame(() => {
        setupCreateFoodStickyTitleBorder({
            titleEl: title,
            watchEl: titleDesc || topBlockCreateFood
        });
    });
}




// ========= ФУНКЦИЯ СТРАНИЦЫ Meal КНОПКА PDF
export function openMealsPdfModal(cycle) {
    openMealsExportModal(cycle); // ✅ теперь открывается выбор периода
}
// ========= МОДАЛКА ЭКСПОРТА
export function openMealsExportModal(cycle) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay active';
    overlay.style.backdropFilter = 'blur(4px)';

    const modal = document.createElement('div');
    modal.className = 'modal-content';
    modal.style.maxWidth = '520px';
    modal.style.width = '92%';
    modal.style.borderRadius = '20px';
    modal.style.padding = '20px';



    let selectedMode = null;

    const title = createElement('h3', null, 'Экспорт отчёта');
    title.style.marginBottom = '18px';
    title.style.textAlign = 'center';

    const subtitle = createElement('div', 'muted', 'Выберите день или период');
    subtitle.style.textAlign = 'center';
    subtitle.style.marginBottom = '18px';
    subtitle.style.fontSize = '14px';

    // ===== helpers =====
    function formatDisplayDate(dateStr) {
        if (!dateStr) return 'Выбрать';
        const [y, m, d] = dateStr.split('-');
        return `${d}.${m}.${y}`;
    }

    function activateRow(activeRow, inactiveRow) {
        [activeRow, inactiveRow].forEach(row => {
            row.style.border = '1px solid #d9d9d9';
            row.style.background = '#fff';
            row.style.boxShadow = 'none';
        });

        activeRow.style.border = '1px solid #7c5cff';
        activeRow.style.background = '#f7f4ff';

    }

    function makePickerRow(labelText) {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.justifyContent = 'space-between';
        row.style.gap = '12px';
        row.style.padding = '14px 16px';
        row.style.border = '1px solid #d9d9d9';
        row.style.borderRadius = '16px';
        row.style.background = '#fff';
        row.style.marginBottom = '14px';
        row.style.transition = '0.18s ease';

        const label = document.createElement('div');
        label.textContent = labelText;
        label.style.fontSize = '15px';
        label.style.fontWeight = '600';
        label.style.color = '#222';

        const right = document.createElement('div');
        right.style.display = 'flex';
        right.style.alignItems = 'center';
        right.style.gap = '8px';

        row.append(label, right);

        return { row, label, right };
    }

function makeFancyDateButton(initialValue = '') {
    const wrap = document.createElement('div');
    wrap.style.position = 'relative';

    const hiddenInput = document.createElement('input');
    hiddenInput.type = 'date';
    hiddenInput.value = initialValue || '';
    hiddenInput.style.position = 'absolute';
    hiddenInput.style.opacity = '0';
    hiddenInput.style.pointerEvents = 'none';
    hiddenInput.style.width = '1px';
    hiddenInput.style.height = '1px';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.style.display = 'inline-flex';
    btn.style.alignItems = 'center';
    btn.style.gap = '8px';
    btn.style.padding = '10px 12px';
    btn.style.border = '1px solid #d6d6d6';
    btn.style.borderRadius = '12px';
    btn.style.background = '#fff';
    btn.style.cursor = 'pointer';
    btn.style.fontSize = '14px';
    btn.style.fontWeight = '600';
    btn.style.color = initialValue ? '#222' : '#777';
    btn.style.minWidth = '128px';
    btn.style.justifyContent = 'space-between';

    const text = document.createElement('span');
    const icon = document.createElement('span');
    icon.textContent = '📅';

    function formatDisplayDate(dateStr) {
        if (!dateStr) return 'Выбрать';
        const [y, m, d] = dateStr.split('-');
        return `${d}.${m}.${y}`;
    }

    function setValue(v) {
        hiddenInput.value = v || '';
        text.textContent = formatDisplayDate(v);
        btn.style.color = v ? '#222' : '#777';
    }

    setValue(initialValue);

    function openPickerDirectly() {
        try {
            if (typeof hiddenInput.showPicker === 'function') {
                hiddenInput.showPicker();
            } else {
                hiddenInput.focus();
                hiddenInput.click();
            }
        } catch {
            hiddenInput.focus();
            hiddenInput.click();
        }
    }

    btn.onclick = (e) => {
        e.stopPropagation();
        openPickerDirectly();
    };

    // 🔥 ВАЖНО: после выбора даты обновляем красивое поле
    hiddenInput.addEventListener('change', () => {
        setValue(hiddenInput.value);
    });

    btn.append(text, icon);
    wrap.append(btn, hiddenInput);

    return {
        wrap,
        input: hiddenInput,
        button: btn,
        setValue,
        getValue: () => hiddenInput.value,
        openPickerDirectly
    };
}

function makeFancyDateButtonModal(initialValue = '', onChange = null) {
    const wrap = document.createElement('div');
    let currentValue = initialValue || '';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.style.display = 'inline-flex';
    btn.style.alignItems = 'center';
    btn.style.gap = '8px';
    btn.style.padding = '10px 12px';
    btn.style.border = '1px solid #d6d6d6';
    btn.style.borderRadius = '12px';
    btn.style.background = '#fff';
    btn.style.cursor = 'pointer';
    btn.style.fontSize = '14px';
    btn.style.fontWeight = '600';
    btn.style.color = initialValue ? '#222' : '#777';
    btn.style.minWidth = '128px';
    btn.style.justifyContent = 'space-between';

    const text = document.createElement('span');
    const icon = document.createElement('span');
    icon.textContent = '📅';

    function formatDisplayDateValue(dateStr) {
        if (!dateStr) return 'Выбрать';
        const [y, m, d] = dateStr.split('-');
        return `${d}.${m}.${y}`;
    }

    function setValue(value) {
        currentValue = value || '';
        text.textContent = formatDisplayDateValue(currentValue);
        btn.style.color = currentValue ? '#222' : '#777';
    }

    function openPickerDirectly() {
        const now = new Date();
        const fallbackValue = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        openDateModal(currentValue || fallbackValue, (nextValue) => {
            if (!nextValue) return;
            setValue(nextValue);
            if (typeof onChange === 'function') {
                onChange(nextValue);
            }
        });
    }

    btn.onclick = (e) => {
        e.stopPropagation();
        openPickerDirectly();
    };

    setValue(initialValue);
    btn.append(text, icon);
    wrap.append(btn);

    return {
        wrap,
        button: btn,
        setValue,
        getValue: () => currentValue,
        openPickerDirectly
    };
}

    // ===== row: day =====
    const dayRowObj = makePickerRow('За день');
    const dayPicker = makeFancyDateButtonModal(state.selectedDate || '', () => {
        selectedMode = 'day';
        startPicker.setValue('');
        endPicker.setValue('');
        activateRow(dayRowObj.row, rangeRowObj.row);
    });

    dayRowObj.right.append(dayPicker.wrap);

    // ===== row: range =====
    const rangeRowObj = makePickerRow('Период');
    function handleRangeChange() {
        selectedMode = 'range';
        dayPicker.setValue('');
        activateRow(rangeRowObj.row, dayRowObj.row);
    }

    const startPicker = makeFancyDateButtonModal('', handleRangeChange);
    const endPicker = makeFancyDateButtonModal('', handleRangeChange);

    const dash = document.createElement('span');
    dash.textContent = '—';
    dash.style.color = '#666';
    dash.style.fontWeight = '700';

    rangeRowObj.right.append(startPicker.wrap, dash, endPicker.wrap);

    // ===== interactions =====

        dayRowObj.row.onclick = (e) => {
            if (e.target.closest('button')) return;
            dayPicker.openPickerDirectly();
        };

        rangeRowObj.row.onclick = (e) => {
            if (e.target.closest('button')) return;
            if (!startPicker.getValue()) {
                startPicker.openPickerDirectly();
                return;
            }
            endPicker.openPickerDirectly();
        };

    // ===== buttons =====
    const controls = document.createElement('div');
    controls.style.display = 'flex';
    controls.style.justifyContent = 'flex-end';
    controls.style.gap = '10px';
    controls.style.marginTop = '18px';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn btn-secondary';
    cancelBtn.textContent = 'Отмена';
    cancelBtn.onclick = () => overlay.remove();

    const okBtn = document.createElement('button');
    okBtn.className = 'btn btn-primary';
    okBtn.textContent = 'ОК';

    okBtn.onclick = async () => {
        const dayValue = dayPicker.getValue();
        const startValue = startPicker.getValue();
        const endValue = endPicker.getValue();

        if (dayValue) {
            await generateMealsPdf(cycle, dayValue);
            overlay.remove();
            return;
        }

        if (startValue && endValue) {
            const html = await generateMealsPdfRange(cycle, startValue, endValue);
            state.reportHtmlCache = html;
            state.currentPage = 'mealsReport';
            render();
            overlay.remove();
            return;
        }

        alert('Выберите период');
    };

    controls.append(cancelBtn, okBtn);

    modal.append(
        title,
        subtitle,
        dayRowObj.row,
        rangeRowObj.row,
        controls
    );

    overlay.append(modal);
    document.body.append(overlay);

    // если уже есть выбранный день — подсветим
    if (dayPicker.getValue()) {
        selectedMode = 'day';
        activateRow(dayRowObj.row, rangeRowObj.row);
    }

    // закрытие по клику вне окна
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.remove();
    });

    // одноразово добавим анимацию
    if (!document.getElementById('meals-export-modal-anim-style')) {
        const style = document.createElement('style');
        style.id = 'meals-export-modal-anim-style';
        style.textContent = `
            @keyframes fadeInScale {
                from {
                    opacity: 0;
                    transform: translateY(8px) scale(0.98);
                }
                to {
                    opacity: 1;
                    transform: translateY(0) scale(1);
                }
            }
        `;
        document.head.appendChild(style);
    }
}


// ========= Добавь helper для диапазона дат

function formatPdfDate(dateStr) {
    const [year, month, day] = dateStr.split('-');
    return `${day}.${month}.${year}`;
}








// ========= ФУНКЦИИ ДЛЯ НЕДЕЛИ И ПЕРИОДА


function getDatesBetween(startDate, endDate) {
    const dates = [];

    const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
    const [endYear, endMonth, endDay] = endDate.split('-').map(Number);

    const current = new Date(startYear, startMonth - 1, startDay);
    const end = new Date(endYear, endMonth - 1, endDay);

    while (current <= end) {
        const y = current.getFullYear();
        const m = String(current.getMonth() + 1).padStart(2, '0');
        const d = String(current.getDate()).padStart(2, '0');

        dates.push(`${y}-${m}-${d}`);

        current.setDate(current.getDate() + 1);
    }

    return dates;
}

async function generateMealsPdfRange(cycle, start, end) {
    const foodsMap = await getFoodsMap();
    const dates = getDatesBetween(start, end);

    let bodyHtml = '';

    for (const date of dates) {
        const meals = await getMealsByDate(date);

        bodyHtml += buildOneDayReportBlock(date, meals || {}, foodsMap);
    }

    const fullHtml = buildFatSecretLikeHtml({
        titleCenter: `${formatDateShort(start)} — ${formatDateShort(end)}`,
        bodyHtml
    });

    return fullHtml;
}
// ========= helper-функции

function formatReportDateHeader(dateStr) {
    const date = new Date(dateStr);
    const days = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
    const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

    return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

function formatShortWeight(item, food) {
    const grams = Number(item.grams || 0);
    const unit = food?.baseUnit || 'г';
    return `${grams} ${unit}`;
}

function buildMealRows(items, foodsMap) {
    let rowsHtml = '';
    let mealP = 0;
    let mealF = 0;
    let mealC = 0;
    let mealK = 0;

    items.forEach(item => {
        const snapshotFood = {
            name: item.name,
            baseAmount: Number(item.baseAmount),
            baseUnit: item.baseUnit,
            protein: Number(item.protein),
            fat: Number(item.fat),
            carbs: Number(item.carbs),
            calories: Number(item.calories)
        };

        const fallbackFood = foodsMap[item.foodId];

        const food = (
            snapshotFood.name &&
            Number.isFinite(snapshotFood.baseAmount) &&
            snapshotFood.baseUnit
        ) ? snapshotFood : fallbackFood;

        if (!food) return;

        const grams = Number(item.grams || 0);
        const baseAmount = Number(food.baseAmount || 100) || 100;
        const factor = grams / baseAmount;

        const p = (Number(food.protein) || 0) * factor;
        const f = (Number(food.fat) || 0) * factor;
        const c = (Number(food.carbs) || 0) * factor;
        const k = (Number(food.calories) || 0) * factor;

        mealP += p;
        mealF += f;
        mealC += c;
        mealK += k;

        rowsHtml += `
            <tr class="food-row">
                <td class="food-name-cell">
                    <div class="food-name">${food.name || '—'}</div>
                    <div class="food-weight">${formatShortWeight(item, food)}</div>
                </td>
                <td>${p.toFixed(2)}</td>
                <td>${f.toFixed(2)}</td>
                <td>${c.toFixed(2)}</td>
                <td>${Math.round(k)}</td>
            </tr>
        `;
    });

    return {
        rowsHtml,
        mealP,
        mealF,
        mealC,
        mealK
    };
}

function buildOneDayReportBlock(dateStr, meals, foodsMap) {
    const mealOrder = getMealKeysFromData(meals).map((id, index) => ({
        id,
        name: `Прием ${index + 1}`
    }));

    let totalP = 0;
    let totalF = 0;
    let totalC = 0;
    let totalK = 0;

    let contentHtml = `
        <div class="report-day-block">
            <div class="report-day-title">${formatReportDateHeader(dateStr)}</div>

            <table class="fatsecret-like-table">
                <thead>
                    <tr>
                        <th class="first-col"></th>
                        <th>Белк<br><span>(г)</span></th>
                        <th>Жир<br><span>(г)</span></th>
                        <th>Углев<br><span>(г)</span></th>
                        <th>Кал<br><span>(ккал)</span></th>
                    </tr>
                </thead>
                <tbody>
    `;

    mealOrder.forEach(meal => {
        const items = meals[meal.id] || [];
        const { rowsHtml, mealP, mealF, mealC, mealK } = buildMealRows(items, foodsMap);

        totalP += mealP;
        totalF += mealF;
        totalC += mealC;
        totalK += mealK;

        contentHtml += `
            <tr class="meal-section-row">
                <td class="meal-section-title">${meal.name}</td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
            </tr>
        `;

        contentHtml += rowsHtml;

        contentHtml += `
            <tr class="meal-total-row">
                <td class="food-name-cell total-label">Всего</td>
                <td>${mealP.toFixed(2)}</td>
                <td>${mealF.toFixed(2)}</td>
                <td>${mealC.toFixed(2)}</td>
                <td>${Math.round(mealK)}</td>
            </tr>
        `;
    });

    contentHtml += `
                <tr class="grand-total-row">
                    <td class="food-name-cell total-label">Всего</td>
                    <td>${totalP.toFixed(2)}</td>
                    <td>${totalF.toFixed(2)}</td>
                    <td>${totalC.toFixed(2)}</td>
                    <td>${Math.round(totalK)}</td>
                </tr>
                </tbody>
            </table>
        </div>
    `;

    return contentHtml;
}
// ========= форматирования даты
function formatDateShort(dateStr) {
    const [year, month, day] = dateStr.split('-');
    return `${day}.${month}.${year}`;
}

function buildFatSecretLikeHtml({ titleCenter, bodyHtml }) {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Food Diary Report</title>
            <style>

                .report-page {
                    width: 100%;
                    margin: 14px auto;
                    background: #efefef;
                    border: 1px solid #cfcfcf;
                    box-shadow: 0 1px 6px rgba(0, 0, 0, 0.08);
                    padding: 10px 0 0px;
                }

                .top-header {
                    display: flex;
                    align-items: center;
                    font-size: 15px;
                    font-weight: 600;
                    color: #222;
                    margin-bottom: 8px;
                    padding-left: 10px;
                }



                .top-header .center {
                text-align: center;
                font-weight: 600;
                }

                .top-header .right {
                text-align: right;
                font-weight: 600;
                }

                .top-header .left {
                text-align: left;
                }

                .report-day-block {
                margin-bottom: 13px;
                }

                .report-day-title {
                background: #303030;
                color: #fff;
                font-size: 12px;
                padding: 10px 12px;
                margin-bottom: 0;
                }

                .fatsecret-like-table {
                width: 100%;
                border-collapse: collapse;
                background: transparent;
                }

                .fatsecret-like-table thead tr {
                background: #c8c8c8;
                }

                .fatsecret-like-table th {
                padding: 8px 8px 8px;
                text-align: center;
                font-size: 13px;
                font-weight: 700;
                color: #222;
                border: none;
                }

                .fatsecret-like-table th span {
                display: inline-block;
                font-size: 12px;
                font-weight: 600;
                color: #444;
                margin-top: 2px;
                }

                .fatsecret-like-table th.first-col {
                width: 240px;
                text-align: left;
                }

                .fatsecret-like-table td {
                border: none;
                padding: 4px 8px;
                font-size: 13px;
                text-align: center;
                vertical-align: top;
                }

                .food-name-cell {
                text-align: left !important;
                width: 240px;
                }

                .meal-section-row td {
                padding-top: 13px;
                padding-bottom: 4px;
                }

                .meal-section-title {
                font-size: 17px;
                font-weight: 700;
                color: #222;
                text-align: left !important;
                }

                .food-row .food-name {
                font-size: 13px;
                font-weight: 500;
                color: #222;
                line-height: 1.2;
                }

                .food-row .food-weight {
                font-size: 12px;
                color: #777;
                margin-top: 2px;
                }

                tr.meal-total-row {
                    background: #e3e3e3;
                }
                .meal-total-row td {
                font-weight: 500;
                color: #666;
                padding-top: 7px;
                padding-bottom: 8px;
                }

                .grand-total-row td {
                background: #303030;
                color: #fff;
                padding-top: 5px;
                padding-bottom: 5px;
                }

                .total-label {
                    font-weight: 700;
                }

                @media print {
                    body {
                        background: #fff;
                    }

                    .report-page {
                        width: auto;
                        margin: 0;
                        border: none;
                        box-shadow: none;
                        padding: 0;
                        background: #fff;
                    }

                    .report-day-block {
                        page-break-inside: avoid;
                    }
                }
            </style>
        </head>
        <body>
            <div class="report-page">
                <div class="top-header">

                    <div class="center">${titleCenter}</div>
                </div>

                ${bodyHtml}
            </div>
        </body>
        </html>
    `;
}

// ========= страницу просмотра
export function renderMealsReportPage(htmlContent) {
    const root = document.getElementById('root');
    root.innerHTML = '';

    const container = document.createElement('div');

    // 🔙 кнопка назад
    const backBtn = document.createElement('button');
    backBtn.className = 'btn';
    backBtn.textContent = '← Назад к еде';
    backBtn.onclick = () => {
        state.currentPage = 'meal';
        render();
    };

    // 🖨️ кнопка печати
    const printBtn = document.createElement('button');
    printBtn.className = 'btn btn-primary';
    printBtn.textContent = '🖨️ Печать / PDF';
    printBtn.onclick = () => {
        const w = window.open('', '_blank');
        w.document.write(htmlContent);
        w.document.close();
        w.print();
    };

    const header = document.createElement('div');
    header.append(backBtn, printBtn);

    const content = document.createElement('div');
    content.innerHTML = htmlContent;

    container.append(header, content);
    root.append(container);

    document.querySelector('.navigation').style.display = 'none';
}


async function getMealsByDate(date) {
    const cycleRef = getCycleDocRef();
    if (!cycleRef) return {};

    const mealRef = doc(cycleRef, 'meals', date);

    const snap = await getDoc(mealRef);
    return snap.exists() ? snap.data() : {};
}


// ========= сохраняем HTML и идем на страницу
export async function generateMealsPdf(cycle, date) {
    const meals = await getMealsByDate(date);
    const foodsMap = await getFoodsMap();

    const dayBlock = buildOneDayReportBlock(date, meals, foodsMap);

    const fullHtml = buildFatSecretLikeHtml({
        titleCenter: formatDateShort(date),
        bodyHtml: dayBlock
    });

    state.reportHtmlCache = fullHtml;
    state.currentPage = 'mealsReport';
    render();
}
// =================================================================
// ❌ УДАЛЕНИЕ
// =================================================================
async function cleanupEmptyMealsDoc(mealRef) {
    if (!mealRef) return;
    const snap = await getDoc(mealRef);
    if (!snap.exists()) return;

    const data = snap.data() || {};
    const mealKeys = Object.keys(data).filter(k => /^meal\d+$/.test(k));
    const updates = {};

    let hasAnyNonEmptyMeal = false;
    for (const k of mealKeys) {
        const arr = data[k];
        if (Array.isArray(arr) && arr.length > 0) {
            hasAnyNonEmptyMeal = true;
        } else {
            // Если приём пустой — удаляем поле, чтобы не оставались "следы".
            updates[k] = deleteField();
        }
    }

    // Если были пустые поля приёмов — подчистим их.
    if (Object.keys(updates).length) {
        await updateDoc(mealRef, updates);
    }

    // Если после чистки в документе не остаётся ни одного приёма с едой — удаляем документ дня целиком.
    if (!hasAnyNonEmptyMeal) {
        await deleteDoc(mealRef);
    }
}

async function removeFoodFromMeal(mealId, index){

    const cycleRef = getCycleDocRef();
    const mealRef = doc(cycleRef, 'meals', state.selectedDate);

    const snap = await getDoc(mealRef);
    const data = snap.data();

    const updated = [...(data[mealId] || [])];
    const removed = updated[index];
    if (removed && isMealPhotoItem(removed)) {
        await deleteUserFirebaseStorageFileByDownloadUrl(removed.photoUrl);
    }
    updated.splice(index, 1);

    if (updated.length) {
        await updateDoc(mealRef, { [mealId]: updated });
    } else {
        await updateDoc(mealRef, { [mealId]: deleteField() });
        await cleanupEmptyMealsDoc(mealRef);
    }
}


async function updateFoodInMeal(mealId, itemIndex, newAmount) {
    const cycleRef = getCycleDocRef();
    const mealRef = doc(cycleRef, 'meals', state.selectedDate);

    const snap = await getDoc(mealRef);
    if (!snap.exists()) return;

    const data = snap.data();
    const items = [...(data[mealId] || [])];

    if (!items[itemIndex]) return;

    items[itemIndex] = {
        ...items[itemIndex],
        grams: Number(newAmount || 0)
    };

    await updateDoc(mealRef, {
        [mealId]: items
    });
}


async function updateOrMoveFoodInMeal(fromMealId, itemIndex, newAmount, toMealId) {
    const cycleRef = getCycleDocRef();
    const mealRef = doc(cycleRef, 'meals', state.selectedDate);

    const snap = await getDoc(mealRef);
    if (!snap.exists()) return;

    const data = snap.data();

    const fromItems = [...(data[fromMealId] || [])];
    const item = fromItems[itemIndex];
    if (!item) return;

    const updatedItem = {
        ...item,
        grams: Number(newAmount || 0)
    };

    if (!toMealId || toMealId === fromMealId) {
        fromItems[itemIndex] = updatedItem;

        await updateDoc(mealRef, {
            [fromMealId]: fromItems
        });
        return;
    }

    const toItems = [...(data[toMealId] || [])];

    fromItems.splice(itemIndex, 1);
    toItems.push(updatedItem);

    await updateDoc(mealRef, {
        [fromMealId]: fromItems,
        [toMealId]: toItems
    });
}
// =================================================================
// 🔍 ПОИСК
// =================================================================
function getMealSearchOptions() {
    const keys = getMealKeysForRender();

    return keys.map((id, index) => ({
        id,
        label: `приём ${index + 1}`
    }));
}

function getMealSearchCurrentLabel() {
    const options = getMealSearchOptions();

    if (!options.length) return 'приём 1';

    const exists = options.some(opt => opt.id === state.currentMealId);
    if (!exists) {
        state.currentMealId = options[0].id;
        return options[0].label;
    }

    return options.find(opt => opt.id === state.currentMealId)?.label || options[0].label;
}


function getMealLabelById(mealId, mealsData = {}) {
    const mealKeys = getMealKeysFromData(mealsData);
    const index = mealKeys.indexOf(mealId);

    if (index === -1) return mealId || 'Прием';
    return `Прием ${index + 1}`;
}


function initMealSearchAutoHide(scrollEl, stickyEl, onBeforeHide) {
    let lastScrollTop = 0;
    let ticking = false;

    function handle() {
        if (ticking) return;
        ticking = true;

        requestAnimationFrame(() => {
            const st = scrollEl.scrollTop;
            const delta = st - lastScrollTop;

            if (st <= 16) {
                stickyEl.classList.remove('is-hidden');
                lastScrollTop = st;
                ticking = false;
                return;
            }

            if (delta > 8) {
                if (onBeforeHide) onBeforeHide();
                stickyEl.classList.add('is-hidden');
            } else if (delta < -8) {
                stickyEl.classList.remove('is-hidden');
            }

            lastScrollTop = st;
            ticking = false;
        });
    }

    scrollEl.addEventListener('scroll', handle, { passive: true });

    return () => {
        scrollEl.removeEventListener('scroll', handle);
    };
}

// ================ состояние сортировки

function ensureMealSearchSortState() {
    // restore persisted sort choices (per tab)
    try {
        if (!state.mealSearchSortByTab || typeof state.mealSearchSortByTab !== 'object') {
            const raw = localStorage.getItem('mealSearchSortByTab:v1');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') {
                    state.mealSearchSortByTab = parsed;
                }
            }
        }
    } catch (_) {}

    const defaults = {
        all: 'recentlyUsed',
        products: 'new',
        recipes: 'new'
    };

    if (!state.mealSearchSortByTab || typeof state.mealSearchSortByTab !== 'object') {
        state.mealSearchSortByTab = { ...defaults };
        return;
    }

    state.mealSearchSortByTab = {
        all: state.mealSearchSortByTab.all || defaults.all,
        products: state.mealSearchSortByTab.products || defaults.products,
        recipes: state.mealSearchSortByTab.recipes || defaults.recipes
    };
}

function getMealSearchCurrentSort() {
    ensureMealSearchSortState();
    const tab = state.mealSearchTab || 'all';
    return state.mealSearchSortByTab[tab];
}

function getMealSearchSortForTab(tabKey = state.mealSearchTab || 'all') {
    ensureMealSearchSortState();
    const tab = tabKey || 'all';
    return state.mealSearchSortByTab[tab];
}

function setMealSearchCurrentSort(sortId, tabKey = state.mealSearchTab || 'all') {
    ensureMealSearchSortState();
    const tab = tabKey || 'all';
    state.mealSearchSortByTab[tab] = sortId;
    try {
        localStorage.setItem('mealSearchSortByTab:v1', JSON.stringify(state.mealSearchSortByTab));
    } catch (_) {}
}

function getMealSearchSortOptionsByTab(tab = state.mealSearchTab || 'all') {
    if (tab === 'all') {
        return [
            { id: 'recentlyUsed', label: 'Недавно употребляемые' },
            { id: 'mostUsed', label: 'Наиболее употребляемые' }
        ];
    }

    if (tab === 'products' || tab === 'recipes') {
        return [
            { id: 'new', label: 'Новые' },
            { id: 'popular', label: 'Популярные' },
            { id: 'az', label: 'По алфавиту А–Я' },
            { id: 'za', label: 'По алфавиту Я–А' }
        ];
    }

    return [];
}

function getMealSearchSectionTitle() {
    if (state.mealSearchTab === 'products') return 'мои продукты';
    if (state.mealSearchTab === 'recipes') return 'мои рецепты';
    return 'История';
}

function getMealSearchSortLabel() {
    const currentSort = getMealSearchCurrentSort();
    const options = getMealSearchSortOptionsByTab();
    return options.find(opt => opt.id === currentSort)?.label || 'Сортировка';
}

function sortFoodsForMealSearch(foods = [], opts = null) {
    const list = [...foods];
    const tab = (opts && opts.tab) ? opts.tab : (state.mealSearchTab || 'all');
    const sort = (opts && opts.sort) ? opts.sort : getMealSearchSortForTab(tab);

    if (tab === 'all') {
        if (sort === 'mostUsed') {
            return list.sort((a, b) => {
                const countDiff = Number(b.usageCount || 0) - Number(a.usageCount || 0);
                if (countDiff !== 0) return countDiff;

                const recentDiff = Number(b.lastUsedAt || 0) - Number(a.lastUsedAt || 0);
                if (recentDiff !== 0) return recentDiff;

                return String(a.name || '').localeCompare(String(b.name || ''), 'ru');
            });
        }

        return list.sort((a, b) => {
            const recentDiff = Number(b.lastUsedAt || 0) - Number(a.lastUsedAt || 0);
            if (recentDiff !== 0) return recentDiff;

            const createdDiff = Number(b.createdAt || 0) - Number(a.createdAt || 0);
            if (createdDiff !== 0) return createdDiff;

            return String(a.name || '').localeCompare(String(b.name || ''), 'ru');
        });
    }

    if (sort === 'popular') {
        return list.sort((a, b) => {
            const countDiff = Number(b.usageCount || 0) - Number(a.usageCount || 0);
            if (countDiff !== 0) return countDiff;

            const recentDiff = Number(b.lastUsedAt || 0) - Number(a.lastUsedAt || 0);
            if (recentDiff !== 0) return recentDiff;

            return String(a.name || '').localeCompare(String(b.name || ''), 'ru');
        });
    }

    if (sort === 'az') {
        return list.sort((a, b) =>
            String(a.name || '').localeCompare(String(b.name || ''), 'ru')
        );
    }

    if (sort === 'za') {
        return list.sort((a, b) =>
            String(b.name || '').localeCompare(String(a.name || ''), 'ru')
        );
    }

    // new
    return list.sort((a, b) => {
        const createdDiff = Number(b.createdAt || 0) - Number(a.createdAt || 0);
        if (createdDiff !== 0) return createdDiff;

        return String(a.name || '').localeCompare(String(b.name || ''), 'ru');
    });
}

function sortRecipesForMealSearch(recipes = [], opts = null) {
    const list = [...recipes];
    const tab = (opts && opts.tab) ? opts.tab : (state.mealSearchTab || 'all');
    const sort = (opts && opts.sort) ? opts.sort : getMealSearchSortForTab(tab);

    if (tab === 'all') {
        if (sort === 'mostUsed') {
            return list.sort((a, b) => {
                const countDiff = Number(b.usageCount || 0) - Number(a.usageCount || 0);
                if (countDiff !== 0) return countDiff;

                const recentDiff = Number(b.lastUsedAt || 0) - Number(a.lastUsedAt || 0);
                if (recentDiff !== 0) return recentDiff;

                return String(a.title || '').localeCompare(String(b.title || ''), 'ru');
            });
        }

        return list.sort((a, b) => {
            const recentDiff = Number(b.lastUsedAt || 0) - Number(a.lastUsedAt || 0);
            if (recentDiff !== 0) return recentDiff;

            const createdDiff = Number(b.createdAt || 0) - Number(a.createdAt || 0);
            if (createdDiff !== 0) return createdDiff;

            return String(a.title || '').localeCompare(String(b.title || ''), 'ru');
        });
    }

    if (sort === 'popular') {
        return list.sort((a, b) => {
            const countDiff = Number(b.usageCount || 0) - Number(a.usageCount || 0);
            if (countDiff !== 0) return countDiff;

            const recentDiff = Number(b.lastUsedAt || 0) - Number(a.lastUsedAt || 0);
            if (recentDiff !== 0) return recentDiff;

            return String(a.title || '').localeCompare(String(b.title || ''), 'ru');
        });
    }

    if (sort === 'az') {
        return list.sort((a, b) =>
            String(a.title || '').localeCompare(String(b.title || ''), 'ru')
        );
    }

    if (sort === 'za') {
        return list.sort((a, b) =>
            String(b.title || '').localeCompare(String(a.title || ''), 'ru')
        );
    }

    // new
    return list.sort((a, b) => {
        const createdDiff = Number(b.createdAt || 0) - Number(a.createdAt || 0);
        if (createdDiff !== 0) return createdDiff;

        return String(a.title || '').localeCompare(String(b.title || ''), 'ru');
    });
}

// ================ bottom-sheet сортировки
function openMealSearchSortSheet({ onApply }) {
    ensureMealSearchSortState();

    const overlay = createElement('div', 'meal-sort-sheet-overlay');
    const sheet = createElement('div', 'meal-sort-sheet');

    const header = createElement('div', 'meal-sort-sheet-header');

    const title = createElement('div', 'meal-sort-sheet-title', 'Сортировка и фильтры');

    const confirmBtn = createElement('button', 'meal-sort-sheet-confirm');
    confirmBtn.type = 'button';
    confirmBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
            <path d="M20 6 9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
    `;

    const section = createElement('div', 'meal-sort-sheet-section');

    const sectionLabel = createElement('div', 'meal-sort-sheet-section-label', 'Сортировать');

    const optionsWrap = createElement('div', 'meal-sort-sheet-options');

    let selectedSort = state.mealSearchSort;

    const options = [
        { value: 'recent', label: 'Недавние' },
        { value: 'popular', label: 'Самые используемые' },
        { value: 'az', label: 'от А до Я' },
        { value: 'za', label: 'от Я до А' }
    ];

    function renderOptions() {
        optionsWrap.innerHTML = '';

        options.forEach(opt => {
            const row = createElement('button', 'meal-sort-sheet-option');
            row.type = 'button';

            const text = createElement('span', 'meal-sort-sheet-option-text', opt.label);
            const check = createElement('span', 'meal-sort-sheet-option-check');
            check.innerHTML = `
                <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                    <path d="M20 6 9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            `;

            row.classList.toggle('active', selectedSort === opt.value);

            row.append(text, check);

            row.onclick = () => {
                selectedSort = opt.value;
                renderOptions();
            };

            optionsWrap.append(row);
        });
    }

    renderOptions();

    function closeSheet() {
        overlay.classList.remove('open');
        sheet.classList.remove('open');
        setTimeout(() => overlay.remove(), 240);
    }

    confirmBtn.onclick = () => {
        state.mealSearchSort = selectedSort;
        if (onApply) onApply();
        closeSheet();
    };

    overlay.onclick = (e) => {
        if (e.target === overlay) {
            closeSheet();
        }
    };

    header.append(title, confirmBtn);
    section.append(sectionLabel, optionsWrap);
    sheet.append(header, section);
    overlay.append(sheet);
    document.body.append(overlay);

    requestAnimationFrame(() => {
        overlay.classList.add('open');
        sheet.classList.add('open');
    });
}



function renderMealSearch() {
    ensureMealShell();
    setMealBaseTopBarVisible(false);

    if (!state.mealSearchTab) {
        state.mealSearchTab = 'all';
    }
    ensureMealSearchSortState();

    // restore persisted base source (english/user)
    try {
        const saved = localStorage.getItem('mealSearchBaseMode:v1');
        if (saved === 'english' || saved === 'user') {
            state.mealSearchBaseMode = saved;
        }
    } catch (_) {}

    if (state.mealSearchBaseMode !== 'english' && state.mealSearchBaseMode !== 'user') {
        state.mealSearchBaseMode = 'english';
    }

    // Meal-search uses small preview caches; invalidate on each open to avoid "stuck empty"
    // after logic/schema changes (or partial failures during a session).
    foodsPreviewCache = null;
    foodsPreviewCacheKey = null;
    recipesPreviewCache = null;
    recipesPreviewCacheKey = null;
    historyPreviewCache = null;
    historyPreviewCacheKey = null;

    // Backfill search fields once per library so word-token search works for old products/recipes.
    const mealSearchIndexReadyPromise = ensureMealSearchIndexFieldsOnce();

    // Поиск по вкладкам: каждую вкладку очищаем при уходе с неё.
    if (!state.mealSearchQueryByTab || typeof state.mealSearchQueryByTab !== 'object') {
        state.mealSearchQueryByTab = { all: '', products: '', recipes: '', base: '' };
    } else {
        state.mealSearchQueryByTab.all ??= '';
        state.mealSearchQueryByTab.products ??= '';
        state.mealSearchQueryByTab.recipes ??= '';
        state.mealSearchQueryByTab.base ??= '';
    }

    // Миграция старого формата (если остался в state от предыдущих версий).
    if (typeof state.mealSearchQueryNonBase === 'string' && state.mealSearchQueryNonBase) {
        // Кладем в текущую вкладку (если она не base), иначе в all.
        const key = state.mealSearchTab === 'base' ? 'all' : state.mealSearchTab;
        state.mealSearchQueryByTab[key] = state.mealSearchQueryNonBase;
        state.mealSearchQueryNonBase = '';
    }
    if (typeof state.mealSearchQueryBase === 'string' && state.mealSearchQueryBase) {
        state.mealSearchQueryByTab.base = state.mealSearchQueryBase;
        state.mealSearchQueryBase = '';
    }

    const mealOptions = getMealSearchOptions();
    if (!mealOptions.some(opt => opt.id === state.currentMealId)) {
        state.currentMealId = mealOptions[0]?.id || 'meal1';
    }

    let loadRequestId = 0;

    if (!state.mealSearchScrollByTab || typeof state.mealSearchScrollByTab !== 'object') {
        state.mealSearchScrollByTab = { all: 0, products: 0, recipes: 0, base: 0 };
    } else {
        // добавляем недостающие ключи, чтобы старые сохранения не ломали новые вкладки
        state.mealSearchScrollByTab.all ??= 0;
        state.mealSearchScrollByTab.products ??= 0;
        state.mealSearchScrollByTab.recipes ??= 0;
        state.mealSearchScrollByTab.base ??= 0;
    }

    const screen = createElement('div', 'meal-search-screen meal-search-screen--fill');
    const body = createElement('div', 'meal-search-body');

    function refreshMealSearchScreenMode() {
        const tab = state.mealSearchTab || 'all';
        screen.classList.toggle('meal-search-screen--history', tab === 'all');
    }

    // ===== Верхняя строка (назад и действия — в нижнем меню)
    const topRow = createElement('div', 'meal-search-topbar');
    topRow.classList.add('meal-search-topbar--bottom-nav-mode');

    const handleMealSearchBack = () => {
        state.mealSearchTab = 'all';
        state.mealSearchScrollByTab = { all: 0, products: 0, recipes: 0, base: 0 };
        closeMealOverlayAndShowMealMain();
    };

const titleWrap = createElement('div', 'meal-search-meal-picker');
const titleBtn = createElement('button', 'meal-search-meal-trigger');
titleBtn.type = 'button';
titleBtn.setAttribute('aria-haspopup', 'true');
titleBtn.setAttribute('aria-expanded', 'false');

const titleText = createElement('span', 'meal-search-meal-text', getMealSearchCurrentLabel());
const titleArrow = createElement('span', 'meal-search-meal-arrow');
titleArrow.innerHTML = `
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
`;

titleBtn.append(titleText, titleArrow);
titleWrap.append(titleBtn);

const menuBackdrop = createElement('button', 'meal-search-picker-backdrop');
menuBackdrop.type = 'button';

const dropdown = createElement('div', 'meal-search-picker-menu');
dropdown.setAttribute('aria-hidden', 'true');

const dropdownLabel = createElement('div', 'meal-search-picker-section-label', 'приёмы дня');
const dropdownList = createElement('div', 'meal-search-picker-list');
dropdown.append(dropdownLabel, dropdownList);

function syncMealPickerState(isOpen) {
    titleWrap.classList.toggle('open', isOpen);
    dropdown.classList.toggle('open', isOpen);
    titleBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    dropdown.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
}

function positionMealPickerDropdown() {
    const pad = 12;
    const rect = titleBtn.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth || 320;

    dropdown.style.top = `${Math.round(rect.bottom + 8)}px`;
    dropdown.style.left = `${Math.round(rect.left + rect.width / 2)}px`;
    dropdown.style.transform = 'translateX(-50%)';
    dropdown.style.maxWidth = `calc(${vw}px - 24px)`;

    if (!dropdown.isConnected) {
        screen.append(dropdown);
    }

    void dropdown.offsetWidth;

    const menuWidth = dropdown.getBoundingClientRect().width || dropdown.offsetWidth || 150;
    const halfWidth = menuWidth / 2;
    const minLeft = pad + halfWidth;
    const maxLeft = vw - pad - halfWidth;
    const nextLeft = Math.min(maxLeft, Math.max(minLeft, rect.left + rect.width / 2));

    if (minLeft > maxLeft) {
        dropdown.style.left = `${pad}px`;
        dropdown.style.transform = 'none';
        dropdown.style.maxWidth = `${Math.max(120, vw - pad * 2)}px`;
        return;
    }

    dropdown.style.left = `${Math.round(nextLeft)}px`;
    dropdown.style.transform = 'translateX(-50%)';
    dropdown.style.maxWidth = `calc(${vw}px - 24px)`;
}

function updateMealPickerSelection(mealId) {
    const nextOption = mealOptions.find(opt => opt.id === mealId);
    if (!nextOption) return;

    state.currentMealId = nextOption.id;
    titleText.textContent = nextOption.label;
    titleWrap.dataset.currentMealId = nextOption.id;
    titleBtn.dataset.currentMealId = nextOption.id;
    titleBtn.classList.add('active');
    titleText.classList.add('active');

    dropdownList.querySelectorAll('.meal-search-picker-item').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mealId === nextOption.id);
        btn.setAttribute('aria-pressed', btn.dataset.mealId === nextOption.id ? 'true' : 'false');
    });
}

function closeMealPicker() {
    syncMealPickerState(false);
    menuBackdrop.remove();
    dropdown.remove();
}

function openMealPicker() {
    positionMealPickerDropdown();
    if (!menuBackdrop.isConnected) {
        screen.append(menuBackdrop);
    }
    syncMealPickerState(true);
}

menuBackdrop.onclick = closeMealPicker;

titleBtn.onclick = () => {
    if (titleWrap.classList.contains('open')) {
        closeMealPicker();
    } else {
        openMealPicker();
    }
};

function selectMealFromPicker(mealId, event) {
    if (!mealId) return;

    if (event) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
    }

    updateMealPickerSelection(mealId);
    closeMealPicker();
}

mealOptions.forEach(opt => {
    const item = createElement('button', 'meal-search-picker-item', opt.label);
    item.type = 'button';
    item.dataset.mealId = opt.id;
    item.classList.toggle('active', opt.id === state.currentMealId);
    item.setAttribute('aria-pressed', opt.id === state.currentMealId ? 'true' : 'false');

    item.onclick = (event) => {
        selectMealFromPicker(opt.id, event);
    };

    dropdownList.append(item);
});

updateMealPickerSelection(state.currentMealId);

topRow.append(titleWrap);

    // ===== Tabs
    const tabsRow = createElement('div', 'meal-search-tabs');

    const tabAll = createElement('button', 'meal-search-tab', 'история');
    const tabProducts = createElement('button', 'meal-search-tab', 'продукты');
    const tabRecipes = createElement('button', 'meal-search-tab', 'рецепты');
    const tabBase = createElement('button', 'meal-search-tab', 'база');
    const tabButtonsMap = {
        all: tabAll,
        products: tabProducts,
        recipes: tabRecipes,
        base: tabBase
    };

    const tabSortBackdrop = createElement('button', 'meal-search-tab-sort-backdrop');
    tabSortBackdrop.type = 'button';

    let activeTabSortDropdown = null;
    let activeTabSortOwner = null;

    function closeTabSortDropdown() {
        if (activeTabSortDropdown) {
            activeTabSortDropdown.remove();
            activeTabSortDropdown = null;
        }

        if (activeTabSortOwner) {
            activeTabSortOwner.classList.remove('open');
            activeTabSortOwner = null;
        }

        tabSortBackdrop.remove();
    }

    /** Центр под вкладкой + clamp по краям экрана (история слева, база справа). */
    function positionMealSearchTabSortDropdown(dropdown, tabBtn) {
        const pad = 12;
        const rect = tabBtn.getBoundingClientRect();
        dropdown.style.position = 'fixed';
        dropdown.style.top = `${rect.bottom + 8}px`;
        dropdown.style.zIndex = '90';
        screen.append(dropdown);
        void dropdown.offsetWidth;

        const vw = window.innerWidth || document.documentElement.clientWidth || 320;
        const menuW = dropdown.getBoundingClientRect().width || dropdown.offsetWidth || 220;
        const halfW = menuW / 2;
        let centerX = rect.left + rect.width / 2;
        const minCenter = pad + halfW;
        const maxCenter = vw - pad - halfW;

        if (minCenter > maxCenter) {
            dropdown.style.left = `${pad}px`;
            dropdown.style.transform = 'translateX(0)';
            dropdown.style.maxWidth = `${Math.max(120, vw - pad * 2)}px`;
        } else {
            centerX = Math.min(maxCenter, Math.max(minCenter, centerX));
            dropdown.style.left = `${Math.round(centerX)}px`;
            dropdown.style.transform = 'translateX(-50%)';
            dropdown.style.maxWidth = '';
        }
    }

    function buildTabSortDropdown(tabKey) {
        const dropdown = createElement('div', 'meal-search-tab-sort-menu');
        const options = getMealSearchSortOptionsByTab(tabKey);
        const currentSort = state.mealSearchSortByTab?.[tabKey];

        options.forEach(option => {
            const item = createElement(
                'button',
                `meal-search-tab-sort-item${option.id === currentSort ? ' active' : ''}`,
                option.label
            );
            item.type = 'button';

            item.onclick = async (e) => {
                e.stopPropagation();
                setMealSearchCurrentSort(option.id, tabKey);
                closeTabSortDropdown();
                updateActiveTabSortUI();
                await loadAndRender();
            };

            dropdown.append(item);
        });

        return dropdown;
    }

    function buildMealSearchBaseSourceDropdown() {
        const dropdown = createElement('div', 'meal-search-tab-sort-menu');
        const current = state.mealSearchBaseMode === 'user' ? 'user' : 'english';
        const options = [
            { id: 'english', label: 'англ.база' },
            { id: 'user', label: 'база пользователей' }
        ];

        options.forEach(option => {
            const item = createElement(
                'button',
                `meal-search-tab-sort-item${option.id === current ? ' active' : ''}`,
                option.label
            );
            item.type = 'button';

            item.onclick = async (e) => {
                e.stopPropagation();
                state.mealSearchBaseMode = option.id === 'user' ? 'user' : 'english';
                try {
                    localStorage.setItem('mealSearchBaseMode:v1', state.mealSearchBaseMode);
                } catch (_) {}
                // Мгновенно обновляем placeholder/подпись, не дожидаясь async loadAndRender().
                updateBaseSearchUiFromMode();
                closeTabSortDropdown();
                updateActiveTabSortUI();
                await loadAndRender();
            };

            dropdown.append(item);
        });

        return dropdown;
    }

    function openMealSearchBaseSourceDropdown() {
        closeTabSortDropdown();

        const tabBtn = tabBase;
        const dropdown = buildMealSearchBaseSourceDropdown();

        tabBtn.classList.add('open');
        positionMealSearchTabSortDropdown(dropdown, tabBtn);

        activeTabSortDropdown = dropdown;
        activeTabSortOwner = tabBtn;

        screen.append(tabSortBackdrop);
    }

    function openTabSortDropdown(tabKey) {
        closeTabSortDropdown();

        const tabBtn = tabButtonsMap[tabKey];
        if (!tabBtn) return;

        const dropdown = buildTabSortDropdown(tabKey);

        tabBtn.classList.add('open');
        // Вкладки живут внутри маски (fade по краям). Если вставлять меню внутрь вкладки,
        // оно будет обрезаться mask-image. Поэтому рендерим меню рядом с экраном.
        positionMealSearchTabSortDropdown(dropdown, tabBtn);

        activeTabSortDropdown = dropdown;
        activeTabSortOwner = tabBtn;

        screen.append(tabSortBackdrop);
    }

    tabSortBackdrop.onclick = closeTabSortDropdown;


    function updateActiveTabSortUI() {
        [tabAll, tabProducts, tabRecipes, tabBase].forEach(tab => {
            tab.classList.remove('has-sort-open');
            tab.querySelector('.meal-search-tab-sort-label')?.remove();
            tab.querySelector('.meal-search-tab-sort-arrow')?.remove();
        });

        const activeTabKey = state.mealSearchTab || 'all';
        if (activeTabKey === 'all') return;

        const activeBtn = tabButtonsMap[activeTabKey];
        if (!activeBtn) return;

        const arrow = createElement('span', 'meal-search-tab-sort-arrow');
        arrow.innerHTML = `
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        `;

        activeBtn.append(arrow);

        if (activeBtn.classList.contains('open')) {
            activeBtn.classList.add('has-sort-open');
        }
    }

    const listAll = createElement('div', 'food-list meal-search-list');
    const listProducts = createElement('div', 'food-list meal-search-list');
    const listRecipes = createElement('div', 'food-list meal-search-list');
    const listBase = createElement('div', 'food-list meal-search-list');
    const basePager = {
        query: '',
        page: 0,
        maxResults: 20,
        totalResults: null,
        loading: false,
        exhausted: false,
        userCatalogLastDoc: null
    };
    const localPageSize = 20;
    const productsPager = {
        pageIndex: 0,
        sortId: null,
        query: '',
        pages: [],
        loading: false,
        exhausted: false
    };
    const recipesPager = {
        pageIndex: 0,
        sortId: null,
        query: '',
        pages: [],
        loading: false,
        exhausted: false
    };

    function getPagerForTab(tabKey) {
        if (tabKey === 'recipes') return recipesPager;
        return productsPager;
    }

    function resetPager(pager, { sortId, query }) {
        pager.pageIndex = 0;
        pager.sortId = sortId || null;
        pager.query = query || '';
        pager.pages = [];
        pager.loading = false;
        pager.exhausted = false;
    }

    function renderPagedControls(listEl, pager, requestId) {
        if (requestId !== loadRequestId) return;
        const existing = listEl.querySelector('.meal-search-pager');
        if (existing) existing.remove();

        const totalPages = pager.pages.length;
        if (!totalPages) return;

        const wrap = createElement('div', 'meal-search-pager');

        const prevBtn = createElement('button', 'meal-search-pager-btn', 'Предыдущая');
        prevBtn.type = 'button';
        prevBtn.disabled = pager.loading || pager.pageIndex <= 0;

        const nextBtn = createElement('button', 'meal-search-pager-btn', 'Следующая');
        nextBtn.type = 'button';
        nextBtn.disabled = pager.loading || pager.exhausted;

        prevBtn.onclick = async () => {
            if (pager.loading) return;
            pager.pageIndex = Math.max(0, pager.pageIndex - 1);
            renderProductsOrRecipesPage(listEl, pager, requestId);
        };

        nextBtn.onclick = async () => {
            if (pager.loading) return;
            pager.pageIndex += 1;
            if (!pager.pages[pager.pageIndex]) {
                await ensureNextPageLoaded(pager, requestId);
            }
            renderProductsOrRecipesPage(listEl, pager, requestId);
        };

        const label = createElement('div', 'meal-search-pager-label', `${pager.pageIndex + 1}`);
        wrap.append(prevBtn, label, nextBtn);
        listEl.append(wrap);
    }

    function renderProductsOrRecipesPage(listEl, pager, requestId) {
        if (requestId !== loadRequestId) return;
        const page = pager.pages[pager.pageIndex];
        if (!page) return;

        listEl.innerHTML = '';
        if (page.type === 'foods') {
            renderFoodListAppend(listEl, page.items, loadAndRender);
        } else if (page.type === 'recipes') {
            renderRecipeListAppend(listEl, page.items, loadAndRender);
        }
        renderPagedControls(listEl, pager, requestId);
    }

    function getFoodsSortQuery(sortId, foodsCol, afterDoc = null) {
        let field = 'createdAt';
        let dir = 'desc';
        if (sortId === 'popular') field = 'usageCount';
        if (sortId === 'az') { field = 'name'; dir = 'asc'; }
        if (sortId === 'za') { field = 'name'; dir = 'desc'; }

        // IMPORTANT: avoid multi-field orderBy here — it commonly requires a manual composite index.
        // Pagination uses startAfter(lastSnapshot) on the same single orderBy field.
        const parts = [foodsCol, orderBy(field, dir), limit(localPageSize)];
        if (afterDoc) parts.splice(2, 0, startAfter(afterDoc));
        return query(...parts);
    }

    function getFoodsSearchQuery(searchText, foodsCol, afterDoc = null) {
        const token = getMealSearchPrimaryToken(searchText);
        const constraints = [
            foodsCol,
            where('searchTokens', 'array-contains', token),
            limit(Math.max(localPageSize, 80))
        ];
        if (afterDoc) {
            constraints.splice(constraints.length - 1, 0, startAfter(afterDoc));
        }
        return query(...constraints);
    }

    function getRecipesSortQuery(sortId, recipesCol, afterDoc = null) {
        let field = 'createdAt';
        let dir = 'desc';
        if (sortId === 'popular') field = 'usageCount';
        if (sortId === 'az') { field = 'title'; dir = 'asc'; }
        if (sortId === 'za') { field = 'title'; dir = 'desc'; }

        const parts = [recipesCol, orderBy(field, dir), limit(localPageSize)];
        if (afterDoc) parts.splice(2, 0, startAfter(afterDoc));
        return query(...parts);
    }

    function getRecipesSearchQuery(searchText, recipesCol, afterDoc = null) {
        const token = getMealSearchPrimaryToken(searchText);
        const constraints = [
            recipesCol,
            where('searchTokens', 'array-contains', token),
            limit(Math.max(localPageSize, 80))
        ];
        if (afterDoc) {
            constraints.splice(constraints.length - 1, 0, startAfter(afterDoc));
        }
        return query(...constraints);
    }

    async function ensureNextPageLoaded(pager, requestId) {
        if (requestId !== loadRequestId) return;
        if (pager.loading) return;
        if (pager.exhausted) return;

        const foodsCol = getMealLibraryFoodsCollection();
        const recipesCol = getMealLibraryRecipesCollection();

        pager.loading = true;
        try {
            const lastPage = pager.pages[pager.pages.length - 1] || null;
            const afterDoc = lastPage?.lastDoc || null;

            if (pager.type === 'foods') {
                if (!foodsCol) {
                    pager.pages.push({ type: 'foods', items: [], firstDoc: null, lastDoc: null });
                    pager.exhausted = true;
                    return;
                }
                const hasSearch = getMealSearchPrimaryToken(pager.query).length >= 2;
                const qRef = hasSearch
                    ? getFoodsSearchQuery(pager.query, foodsCol, afterDoc)
                    : getFoodsSortQuery(pager.sortId, foodsCol, afterDoc);
                let snap;
                try {
                    snap = await getDocs(qRef);
                } catch (e) {
                    console.warn('foods page query failed', e);
                    const hint = e?.code === 'permission-denied'
                        ? ' Войдите в аккаунт или проверьте правила Firestore для mealLibraryFoods.'
                        : (String(e?.message || '').includes('index') ? ' Откройте консоль (F12) — ссылка на индекс в ошибке.' : '');
                    showToast(`Не удалось загрузить продукты.${hint}`);
                    pager.pages.push({ type: 'foods', items: [], firstDoc: null, lastDoc: null });
                    pager.exhausted = true;
                    return;
                }
                if (requestId !== loadRequestId) return;
                const docs = snap.docs || [];
                const rawItems = docs.map(d => ({ id: d.id, ...d.data() }));
                const items = hasSearch
                    ? filterMealSearchRowsByText(rawItems, pager.query, item => item.name || '')
                    : rawItems;
                pager.pages.push({
                    type: 'foods',
                    items,
                    firstDoc: docs[0] || null,
                    lastDoc: docs[docs.length - 1] || null
                });
                pager.exhausted = docs.length < Math.max(localPageSize, hasSearch ? 80 : localPageSize);
            } else {
                if (!recipesCol) {
                    pager.pages.push({ type: 'recipes', items: [], firstDoc: null, lastDoc: null });
                    pager.exhausted = true;
                    return;
                }
                const hasSearch = getMealSearchPrimaryToken(pager.query).length >= 2;
                const qRef = hasSearch
                    ? getRecipesSearchQuery(pager.query, recipesCol, afterDoc)
                    : getRecipesSortQuery(pager.sortId, recipesCol, afterDoc);
                let snap;
                try {
                    snap = await getDocs(qRef);
                } catch (e) {
                    console.warn('recipes page query failed', e);
                    const hint = e?.code === 'permission-denied'
                        ? ' Войдите в аккаунт или проверьте правила Firestore для mealLibraryRecipes.'
                        : (String(e?.message || '').includes('index') ? ' Откройте консоль (F12) — ссылка на индекс в ошибке.' : '');
                    showToast(`Не удалось загрузить рецепты.${hint}`);
                    pager.pages.push({ type: 'recipes', items: [], firstDoc: null, lastDoc: null });
                    pager.exhausted = true;
                    return;
                }
                if (requestId !== loadRequestId) return;
                const docs = snap.docs || [];
                const rawItems = docs.map(d => ({ id: d.id, ...d.data() }));
                const items = hasSearch
                    ? filterMealSearchRowsByText(rawItems, pager.query, item => item.title || '')
                    : rawItems;
                pager.pages.push({
                    type: 'recipes',
                    items,
                    firstDoc: docs[0] || null,
                    lastDoc: docs[docs.length - 1] || null
                });
                pager.exhausted = docs.length < Math.max(localPageSize, hasSearch ? 80 : localPageSize);
            }
        } finally {
            pager.loading = false;
        }
    }

    // -------------------------------------------------------------------------
    // TAB_SYNC_ANCHOR_B · «Якорь»
    // Текущий эталон синхронизации полоски вкладок и горизонтальной карусели
    // на экране поиска еды. Ищи в репозитории по TAB_SYNC_ANCHOR_B, чтобы найти
    // этот блок или откатиться к нему из git.
    // Кратко: ряд табов — translate3d; measureTabsTrack + спейсеры; один RAF на кадр;
    // при свайпе только классы активной вкладки без полного updateTabs; тяжёлый
    // пересчёт — scrollend + 140ms.
    // Paging как у iOS: CSS scroll-snap mandatory + scroll-behavior auto; доля табов
    // t ≈ scrollLeft / clientWidth (аналог contentOffset.x / bounds.width).
    // -------------------------------------------------------------------------

    const carousel = createElement('div', 'meal-search-tab-carousel');
    const panelAll = createElement('div', 'meal-search-tab-panel');
    const panelProducts = createElement('div', 'meal-search-tab-panel');
    const panelRecipes = createElement('div', 'meal-search-tab-panel');
    const panelBase = createElement('div', 'meal-search-tab-panel');
    panelAll.dataset.tab = 'all';
    panelProducts.dataset.tab = 'products';
    panelRecipes.dataset.tab = 'recipes';
    panelBase.dataset.tab = 'base';

    function buildMealTabSearchRow(placeholder) {
        const row = createElement('div', 'meal-search-panel-search');
        const box = createElement('div', 'meal-search-box');
        const icon = createElement('div', 'meal-search-icon');
        icon.innerHTML = `
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/>
            <path d="M16 16l5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
    `;
        const inp = createElement('input', 'meal-search-input');
        inp.placeholder = placeholder;
        inp.autocomplete = 'off';
        inp.spellcheck = false;
        box.append(icon, inp);
        row.append(box);
        return { row, input: inp };
    }

    const searchProducts = buildMealTabSearchRow('Поиск продуктов');
    const searchRecipes = buildMealTabSearchRow('Поиск рецептов');
    const searchBase = buildMealTabSearchRow('Поиск по англ. базе');

    const inputProducts = searchProducts.input;
    const inputRecipes = searchRecipes.input;
    const inputBase = searchBase.input;

    function syncMealSearchInputsFromState() {
        inputProducts.value = String(state.mealSearchQueryByTab?.products || '');
        inputRecipes.value = String(state.mealSearchQueryByTab?.recipes || '');
        inputBase.value = String(state.mealSearchQueryByTab?.base || '');
    }

    function updateBaseSearchUiFromMode() {
        const isUser = state.mealSearchBaseMode === 'user';
        inputBase.placeholder = isUser ? 'Поиск по базе пользователей' : 'Поиск по англ. базе';
    }

    function clearMealSearchQueryForTab(tabKey) {
        if (!state.mealSearchQueryByTab || typeof state.mealSearchQueryByTab !== 'object') return;

        if (tabKey === 'products') {
            state.mealSearchQueryByTab.products = '';
            inputProducts.value = '';
            resetPager(productsPager, { sortId: productsPager.sortId || (state.mealSearchSortByTab?.products || 'new'), query: '' });
            state.mealSearchScrollByTab.products = 0;
        }
        if (tabKey === 'recipes') {
            state.mealSearchQueryByTab.recipes = '';
            inputRecipes.value = '';
            resetPager(recipesPager, { sortId: recipesPager.sortId || (state.mealSearchSortByTab?.recipes || 'new'), query: '' });
            state.mealSearchScrollByTab.recipes = 0;
        }
        if (tabKey === 'base') {
            state.mealSearchQueryByTab.base = '';
            inputBase.value = '';
            basePager.query = '';
            basePager.page = 0;
            basePager.totalResults = null;
            basePager.exhausted = false;
            basePager.userCatalogLastDoc = null;
            state.mealSearchScrollByTab.base = 0;
        }
    }

    panelAll.append(listAll);
    panelProducts.append(searchProducts.row, listProducts);
    panelRecipes.append(searchRecipes.row, listRecipes);
    panelBase.append(searchBase.row, listBase);
    carousel.append(panelAll, panelProducts, panelRecipes, panelBase);

    syncMealSearchInputsFromState();
    updateBaseSearchUiFromMode();

    const mealSearchTabsOrder = ['all', 'products', 'recipes', 'base'];

    function getSearchListByTab(t) {
        if (t === 'products') return listProducts;
        if (t === 'recipes') return listRecipes;
        if (t === 'base') return listBase;
        return listAll;
    }

    const tabsWrap = createElement('div', 'meal-search-tabs-wrap');

    const tabsIndicator = createElement('div', 'meal-search-tabs-indicator');
    tabsIndicator.innerHTML = `
        <svg class="meal-search-tabs-indicator-svg" viewBox="0 0 16 7" width="16" height="7" aria-hidden="true">
            <path d="M0 7 L8 0 L16 7 Z" fill="#f2f2f7"/>
        </svg>
    `;

    function getTabCenterInScroll(tabBtn) {
        return (tabBtn?.offsetLeft || 0) + (tabBtn?.offsetWidth || 0) * 0.5;
    }

    let lastTabsTranslate = NaN;
    let tabsMetrics = null;
    let mealSearchCarouselRaf = 0;

    function applyTabsTranslate(x) {
        // Tabs are now static (no horizontal translate).
        // Keep function for backwards compatibility with the old carousel logic.
        void x;
    }

    function scheduleMealSearchCarouselFrame() {
        if (mealSearchCarouselRaf) return;
        mealSearchCarouselRaf = requestAnimationFrame(() => {
            mealSearchCarouselRaf = 0;
            applyMealSearchTabPreviewFromCarouselScroll();
        });
    }

    function measureTabsTrack() {
        const viewportW = tabsWrap.clientWidth || tabsWrap.getBoundingClientRect().width || 0;
        if (!viewportW) return null;

        const firstBtn = tabButtonsMap[mealSearchTabsOrder[0]];
        const lastBtn = tabButtonsMap[mealSearchTabsOrder[mealSearchTabsOrder.length - 1]];

        const leftSpacer = tabsRow.querySelector('.meal-search-tabs-spacer:first-child');
        const rightSpacer = tabsRow.querySelector('.meal-search-tabs-spacer:last-child');
        if (leftSpacer && firstBtn) {
            const leftW = Math.max(0, (viewportW / 2) - (firstBtn.offsetWidth / 2));
            leftSpacer.style.width = `${leftW}px`;
        }
        if (rightSpacer && lastBtn) {
            const rightW = Math.max(0, (viewportW / 2) - (lastBtn.offsetWidth / 2));
            rightSpacer.style.width = `${rightW}px`;
        }

        const centers = mealSearchTabsOrder.map(key => {
            const btn = tabButtonsMap[key];
            return getTabCenterInScroll(btn);
        });

        const maxTranslate = Math.max(0, tabsRow.scrollWidth - viewportW);

        return {
            viewportW,
            centers,
            maxTranslate
        };
    }

    /** TAB_SYNC_ANCHOR_B: доля пути как у UIScrollView paging — scrollLeft / ширина страницы. */
    function getMealSearchCarouselTabT() {
        const n = mealSearchTabsOrder.length;
        if (n <= 1) return 0;

        const pageW = carousel.clientWidth || 0;
        if (pageW <= 0) {
            const i = Math.max(0, mealSearchTabsOrder.indexOf(state.mealSearchTab || 'all'));
            return Math.min(n - 1, i);
        }

        const raw = carousel.scrollLeft / pageW;
        return Math.max(0, Math.min(n - 1, raw));
    }

    function syncMealSearchTabsTransform() {
        if (!tabsMetrics) {
            tabsMetrics = measureTabsTrack();
        }
        if (!tabsMetrics) return;

        const { viewportW, centers, maxTranslate } = tabsMetrics;
        const n = mealSearchTabsOrder.length;
        if (!n) return;

        const t = getMealSearchCarouselTabT();

        const leftIdx = Math.floor(t);
        const rightIdx = Math.min(n - 1, leftIdx + 1);
        const frac = t - leftIdx;

        const leftCenter = centers[leftIdx] ?? 0;
        const rightCenter = centers[rightIdx] ?? leftCenter;
        const currentCenter = leftCenter + (rightCenter - leftCenter) * frac;

        let translate = currentCenter - (viewportW / 2);
        translate = Math.max(0, Math.min(maxTranslate, translate));

        applyTabsTranslate(translate);
    }

    function applyMealSearchTabActiveClasses() {
        [tabAll, tabProducts, tabRecipes, tabBase].forEach(tab => {
            tab.classList.remove('active');
        });

        if (state.mealSearchTab === 'all') tabAll.classList.add('active');
        if (state.mealSearchTab === 'products') tabProducts.classList.add('active');
        if (state.mealSearchTab === 'recipes') tabRecipes.classList.add('active');
        if (state.mealSearchTab === 'base') tabBase.classList.add('active');
    }

    function updateTabs() {
        applyMealSearchTabActiveClasses();
        tabsMetrics = null;
        lastTabsTranslate = NaN;
        updateActiveTabSortUI();
        syncTabsIndicatorToActive();
        scheduleMealSearchCarouselFrame();
    }

    function syncTabsIndicatorToActive(tabKey = state.mealSearchTab || 'all') {
        const key = tabKey || 'all';
        const btn = tabButtonsMap[key];
        if (!btn) return;
        const wrapRect = tabsWrap.getBoundingClientRect();
        const btnRect = btn.getBoundingClientRect();
        const left = Math.round(btnRect.left - wrapRect.left);
        const width = Math.round(btnRect.width);
        const noAnim = Boolean(state._mealSearchRestoreNoIndicatorAnim);
        tabsIndicator.style.transition = noAnim
            ? 'none'
            : 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1), width 220ms cubic-bezier(0.22, 1, 0.36, 1)';
        // Indicator is absolutely positioned inside tabsWrap (left:0).
        // Move it via transform for the smoothest animation on mobile.
        tabsIndicator.style.transform = `translate3d(${left}px, 0, 0)`;
        tabsIndicator.style.width = `${width}px`;
        if (noAnim) state._mealSearchRestoreNoIndicatorAnim = false;
    }

    /** Индикатор следует дробной позиции карусели (как scroll / page width), пиксель в пиксель со скроллом. */
    function syncTabsIndicatorToCarouselScroll({ animated = false } = {}) {
        const n = mealSearchTabsOrder.length;
        if (!n) return;

        const t = getMealSearchCarouselTabT();
        const leftIdx = Math.min(n - 1, Math.max(0, Math.floor(t)));
        const rightIdx = Math.min(n - 1, leftIdx + 1);
        const frac = t - leftIdx;

        const keyL = mealSearchTabsOrder[leftIdx];
        const keyR = mealSearchTabsOrder[rightIdx];
        const btnL = tabButtonsMap[keyL];
        const btnR = tabButtonsMap[keyR];
        if (!btnL || !btnR) return;

        const wrapRect = tabsWrap.getBoundingClientRect();
        const rectL = btnL.getBoundingClientRect();
        const rectR = btnR.getBoundingClientRect();
        const leftL = rectL.left - wrapRect.left;
        const leftR = rectR.left - wrapRect.left;
        const wL = rectL.width;
        const wR = rectR.width;

        const left = leftL + (leftR - leftL) * frac;
        const width = Math.max(12, wL + (wR - wL) * frac);

        tabsIndicator.style.transition = animated
            ? 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1), width 220ms cubic-bezier(0.22, 1, 0.36, 1)'
            : 'none';
        tabsIndicator.style.transform = `translate3d(${left}px, 0, 0)`;
        tabsIndicator.style.width = `${width}px`;
    }

    function applyMealSearchTabPreviewFromCarouselScroll() {
        const n = mealSearchTabsOrder.length;
        if (!n || !carousel.clientWidth) return;

        const idx = Math.min(n - 1, Math.max(0, Math.round(getMealSearchCarouselTabT())));
        const tab = mealSearchTabsOrder[idx];
        if (!tab) return;

        // During swipe: update ONLY lightweight visuals. Avoid mutating state + heavy reloads.
        [tabAll, tabProducts, tabRecipes, tabBase].forEach(t => t.classList.remove('active'));
        if (tab === 'all') tabAll.classList.add('active');
        if (tab === 'products') tabProducts.classList.add('active');
        if (tab === 'recipes') tabRecipes.classList.add('active');
        if (tab === 'base') tabBase.classList.add('active');

        syncTabsIndicatorToCarouselScroll({ animated: false });
        syncMealSearchBottomNavActionForTab(tab);
    }

    let mealSearchCarouselScrollEndTimer = 0;

    function scheduleMealSearchCarouselScrollEndFallback() {
        if (mealSearchCarouselScrollEndTimer) {
            clearTimeout(mealSearchCarouselScrollEndTimer);
        }
        mealSearchCarouselScrollEndTimer = setTimeout(() => {
            mealSearchCarouselScrollEndTimer = 0;
            onMealSearchCarouselScrollSettled();
        }, 140);
    }

    function onMealSearchCarouselScrollSettled() {
        tabsMetrics = null;
        lastTabsTranslate = NaN;

        const n = mealSearchTabsOrder.length;
        if (!n || !carousel.clientWidth) {
            updateActiveTabSortUI();
            scheduleMealSearchCarouselFrame();
            return;
        }

        const idx = Math.min(n - 1, Math.max(0, Math.round(getMealSearchCarouselTabT())));
        const tab = mealSearchTabsOrder[idx];
        if (tab && tab !== state.mealSearchTab) {
            const prevTab = state.mealSearchTab;
            // По UX: ушли со вкладки — очистили её поиск (products/recipes/base).
            clearMealSearchQueryForTab(prevTab);
            state.mealSearchTab = tab;
            applyMealSearchTabActiveClasses();
            updateActiveTabSortUI();
            renderActionsForTab(tab);
            syncTabsIndicatorToCarouselScroll({ animated: false });
            refreshMealSearchScreenMode();
            void loadAndRender();
        } else {
            updateActiveTabSortUI();
            scheduleMealSearchCarouselFrame();
        }
    }











    function handleMealSearchTabClick(e, tabKey) {
        e.stopPropagation();

        if (state.mealSearchTab !== tabKey) {
            goToTab(tabKey);
            return;
        }

        if (tabKey === 'products') {
            if (activeTabSortOwner === tabProducts) closeTabSortDropdown();
            else openTabSortDropdown('products');
            return;
        }

        if (tabKey === 'recipes') {
            if (activeTabSortOwner === tabRecipes) closeTabSortDropdown();
            else openTabSortDropdown('recipes');
            return;
        }

        if (tabKey === 'base') {
            if (activeTabSortOwner === tabBase) closeTabSortDropdown();
            else openMealSearchBaseSourceDropdown();
        }
    }

    tabAll.onclick = (e) => handleMealSearchTabClick(e, 'all');
    tabProducts.onclick = (e) => handleMealSearchTabClick(e, 'products');
    tabRecipes.onclick = (e) => handleMealSearchTabClick(e, 'recipes');
    tabBase.onclick = (e) => handleMealSearchTabClick(e, 'base');

    const tabsSpacerLeft = createElement('div', 'meal-search-tabs-spacer');
    const tabsSpacerRight = createElement('div', 'meal-search-tabs-spacer');

    tabsRow.append(tabsSpacerLeft, tabAll, tabProducts, tabRecipes, tabBase, tabsSpacerRight);
    tabsWrap.append(tabsRow, tabsIndicator);
    updateTabs();

    let tabGestureStartX = 0;
    let tabGestureStartY = 0;
    let tabPanAxis = null;
    tabsWrap.addEventListener('touchstart', (e) => {
        if (!e.touches?.length) return;
        tabGestureStartX = e.touches[0].clientX;
        tabGestureStartY = e.touches[0].clientY;
        tabPanAxis = null;
    }, { passive: true });
    tabsWrap.addEventListener('touchmove', (e) => {
        if (!e.touches?.length) return;
        const dx = e.touches[0].clientX - tabGestureStartX;
        const dy = e.touches[0].clientY - tabGestureStartY;
        if (!tabPanAxis) {
            tabPanAxis = resolveSwipePanAxis(dx, dy);
            if (tabPanAxis == null) return;
        }
        if (tabPanAxis === 'x' && e.cancelable) e.preventDefault();
    }, { passive: false });
    tabsWrap.addEventListener('touchend', () => { tabPanAxis = null; });
    tabsWrap.addEventListener('touchcancel', () => { tabPanAxis = null; });

    const controlsStrip = createElement('div', 'meal-search-controls-strip');

    // ===== History title + sort


    // Tabs row (each tab page has its own search UI inside the carousel panel).
    controlsStrip.append(tabsWrap);
    refreshMealSearchScreenMode();




    function wireMealSearchListScroll(list, tabKey) {
        list.addEventListener(
            'scroll',
            () => {
                state.mealSearchScrollByTab[tabKey] = list.scrollTop;
            },
            { passive: true }
        );
    }

    wireMealSearchListScroll(listAll, 'all');
    wireMealSearchListScroll(listProducts, 'products');
    wireMealSearchListScroll(listRecipes, 'recipes');
    wireMealSearchListScroll(listBase, 'base');

    function buildMealSearchBottomNavConfig(tab) {
        const currentTab = tab || state.mealSearchTab || 'all';

        if (currentTab === 'all') {
            return {
                visible: true,
                onBack: handleMealSearchBack,
                secondaryActionHtml: getMealCameraIconMarkup(),
                secondaryActionLabel: 'Сделать фото',
                secondaryActionVisible: true,
                secondaryActionIcon: true,
                onSecondaryAction: () => openMealPhotoCaptureFlow(state.currentMealId),
                actionHtml: getMealQuickAddIconMarkup(),
                actionLabel: 'Быстрое добавление',
                actionIcon: true,
                onAction: () => {
                    openQuickAddForm('search');
                }
            };
        }

        if (currentTab === 'base') {
            return {
                visible: true,
                onBack: handleMealSearchBack,
                actionVisible: false
            };
        }

        if (currentTab === 'products') {
            return {
                visible: true,
                onBack: handleMealSearchBack,
                actionText: 'Добавить продукт',
                onAction: () => {
                    state.mealSearchReturnTab = state.mealSearchTab || 'products';
                    state.createFoodBackTarget = 'search';
                    state.mealView = 'create';
                    renderMealPage();
                }
            };
        }

        return {
            visible: true,
            onBack: handleMealSearchBack,
            actionText: 'Добавить рецепт',
            onAction: () => {
                saveMealPageScroll();
                mealScrollRestorePending = true;
                state.mealSearchReturnTab = state.mealSearchTab || 'recipes';
                state.recipeDraft = createEmptyRecipeDraft();
                state.mealView = 'recipe';
                renderMealPage();
            }
        };
    }

    function syncMealSearchBottomNavActionForTab(tab) {
        setMealBottomNavOverlayMode(buildMealSearchBottomNavConfig(tab));
    }

    function renderActionsForTab(tab) {
        syncMealSearchBottomNavActionForTab(tab);
    }

    function syncCarouselToState() {
        const idx = Math.max(0, mealSearchTabsOrder.indexOf(state.mealSearchTab || 'all'));
        requestAnimationFrame(() => {
            const w = carousel.clientWidth;
            if (w <= 0) return;
            const target = idx * w;
            if (Math.abs(carousel.scrollLeft - target) > 2) {
                const prevSnap = carousel.style.scrollSnapType;
                carousel.style.scrollSnapType = 'none';
                carousel.scrollLeft = target;
                void carousel.offsetWidth;
                carousel.style.scrollSnapType = prevSnap || '';
            }
        });
    }

    function goToTab(tab) {
        if (!mealSearchTabsOrder.includes(tab)) return;

        const idx = mealSearchTabsOrder.indexOf(tab);
        const w = carousel.clientWidth;
        if (w > 0 && state.mealSearchTab === tab && Math.abs(carousel.scrollLeft - idx * w) < 6) {
            return;
        }

        if (state.mealSearchTab !== tab) {
            const prevTab = state.mealSearchTab;
            clearMealSearchQueryForTab(prevTab);
            state.mealSearchTab = tab;
            renderActionsForTab(tab);
            updateActiveTabSortUI();
            refreshMealSearchScreenMode();

        }
        closeTabSortDropdown();
        updateTabs();

        if (w > 0) {
            const target = idx * w;
            const prevSnap = carousel.style.scrollSnapType;
            carousel.style.scrollSnapType = 'none';
            carousel.scrollLeft = target;
            void carousel.offsetWidth;
            carousel.style.scrollSnapType = prevSnap || '';
        }

        requestAnimationFrame(() => {
            const newList = getSearchListByTab(tab);
            if (newList) {
                newList.scrollTop = 0;
            }
        });

        void loadAndRender();
    }

    carousel.addEventListener(
        'scroll',
        () => {
            scheduleMealSearchCarouselFrame();
            scheduleMealSearchCarouselScrollEndFallback();
        },
        { passive: true }
    );

    if ('onscrollend' in window) {
        carousel.addEventListener(
            'scrollend',
            () => {
                if (mealSearchCarouselScrollEndTimer) {
                    clearTimeout(mealSearchCarouselScrollEndTimer);
                    mealSearchCarouselScrollEndTimer = 0;
                }
                onMealSearchCarouselScrollSettled();
            },
            { passive: true }
        );
    }

    window.addEventListener(
        'resize',
        () => {
            tabsMetrics = null;
            lastTabsTranslate = NaN;
            syncCarouselToState();
        },
        { passive: true }
    );

    /** Позиция карусели — источник правды для вкладки до debounce input (иначе поиск В«базы» не стартует). */
    function syncMealSearchTabFromCarouselScroll() {
        if (state._mealSearchRestoreSkipCarouselSyncOnce) return;
        const n = mealSearchTabsOrder.length;
        if (!n || !carousel?.clientWidth) return;
        const idx = Math.min(n - 1, Math.max(0, Math.round(getMealSearchCarouselTabT())));
        const tab = mealSearchTabsOrder[idx];
        if (tab && tab !== state.mealSearchTab) {
            state.mealSearchTab = tab;
            applyMealSearchTabActiveClasses();
            updateActiveTabSortUI();
            renderActionsForTab(tab);
            refreshMealSearchScreenMode();
        }
    }

    async function loadAndRender() {
        if (state._mealSearchRestoreSkipCarouselSyncOnce) {
            state._mealSearchRestoreSkipCarouselSyncOnce = false;
            syncCarouselToState(); // выставить карусель на нужную вкладку до любого чтения
        } else {
            syncMealSearchTabFromCarouselScroll();
        }
        const requestId = ++loadRequestId;
        const qProducts = String(state.mealSearchQueryByTab?.products || '').toLowerCase().trim();
        const qRecipes = String(state.mealSearchQueryByTab?.recipes || '').toLowerCase().trim();
        const qBase = String(state.mealSearchQueryByTab?.base || '').toLowerCase().trim();
        const hasProductsTokenSearch = getMealSearchPrimaryToken(qProducts).length >= 2;
        const hasRecipesTokenSearch = getMealSearchPrimaryToken(qRecipes).length >= 2;

        renderActionsForTab(state.mealSearchTab);

        // SWR (stale‑while‑revalidate): если уже есть список — не очищаем его, пока не придут новые данные.
        // Лоадер показываем только при первом открытии / когда список реально пуст.
        const ensureLoadingIfEmpty = (el, text) => {
            if (!el) return;
            const hasAnyContent = (el.childNodes && el.childNodes.length > 0) && String(el.textContent || '').trim().length > 0;
            if (!hasAnyContent) {
                el.innerHTML = `<div class="meal-search-empty meal-search-empty--loading">${text}</div>`;
            }
        };
        ensureLoadingIfEmpty(listAll, 'Загрузка истории…');
        ensureLoadingIfEmpty(listProducts, 'Загрузка продуктов…');
        ensureLoadingIfEmpty(listRecipes, 'Загрузка рецептов…');
        ensureLoadingIfEmpty(listBase, 'Загрузка…');

        const historyPreview = await getHistoryPreview('recentlyUsed', 20);
        if (requestId !== loadRequestId) return;
        renderMixedFoodAndRecipes(listAll, historyPreview?.foods || [], historyPreview?.recipes || [], loadAndRender);

        if (hasProductsTokenSearch || hasRecipesTokenSearch) {
            await mealSearchIndexReadyPromise;
            if (requestId !== loadRequestId) return;
        }

        // Продукты / рецепты: постранично по сортировке + поиск по searchTokens любого слова.
        const sortProducts = state.mealSearchSortByTab?.products || 'new';
        const sortRecipes = state.mealSearchSortByTab?.recipes || 'new';

        // Foods
        if (!productsPager.pages.length || productsPager.sortId !== sortProducts || productsPager.query !== qProducts) {
            productsPager.type = 'foods';
            resetPager(productsPager, { sortId: sortProducts, query: qProducts });
            await ensureNextPageLoaded(productsPager, requestId);
        }
        // Recipes
        if (!recipesPager.pages.length || recipesPager.sortId !== sortRecipes || recipesPager.query !== qRecipes) {
            recipesPager.type = 'recipes';
            resetPager(recipesPager, { sortId: sortRecipes, query: qRecipes });
            await ensureNextPageLoaded(recipesPager, requestId);
        }

        if (requestId !== loadRequestId) return;
        renderProductsOrRecipesPage(listProducts, productsPager, requestId);
        renderProductsOrRecipesPage(listRecipes, recipesPager, requestId);

        listAll.scrollTop = state.mealSearchScrollByTab.all || 0;
        listProducts.scrollTop = state.mealSearchScrollByTab.products || 0;
        listRecipes.scrollTop = state.mealSearchScrollByTab.recipes || 0;
        listBase.scrollTop = state.mealSearchScrollByTab.base || 0;

        // Вкладка "база": FatSecret (англ.) или общий каталог Firestore «база пользователей».
        if (state.mealSearchBaseMode === 'user') {
            basePager.totalResults = null;
            if (!qBase || qBase.length < 2) {
                basePager.query = '';
                basePager.page = 0;
                basePager.exhausted = false;
                basePager.userCatalogLastDoc = null;
                listBase.innerHTML = `<div class="meal-search-empty">Начните вводить (минимум 2 символа)</div>`;
            } else if (state.mealSearchTab === 'base') {
                await loadAndRenderBaseTabUserCatalog(qBase, requestId, { append: false });
            } else {
                basePager.query = '';
                listBase.innerHTML = `<div class="meal-search-empty">Откройте вкладку «база», чтобы выполнить поиск</div>`;
            }
        } else if (!qBase || qBase.length < 2) {
            basePager.query = '';
            basePager.page = 0;
            basePager.totalResults = null;
            basePager.exhausted = false;
            listBase.innerHTML = `<div class="meal-search-empty">Начните вводить (минимум 2 символа)</div>`;
        } else if (state.mealSearchTab === 'base') {
            await loadAndRenderBaseTab(qBase, requestId, { append: false });
        } else {
            // Avoid spending FatSecret quota while user isn't actually on the "база" tab.
            listBase.innerHTML = `<div class="meal-search-empty">Откройте вкладку «база», чтобы выполнить поиск</div>`;
        }

        syncCarouselToState();

        scheduleMealSearchCarouselFrame();

        syncMealSearchInputsFromState();
    }

    let mealSearchPostTabReloadTimer = 0;
    function scheduleMealSearchReloadAfterCarouselSettle() {
        if (mealSearchPostTabReloadTimer) {
            clearTimeout(mealSearchPostTabReloadTimer);
        }
        mealSearchPostTabReloadTimer = setTimeout(() => {
            mealSearchPostTabReloadTimer = 0;
            void loadAndRender();
        }, 60);
    }

    inputProducts.addEventListener('input', debounce(() => {
        if (state.mealSearchQueryByTab && typeof state.mealSearchQueryByTab === 'object') {
            state.mealSearchQueryByTab.products = inputProducts.value || '';
        }
        loadAndRender();
    }, 250));

    inputRecipes.addEventListener('input', debounce(() => {
        if (state.mealSearchQueryByTab && typeof state.mealSearchQueryByTab === 'object') {
            state.mealSearchQueryByTab.recipes = inputRecipes.value || '';
        }
        loadAndRender();
    }, 250));

    inputBase.addEventListener('input', debounce(() => {
        if (state.mealSearchQueryByTab && typeof state.mealSearchQueryByTab === 'object') {
            state.mealSearchQueryByTab.base = inputBase.value || '';
        }
        loadAndRender();
    }, 250));

    function renderBasePaginationFooter(requestId) {
        if (requestId !== loadRequestId) return;
        const existing = listBase.querySelector('.meal-search-base-pager');
        if (existing) existing.remove();

        if (!basePager.query || basePager.query.length < 2) return;
        if (basePager.exhausted) return;

        const wrap = createElement('div', 'meal-search-base-pager');
        const btn = createElement('button', 'meal-search-base-pager-btn', 'Показать ещё');
        btn.type = 'button';

        btn.onclick = async () => {
            if (basePager.loading) return;
            basePager.loading = true;
            btn.disabled = true;
            btn.textContent = 'Загрузка…';
            try {
                basePager.page += 1;
                if (state.mealSearchBaseMode === 'user') {
                    await loadAndRenderBaseTabUserCatalog(basePager.query, loadRequestId, { append: true });
                } else {
                    await loadAndRenderBaseTab(basePager.query, loadRequestId, { append: true });
                }
            } finally {
                basePager.loading = false;
            }
        };

        wrap.append(btn);
        listBase.append(wrap);
    }

    async function loadAndRenderBaseTabUserCatalog(searchText, requestId, opts = {}) {
        const append = Boolean(opts.append);
        const prefix = normalizeSearchText(searchText);
        if (!prefix || prefix.length < 2) {
            basePager.query = '';
            basePager.page = 0;
            basePager.totalResults = null;
            basePager.exhausted = false;
            basePager.userCatalogLastDoc = null;
            listBase.innerHTML = `<div class="meal-search-empty">Начните вводить (минимум 2 символа)</div>`;
            return;
        }

        if (!append || basePager.query !== prefix) {
            basePager.query = prefix;
            basePager.page = 0;
            basePager.totalResults = null;
            basePager.exhausted = false;
            basePager.userCatalogLastDoc = null;
        }

        if (!append) {
            listBase.innerHTML = `
                <div class="meal-search-empty meal-search-empty--loading">
                    Поиск в базе пользователей…
                </div>
            `;
        } else {
            const existing = listBase.querySelector('.meal-search-base-pager');
            if (existing) existing.remove();
        }

        const gCol = getGlobalFoodCatalogCollection();
        if (!gCol) {
            if (requestId !== loadRequestId) return;
            listBase.innerHTML = `<div class="meal-search-empty">Каталог недоступен</div>`;
            return;
        }

        const end = `${prefix}\uf8ff`;
        let qy = query(
            gCol,
            where('nameLower', '>=', prefix),
            where('nameLower', '<=', end),
            orderBy('nameLower'),
            limit(basePager.maxResults)
        );
        if (append && basePager.userCatalogLastDoc) {
            qy = query(
                gCol,
                where('nameLower', '>=', prefix),
                where('nameLower', '<=', end),
                orderBy('nameLower'),
                startAfter(basePager.userCatalogLastDoc),
                limit(basePager.maxResults)
            );
        }

        let snap;
        try {
            snap = await getDocs(qy);
        } catch (e) {
            console.warn('globalFoodCatalog search failed', e);
            if (requestId !== loadRequestId) return;
            if (!append) {
                listBase.innerHTML = `<div class="meal-search-empty">Не удалось выполнить поиск. Если Firestore просит индекс — создайте его по ссылке из консоли.</div>`;
            } else {
                showToast('Не удалось загрузить ещё');
            }
            return;
        }

        if (requestId !== loadRequestId) return;

        const docs = snap.docs || [];
        if (!docs.length) {
            if (!append) {
                listBase.innerHTML = `<div class="meal-search-empty">Ничего не найдено в общем каталоге. Сюда попадают только продукты, сохранённые в вашу библиотеку (не FatSecret). Если записей ещё нет — добавьте свой продукт во вкладке В«продукты».</div>`;
            }
            basePager.exhausted = true;
            return;
        }

        if (!append) listBase.innerHTML = '';

        basePager.userCatalogLastDoc = docs[docs.length - 1] || basePager.userCatalogLastDoc;
        basePager.exhausted = docs.length < basePager.maxResults;

        docs.forEach((dSnap) => {
            const row = dSnap.data() || {};
            const catalogId = dSnap.id;
            const pseudoFood = {
                name: String(row.name || 'Продукт').trim(),
                description: String(row.description || '').trim(),
                baseAmount: Number(row.baseAmount || 100),
                baseUnit: String(row.baseUnit || 'г'),
                calories: Number(row.calories || 0),
                protein: Number(row.protein || 0),
                fat: Number(row.fat || 0),
                carbs: Number(row.carbs || 0),
                defaultAmount: Number(row.defaultAmount ?? row.baseAmount ?? 100)
            };

            const itemEl = createElement('div', 'food-item meal-search-item');
            itemEl.dataset.globalFoodCatalogId = catalogId;

            const contentHeader = createElement('div', 'food-info-header-content');
            const header = createElement('div', 'food-info-header');
            const info = createElement('div', 'food-info meal-search-item-info');

            const _gAmt = Number(pseudoFood.defaultAmount || pseudoFood.baseAmount || 100);
            const _gUnit = pseudoFood.baseUnit || 'г';
            const _gM = calcFoodMacrosByAmount(pseudoFood, _gAmt);

            info.innerHTML = `
                ${buildMealSearchFoodNameMarkup(pseudoFood.name, true)}
                ${pseudoFood.description ? `<div class="meal-search-item-desc">${escapeHtml(pseudoFood.description)}</div>` : ''}
                <div class="meal-search-item-macros"><span class="meal-search-item-weight">${_gAmt}${_gUnit}</span>Б ${formatMacro(_gM.protein, 1)} · Ж ${formatMacro(_gM.fat, 1)} · У ${formatMacro(_gM.carbs, 1)} · ${Math.round(_gM.calories)} ккал</div>
            `;

            info.style.cursor = 'pointer';
            info.onclick = (e) => {
                e.stopPropagation();
                openGlobalCatalogItemDetails(catalogId);
            };

            const addBtn = createElement('button', 'food-add-btn meal-search-add-btn');
            addBtn.type = 'button';
            addBtn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24">
                    <title>Plus SVG Icon</title>
                    <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M12 20v-8m0 0V4m0 8h8m-8 0H4"></path>
                </svg>
            `;

            addBtn.onclick = async (e) => {
                e.stopPropagation();
                try {
                    addBtn.disabled = true;
                    const snapRow = await getDoc(doc(gCol, catalogId));
                    if (!snapRow.exists()) {
                        showToast('Запись не найдена');
                        return;
                    }
                    const d = snapRow.data() || {};
                    const foodId = await ensureGlobalCatalogFoodSaved(d, catalogId);
                    if (!foodId) return;
                    await getFoodsMap(true);
                    await addFoodToMeal(foodId);
                    showToast('Продукт добавлен в прием');
                } catch (err) {
                    console.error(err);
                    showToast('Не удалось добавить продукт');
                } finally {
                    addBtn.disabled = false;
                }
            };

            header.append(info, addBtn);
            contentHeader.append(header);
            itemEl.append(contentHeader);
            listBase.append(itemEl);
        });

        renderBasePaginationFooter(requestId);
    }

    function openGlobalCatalogItemDetails(catalogFoodId) {
        const id = String(catalogFoodId || '').trim();
        if (!id) return;

        saveMealPageScroll();
        mealScrollRestorePending = true;

        state.mealSearchReturnTab = state.mealSearchTab || 'all';
        state.foodDetailsSource = 'globalCatalog';
        state.currentFoodId = id;
        state.currentMealItemIndex = null;
        state.currentMealDetailsId = null;
        state.mealView = 'foodDetails';
        renderMealPage();
    }

    async function loadAndRenderBaseTab(query, requestId, opts = {}) {
        const append = Boolean(opts.append);
        // Не дергаем API на пустой строке или одиночной букве.
        if (!query || query.length < 2) {
            basePager.query = '';
            basePager.page = 0;
            basePager.totalResults = null;
            basePager.exhausted = false;
            listBase.innerHTML = `<div class="meal-search-empty">Начните вводить (минимум 2 символа)</div>`;
            return;
        }

        if (!append || basePager.query !== query) {
            basePager.query = query;
            basePager.page = 0;
            basePager.totalResults = null;
            basePager.exhausted = false;
        }

        if (!append) {
            listBase.innerHTML = `
                <div class="meal-search-empty meal-search-empty--loading">
                    Поиск в базе…
                </div>
            `;
        } else {
            const existing = listBase.querySelector('.meal-search-base-pager');
            if (existing) existing.remove();
        }

        let data = null;
        try {
            const resp = await fetch('/api/fatsecret/search', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ q: query, page: basePager.page, maxResults: basePager.maxResults })
            });
            data = await resp.json().catch(() => null);

            if (requestId !== loadRequestId) return;

            if (!resp.ok) {
                if (resp.status === 429 && data?.error === 'quota_exhausted') {
                    const resetAt = data?.quota?.resetAt ? new Date(data.quota.resetAt) : null;
                    const resetText = resetAt ? resetAt.toLocaleString('ru-RU') : 'завтра';
                    listBase.innerHTML = `
                        <div class="meal-search-banner meal-search-banner--limit">
                            <div class="meal-search-banner__title">Лимит базы исчерпан</div>
                            <div class="meal-search-banner__text">
                                Сегодня запросы к базе продуктов недоступны. Счётчик обновится: <strong>${resetText}</strong>.
                            </div>
                        </div>
                    `;
                    return;
                }

                if (!append) {
                    listBase.innerHTML = `<div class="meal-search-empty">Не удалось загрузить базу. Попробуйте позже.</div>`;
                } else {
                    showToast('Не удалось загрузить ещё');
                }
                return;
            }
        } catch (_) {
            if (requestId !== loadRequestId) return;
            if (!append) {
                listBase.innerHTML = `<div class="meal-search-empty">Нет соединения. Проверьте интернет.</div>`;
            } else {
                showToast('Нет соединения');
            }
            return;
        }

        if (requestId !== loadRequestId) return;

        const items = Array.isArray(data?.items) ? data.items : [];
        if (!items.length) {
            const hasCyrillic = /[а-яё]/i.test(query);
            if (!append) {
                listBase.innerHTML = hasCyrillic
                    ? `<div class="meal-search-empty">Ничего не найдено. В бесплатной базе FatSecret результаты обычно на английском — попробуйте запрос на английском (например: <strong>milk</strong>, <strong>banana</strong>).</div>`
                    : `<div class="meal-search-empty">Ничего не найдено</div>`;
            }
            return;
        }

        if (!append) listBase.innerHTML = '';

        const totalResults = Number(data?.meta?.totalResults);
        if (Number.isFinite(totalResults) && totalResults >= 0) {
            basePager.totalResults = totalResults;
        }

        items.forEach((it) => {
            const fatId = String(it.id || '').trim();
            if (!fatId) return;

            const parsed = parseFatSecretDescription(it?.description);
            const hasMacros =
                Number.isFinite(parsed.calories) &&
                Number.isFinite(parsed.protein) &&
                Number.isFinite(parsed.fat) &&
                Number.isFinite(parsed.carbs);

            const pseudoFood = {
                name: String(it?.name || 'Продукт').trim(),
                description: String(it?.brand || '') || '',
                baseAmount: Number(parsed.baseAmount || 100),
                baseUnit: String(parsed.baseUnit || 'г'),
                calories: hasMacros ? Number(parsed.calories) : 0,
                protein: hasMacros ? Number(parsed.protein) : 0,
                fat: hasMacros ? Number(parsed.fat) : 0,
                carbs: hasMacros ? Number(parsed.carbs) : 0,
                defaultAmount: Number(parsed.baseAmount || 100)
            };

            const itemEl = createElement('div', 'food-item meal-search-item');
            itemEl.dataset.fatsecretId = fatId;

            const contentHeader = createElement('div', 'food-info-header-content');
            const header = createElement('div', 'food-info-header');
            const info = createElement('div', 'food-info meal-search-item-info');

            const _fAmt = Number(pseudoFood.defaultAmount || pseudoFood.baseAmount || 100);
            const _fUnit = pseudoFood.baseUnit || 'г';
            const _fM = hasMacros ? calcFoodMacrosByAmount(pseudoFood, _fAmt) : null;
            const descText = String(it?.description || '').trim();

            info.innerHTML = `
                <div class="meal-search-item-name">${pseudoFood.name}</div>
                ${descText ? `<div class="meal-search-item-desc">${escapeHtml(descText)}</div>` : ''}
                ${_fM
                    ? `<div class="meal-search-item-macros"><span class="meal-search-item-weight">${_fAmt}${_fUnit}</span>Б ${formatMacro(_fM.protein, 1)} · Ж ${formatMacro(_fM.fat, 1)} · У ${formatMacro(_fM.carbs, 1)} · ${Math.round(_fM.calories)} ккал</div>`
                    : `<div class="meal-search-item-macros">Детали · выберите порцию</div>`}
            `;

            info.style.cursor = 'pointer';
            info.onclick = async (e) => {
                e.stopPropagation();
                openFatSecretItemDetails(it);
            };

            const addBtn = createElement('button', 'food-add-btn meal-search-add-btn');
            addBtn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24">
                    <title>Plus SVG Icon</title>
                    <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M12 20v-8m0 0V4m0 8h8m-8 0H4"></path>
                </svg>
            `;
            addBtn.type = 'button';

            addBtn.onclick = async (e) => {
                e.stopPropagation();
                try {
                    addBtn.disabled = true;
                    const foodId = await ensureFatSecretFoodSaved(it);
                    if (!foodId) return;
                    await addFoodToMeal(foodId);
                    showToast('Продукт добавлен в прием');
                } catch (err) {
                    console.error(err);
                    showToast('Не удалось добавить продукт');
                } finally {
                    addBtn.disabled = false;
                }
            };

            header.append(info, addBtn);
            contentHeader.append(header);
            itemEl.append(contentHeader);
            listBase.append(itemEl);
        });

        const nextCount = (basePager.page + 1) * basePager.maxResults;
        if (Number.isFinite(basePager.totalResults) && basePager.totalResults != null) {
            basePager.exhausted = nextCount >= basePager.totalResults;
        } else {
            basePager.exhausted = items.length < basePager.maxResults;
        }

        renderBasePaginationFooter(requestId);
    }

    function parseFatSecretDescription(desc) {
        const raw = String(desc || '');
        // Typical: "Per 100g - Calories: 89kcal | Fat: 0.3g | Carbs: 22.8g | Protein: 1.1g"
        const perMatch = raw.match(/Per\s+(\d+(?:[.,]\d+)?)\s*([a-zA-Z\u0430-\u044f\u0410-\u042f]+)/i);
        const baseAmount = perMatch ? Number(String(perMatch[1]).replace(',', '.')) : 100;
        const baseUnit = perMatch ? String(perMatch[2]).toLowerCase() : 'g';

        const cal = raw.match(/Calories:\s*([\d.,]+)\s*kcal/i);
        const fat = raw.match(/Fat:\s*([\d.,]+)\s*g/i);
        const carbs = raw.match(/Carbs?:\s*([\d.,]+)\s*g/i);
        const prot = raw.match(/Protein:\s*([\d.,]+)\s*g/i);

        const toNum = (m) => (m ? Number(String(m[1]).replace(',', '.')) : null);
        return {
            baseAmount: Number.isFinite(baseAmount) && baseAmount > 0 ? baseAmount : 100,
            baseUnit: baseUnit === 'g' || baseUnit === 'гр' || baseUnit === 'г' ? 'г' : baseUnit,
            calories: toNum(cal),
            fat: toNum(fat),
            carbs: toNum(carbs),
            protein: toNum(prot)
        };
    }

    function escapeHtml(s) {
        return String(s || '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');
    }

    async function ensureFatSecretFoodSaved(searchItem) {
        const fatId = String(searchItem?.id || '').trim();
        if (!fatId) return null;

        const foodsMap = await getFoodsMap();
        const existingId = Object.keys(foodsMap).find((id) => {
            const f = foodsMap[id];
            return f && f.source === 'fatsecret' && String(f.externalId || '') === fatId;
        });
        if (existingId) return existingId;

        const parsed = parseFatSecretDescription(searchItem?.description);
        const hasMacros =
            Number.isFinite(parsed.calories) &&
            Number.isFinite(parsed.protein) &&
            Number.isFinite(parsed.fat) &&
            Number.isFinite(parsed.carbs);

        // Если поиск не дал БЖУ — подтянем детали и возьмём первую подходящую порцию.
        let payload = null;
        if (hasMacros) {
            payload = {
                name: String(searchItem?.name || 'Продукт').trim(),
                description: String(searchItem?.brand || '').trim() || String(searchItem?.description || '').trim(),
                calories: Number(parsed.calories),
                protein: Number(parsed.protein),
                fat: Number(parsed.fat),
                carbs: Number(parsed.carbs),
                baseAmount: Number(parsed.baseAmount || 100),
                baseUnit: String(parsed.baseUnit || 'г'),
                defaultAmount: Number(parsed.baseAmount || 100),
                source: 'fatsecret',
                externalId: fatId
            };
        } else {
            const resp = await fetch('/api/fatsecret/food', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ foodId: fatId })
            });
            const data = await resp.json().catch(() => null);
            if (!resp.ok) throw new Error(data?.message || 'fatsecret_food_failed');

            const food = data?.food;
            const servingsRaw = food?.servings?.serving;
            const servings = Array.isArray(servingsRaw) ? servingsRaw : (servingsRaw ? [servingsRaw] : []);
            const pick =
                servings.find((s) => String(s.metric_serving_unit || '').toLowerCase() === 'g' && Number(s.metric_serving_amount || 0) === 100) ||
                servings.find((s) => String(s.metric_serving_unit || '').toLowerCase() === 'g') ||
                servings[0] ||
                null;
            if (!pick) throw new Error('fatsecret_no_servings');

            payload = {
                name: String(food?.food_name || searchItem?.name || 'Продукт').trim(),
                description: String(food?.food_description || searchItem?.description || '').trim(),
                calories: Number(pick.calories || 0),
                protein: Number(pick.protein || 0),
                fat: Number(pick.fat || 0),
                carbs: Number(pick.carbohydrate || 0),
                baseAmount: Number(pick.metric_serving_amount || 100) || 100,
                baseUnit: String(pick.metric_serving_unit || 'г') || 'г',
                defaultAmount: Number(pick.metric_serving_amount || 100) || 100,
                source: 'fatsecret',
                externalId: fatId
            };
        }

        const foodId = await addFood(payload);
        await getFoodsMap(true);
        return foodId;
    }

    function openFatSecretItemDetails(searchItem) {
        const fatId = String(searchItem?.id || '').trim();
        if (!fatId) return;

        saveMealPageScroll();
        mealScrollRestorePending = true;

        state.mealSearchReturnTab = state.mealSearchTab || 'all';
        state.fatsecretDetails = {
            foodId: fatId,
            fromSearch: {
                id: fatId,
                name: String(searchItem?.name || '').trim(),
                description: String(searchItem?.description || '').trim(),
                brand: String(searchItem?.brand || '').trim()
            }
        };

        state.foodDetailsSource = 'fatsecret';
        state.currentMealItemIndex = null;
        state.currentMealDetailsId = null;
        state.mealView = 'foodDetails';
        renderMealPage();
    }

    let mealSearchViewportSyncFrame = 0;
    const mealSearchViewportSyncTimers = new Set();

    function syncMealSearchBodyViewportHeight() {
        mealSearchViewportSyncFrame = 0;
        if (!screen.isConnected || !body.isConnected) return;

        if (typeof syncBottomNavClearanceVar === 'function') {
            try {
                syncBottomNavClearanceVar();
            } catch (_) {}
        }

        const viewport = window.visualViewport;
        const viewportBottom = Math.round(
            (viewport?.offsetTop || 0) +
            (viewport?.height || window.innerHeight || document.documentElement.clientHeight || 0)
        );
        if (!viewportBottom) return;

        const bodyRect = body.getBoundingClientRect();
        if (!Number.isFinite(bodyRect.top)) return;

        const nextBodyHeight = Math.max(0, Math.floor(viewportBottom - bodyRect.top));
        if (!nextBodyHeight) return;

        const nextHeightPx = `${nextBodyHeight}px`;
        if (body.style.height !== nextHeightPx) {
            body.style.height = nextHeightPx;
            body.style.maxHeight = nextHeightPx;
        }
    }

    function scheduleMealSearchBodyViewportHeightSync(delay = 0) {
        if (delay > 0) {
            const timerId = window.setTimeout(() => {
                mealSearchViewportSyncTimers.delete(timerId);
                scheduleMealSearchBodyViewportHeightSync();
            }, delay);
            mealSearchViewportSyncTimers.add(timerId);
            return;
        }

        if (mealSearchViewportSyncFrame) {
            cancelAnimationFrame(mealSearchViewportSyncFrame);
        }

        mealSearchViewportSyncFrame = requestAnimationFrame(syncMealSearchBodyViewportHeight);
    }

    const handleMealSearchViewportChange = () => {
        scheduleMealSearchBodyViewportHeightSync();
    };

    body.append(carousel);
    screen.append(topRow, controlsStrip, body);
    attachMealOverlayBottomNavSync(screen, () => {
        setMealBottomNavOverlayMode(buildMealSearchBottomNavConfig(state.mealSearchTab || 'all'));
        scheduleMealSearchBodyViewportHeightSync();
    });
    pushMealOverlay(screen, { isSearch: true });

    window.addEventListener('resize', handleMealSearchViewportChange, { passive: true });
    window.addEventListener('orientationchange', handleMealSearchViewportChange, { passive: true });
    window.visualViewport?.addEventListener?.('resize', handleMealSearchViewportChange, { passive: true });
    window.visualViewport?.addEventListener?.('scroll', handleMealSearchViewportChange, { passive: true });

    appendMealOverlayCleanup(screen, () => {
        if (mealSearchViewportSyncFrame) {
            cancelAnimationFrame(mealSearchViewportSyncFrame);
            mealSearchViewportSyncFrame = 0;
        }
        mealSearchViewportSyncTimers.forEach((timerId) => clearTimeout(timerId));
        mealSearchViewportSyncTimers.clear();
        window.removeEventListener('resize', handleMealSearchViewportChange);
        window.removeEventListener('orientationchange', handleMealSearchViewportChange);
        window.visualViewport?.removeEventListener?.('resize', handleMealSearchViewportChange);
        window.visualViewport?.removeEventListener?.('scroll', handleMealSearchViewportChange);
        body.style.removeProperty('height');
        body.style.removeProperty('max-height');
    });

    scheduleMealSearchBodyViewportHeightSync();
    scheduleMealSearchBodyViewportHeightSync(140);
    scheduleMealSearchBodyViewportHeightSync(320);

    scheduleMealSearchCarouselFrame();

    if (mealOverlayEl) {
        mealOverlayEl.classList.add('meal-overlay-layer--search');
    }

    // Тёплая загрузка кэша рецептов (getRecipes уже вызывается в loadAndRender для панелей).
    getRecipes('').catch(() => {});

    loadAndRender();
}


// ================================ страница поиск продуктов для рецепта
async function renderRecipeFoodSearch() {
    ensureMealShell();
    setMealBaseTopBarVisible(false);

    if (typeof state.recipeFoodSearchQuery !== 'string') {
        state.recipeFoodSearchQuery = '';
    }

    const screen = createElement('div', 'meal-search-screen recipe-food-search-screen meal-search-screen--fill');
    const sticky = createElement('div', 'meal-search-sticky');
    const body = createElement('div', 'meal-search-body');

    const handleBack = () => {
        state.recipeIngredientEditIndex = null;
        state.mealView = state.createRecipeBackTarget === 'editRecipe' ? 'editRecipe' : 'recipe';

        if (hasUnderlyingMealSearch()) {
            popMealOverlay();
            return;
        }

        renderMealPage();
    };

    const topRow = createElement('div', 'meal-search-topbar meal-search-topbar--bottom-nav-mode recipe-food-search-topbar');
    const title = createElement('h3', 'create-food-sticky-h3 recipe-food-search-title', 'Продукты для рецепта');
    topRow.append(title);

    const searchControls = createElement('div', 'recipe-food-search-controls');
    const searchWrap = createElement('div', 'meal-search-box recipe-food-search-input-wrap');

    const searchInput = createElement('input', 'meal-search-input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Поиск продуктов';
    searchInput.value = state.recipeFoodSearchQuery || '';
    searchInput.autocomplete = 'off';
    searchInput.spellcheck = false;

    const searchIcon = createElement('div', 'meal-search-icon recipe-food-search-input-icon');
    searchIcon.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24">
            <path fill="currentColor" d="m21.53 20.47l-4.694-4.694a8 8 0 1 0-1.06 1.06l4.694 4.694a.75.75 0 1 0 1.06-1.06M4.5 10.5a6 6 0 1 1 12 0a6 6 0 0 1-12 0"/>
        </svg>
    `;

    const clearBtn = createElement('button', 'meal-search-clear-btn');
    clearBtn.type = 'button';
    clearBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24">
            <path fill="currentColor" d="M6.225 4.811a1 1 0 0 0-1.414 1.414L10.586 12l-5.775 5.775a1 1 0 1 0 1.414 1.414L12 13.414l5.775 5.775a1 1 0 0 0 1.414-1.414L13.414 12l5.775-5.775a1 1 0 0 0-1.414-1.414L12 10.586z"/>
        </svg>
    `;

    const sortBtn = createElement('button', 'recipe-food-search-sort-btn');
    sortBtn.type = 'button';
    sortBtn.setAttribute('aria-label', 'Сортировка');
    sortBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="21" height="21" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M4 7h10m-6 5h12m-9 5h6"/>
        </svg>
    `;

    const sortBackdrop = createElement('button', 'meal-search-tab-sort-backdrop');
    sortBackdrop.type = 'button';

    let activeSortDropdown = null;

    function closeSortDropdown() {
        activeSortDropdown?.remove();
        activeSortDropdown = null;
        sortBtn.classList.remove('open');
        sortBackdrop.remove();
    }

    function positionSortDropdown(dropdown) {
        const pad = 12;
        const rect = sortBtn.getBoundingClientRect();
        dropdown.style.position = 'fixed';
        dropdown.style.top = `${rect.bottom + 8}px`;
        dropdown.style.zIndex = '90';
        screen.append(dropdown);
        void dropdown.offsetWidth;

        const vw = window.innerWidth || document.documentElement.clientWidth || 320;
        const menuW = dropdown.getBoundingClientRect().width || dropdown.offsetWidth || 220;
        const halfW = menuW / 2;
        let centerX = rect.left + rect.width / 2;
        centerX = Math.min(vw - pad - halfW, Math.max(pad + halfW, centerX));
        dropdown.style.left = `${Math.round(centerX)}px`;
        dropdown.style.transform = 'translateX(-50%)';
    }

    function buildSortDropdown() {
        const dropdown = createElement('div', 'meal-search-tab-sort-menu');
        const currentSort = getMealSearchSortForTab('products');

        getMealSearchSortOptionsByTab('products').forEach(option => {
            const item = createElement(
                'button',
                `meal-search-tab-sort-item${option.id === currentSort ? ' active' : ''}`,
                option.label
            );
            item.type = 'button';
            item.onclick = async (e) => {
                e.stopPropagation();
                setMealSearchCurrentSort(option.id, 'products');
                closeSortDropdown();
                await loadAndRenderFoods();
            };
            dropdown.append(item);
        });

        return dropdown;
    }

    sortBtn.onclick = (e) => {
        e.stopPropagation();
        if (activeSortDropdown) {
            closeSortDropdown();
            return;
        }

        const dropdown = buildSortDropdown();
        activeSortDropdown = dropdown;
        sortBtn.classList.add('open');
        positionSortDropdown(dropdown);
        screen.append(sortBackdrop);
    };

    sortBackdrop.onclick = closeSortDropdown;

    function updateRecipeSearchClearBtn() {
        const hasValue = String(searchInput.value || '').trim().length > 0;
        clearBtn.style.display = hasValue ? 'flex' : 'none';
    }

    clearBtn.onclick = () => {
        searchInput.value = '';
        state.recipeFoodSearchQuery = '';
        updateRecipeSearchClearBtn();
        loadAndRenderFoods();
        searchInput.focus();
    };

    searchWrap.append(searchIcon, searchInput, clearBtn);
    searchControls.append(searchWrap, sortBtn);
    updateRecipeSearchClearBtn();

    const list = createElement('div', 'food-list meal-search-list recipe-food-search-list');

    async function loadAndRenderFoods() {
        const query = (state.recipeFoodSearchQuery || '').trim();
        const foods = sortFoodsForMealSearch(await getFoods(query), {
            tab: 'products',
            sort: getMealSearchSortForTab('products')
        });

        list.innerHTML = '';

        if (!foods.length) {
            list.append(createElement('div', 'meal-search-empty', 'Ничего не найдено'));
            return;
        }

        renderRecipeFoodSearchList(list, foods, loadAndRenderFoods);
    }

    let searchTimer = null;
    searchInput.oninput = (e) => {
        state.recipeFoodSearchQuery = e.target.value;
        updateRecipeSearchClearBtn();

        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            loadAndRenderFoods();
        }, 180);
    };

    sticky.append(topRow, searchControls);
    body.append(list);
    screen.append(sticky, body);

    attachMealOverlayBottomNavSync(screen, () => {
        setMealBottomNavOverlayMode({
            visible: true,
            onBack: handleBack,
            actionVisible: false,
            secondaryActionVisible: false
        });
    });

    pushMealOverlay(screen, { isSearch: true });
    await loadAndRenderFoods();
}
async function renderRecipeFoodPreview() {
    ensureMealShell();
    setMealBaseTopBarVisible(false);

    const foodsMap = await getFoodsMap();
    const food = foodsMap[state.recipeSelectedFoodId];

    if (!food) {
        const container = createElement('div', 'create-food');
        const backBtn = createElement('button', 'back-btn');
        backBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24">
                <title>Ios-arrow-ltr-24-filled SVG Icon</title>
                <path fill="currentColor" d="M12.727 3.687a1 1 0 1 0-1.454-1.374l-8.5 9a1 1 0 0 0 0 1.374l8.5 9.001a1 1 0 1 0 1.454-1.373L4.875 12z"></path>
            </svg>
        `;

        backBtn.onclick = () => {
            state.mealView = state.recipeFoodPreviewBackTarget === 'recipeForm'
                ? (state.createRecipeBackTarget === 'editRecipe' ? 'editRecipe' : 'recipe')
                : 'recipeFoodSearch';
            if (hasUnderlyingMealSearch()) {
                popMealOverlay();
                return;
            }
            renderMealPage();
        };

        container.append(
            createElement('h3', null, 'Продукт не найден')
        );

        attachMealOverlayBottomNavSync(container, () => {
            setMealBottomNavOverlayMode({
                visible: true,
                onBack: () => backBtn.onclick?.(),
                actionVisible: false,
                secondaryActionVisible: false
            });
        });

        pushMealOverlay(container);
        return;
    }

    const draft = getRecipeDraft();
    const editIndex = Number.isInteger(state.recipeIngredientEditIndex)
        ? state.recipeIngredientEditIndex
        : -1;
    const editingIngredient = editIndex >= 0 && Array.isArray(draft.ingredients)
        ? draft.ingredients[editIndex]
        : null;
    const foodId = String(state.recipeSelectedFoodId || '').trim();
    const foodWithId = { id: foodId, ...food };
    let currentAmount = Number(
        editingIngredient?.selectedAmount ||
        parseFloat(editingIngredient?.amount) ||
        food.defaultAmount ||
        food.baseAmount ||
        100
    );
    const getPreviewReturnView = () => (
        state.recipeFoodPreviewBackTarget === 'recipeForm'
            ? (state.createRecipeBackTarget === 'editRecipe' ? 'editRecipe' : 'recipe')
            : 'recipeFoodSearch'
    );

    const container = createElement('div', 'create-food');

    const backBtn = createElement('button', 'back-btn');
    backBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24">
            <title>Ios-arrow-ltr-24-filled SVG Icon</title>
            <path fill="currentColor" d="M12.727 3.687a1 1 0 1 0-1.454-1.374l-8.5 9a1 1 0 0 0 0 1.374l8.5 9.001a1 1 0 1 0 1.454-1.373L4.875 12z"></path>
        </svg>
    `;

    backBtn.onclick = () => {
        state.recipeIngredientEditIndex = null;
        state.mealView = getPreviewReturnView();
        if (hasUnderlyingMealSearch()) {
            popMealOverlay();
            return;
        }
        renderMealPage();
    };

    const isRecipeSearchPreview = getPreviewReturnView() === 'recipeFoodSearch';
    const topBarCreateFood = isRecipeSearchPreview
        ? createElement('div', 'topBar-create-food recipe-food-preview-topbar')
        : null;

    const title = createElement('h3', 'create-food-sticky-h3', food.name || 'Продукт');

    const stickyHeader = createElement('div', 'create-food-sticky-header');
    stickyHeader.append(...(topBarCreateFood ? [topBarCreateFood] : []), title);

    const titleDesc = food.description?.trim()
        ? createElement('div', 'food-title-description', food.description)
        : null;

    const topBlockCreateFood = createElement('div', 'topBlock-create-food');
    const amountInput = createElement('input', 'input');
    amountInput.type = 'number';
    amountInput.placeholder = 'Порция';
    amountInput.value = currentAmount;

    const unitInput = createElement('input', 'input');
    unitInput.value = food.baseUnit || 'г';
    unitInput.disabled = true;

    const saveBtn = createElement('button', 'food-add-btn meal-search-add-btn');
    saveBtn.type = 'button';
    saveBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24">
            <title>Plus SVG Icon</title>
            <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M12 20v-8m0 0V4m0 8h8m-8 0H4"></path>
        </svg>
    `;

    const currentValuesWrap = createElement('div', 'food-current-card');
    function renderCurrentValuesBlock() {
        const currentValues = getScaledFoodValues(
            food,
            Number(amountInput.value) || Number(food.defaultAmount || food.baseAmount || 100)
        );

        const circumference = 301.59;
        const carbsLen = (currentValues.carbsPercent / 100) * circumference;
        const fatLen = (currentValues.fatPercent / 100) * circumference;
        const proteinLen = (currentValues.proteinPercent / 100) * circumference;

        currentValuesWrap.innerHTML = `
            <div class="food-current-ring-block">
                <div class="food-current-ring">
                    <svg viewBox="0 0 120 120" class="food-ring-svg">
                        <circle class="food-ring-bg" cx="60" cy="60" r="48"></circle>

                        <circle
                            class="food-ring-segment food-ring-carbs"
                            cx="60"
                            cy="60"
                            r="48"
                            stroke-dasharray="${carbsLen} ${circumference}"
                            stroke-dashoffset="0"
                        ></circle>

                        <circle
                            class="food-ring-segment food-ring-fat"
                            cx="60"
                            cy="60"
                            r="48"
                            stroke-dasharray="${fatLen} ${circumference}"
                            stroke-dashoffset="-${carbsLen}"
                        ></circle>

                        <circle
                            class="food-ring-segment food-ring-protein"
                            cx="60"
                            cy="60"
                            r="48"
                            stroke-dasharray="${proteinLen} ${circumference}"
                            stroke-dashoffset="-${carbsLen + fatLen}"
                        ></circle>
                    </svg>

                    <div class="food-ring-center">
                        <div class="food-ring-kcal">${currentValues.calories}</div>
                        <div class="food-ring-label">ккал</div>
                    </div>
                </div>
            </div>

            <div class="food-current-macros">
                <div class="food-current-macro food-current-macro-carbs">
                    <div class="food-current-percent">${currentValues.carbsPercent} %</div>
                    <div class="food-current-grams">${String(currentValues.carbs).replace('.', ',')} г</div>
                    <div class="food-current-name">Углев.</div>
                </div>

                <div class="food-current-macro food-current-macro-fat">
                    <div class="food-current-percent">${currentValues.fatPercent} %</div>
                    <div class="food-current-grams">${String(currentValues.fat).replace('.', ',')} г</div>
                    <div class="food-current-name">Жиры</div>
                </div>

                <div class="food-current-macro food-current-macro-protein">
                    <div class="food-current-percent">${currentValues.proteinPercent} %</div>
                    <div class="food-current-grams">${String(currentValues.protein).replace('.', ',')} г</div>
                    <div class="food-current-name">Белки</div>
                </div>
            </div>
        `;
    }

    renderCurrentValuesBlock();

    amountInput.addEventListener('input', () => {
        renderCurrentValuesBlock();
    });

    saveBtn.onclick = async () => {
        const newAmount = Number(amountInput.value || 0);

        if (!newAmount || newAmount <= 0) {
            showToast('Введите корректное количество');
            return;
        }

        try {
            saveBtn.disabled = true;

            addFoodToRecipeDraft(foodWithId, newAmount, editIndex);
            state.recipeIngredientEditIndex = null;
            state.mealView = getPreviewReturnView();

            showToast(editIndex >= 0 ? 'Ингредиент обновлен' : 'Ингредиент добавлен в рецепт');

            if (hasUnderlyingMealSearch()) {
                popMealOverlay();
            } else {
                renderMealPage();
            }
        } catch (error) {
            console.error(error);
            showToast('Ошибка при добавлении');
        } finally {
            saveBtn.disabled = false;
        }
    };

    const passportBlock = createElement('div', 'food-passport-block');
    passportBlock.innerHTML = `
        <div class="food-passport-title">Пищевая ценность</div>
        <div class="food-passport-divider"></div>

        <div class="food-passport-portion-row">
            <span>Порция</span>
            <span>${Number(food.baseAmount || 100)} ${food.baseUnit || 'г'}</span>
        </div>

        <div class="food-passport-bar"></div>

        <div class="food-passport-portion-label">в порции</div>

        <div class="food-passport-bar"></div>

        <div class="food-passport-row food-passport-row-energy">
            <div class="food-passport-name food-passport-name-energy">Энергетическая<br>ценность</div>
            <div class="food-passport-value">${Math.round(Number(food.calories || 0))} кал</div>
        </div>

        <div class="food-passport-row">
            <div class="food-passport-name">Жир</div>
            <div class="food-passport-value">${formatMacro(Number(food.fat || 0), 1)}г</div>
        </div>

        <div class="food-passport-row">
            <div class="food-passport-name">Углеводы</div>
            <div class="food-passport-value">${formatMacro(Number(food.carbs || 0), 1)}г</div>
        </div>

        <div class="food-passport-row food-passport-row-last">
            <div class="food-passport-name">Белок</div>
            <div class="food-passport-value">${formatMacro(Number(food.protein || 0), 1)}г</div>
        </div>

        <div class="food-passport-bar food-passport-bar-bottom"></div>
    `;

    const amountRow = createElement('div', 'food-input-row');
    const unitRow = createElement('div', 'food-input-row');

    const plusMinusIcon = document.createElement('div');
    plusMinusIcon.className = 'food-input-icon';
    plusMinusIcon.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 256 256">
            <title>Plus-minus SVG Icon</title>
            <path fill="currentColor" d="m205.66 61.66l-144 144a8 8 0 0 1-11.32-11.32l144-144a8 8 0 0 1 11.32 11.32M64 112a8 8 0 0 0 16 0V80h32a8 8 0 0 0 0-16H80V32a8 8 0 0 0-16 0v32H32a8 8 0 0 0 0 16h32Zm160 64h-80a8 8 0 0 0 0 16h80a8 8 0 0 0 0-16"/>
        </svg>
    `;

    const listIcon = document.createElement('div');
    listIcon.className = 'food-input-icon';
    listIcon.innerHTML = `
        <svg viewBox="0 0 24 24" width="20" height="20">
            <path d="M8 6h12M8 12h12M8 18h12"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  fill="none"/>
            <circle cx="4" cy="6" r="1.5" fill="currentColor"/>
            <circle cx="4" cy="12" r="1.5" fill="currentColor"/>
            <circle cx="4" cy="18" r="1.5" fill="currentColor"/>
        </svg>
    `;

    amountRow.append(plusMinusIcon, amountInput);
    unitRow.append(listIcon, unitInput);
    topBlockCreateFood.append(amountRow, unitRow);

    container.append(
        stickyHeader,
        ...(titleDesc ? [titleDesc] : []),
        topBlockCreateFood,
        currentValuesWrap,
        passportBlock
    );

    attachMealOverlayBottomNavSync(container, () => {
        setMealBottomNavOverlayMode({
            visible: true,
            onBack: () => backBtn.onclick?.(),
            actionText: 'Добавить в рецепт',
            onAction: () => saveBtn.onclick?.(),
            actionDisabled: false
        });
    });

    pushMealOverlay(container);

    requestAnimationFrame(() => {
        setupCreateFoodStickyTitleBorder({
            titleEl: title,
            watchEl: titleDesc || topBlockCreateFood
        });
    });
}

// =================================================================
// ⚡ Быстрое добавление
// =================================================================
function renderQuickAddStub() {
    ensureMealShell();
    setMealBaseTopBarVisible(false);

    const container = createElement('div', 'create-food create-food-form-page meal-quick-add-page');

    const topBar = createElement('div', 'create-food-topbar');

    const backBtn = createElement('button', 'back-btn');
    backBtn.type = 'button';
    backBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24">
            <path fill="currentColor" d="M12.727 3.687a1 1 0 1 0-1.454-1.374l-8.5 9a1 1 0 0 0 0 1.374l8.5 9.001a1 1 0 1 0 1.454-1.373L4.875 12z"/>
        </svg>
    `;
    backBtn.onclick = () => {
        const target = state.quickAddBackTarget || (hasUnderlyingMealSearch() ? 'search' : 'main');

        if (target === 'main') {
            state.quickAddBackTarget = null;
            closeMealOverlayAndShowMealMain();
            return;
        }

        if (state.mealSearchReturnTab) {
            state.mealSearchTab = state.mealSearchReturnTab;
            state._mealSearchRestoreNoIndicatorAnim = true;
            state._mealSearchRestoreSkipCarouselSyncOnce = true;
        }
        if (hasUnderlyingMealSearch()) {
            popMealOverlay();
            return;
        }
        state.mealView = 'search';
        renderMealSearch();
    };

    const pageTitle = createElement('h3', 'create-food-sticky-h3', 'Быстрое добавление');

    const stickyHeader = createElement('div', 'create-food-sticky-header');
    stickyHeader.append(topBar, pageTitle);

    const formCard = createElement('div', 'create-food-form-card meal-quick-add-form-card');

    function createFormRow(labelText, controlEl, required = false, extraClass = '') {
        const row = createElement('div', `create-food-row ${extraClass}`.trim());
        const labelWrap = createElement('div', 'create-food-row-label-wrap');
        const left = createElement('div', 'create-food-row-label-left');
        const label = createElement('div', 'create-food-row-label', labelText);
        const hint = createElement(
            'div',
            'create-food-row-hint',
            required ? 'обязательно' : 'необязательно'
        );

        left.append(label, hint);
        labelWrap.append(left);

        const controlWrap = createElement('div', 'create-food-row-control');
        controlWrap.append(controlEl);

        row.append(labelWrap, controlWrap);
        return row;
    }

    const name = createElement('input', 'create-food-input');
    name.placeholder = 'Введите название';

    const portion = createElement('input', 'create-food-input');
    portion.type = 'number';
    portion.inputMode = 'decimal';
    portion.placeholder = 'Например 250';

    const protein = createElement('input', 'create-food-input');
    protein.type = 'number';
    protein.inputMode = 'decimal';
    protein.placeholder = '0';

    const fat = createElement('input', 'create-food-input');
    fat.type = 'number';
    fat.inputMode = 'decimal';
    fat.placeholder = '0';

    const carbs = createElement('input', 'create-food-input');
    carbs.type = 'number';
    carbs.inputMode = 'decimal';
    carbs.placeholder = '0';

    const calories = createElement('input', 'create-food-input');
    calories.type = 'number';
    calories.inputMode = 'decimal';
    calories.placeholder = '0';

    const rows = [
        createFormRow('Название', name, true),
        createFormRow('Размер порции', portion, false),
        createFormRow('Белки', protein, false),
        createFormRow('Жиры', fat, false),
        createFormRow('Углеводы', carbs, false),
        createFormRow('Калории', calories, false)
    ];

    rows.forEach((row) => formCard.append(row));

    const saveBtn = createElement('button', 'save-btn create-food-submit-btn', 'Сохранить');
    saveBtn.disabled = true;

    function syncQuickAddBottomNav() {
        setMealBottomNavOverlayMode({
            visible: true,
            onBack: () => backBtn.onclick?.(),
            actionText: 'Сохранить',
            onAction: () => saveBtn.onclick?.(),
            actionDisabled: saveBtn.disabled
        });
    }

    function validateForm() {
        const canSave = String(name.value || '').trim().length > 0;
        saveBtn.disabled = !canSave;
        saveBtn.classList.toggle('active', canSave);
        syncQuickAddBottomNav();
    }

    [name, portion, protein, fat, carbs, calories].forEach((el) => {
        el.addEventListener('input', validateForm);
        el.addEventListener('change', validateForm);
    });

    saveBtn.onclick = async () => {
        if (saveBtn.disabled) return;

        try {
            saveBtn.disabled = true;

            const saved = await addQuickFoodToCurrentMeal({
                name: name.value,
                portionSize: portion.value,
                protein: protein.value,
                fat: fat.value,
                carbs: carbs.value,
                calories: calories.value
            });

            if (!saved) {
                showToast('Не удалось сохранить продукт в прием');
                return;
            }

            showToast('Продукт добавлен в прием');

            const target = state.quickAddBackTarget || (hasUnderlyingMealSearch() ? 'search' : 'main');

            if (target === 'main') {
                state.quickAddBackTarget = null;
                closeMealOverlayAndShowMealMain();
                return;
            }

            if (state.mealSearchReturnTab) {
                state.mealSearchTab = state.mealSearchReturnTab;
                state._mealSearchRestoreNoIndicatorAnim = true;
                state._mealSearchRestoreSkipCarouselSyncOnce = true;
            }

            if (hasUnderlyingMealSearch()) {
                popMealOverlay();
            } else {
                state.mealView = 'search';
                renderMealSearch();
            }
        } catch (error) {
            console.error(error);
            showToast('Не удалось сохранить продукт в прием');
        } finally {
            if (container.isConnected) {
                saveBtn.disabled = false;
                validateForm();
            }
        }
    };

    attachMealOverlayBottomNavSync(container, syncQuickAddBottomNav);
    container.append(stickyHeader, formCard);
    pushMealOverlay(container);
    attachCreateFoodKeyboardAvoidance(container);

    requestAnimationFrame(() => {
        setupCreateFoodStickyTitleBorder({
            titleEl: pageTitle,
            watchEl: formCard
        });
    });

    validateForm();
}

// =================================================================
// ➕ СОЗДАНИЕ ПРОДУКТА
// =================================================================
function renderCreateFood() {
    ensureMealShell();

    const container = createElement('div', 'create-food create-food-form-page');

    const topBar = createElement('div', 'create-food-topbar');

    const backBtn = createElement('button', 'back-btn');
    backBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24">
            <path fill="currentColor" d="M12.727 3.687a1 1 0 1 0-1.454-1.374l-8.5 9a1 1 0 0 0 0 1.374l8.5 9.001a1 1 0 1 0 1.454-1.373L4.875 12z"/>
        </svg>
    `;
    backBtn.onclick = () => {
        const target = state.createFoodBackTarget || 'search';
        state.createFoodBackTarget = null;

        if (target === 'search') {
            if (state.mealSearchReturnTab) {
                state.mealSearchTab = state.mealSearchReturnTab;
                state._mealSearchRestoreNoIndicatorAnim = true;
                state._mealSearchRestoreSkipCarouselSyncOnce = true;
            }
            if (hasUnderlyingMealSearch()) {
                popMealOverlay();
            } else {
                state.mealView = 'search';
                renderMealSearch();
            }
            return;
        }

        if (target === 'recipeFoodSearch') {
            if (hasUnderlyingMealSearch()) {
                popMealOverlay();
            } else {
                state.mealView = 'recipeFoodSearch';
                renderMealPage();
            }
            return;
        }

        state.mealView = target;
        renderMealPage();
    };

    const pageTitle = createElement('h3', 'create-food-sticky-h3', 'Новый продукт');

    const stickyHeader = createElement('div', 'create-food-sticky-header');
    stickyHeader.append(topBar, pageTitle);

    const formCard = createElement('div', 'create-food-form-card');

    function createFormRow(labelText, controlEl, required = true, extraClass = '', rightActionEl = null) {
        const row = createElement('div', `create-food-row ${extraClass}`.trim());

        const labelWrap = createElement('div', 'create-food-row-label-wrap');

        const left = createElement('div', 'create-food-row-label-left');
        const label = createElement('div', 'create-food-row-label', labelText);
        const hint = createElement(
            'div',
            'create-food-row-hint',
            required ? 'обязательно' : 'необязательно'
        );

        left.append(label, hint);

        labelWrap.append(left);

        // 👉 ВСТАВКА КНОПКИ СПРАВА
        if (rightActionEl) {
            const right = createElement('div', 'create-food-row-label-right');
            right.append(rightActionEl);
            labelWrap.append(right);
        }

        const controlWrap = createElement('div', 'create-food-row-control');
        controlWrap.append(controlEl);

        row.append(labelWrap, controlWrap);
        return row;
    }

    const name = createElement('input', 'create-food-input');
    name.placeholder = 'Введите название';

    const description = document.createElement('textarea');
    description.className = 'create-food-input create-food-textarea';
    description.placeholder = 'Краткое описание';
    description.rows = 3;

    let selectedUnit = 'г';
    let selectedPortionMeasureUnit = 'г';
    let customPortionValue = '';
    let isPortionModeActive = false;

    const unitWrap = createElement('div', 'create-food-picker-wrap');
    unitWrap.style.position = 'relative';

    const unitField = createElement('div', 'create-food-input create-food-picker-field');
    unitField.tabIndex = 0;

    const unitValue = createElement('span', 'create-food-picker-value', selectedUnit);

    const unitArrow = createElement('span', 'create-food-picker-arrow');
    unitArrow.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
    `;

    unitField.append(unitValue, unitArrow);

    const unitDropdown = createElement('div', 'create-food-unit-dropdown');
    unitDropdown.style.display = 'none';

    FOOD_NUTRITION_BASIS_OPTIONS.forEach(unit => {
        const option = createElement('button', 'create-food-unit-dropdown-item', unit);
        option.type = 'button';

        option.onclick = (e) => {
            e.stopPropagation();
            selectedUnit = unit;
            unitValue.textContent = unit;
            unitDropdown.style.display = 'none';
            unitWrap.classList.remove('open');
            syncPortionInputState();
            validateForm();
        };

        unitDropdown.append(option);
    });

    unitField.onclick = (e) => {
        e.stopPropagation();
        const isOpen = unitDropdown.style.display === 'block';
        unitDropdown.style.display = isOpen ? 'none' : 'block';
        unitWrap.classList.toggle('open', !isOpen);
    };

    const portionUnitWrap = createElement('div', 'create-food-picker-wrap create-food-portion-unit-wrap');
    portionUnitWrap.style.position = 'relative';

    const portionUnitField = createElement('div', 'create-food-input create-food-picker-field');
    portionUnitField.tabIndex = 0;

    const portionUnitValue = createElement('span', 'create-food-picker-value', selectedPortionMeasureUnit);

    const portionUnitArrow = createElement('span', 'create-food-picker-arrow');
    portionUnitArrow.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
    `;

    portionUnitField.append(portionUnitValue, portionUnitArrow);

    const portionUnitDropdown = createElement('div', 'create-food-unit-dropdown');
    portionUnitDropdown.style.display = 'none';

    FOOD_PORTION_MEASURE_OPTIONS.forEach(unit => {
        const option = createElement('button', 'create-food-unit-dropdown-item', unit);
        option.type = 'button';

        option.onclick = (e) => {
            e.stopPropagation();
            selectedPortionMeasureUnit = unit;
            portionUnitValue.textContent = unit;
            portionUnitDropdown.style.display = 'none';
            portionUnitWrap.classList.remove('open');
            validateForm();
        };

        portionUnitDropdown.append(option);
    });

    portionUnitField.onclick = (e) => {
        e.stopPropagation();
        if (selectedUnit !== 'порция') return;
        const isOpen = portionUnitDropdown.style.display === 'block';
        portionUnitDropdown.style.display = isOpen ? 'none' : 'block';
        portionUnitWrap.classList.toggle('open', !isOpen);
    };

    portionUnitWrap.append(portionUnitField, portionUnitDropdown);

    document.addEventListener('click', () => {
        unitDropdown.style.display = 'none';
        unitWrap.classList.remove('open');
        portionUnitDropdown.style.display = 'none';
        portionUnitWrap.classList.remove('open');
    });

    unitWrap.append(unitField, unitDropdown);

    const portion = createElement('input', 'create-food-input');
    portion.type = 'number';
    portion.inputMode = 'decimal';
    portion.placeholder = '';

    const portionControl = createElement('div', 'create-food-portion-control');
    portionControl.append(portion, portionUnitWrap);

    function syncPortionInputState() {
        const isPortionMode = selectedUnit === 'порция';

        if (!isPortionMode && isPortionModeActive && String(portion.value || '').trim() !== '') {
            customPortionValue = String(portion.value).trim();
        }

        if (isPortionMode) {
            portion.value = customPortionValue || '';
            portion.placeholder = '';
        } else {
            portion.value = String(FOOD_LOCKED_PORTION_AMOUNT);
            portion.placeholder = String(FOOD_LOCKED_PORTION_AMOUNT);
            portionUnitDropdown.style.display = 'none';
            portionUnitWrap.classList.remove('open');
        }

        portion.readOnly = !isPortionMode;
        portion.classList.toggle('is-locked', !isPortionMode);
        portionUnitWrap.style.display = isPortionMode ? '' : 'none';
        isPortionModeActive = isPortionMode;
    }

    const protein = createElement('input', 'create-food-input');
    protein.type = 'number';
    protein.inputMode = 'decimal';
    protein.placeholder = '0';

    const fat = createElement('input', 'create-food-input');
    fat.type = 'number';
    fat.inputMode = 'decimal';
    fat.placeholder = '0';

    const carbs = createElement('input', 'create-food-input');
    carbs.type = 'number';
    carbs.inputMode = 'decimal';
    carbs.placeholder = '0';

    const calories = createElement('input', 'create-food-input');
    calories.type = 'number';
    calories.inputMode = 'decimal';
    calories.placeholder = '0';

    syncPortionInputState();

    const rows = [
        createFormRow('Название', name, true),
        createFormRow('Описание', description, true, 'is-textarea'),
        createFormRow('Ед. изм.', unitWrap, true),
        createFormRow('Размер порции', portionControl, true),
        createFormRow('Белки', protein, true),
        createFormRow('Жиры', fat, true),
        createFormRow('Углеводы', carbs, true),
        createFormRow('Калории', calories, true)
    ];

    rows.forEach(row => formCard.append(row));

    const saveBtn = createElement('button', 'save-btn create-food-submit-btn', 'Сохранить продукт');
    saveBtn.disabled = true;

    function syncCreateFoodBottomNav() {
        setMealBottomNavOverlayMode({
            visible: true,
            onBack: () => backBtn.onclick?.(),
            actionText: 'Сохранить продукт',
            onAction: () => saveBtn.onclick?.(),
            actionDisabled: saveBtn.disabled
        });
    }

    function isFilled(value) {
        return String(value ?? '').trim() !== '';
    }

    function validateForm() {
        const isPortionMode = selectedUnit === 'порция';
        const allFilled =
            isFilled(name.value) &&
            isFilled(description.value) &&
            isFilled(selectedUnit) &&
            isFilled(portion.value) &&
            (!isPortionMode || isFilled(selectedPortionMeasureUnit)) &&
            isFilled(protein.value) &&
            isFilled(fat.value) &&
            isFilled(carbs.value) &&
            isFilled(calories.value);

        saveBtn.disabled = !allFilled;
        saveBtn.classList.toggle('active', allFilled);
        syncCreateFoodBottomNav();
    }

    [
        name,
        description,
        unitField,
        portion,
        portionUnitField,
        protein,
        fat,
        carbs,
        calories
    ].forEach(el => {
        el.addEventListener('input', validateForm);
        el.addEventListener('change', validateForm);
    });

    saveBtn.onclick = async () => {
        if (saveBtn.disabled) return;

        try {
            saveBtn.disabled = true;
            const nutritionPayload = buildFoodNutritionPayload(
                selectedUnit,
                portion.value,
                selectedPortionMeasureUnit
            );
            const foodId = await addFood({
                name: name.value.trim(),
                description: description.value.trim(),
                ...nutritionPayload,
                protein: Number(protein.value),
                fat: Number(fat.value),
                carbs: Number(carbs.value),
                calories: Number(calories.value)
            });

            if (!foodId) {
                showToast('Не удалось сохранить: нет доступа к библиотеке продуктов (режим, клиент или вход в аккаунт).');
                return;
            }

            foodsPreviewCache = null;
            foodsPreviewCacheKey = null;
            historyPreviewCache = null;
            historyPreviewCacheKey = null;

            const newFood = {
                id: foodId,
                name: name.value.trim(),
                description: description.value.trim(),
                ...nutritionPayload,
                protein: Number(protein.value),
                fat: Number(fat.value),
                carbs: Number(carbs.value),
                calories: Number(calories.value)
            };

            const target = state.createFoodBackTarget || 'search';
            state.createFoodBackTarget = null;

            if (target === 'search') {
                if (state.mealSearchReturnTab) {
                    state.mealSearchTab = state.mealSearchReturnTab;
                    state._mealSearchRestoreNoIndicatorAnim = true;
                    state._mealSearchRestoreSkipCarouselSyncOnce = true;
                }
                if (hasUnderlyingMealSearch()) {
                    popMealOverlay();
                    prependFoodCardToSearchDOM(newFood);
                } else {
                    state.mealView = 'search';
                    renderMealSearch();
                }
            } else if (target === 'recipeFoodSearch') {
                if (hasUnderlyingMealSearch()) {
                    popMealOverlay();
                } else {
                    state.mealView = 'recipeFoodSearch';
                    renderMealPage();
                }
            } else {
                state.mealView = target;
                renderMealPage();
            }
        } catch (e) {
            console.error(e);
            const hint = e?.code === 'permission-denied'
                ? 'Нет прав на запись в библиотеку.'
                : 'Проверьте сеть и что правила Firestore разрешают запись.';
            showToast(`Не удалось сохранить продукт. ${hint}`);
        } finally {
            saveBtn.disabled = false;
            validateForm();
        }
    };

    attachMealOverlayBottomNavSync(container, syncCreateFoodBottomNav);
    container.append(stickyHeader, formCard);
    pushMealOverlay(container);
    attachCreateFoodKeyboardAvoidance(container);

    requestAnimationFrame(() => {
        setupCreateFoodStickyTitleBorder({
            titleEl: pageTitle,
            watchEl: formCard
        });
    });

    validateForm();
}

// =================================================================
// ➕ СОЗДАНИЕ рецепта
// =================================================================
// =============== хелперы
function isRecipeFilled(value) {
    return String(value ?? '').trim() !== '';
}

function isRecipeDraftValid() {
    const draft = getRecipeDraft();

    const hasTitle = isRecipeFilled(draft.title);
    const hasServings = Number(draft.servings || 0) > 0;

    const filledIngredients = (draft.ingredients || []).filter(item =>
        isRecipeFilled(item?.name) && isRecipeFilled(item?.amount)
    );

    const hasPhoto = Array.isArray(draft.photos) && draft.photos.length >= 1;

    return (
        hasTitle &&
        hasServings &&
        filledIngredients.length >= 3 &&
        hasPhoto
    );
}

function updateRecipeSaveButtonState(container = document) {
    const btn = container.querySelector('.recipe-create-save-btn');
    if (!btn) return;

    const valid = isRecipeDraftValid();

    btn.disabled = !valid;
    btn.classList.toggle('disabled', !valid);
    btn.classList.toggle('active', valid);
}









// =============== страница
function renderCreateRecipe() {
    ensureMealShell();
    setMealBaseTopBarVisible(false);

    const draft = getRecipeDraft();

    const container = createElement('div', 'create-food create-food-form-page recipe-create-page');

    const topBar = createElement('div', 'create-food-topbar');

    const backBtn = createElement('button', 'back-btn');
    backBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24">
            <path fill="currentColor" d="M12.727 3.687a1 1 0 1 0-1.454-1.374l-8.5 9a1 1 0 0 0 0 1.374l8.5 9.001a1 1 0 1 0 1.454-1.373L4.875 12z"/>
        </svg>
    `;
    backBtn.onclick = () => {
        state.mealView = 'search';
        if (state.mealSearchReturnTab) {
            state.mealSearchTab = state.mealSearchReturnTab;
            state._mealSearchRestoreNoIndicatorAnim = true;
            state._mealSearchRestoreSkipCarouselSyncOnce = true;
        }
        if (hasUnderlyingMealSearch()) {
            popMealOverlay();
        } else {
            renderMealPage();
        }
    };

    const saveBtn = createElement('button', 'save-btn create-food-submit-btn recipe-create-save-btn', 'Сохранить рецепт');
    saveBtn.disabled = true;

    function syncCreateRecipeBottomNav() {
        setMealBottomNavOverlayMode({
            visible: true,
            onBack: () => backBtn.onclick?.(),
            actionText: 'Сохранить рецепт',
            onAction: () => saveBtn.onclick?.(),
            actionDisabled: saveBtn.disabled
        });
    }


    const pageTitle = createElement('h3', 'create-food-sticky-h3', 'Новый рецепт');

    const stickyHeader = createElement('div', 'create-food-sticky-header');
    stickyHeader.append(topBar, pageTitle);

    const formCard = createElement('div', 'create-food-form-card create-food-form-card--new-recipe');

    function createFormRow(labelText, controlEl, required = true, extraClass = '', rightActionEl = null) {
        const row = createElement('div', `create-food-row ${extraClass}`.trim());

        const labelWrap = createElement('div', 'create-food-row-label-wrap');

        const left = createElement('div', 'create-food-row-label-left');
        const label = createElement('div', 'create-food-row-label', labelText);
        const hint = createElement(
            'div',
            'create-food-row-hint',
            required ? 'обязательно' : 'необязательно'
        );

        left.append(label, hint);
        labelWrap.append(left);

        if (rightActionEl) {
            const right = createElement('div', 'create-food-row-label-right');
            right.append(rightActionEl);
            labelWrap.append(right);
        }

        const controlWrap = createElement('div', 'create-food-row-control');
        controlWrap.append(controlEl);

        row.append(labelWrap, controlWrap);
        return row;
    }

    const titleInput = createElement('input', 'create-food-input');
    titleInput.placeholder = 'Введите название';
    titleInput.value = draft.title || '';

    const descriptionInput = document.createElement('textarea');
    descriptionInput.className = 'create-food-input create-food-textarea';
    descriptionInput.placeholder = 'Краткое описание';
    descriptionInput.rows = 3;
    descriptionInput.value = draft.description || '';

    const servingsInput = createElement('input', 'create-food-input');
    servingsInput.type = 'number';
    servingsInput.inputMode = 'decimal';
    servingsInput.placeholder = 'Например 4';
    servingsInput.value = draft.servings || '';
    servingsInput.autocomplete = 'off';

    const ingredientsWrap = createElement('div', 'recipe-form-ingredients-wrap');
    const ingredientsControl = createElement('div', 'recipe-ingredients-control');

    const addIngredientBtn = createElement('button', 'meal-search-main-action recipe-add-ingredient-btn');
    addIngredientBtn.type = 'button';
    addIngredientBtn.innerHTML = `
                             добаваить
                         `;
    addIngredientBtn.onclick = () => {
        state.recipeDraft = draft;
        state.recipeIngredientEditIndex = null;
        state.mealView = 'recipeFoodSearch';
        renderMealPage();
    };

    const ingredientsList = createElement('div', 'recipe-form-ingredients-list');
    const ingredientsTotals = createElement('div', 'recipe-form-ingredients-totals');
    ingredientsWrap.append(ingredientsList, ingredientsTotals);
    ingredientsControl.append(ingredientsWrap);
    function renderIngredientsBlock() {
        const ingredients = Array.isArray(draft.ingredients) ? draft.ingredients : [];
        ingredientsList.innerHTML = '';

        if (!ingredients.length) {
            ingredientsList.append(
                createElement('div', 'meal-search-empty recipe-form-empty', 'Ингредиенты не добавлены')
            );
            ingredientsTotals.innerHTML = '';
            return;
        }

        ingredients.forEach((item, index) => {
            const row = createElement('div', 'recipe-ingredient-row');

            const left = createElement('div', 'recipe-ingredient-main');
            const name = createElement('div', 'recipe-ingredient-name', item.name || 'Без названия');
            const amount = createElement('div', 'recipe-ingredient-amount', item.amount || `${item.grams || 0} ${item.baseUnit || 'г'}`);

            const macros = createElement(
                'div',
                'recipe-ingredient-macros',
                `Б ${formatMacro(item.protein, 1)} · Ж ${formatMacro(item.fat, 1)} · У ${formatMacro(item.carbs, 1)} · К ${Math.round(Number(item.calories || 0))}`
            );

            left.append(name, amount, macros);

            const removeBtn = createElement('button', 'recipe-ingredient-remove-btn');
            removeBtn.type = 'button';
            removeBtn.textContent = 'Удалить';
            removeBtn.onclick = (e) => {
                e.stopPropagation();
                draft.ingredients.splice(index, 1);
                renderIngredientsBlock();
                validateRecipeForm();
            };

            row.onclick = () => {
                if (!item.foodId) return;
                state.recipeDraft = draft;
                state.recipeIngredientEditIndex = index;
                state.recipeSelectedFoodId = item.foodId;
                state.recipeFoodPreviewBackTarget = 'recipeForm';
                state.mealView = 'recipeFoodPreview';
                renderMealPage();
            };

            row.append(left, removeBtn);
            ingredientsList.append(row);
        });

        const totals = calcRecipeIngredientsTotals(draft.ingredients);
        ingredientsTotals.innerHTML = `
            <div class="recipe-ingredients-total-title">Всего</div>
            <div class="recipe-ingredients-total-values">
                <span>Б ${formatMacro(totals.protein, 1)}</span>
                <span>Ж ${formatMacro(totals.fat, 1)}</span>
                <span>У ${formatMacro(totals.carbs, 1)}</span>
                <span>К ${Math.round(totals.calories)}</span>
            </div>
        `;
    }

    titleInput.oninput = () => {
        draft.title = titleInput.value;
        validateRecipeForm();
    };

    descriptionInput.oninput = () => {
        draft.description = descriptionInput.value;
        validateRecipeForm();
    };

    servingsInput.oninput = () => {
        draft.servings = servingsInput.value;
        validateRecipeForm();
    };

    formCard.append(
        createFormRow('Название', titleInput, true),
        createFormRow('Описание', descriptionInput, false, 'is-textarea'),
        createFormRow('Кол-во порций', servingsInput, true),
        createFormRow(
            'Ингредиенты',
            ingredientsControl,
            true,
            'recipe-row-ingredients',
            addIngredientBtn
        )
    );
    renderIngredientsBlock();

    const syncRecipeDraftIngredients = () => {
        if (state.recipeDraft && state.recipeDraft !== draft && Array.isArray(state.recipeDraft.ingredients)) {
            draft.ingredients = state.recipeDraft.ingredients;
        }
        renderIngredientsBlock();
        validateRecipeForm();
    };
    window.addEventListener('recipeDraftIngredientsChanged', syncRecipeDraftIngredients);
    container._mealOverlayCleanup = () => {
        window.removeEventListener('recipeDraftIngredientsChanged', syncRecipeDraftIngredients);
    };

    function isFilled(value) {
        return String(value ?? '').trim() !== '';
    }

    function validateRecipeForm() {
        const hasRequiredTitle = isFilled(draft.title);
        const hasRequiredServings = isFilled(draft.servings);
        const hasEnoughIngredients = Array.isArray(draft.ingredients) && draft.ingredients.length >= 3;

        const isValid =
            hasRequiredTitle &&
            hasRequiredServings &&
            hasEnoughIngredients;

        saveBtn.disabled = !isValid;
        saveBtn.classList.toggle('active', isValid);
        saveBtn.classList.toggle('disabled', !isValid);
        if (mealOverlayStack[mealOverlayStack.length - 1] === container) {
            syncCreateRecipeBottomNav();
        }
    }

    saveBtn.onclick = async () => {
        if (saveBtn.disabled) return;

        const recipesCol = getMealLibraryRecipesCollection();
        if (!recipesCol) {
            showToast('Библиотека рецептов недоступна: выберите клиента / режим или войдите в аккаунт.');
            return;
        }

        const recipePayload = {
            title: String(draft.title || '').trim(),
            titleLower: normalizeSearchText(draft.title),
            searchTokens: buildMealSearchTokens(draft.title),
            description: String(draft.description || '').trim(),
            servings: String(draft.servings || '').trim(),
            ingredients: Array.isArray(draft.ingredients) ? draft.ingredients : [],
            createdAt: Date.now(),
            usageCount: 0,
            lastUsedAt: 0
        };

        try {
            saveBtn.disabled = true;
            const newRecipeRef = await addDoc(recipesCol, recipePayload);

            // Invalidate recipe cache so search/history picks up the new recipe immediately.
            recipesCache = null;
            recipesCacheLibraryKey = null;
            recipesCachePromise = null;
            recipesPreviewCache = null;
            recipesPreviewCacheKey = null;
            historyPreviewCache = null;
            historyPreviewCacheKey = null;

            const newRecipe = { id: newRecipeRef.id, ...recipePayload };

            showToast('Рецепт сохранён');
            state.recipeDraft = createEmptyRecipeDraft();
            state.mealView = 'search';
            if (state.mealSearchReturnTab) {
                state.mealSearchTab = state.mealSearchReturnTab;
                state._mealSearchRestoreNoIndicatorAnim = true;
                state._mealSearchRestoreSkipCarouselSyncOnce = true;
            }
            if (hasUnderlyingMealSearch()) {
                popMealOverlay();
                prependRecipeCardToSearchDOM(newRecipe);
            } else {
                renderMealPage();
            }
        } catch (e) {
            console.error(e);
            const hint = e?.code === 'permission-denied'
                ? 'Нет прав на запись в библиотеку.'
                : 'Проверьте сеть и правила Firestore.';
            showToast(`Не удалось сохранить рецепт. ${hint}`);
        } finally {
            saveBtn.disabled = false;
            validateRecipeForm();
        }
    };

    attachMealOverlayBottomNavSync(container, syncCreateRecipeBottomNav);
    container.append(stickyHeader, formCard);
    pushMealOverlay(container);
    attachCreateFoodKeyboardAvoidance(container);

    requestAnimationFrame(() => {
        setupCreateFoodStickyTitleBorder({
            titleEl: pageTitle,
            watchEl: formCard
        });
    });

    validateRecipeForm();
}



async function renderEditRecipe() {
    ensureMealShell();
    setMealBaseTopBarVisible(false);

    if (!state.currentRecipeId) return;

    const recipeRef = await getRecipeDocumentRef(state.currentRecipeId);
    if (!recipeRef) return;

    const recipeSnap = await getDoc(recipeRef);

    if (!recipeSnap.exists()) {
        showToast('Рецепт не найден');
        state.mealView = 'search';
        renderMealPage();
        return;
    }

    const recipe = {
        id: recipeSnap.id,
        ...recipeSnap.data()
    };

    const savedEditDraft = state.createRecipeBackTarget === 'editRecipe' && state.recipeDraft
        ? state.recipeDraft
        : null;

    const draft = savedEditDraft ? {
        title: String(savedEditDraft.title || ''),
        description: String(savedEditDraft.description || ''),
        servings: String(savedEditDraft.servings || ''),
        ingredients: Array.isArray(savedEditDraft.ingredients) ? savedEditDraft.ingredients.map(item => ({ ...item })) : []
    } : {
        title: String(recipe.title || ''),
        description: String(recipe.description || ''),
        servings: String(recipe.servings || ''),
        ingredients: Array.isArray(recipe.ingredients) ? recipe.ingredients.map(item => ({ ...item })) : []
    };

    const container = createElement('div', 'create-food create-food-form-page recipe-create-page');

    const topBar = createElement('div', 'create-food-topbar');

    const backBtn = createElement('button', 'back-btn');
    backBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24">
            <path fill="currentColor" d="M12.727 3.687a1 1 0 1 0-1.454-1.374l-8.5 9a1 1 0 0 0 0 1.374l8.5 9.001a1 1 0 1 0 1.454-1.373L4.875 12z"/>
        </svg>
    `;
    backBtn.onclick = () => {
        if (hasUnderlyingMealSearch()) {
            popMealOverlay();
            return;
        }
        state.mealView = 'recipeDetails';
        renderMealPage();
    };

    const saveBtn = createElement('button', 'save-btn create-food-submit-btn recipe-create-save-btn', 'Сохранить рецепт');
    saveBtn.disabled = true;

    function syncCreateRecipeBottomNav() {
        setMealBottomNavOverlayMode({
            visible: true,
            onBack: () => backBtn.onclick?.(),
            actionText: 'Сохранить рецепт',
            onAction: () => saveBtn.onclick?.(),
            actionDisabled: saveBtn.disabled
        });
    }

    const pageTitle = createElement('h3', 'create-food-sticky-h3', 'Редактировать рецепт');

    const stickyHeader = createElement('div', 'create-food-sticky-header');
    stickyHeader.append(topBar, pageTitle);

    const formCard = createElement('div', 'create-food-form-card');

    function createFormRow(labelText, controlEl, required = true, extraClass = '', rightActionEl = null) {
        const row = createElement('div', `create-food-row ${extraClass}`.trim());

        const labelWrap = createElement('div', 'create-food-row-label-wrap');

        const left = createElement('div', 'create-food-row-label-left');
        const label = createElement('div', 'create-food-row-label', labelText);
        const hint = createElement(
            'div',
            'create-food-row-hint',
            required ? 'обязательно' : 'необязательно'
        );

        left.append(label, hint);
        labelWrap.append(left);

        if (rightActionEl) {
            const right = createElement('div', 'create-food-row-label-right');
            right.append(rightActionEl);
            labelWrap.append(right);
        }

        const controlWrap = createElement('div', 'create-food-row-control');
        controlWrap.append(controlEl);

        row.append(labelWrap, controlWrap);
        return row;
    }

    const titleInput = createElement('input', 'create-food-input');
    titleInput.placeholder = 'Введите название';
    titleInput.value = draft.title || '';

    const descriptionInput = document.createElement('textarea');
    descriptionInput.className = 'create-food-input create-food-textarea';
    descriptionInput.placeholder = 'Краткое описание';
    descriptionInput.rows = 3;
    descriptionInput.value = draft.description || '';

    const servingsInput = createElement('input', 'create-food-input');
    servingsInput.type = 'number';
    servingsInput.inputMode = 'decimal';
    servingsInput.placeholder = 'Например 4';
    servingsInput.value = draft.servings || '';
    servingsInput.autocomplete = 'off';

    const ingredientsWrap = createElement('div', 'recipe-form-ingredients-wrap');
    const ingredientsControl = createElement('div', 'recipe-ingredients-control');

    const addIngredientBtn = createElement('button', 'meal-search-main-action recipe-add-ingredient-btn');
    addIngredientBtn.type = 'button';
    addIngredientBtn.innerHTML = `
                             <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"><title>Plus SVG Icon</title><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M12 20v-8m0 0V4m0 8h8m-8 0H4"></path></svg>
                         `;
    addIngredientBtn.onclick = () => {
        state.recipeDraft = draft;
        state.recipeIngredientEditIndex = null;
        state.createRecipeBackTarget = 'editRecipe';
        state.mealView = 'recipeFoodSearch';
        renderMealPage();
    };

    const ingredientsList = createElement('div', 'recipe-form-ingredients-list');
    const ingredientsTotals = createElement('div', 'recipe-form-ingredients-totals');

    ingredientsWrap.append(ingredientsList, ingredientsTotals);
    ingredientsControl.append(ingredientsWrap);
    function renderIngredientsBlock() {
        const ingredients = Array.isArray(draft.ingredients) ? draft.ingredients : [];
        ingredientsList.innerHTML = '';

        if (!ingredients.length) {
            ingredientsList.append(
                createElement('div', 'meal-search-empty recipe-form-empty', 'Ингредиенты не добавлены')
            );
            ingredientsTotals.innerHTML = '';
            return;
        }

        ingredients.forEach((item, index) => {
            const row = createElement('div', 'recipe-ingredient-row');

            const left = createElement('div', 'recipe-ingredient-main');
            const name = createElement('div', 'recipe-ingredient-name', item.name || 'Без названия');
            const amount = createElement(
                'div',
                'recipe-ingredient-amount',
                item.amount || `${item.grams || 0} ${item.baseUnit || 'г'}`
            );

            const macros = createElement(
                'div',
                'recipe-ingredient-macros',
                `Б ${formatMacro(item.protein, 1)} · Ж ${formatMacro(item.fat, 1)} · У ${formatMacro(item.carbs, 1)} · К ${Math.round(Number(item.calories || 0))}`
            );

            left.append(name, amount, macros);

            const removeBtn = createElement('button', 'recipe-ingredient-remove-btn');
            removeBtn.type = 'button';
            removeBtn.innerHTML = `
                                  <svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24">
                                     <path fill="currentColor" d="M16 1.75V3h5.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H8V1.75C8 .784 8.784 0 9.75 0h4.5C15.216 0 16 .784 16 1.75m-6.5 0V3h5V1.75a.25.25 0 0 0-.25-.25h-4.5a.25.25 0 0 0-.25.25M4.997 6.178a.75.75 0 1 0-1.493.144L4.916 20.92a1.75 1.75 0 0 0 1.742 1.58h10.684a1.75 1.75 0 0 0 1.742-1.581l1.413-14.597a.75.75 0 0 0-1.494-.144l-1.412 14.596a.25.25 0 0 1-.249.226H6.658a.25.25 0 0 1-.249-.226z"></path>
                                     <path fill="currentColor" d="M9.206 7.501a.75.75 0 0 1 .793.705l.5 8.5A.75.75 0 1 1 9 16.794l-.5-8.5a.75.75 0 0 1 .705-.793Zm6.293.793A.75.75 0 1 0 14 8.206l-.5 8.5a.75.75 0 0 0 1.498.088l.5-8.5Z"></path>
                                 </svg>`;
            removeBtn.onclick = (e) => {
                e.stopPropagation();
                draft.ingredients.splice(index, 1);
                renderIngredientsBlock();
                validateRecipeForm();
            };

            row.onclick = () => {
                if (!item.foodId) return;
                state.recipeDraft = draft;
                state.recipeIngredientEditIndex = index;
                state.recipeSelectedFoodId = item.foodId;
                state.recipeFoodPreviewBackTarget = 'recipeForm';
                state.mealView = 'recipeFoodPreview';
                renderMealPage();
            };

            row.append(left, removeBtn);
            ingredientsList.append(row);
        });

        const totals = calcRecipeIngredientsTotals(draft.ingredients);
        ingredientsTotals.innerHTML = `
            <div class="recipe-ingredients-total-title">Всего</div>
            <div class="recipe-ingredients-total-values">
                <span>Б ${formatMacro(totals.protein, 1)}</span>
                <span>Ж ${formatMacro(totals.fat, 1)}</span>
                <span>У ${formatMacro(totals.carbs, 1)}</span>
                <span>К ${Math.round(totals.calories)}</span>
            </div>
        `;
    }

    titleInput.oninput = () => {
        draft.title = titleInput.value;
        validateRecipeForm();
    };

    descriptionInput.oninput = () => {
        draft.description = descriptionInput.value;
        validateRecipeForm();
    };

    servingsInput.oninput = () => {
        draft.servings = servingsInput.value;
        validateRecipeForm();
    };

    formCard.append(
        createFormRow('Название', titleInput, true),
        createFormRow('Описание', descriptionInput, false, 'is-textarea'),
        createFormRow('Кол-во порций', servingsInput, true),
        createFormRow(
            'Ингредиенты',
            ingredientsControl,
            true,
            'recipe-row-ingredients',
            addIngredientBtn
        )
    );

    function isFilled(value) {
        return String(value ?? '').trim() !== '';
    }

    function validateRecipeForm() {
        const hasRequiredTitle = isFilled(draft.title);
        const hasRequiredServings = isFilled(draft.servings);
        const hasEnoughIngredients = Array.isArray(draft.ingredients) && draft.ingredients.length >= 3;

        const isValid =
            hasRequiredTitle &&
            hasRequiredServings &&
            hasEnoughIngredients;

        saveBtn.disabled = !isValid;
        saveBtn.classList.toggle('active', isValid);
        saveBtn.classList.toggle('disabled', !isValid);
        if (mealOverlayStack[mealOverlayStack.length - 1] === container) {
            syncCreateRecipeBottomNav();
        }
    }

    saveBtn.onclick = async () => {
        if (saveBtn.disabled) return;

        const updatedRecipePayload = {
            title: String(draft.title || '').trim(),
            titleLower: normalizeSearchText(draft.title),
            searchTokens: buildMealSearchTokens(draft.title),
            description: String(draft.description || '').trim(),
            servings: String(draft.servings || '').trim(),
            prepMinutes: deleteField(),
            cookMinutes: deleteField(),
            categories: deleteField(),
            ingredients: Array.isArray(draft.ingredients) ? draft.ingredients : []
        };

        const recipeWriteRef = await getRecipeDocumentRef(recipe.id);
        if (!recipeWriteRef) {
            showToast('Нет доступа к библиотеке рецептов для сохранения.');
            return;
        }
        try {
            saveBtn.disabled = true;
            await updateDoc(recipeWriteRef, updatedRecipePayload);

            showToast('Изменения сохранены');
            state.recipeDraft = createEmptyRecipeDraft();
            state.recipeServingsDraft = null;
            state.createRecipeBackTarget = null;
            popMealOverlay();
            const topAfter = mealOverlayStack.length ? mealOverlayStack[mealOverlayStack.length - 1] : null;
            if (topAfter && !topAfter.classList.contains('meal-search-screen')) {
                popMealOverlay();
            }
            state.mealView = 'recipeDetails';
            await renderRecipeDetails();
        } catch (e) {
            console.error(e);
            const hint = e?.code === 'permission-denied' ? 'Нет прав на запись.' : 'Проверьте сеть и правила Firestore.';
            showToast(`Не удалось сохранить рецепт. ${hint}`);
        } finally {
            saveBtn.disabled = false;
            validateRecipeForm();
        }
    };

    renderIngredientsBlock();

    const syncRecipeDraftIngredients = () => {
        if (state.recipeDraft && state.recipeDraft !== draft && Array.isArray(state.recipeDraft.ingredients)) {
            draft.ingredients = state.recipeDraft.ingredients;
        }
        renderIngredientsBlock();
        validateRecipeForm();
    };
    window.addEventListener('recipeDraftIngredientsChanged', syncRecipeDraftIngredients);
    container._mealOverlayCleanup = () => {
        window.removeEventListener('recipeDraftIngredientsChanged', syncRecipeDraftIngredients);
    };

    attachMealOverlayBottomNavSync(container, syncCreateRecipeBottomNav);
    container.append(stickyHeader, formCard);
    pushMealOverlay(container);
    attachCreateFoodKeyboardAvoidance(container);

    requestAnimationFrame(() => {
        setupCreateFoodStickyTitleBorder({
            titleEl: pageTitle,
            watchEl: formCard
        });
    });

    validateRecipeForm();
}
// =================================================================
// 📦 FIREBASE
// =================================================================
async function getFoods(query = '') {
    const foodsMap = await getFoodsMap();
    const q = (query || '').toLowerCase().trim();

    return Object.entries(foodsMap)
        .map(([id, data]) => ({ id, ...data }))

        .filter(food => {
            const name = (food.name || '').toLowerCase();
            return !q || name.includes(q);
        })
        .sort((a, b) => {
            const aTime = Number(a.createdAt || 0);
            const bTime = Number(b.createdAt || 0);
            if (bTime !== aTime) return bTime - aTime;
            return (a.name || '').localeCompare(b.name || '', 'ru');
        });
}

async function getRecipes(query = '') {
    const libKey = getMealLibraryContextKey();
    if (!libKey || libKey === 'none') return [];

    if (recipesCacheLibraryKey != null && recipesCacheLibraryKey !== libKey) {
        recipesCache = null;
        recipesCachePromise = null;
    }

    const q = String(query || '').toLowerCase().trim();

    // Кэшируем рецепты как и продукты, чтобы вкладка "Рецепты" не мигала.
    if (recipesCache && recipesCacheLibraryKey === libKey) {
        return recipesCache
            .filter(recipe => {
                const title = String(recipe.title || '').toLowerCase();
                const description = String(recipe.description || '').toLowerCase();

                return !q ||
                    title.includes(q) ||
                    description.includes(q);
            })
            .sort((a, b) => {
                const aTitle = String(a.title || '');
                const bTitle = String(b.title || '');
                return aTitle.localeCompare(bTitle, 'ru');
            });
    }

    if (recipesCachePromise && recipesCacheLibraryKey === libKey) {
        await recipesCachePromise;
        return getRecipes(query);
    }

    recipesCacheLibraryKey = libKey;
    recipesCachePromise = (async () => {
        const libCol = getMealLibraryRecipesCollection();
        if (!libCol) {
            recipesCache = [];
            return;
        }
        try {
            const snap = await getDocs(libCol);
            recipesCache = snap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
        } catch (e) {
            console.warn('getRecipes cache: read failed', e?.code);
            recipesCache = [];
        }
    })();

    await recipesCachePromise;
    recipesCachePromise = null;

    return (recipesCache || [])
        .filter(recipe => {
            const title = String(recipe.title || '').toLowerCase();
            const description = String(recipe.description || '').toLowerCase();

            return !q ||
                title.includes(q) ||
                description.includes(q);
        })
        .sort((a, b) => {
            const aTitle = String(a.title || '');
            const bTitle = String(b.title || '');
            return aTitle.localeCompare(bTitle, 'ru');
        });
}
// ========================= helper для одной карточки продукта со свайпом
function createFoodSearchSwipeItem(food, onDeleted) {
    const item = createElement('div', 'food-item meal-search-item');
    item.dataset.foodId = food.id;

    const contentHeader = createElement('div', 'food-info-header-content');
    const header = createElement('div', 'food-info-header');
    const info = createElement('div', 'food-info meal-search-item-info');
    const _amt = Number(food.defaultAmount || food.baseAmount || 100);
    const _unit = food.baseUnit || 'г';
    const _m = calcFoodMacrosByAmount(food, _amt);
    info.innerHTML = `
        ${buildMealSearchFoodNameMarkup(food.name, isFoodLinkedToGlobalCatalog(food))}
        ${food.description?.trim() ? `<div class="meal-search-item-desc">${food.description}</div>` : ''}
        <div class="meal-search-item-macros"><span class="meal-search-item-weight">${_amt}${_unit}</span>Б ${formatMacro(_m.protein, 1)} · Ж ${formatMacro(_m.fat, 1)} · У ${formatMacro(_m.carbs, 1)} · ${Math.round(_m.calories)} ккал</div>
    `;

    info.style.cursor = 'pointer';

   info.onclick = (e) => {
       e.stopPropagation();

       saveMealPageScroll();
       mealScrollRestorePending = true;

       state.mealSearchReturnTab = state.mealSearchTab || 'all';

       const freshFood = foodsMapCache?.[food.id] || food;
       state.foodDetailsPrefill = { ...freshFood, id: food.id };

       state.currentFoodId = food.id;
       state.foodDetailsSource = 'foods';
       state.currentMealItemIndex = null;
       state.currentMealDetailsId = null;
       state.mealView = 'foodDetails';

       renderMealPage();
   };

    const addBtn = createElement('button', 'food-add-btn meal-search-add-btn');
    addBtn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24"><title>Plus SVG Icon</title><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M12 20v-8m0 0V4m0 8h8m-8 0H4"></path></svg>
        `;
    addBtn.type = 'button';

    addBtn.onclick = async (e) => {
        e.stopPropagation();
        await addFoodToMeal(food.id);
        showToast('Продукт добавлен в прием');
        addBtn.innerHTML = `
             <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 512 512">
                               <title>Checkmark-sharp SVG Icon</title>
                               <path fill="none" stroke="currentColor" stroke-linecap="square" stroke-miterlimit="10" stroke-width="44" d="M416 128L192 384l-96-96"></path>
                             </svg>
        `;
        setTimeout(() => {
            addBtn.innerHTML = `
                  <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24"><title>Plus SVG Icon</title><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M12 20v-8m0 0V4m0 8h8m-8 0H4"></path></svg>
            `;
        }, 600);
    };

    header.append(info, addBtn);
    contentHeader.append(header);
    item.append(contentHeader);

    return item;
}

function getScaledRecipeValues(recipe, servings) {
    const baseServings = Math.max(0.1, Number(recipe.servings || 1));
    const currentServings = Math.max(0.1, Number(servings || baseServings));
    const factor = currentServings / baseServings;

    const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];

    const totals = ingredients.reduce((acc, item) => {
        acc.protein += Number(item.protein || 0) * factor;
        acc.fat += Number(item.fat || 0) * factor;
        acc.carbs += Number(item.carbs || 0) * factor;
        acc.calories += Number(item.calories || 0) * factor;
        return acc;
    }, {
        protein: 0,
        fat: 0,
        carbs: 0,
        calories: 0
    });

    return {
        servings: currentServings,
        protein: totals.protein,
        fat: totals.fat,
        carbs: totals.carbs,
        calories: totals.calories
    };
}

function buildRecipeIngredientFromFood(food, foodId, selectedAmount, existing = null) {
    const scaled = calcFoodMacrosByAmount(food, selectedAmount);
    return {
        ...(existing || {}),
        id: existing?.id || crypto.randomUUID(),
        foodId,
        name: food.name || '',
        description: food.description || '',
        amount: `${selectedAmount} ${food.baseUnit || 'г'}`,
        selectedAmount,
        baseAmount: Number(food.baseAmount || 100) || 100,
        baseUnit: food.baseUnit || 'г',
        protein: Number(scaled.protein || 0),
        fat: Number(scaled.fat || 0),
        carbs: Number(scaled.carbs || 0),
        calories: Number(scaled.calories || 0)
    };
}

function addFoodToRecipeDraft(food, selectedAmount, editIndex = null) {
    const draft = getRecipeDraft();
    if (!Array.isArray(draft.ingredients)) {
        draft.ingredients = [];
    }

    const foodId = String(food?.id || state.recipeSelectedFoodId || state.currentFoodId || '').trim();
    const safeAmount = Number(selectedAmount || food?.defaultAmount || food?.baseAmount || 100) || 100;
    const existingIndex = Number.isInteger(editIndex) ? editIndex : -1;

    if (existingIndex >= 0 && existingIndex < draft.ingredients.length) {
        draft.ingredients[existingIndex] = buildRecipeIngredientFromFood(
            food,
            foodId,
            safeAmount,
            draft.ingredients[existingIndex]
        );
        notifyRecipeDraftIngredientsChanged();
        return draft.ingredients[existingIndex];
    }

    const item = buildRecipeIngredientFromFood(food, foodId, safeAmount);
    draft.ingredients.push(item);
    notifyRecipeDraftIngredientsChanged();
    return item;
}

function notifyRecipeDraftIngredientsChanged() {
    window.dispatchEvent(new CustomEvent('recipeDraftIngredientsChanged'));
}

function createRecipeSearchSwipeItem(recipe, onDeleted = null) {
    const item = createElement('div', 'food-item meal-search-item');
    item.dataset.recipeId = recipe.id;

    const contentHeader = createElement('div', 'food-info-header-content');
    const foodHeader = createElement('div', 'food-info-header');

    const info = createElement('div', 'food-info meal-search-item-info');

    const _displayServings = Number(recipe.defaultServings || recipe.servings || 1);
    const scaled = getScaledRecipeValues(recipe, _displayServings);

    info.innerHTML = `
        <div class="meal-search-item-name">${recipe.title || 'Без названия'}</div>
        ${recipe.description?.trim() ? `<div class="meal-search-item-desc">${recipe.description}</div>` : ''}
        <div class="meal-search-item-macros"><span class="meal-search-item-weight">${_displayServings} порц.</span>Б ${formatMacro(scaled.protein, 1)} · Ж ${formatMacro(scaled.fat, 1)} · У ${formatMacro(scaled.carbs, 1)} · ${Math.round(scaled.calories)} ккал</div>
    `;

    info.style.cursor = 'pointer';

    const openRecipeDetails = () => {
        saveMealPageScroll();
        mealScrollRestorePending = true;

        state.mealSearchReturnTab = state.mealSearchTab || 'all';

        state.currentRecipeId = recipe.id;
        state.recipeDetailsSource = 'search';
        state.mealView = 'recipeDetails';
        renderMealPage();
    };

    info.onclick = (e) => {
        e.stopPropagation();
        openRecipeDetails();
    };

    const addBtn = createElement('button', 'food-add-btn meal-search-add-btn');
    addBtn.type = 'button';
    addBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24">
            <title>Plus SVG Icon</title>
            <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M12 20v-8m0 0V4m0 8h8m-8 0H4"></path>
        </svg>
    `;

    addBtn.onclick = async (e) => {
        e.stopPropagation();

        await addRecipeToCurrentMeal(recipe, Number(recipe.defaultServings || recipe.servings || 1));
        showToast('Рецепт добавлен в прием');
    };

    foodHeader.append(info, addBtn);
    contentHeader.append(foodHeader);
    item.append(contentHeader);

    return item;
}

function createMealFoodSwipeItem({ item, index, mealId, food }) {
    const swipeWrap = createElement('div', 'food-swipe food-swipe--meal-item');
    swipeWrap.dataset.mealId = mealId;
    swipeWrap.dataset.itemIndex = String(index);

    const row = createElement('div', 'meal-food-item');

    const content = createElement('div', 'food-info-header-content');
    const header = createElement('div', 'food-info-header');
    const text = createElement('div', 'meal-food-text');

    let cal, p, f, c, displayAmount;

    if (item.isRecipe && Number(item.grams) === 0) {
        cal = Number(item.calories || 0);
        p = Number(item.protein || 0);
        f = Number(item.fat || 0);
        c = Number(item.carbs || 0);
        displayAmount = formatMacro(item.servings || 1, 1);
    } else {
        const factor = Number(item.grams || 0) / (Number(food.baseAmount || 100) || 100);
        cal = (Number(food.calories) || 0) * factor;
        p = (Number(food.protein) || 0) * factor;
        f = (Number(food.fat) || 0) * factor;
        c = (Number(food.carbs) || 0) * factor;
        displayAmount = formatMacro(item.grams, 1);
    }

    const weightLabel = item.isQuickAdded && item.hideWeightDisplay
        ? '-'
        : `${displayAmount} ${food.baseUnit || 'г'}`;

    text.style.cursor = 'pointer';
    text.innerHTML = `
        <div class="meal-food-top">
            <span>${food.name}</span>

        </div>
        <div class="meal-food-grams">
            <span class="meal-food-grams-amount">${weightLabel}</span>
            <span class="meal-food-grams-kcal"><span></span> ${Math.round(cal)}</span>
        </div>
        <div class="meal-food-macros">
            <div><span>б-</span> ${formatMacro(p, 1)},</div>
            <div><span>ж-</span> ${formatMacro(f, 1)},</div>
            <div><span>у-</span> ${formatMacro(c, 1)}</div>
        </div>
    `;

    const openArrow = createElement('div', 'meal-food-open-arrow');
    openArrow.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><title>Arrow-drop-right-line SVG Icon</title><path fill="currentColor" d="M12.172 12L9.343 9.173l1.415-1.414L15 12l-4.242 4.242l-1.415-1.414z"/></svg>
    `;

    text.onclick = (e) => {
        e.stopPropagation();

        saveMealPageScroll();
        mealScrollRestorePending = true;

        if (item.isRecipe && item.recipeId) {
            state.currentRecipeId = item.recipeId;
            state.recipeServingsDraft = item.servings || item.grams || 1;
            state.recipeDetailsSource = 'meal';
            state.currentMealItemIndex = index;
            state.currentMealDetailsId = mealId;
            state.recipeMealSnapshot = item;
            state.mealView = 'recipeDetails';
        } else {
            state.currentFoodId = item.foodId;
            state.foodDetailsSource = 'meal';
            state.currentMealItemIndex = index;
            state.currentMealDetailsId = mealId;
            state.mealView = 'foodDetails';
        }

        renderMealPage();
    };

    const deleteSlot = createElement('div', 'food-swipe-delete-slot');
    const deleteBtn = createElement('button', 'action-btn action-delete');
    deleteBtn.type = 'button';
    deleteBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
                <path fill="currentColor" d="M16 1.75V3h5.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H8V1.75C8 .784 8.784 0 9.75 0h4.5C15.216 0 16 .784 16 1.75m-6.5 0V3h5V1.75a.25.25 0 0 0-.25-.25h-4.5a.25.25 0 0 0-.25.25M4.997 6.178a.75.75 0 1 0-1.493.144L4.916 20.92a1.75 1.75 0 0 0 1.742 1.58h10.684a1.75 1.75 0 0 0 1.742-1.581l1.413-14.597a.75.75 0 0 0-1.494-.144l-1.412 14.596a.25.25 0 0 1-.249.226H6.658a.25.25 0 0 1-.249-.226z"></path>
                <path fill="currentColor" d="M9.206 7.501a.75.75 0 0 1 .793.705l.5 8.5A.75.75 0 1 1 9 16.794l-.5-8.5a.75.75 0 0 1 .705-.793Zm6.293.793A.75.75 0 1 0 14 8.206l-.5 8.5a.75.75 0 0 0 1.498.088l.5-8.5Z"></path>
            </svg>
        `;
    deleteBtn.onclick = async (e) => {
        e.stopPropagation();

        openConfirmModal(`Удалить продукт «${food.name}»?`, async () => {
            const cycleRef = getCycleDocRef();
            if (!cycleRef) return;

            const mealRef = doc(cycleRef, 'meals', state.selectedDate);
            const mealItems = Array.isArray(state.mealsData?.[mealId])
                ? [...state.mealsData[mealId]]
                : [];

            mealItems.splice(index, 1);

            if (mealItems.length) {
                await updateDoc(mealRef, { [mealId]: mealItems });
            } else {
                await updateDoc(mealRef, { [mealId]: deleteField() });
                await cleanupEmptyMealsDoc(mealRef);
            }
        });
    };
    deleteSlot.append(deleteBtn);

    const actionsStrip = createElement('div', 'food-swipe-meal-actions');

    const mealPlanUnplannedIconHtml = `<span class="action-plan-text" role="img" aria-label="Запланировать"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><title>Round-more-time SVG Icon</title><path fill="currentColor" d="M10.75 8c-.41 0-.75.34-.75.75v4.69c0 .35.18.67.47.85l3.64 2.24a.713.713 0 1 0 .74-1.22L11.5 13.3V8.75c0-.41-.34-.75-.75-.75"/><path fill="currentColor" d="M17.92 12A6.957 6.957 0 0 1 11 20c-3.9 0-7-3.1-7-7s3.1-7 7-7c.7 0 1.37.1 2 .29V4.23c-.64-.15-1.31-.23-2-.23c-5 0-9 4-9 9s4 9 9 9a8.963 8.963 0 0 0 8.94-10z"/><path fill="currentColor" d="M22 5h-2V3c0-.55-.45-1-1-1s-1 .45-1 1v2h-2c-.55 0-1 .45-1 1s.45 1 1 1h2v2c0 .55.45 1 1 1s1-.45 1-1V7h2c.55 0 1-.45 1-1s-.45-1-1-1"/></svg></span>`;

    const mealPlanPlannedIconHtml = `<span class="action-plan-text" role="img" aria-label="Съедено"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><title>Round-more-time-check SVG Icon</title><path fill="currentColor" d="M10.75 8c-.41 0-.75.34-.75.75v4.69c0 .35.18.67.47.85l3.64 2.24a.713.713 0 1 0 .74-1.22L11.5 13.3V8.75c0-.41-.34-.75-.75-.75"/><path fill="currentColor" d="M17.92 12A6.957 6.957 0 0 1 11 20c-3.9 0-7-3.1-7-7s3.1-7 7-7c.7 0 1.37.1 2 .29V4.23c-.64-.15-1.31-.23-2-.23c-5 0-9 4-9 9s4 9 9 9a8.963 8.963 0 0 0 8.94-10z"/><path fill="currentColor" d="M17.3 9.8a1 1 0 0 1-.7-.29L15 7.91a1 1 0 1 1 1.41-1.41l.89.89l2.69-2.69A1 1 0 1 1 21.41 6l-3.4 3.4a1 1 0 0 1-.71.4"/></svg></span>`;

    const planSlot = createElement('div', 'food-swipe-plan-slot');
    const planBtn = createElement('button', 'action-btn action-plan');
    planBtn.type = 'button';
    let isPlanned = item.planned === true;

    const planOverlay = createElement('div', 'food-planned-overlay');
    planOverlay.textContent = 'Запланировано';

    planBtn.onclick = async (e) => {
        e.stopPropagation();

        const cycleRef = getCycleDocRef();
        if (!cycleRef) {
            showToast('Не выбран цикл — нельзя сохранить приём');
            return;
        }

        const nextPlanned = !isPlanned;

        try {
            planBtn.disabled = true;

            const mealRef = doc(cycleRef, 'meals', state.selectedDate);
            const mealItems = Array.isArray(state.mealsData?.[mealId])
                ? [...state.mealsData[mealId]]
                : [];

            if (!mealItems[index]) return;

            mealItems[index] = {
                ...mealItems[index],
                planned: nextPlanned
            };

            await updateDoc(mealRef, { [mealId]: mealItems });

            isPlanned = nextPlanned;

            if (nextPlanned) {
                header.classList.add('food-header--planned');
                if (!planOverlay.parentNode) header.append(planOverlay);
                planSlot.classList.add('food-swipe-plan-slot--planned');
                planBtn.innerHTML = mealPlanPlannedIconHtml;
            } else {
                header.classList.remove('food-header--planned');
                planOverlay.remove();
                planSlot.classList.remove('food-swipe-plan-slot--planned');
                planBtn.innerHTML = mealPlanUnplannedIconHtml;

            }

            closeSwipeRowVisual(swipeWrap);
        } catch (err) {
            console.error(err);
            showToast('Не удалось сохранить');
        } finally {
            planBtn.disabled = false;
        }
    };
    planSlot.append(planBtn);

    header.append(text, openArrow);

    if (isPlanned) {
        header.append(planOverlay);
        planSlot.classList.add('food-swipe-plan-slot--planned');
        planBtn.innerHTML = mealPlanPlannedIconHtml;
    } else {
        planBtn.innerHTML = mealPlanUnplannedIconHtml;
    }
    actionsStrip.append(planSlot, deleteSlot);
    content.append(header, actionsStrip);
    row.append(content);
    swipeWrap.append(row);

    return swipeWrap;
}

function createMealPhotoSwipeItem({ item, index, mealId }) {
    const swipeWrap = createElement('div', 'food-swipe food-swipe--meal-item food-swipe--meal-photo-item');
    swipeWrap.dataset.mealId = mealId;
    swipeWrap.dataset.itemIndex = String(index);

    const row = createElement('div', 'meal-food-item');
    const content = createElement('div', 'food-info-header-content');
    const header = createElement('div', 'food-info-header');

    const text = createElement('div', 'meal-food-text meal-food-text--photo');
    text.style.cursor = 'pointer';
    const preview = createElement('img', 'meal-photo-thumb');
    preview.src = item.photoUrl;
    preview.alt = item.name || 'Фото продукта';

    const meta = createElement('div', 'meal-photo-meta');
    const title = createElement('div', 'meal-food-photo-title', item.name || 'Фото продукта');
    const subtitle = createElement('div', 'meal-food-photo-subtitle', 'Открыть фото');
    meta.append(title, subtitle);
    text.append(preview, meta);

    const openArrow = createElement('div', 'meal-food-open-arrow meal-food-open-arrow--photo');
    openArrow.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><title>Arrow-drop-right-line SVG Icon</title><path fill="currentColor" d="M12.172 12L9.343 9.173l1.415-1.414L15 12l-4.242 4.242l-1.415-1.414z"></path></svg>
    `;

    const openPhoto = (e) => {
        e.stopPropagation();
        openMediaFullScreen(item.photoUrl, 'photo');
    };

    text.onclick = openPhoto;
    preview.onclick = openPhoto;
    openArrow.onclick = openPhoto;

    const mealPlanUnplannedIconHtml = `<span class="action-plan-text" role="img" aria-label="Запланировать"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><title>Round-more-time SVG Icon</title><path fill="currentColor" d="M10.75 8c-.41 0-.75.34-.75.75v4.69c0 .35.18.67.47.85l3.64 2.24a.713.713 0 1 0 .74-1.22L11.5 13.3V8.75c0-.41-.34-.75-.75-.75"/><path fill="currentColor" d="M17.92 12A6.957 6.957 0 0 1 11 20c-3.9 0-7-3.1-7-7s3.1-7 7-7c.7 0 1.37.1 2 .29V4.23c-.64-.15-1.31-.23-2-.23c-5 0-9 4-9 9s4 9 9 9a8.963 8.963 0 0 0 8.94-10z"/><path fill="currentColor" d="M22 5h-2V3c0-.55-.45-1-1-1s-1 .45-1 1v2h-2c-.55 0-1 .45-1 1s.45 1 1 1h2v2c0 .55.45 1 1 1s1-.45 1-1V7h2c.55 0 1-.45 1-1s-.45-1-1-1"/></svg></span>`;
    const mealPlanPlannedIconHtml = `<span class="action-plan-text" role="img" aria-label="Съедено"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><title>Round-more-time-check SVG Icon</title><path fill="currentColor" d="M10.75 8c-.41 0-.75.34-.75.75v4.69c0 .35.18.67.47.85l3.64 2.24a.713.713 0 1 0 .74-1.22L11.5 13.3V8.75c0-.41-.34-.75-.75-.75"/><path fill="currentColor" d="M17.92 12A6.957 6.957 0 0 1 11 20c-3.9 0-7-3.1-7-7s3.1-7 7-7c.7 0 1.37.1 2 .29V4.23c-.64-.15-1.31-.23-2-.23c-5 0-9 4-9 9s4 9 9 9a8.963 8.963 0 0 0 8.94-10z"/><path fill="currentColor" d="M17.3 9.8a1 1 0 0 1-.7-.29L15 7.91a1 1 0 1 1 1.41-1.41l.89.89l2.69-2.69A1 1 0 1 1 21.41 6l-3.4 3.4a1 1 0 0 1-.71.4"/></svg></span>`;
    const planSlot = createElement('div', 'food-swipe-plan-slot');
    const planBtn = createElement('button', 'action-btn action-plan');
    planBtn.type = 'button';
    let isPlanned = item.planned === true;

    const planOverlay = createElement('div', 'food-planned-overlay');
    planOverlay.textContent = 'Запланировано';

    planBtn.onclick = async (e) => {
        e.stopPropagation();

        const cycleRef = getCycleDocRef();
        if (!cycleRef) {
            showToast('Не выбран цикл — нельзя сохранить прием');
            return;
        }

        const nextPlanned = !isPlanned;

        try {
            planBtn.disabled = true;

            const mealRef = doc(cycleRef, 'meals', state.selectedDate);
            const mealItems = Array.isArray(state.mealsData?.[mealId])
                ? [...state.mealsData[mealId]]
                : [];

            if (!mealItems[index]) return;

            mealItems[index] = {
                ...mealItems[index],
                planned: nextPlanned
            };

            await updateDoc(mealRef, { [mealId]: mealItems });

            isPlanned = nextPlanned;

            if (nextPlanned) {
                header.classList.add('food-header--planned');
                if (!planOverlay.parentNode) header.append(planOverlay);
                planSlot.classList.add('food-swipe-plan-slot--planned');
                planBtn.innerHTML = mealPlanPlannedIconHtml;
            } else {
                header.classList.remove('food-header--planned');
                planOverlay.remove();
                planSlot.classList.remove('food-swipe-plan-slot--planned');
                planBtn.innerHTML = mealPlanUnplannedIconHtml;
            }

            closeSwipeRowVisual(swipeWrap);
        } catch (error) {
            console.error(error);
            showToast('Не удалось сохранить');
        } finally {
            planBtn.disabled = false;
        }
    };
    planSlot.append(planBtn);

    const deleteSlot = createElement('div', 'food-swipe-delete-slot');
    const deleteBtn = createElement('button', 'action-btn action-delete');
    deleteBtn.type = 'button';
    deleteBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
            <path fill="currentColor" d="M16 1.75V3h5.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H8V1.75C8 .784 8.784 0 9.75 0h4.5C15.216 0 16 .784 16 1.75m-6.5 0V3h5V1.75a.25.25 0 0 0-.25-.25h-4.5a.25.25 0 0 0-.25.25M4.997 6.178a.75.75 0 1 0-1.493.144L4.916 20.92a1.75 1.75 0 0 0 1.742 1.58h10.684a1.75 1.75 0 0 0 1.742-1.581l1.413-14.597a.75.75 0 0 0-1.494-.144l-1.412 14.596a.25.25 0 0 1-.249.226H6.658a.25.25 0 0 1-.249-.226z"></path>
            <path fill="currentColor" d="M9.206 7.501a.75.75 0 0 1 .793.705l.5 8.5A.75.75 0 1 1 9 16.794l-.5-8.5a.75.75 0 0 1 .705-.793Zm6.293.793A.75.75 0 1 0 14 8.206l-.5 8.5a.75.75 0 0 0 1.498.088l.5-8.5Z"></path>
        </svg>
    `;
    deleteBtn.onclick = (e) => {
        e.stopPropagation();
        openConfirmModal('Удалить фото из приема?', async () => {
            await removeFoodFromMeal(mealId, index);
        });
    };
    deleteSlot.append(deleteBtn);

    const actionsStrip = createElement('div', 'food-swipe-meal-actions');
    actionsStrip.append(planSlot, deleteSlot);

    header.append(text, openArrow);

    if (isPlanned) {
        header.classList.add('food-header--planned');
        header.append(planOverlay);
        planSlot.classList.add('food-swipe-plan-slot--planned');
        planBtn.innerHTML = mealPlanPlannedIconHtml;
    } else {
        planBtn.innerHTML = mealPlanUnplannedIconHtml;
    }

    content.append(header, actionsStrip);
    row.append(content);
    swipeWrap.append(row);

    return swipeWrap;
}

function createRecipeFoodSearchSwipeItem(food, onDeleted = null) {
    const item = createElement('div', 'food-item meal-search-item');
    item.dataset.foodId = food.id;

    const contentHeader = createElement('div', 'food-info-header-content');
    const foodHeader = createElement('div', 'food-info-header');

    const info = createElement('div', 'food-info meal-search-item-info');
    const actualAmt = Number(food.defaultAmount || food.baseAmount || 100);
    const scaledPreview = calcFoodMacrosByAmount(food, actualAmt);
    const unit = food.baseUnit || 'г';
    info.innerHTML = `
        ${buildMealSearchFoodNameMarkup(food.name, isFoodLinkedToGlobalCatalog(food))}
        ${food.description?.trim() ? `<div class="meal-search-item-desc">${food.description}</div>` : ''}
        <div class="meal-search-item-macros"><span class="meal-search-item-weight">${actualAmt}${unit}</span>Б ${formatMacro(scaledPreview.protein, 1)} · Ж ${formatMacro(scaledPreview.fat, 1)} · У ${formatMacro(scaledPreview.carbs, 1)} · ${Math.round(scaledPreview.calories)} ккал</div>
    `;

    info.style.cursor = 'pointer';

    const openPreview = () => {
        saveMealPageScroll();
        mealScrollRestorePending = true;

        state.recipeIngredientEditIndex = null;
        state.recipeSelectedFoodId = food.id;
        state.recipeFoodPreviewBackTarget = 'recipeFoodSearch';
        state.mealView = 'recipeFoodPreview';
        renderMealPage();
    };

    info.onclick = (e) => {
        e.stopPropagation();
        openPreview();
    };
    item.onclick = openPreview;

    const addBtn = createElement('button', 'food-add-btn meal-search-add-btn');
    addBtn.type = 'button';
    addBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24">
            <title>Plus SVG Icon</title>
            <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M12 20v-8m0 0V4m0 8h8m-8 0H4"></path>
        </svg>
    `;

    addBtn.onclick = (e) => {
        e.stopPropagation();

        addFoodToRecipeDraft({ id: food.id, ...food }, actualAmt, null);
        showToast('Добавлено в рецепт');

        addBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 512 512">
                <path fill="none" stroke="currentColor" stroke-linecap="square" stroke-miterlimit="10" stroke-width="44" d="M416 128L192 384l-96-96"></path>
            </svg>
        `;
        setTimeout(() => {
            addBtn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24">
                    <title>Plus SVG Icon</title>
                    <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M12 20v-8m0 0V4m0 8h8m-8 0H4"></path>
                </svg>
            `;
        }, 600);
    };

    foodHeader.append(info, addBtn);
    contentHeader.append(foodHeader);
    item.append(contentHeader);

    return item;
}
function renderRecipeFoodSearchList(container, foods, onDeleted = null) {
    container.innerHTML = '';

    if (!foods.length) {
        const empty = createElement('div', 'meal-search-empty', 'Ничего не найдено');
        container.append(empty);
        return;
    }

    foods.forEach(food => {
        container.append(createRecipeFoodSearchSwipeItem(food, onDeleted));
    });
}

function renderFoodList(container, foods, onDeleted = null) {
    container.innerHTML = '';

    if (!foods.length) {
        const empty = createElement('div', 'meal-search-empty', 'Ничего не найдено');
        container.append(empty);
        return;
    }

    foods.forEach(food => {
        container.append(createFoodSearchSwipeItem(food, onDeleted));
    });
}

function renderRecipeList(container, recipes, onDeleted = null) {
    container.innerHTML = '';

    if (!recipes.length) {
        const empty = createElement('div', 'meal-search-empty', 'Рецептов пока нет');
        container.append(empty);
        return;
    }

    recipes.forEach(recipe => {
        container.append(createRecipeSearchSwipeItem(recipe, onDeleted));
    });
}


function renderMixedFoodAndRecipes(container, foods, recipes, onDeleted = null) {
    container.innerHTML = '';

    if ((!foods || !foods.length) && (!recipes || !recipes.length)) {
        const empty = createElement('div', 'meal-search-empty', 'Ничего не найдено');
        container.append(empty);
        return;
    }

    const mixed = [
        ...(foods || []).map(item => ({ ...item, entityType: 'food' })),
        ...(recipes || []).map(item => ({ ...item, entityType: 'recipe' }))
    ];

    mixed.sort((a, b) => Number(b.lastUsedAt || 0) - Number(a.lastUsedAt || 0));

    mixed.forEach(item => {
        if (item.entityType === 'food') {
            container.append(createFoodSearchSwipeItem(item, onDeleted));
        } else {
            container.append(createRecipeSearchSwipeItem(item, onDeleted));
        }
    });

    setTimeout(() => {
        initMealSwipe();
    }, 0);
}

function renderFoodListAppend(container, foods, onDeleted = null) {
    foods.forEach(food => {
        container.append(createFoodSearchSwipeItem(food, onDeleted));
    });

    setTimeout(() => {
        initMealSwipe();
    }, 0);
}

function renderRecipeListAppend(container, recipes, onDeleted = null) {
    recipes.forEach(recipe => {
        container.append(createRecipeSearchSwipeItem(recipe, onDeleted));
    });

    setTimeout(() => {
        initMealSwipe();
    }, 0);
}



async function addFood(food, opts = {}) {
    const skipGlobalMirror = Boolean(opts.skipGlobalMirror);
    const libCol = getMealLibraryFoodsCollection();
    if (!libCol) {
        showToast('Не выбран контекст для сохранения продукта');
        return null;
    }

    const payload = {
        ...food,
        nameLower: normalizeSearchText(food?.name),
        searchTokens: buildMealSearchTokens(food?.name),
        createdAt: Date.now()
    };

    const docRef = await addDoc(libCol, payload);

    if (foodsMapCache && foodsMapLibraryKey === getMealLibraryContextKey()) {
        foodsMapCache[docRef.id] = payload;
    }
    // Global sharing is explicit via the “Поделиться продуктом” button in details.

    return docRef.id;
}


async function updateFoodDefaultAmount(foodId, defaultAmount) {
    const foodRef = await getFoodDocumentRef(foodId);
    if (!foodRef) return;

    const patch = { defaultAmount: Number(defaultAmount || 0) };
    await updateDoc(foodRef, patch);
    await syncSharedFoodToGlobalCatalogIfNeeded(foodId, patch);

    if (foodsMapCache && foodsMapLibraryKey === getMealLibraryContextKey() && foodsMapCache[foodId]) {
        foodsMapCache[foodId].defaultAmount = Number(defaultAmount || 0);
    }

    foodsPreviewCache = null;
    foodsPreviewCacheKey = null;
    historyPreviewCache = null;
    historyPreviewCacheKey = null;
}

function patchSearchCardSubtitle(foodId) {
    if (!mealOverlayEl) return;
    const food = foodsMapCache?.[foodId];
    if (!food) return;
    const amt = Number(food.defaultAmount || food.baseAmount || 100);
    const unit = food.baseUnit || 'г';
    const m = calcFoodMacrosByAmount(food, amt);
    const cards = mealOverlayEl.querySelectorAll(`.meal-search-item[data-food-id="${foodId}"]`);
    cards.forEach(card => {
        const macrosEl = card.querySelector('.meal-search-item-macros');
        if (macrosEl) macrosEl.innerHTML = `<span class="meal-search-item-weight">${amt}${unit}</span>Б ${formatMacro(m.protein, 1)} · Ж ${formatMacro(m.fat, 1)} · У ${formatMacro(m.carbs, 1)} · ${Math.round(m.calories)} ккал`;
    });
}

function patchRecipeSearchCard(recipeId) {
    if (!mealOverlayEl) return;
    const cached = recipesCache?.find(r => r && r.id === recipeId);
    if (!cached) return;
    const ds = Number(cached.defaultServings || cached.servings || 1);
    const sc = getScaledRecipeValues(cached, ds);
    mealOverlayEl.querySelectorAll(`.meal-search-item[data-recipe-id="${recipeId}"]`).forEach(card => {
        const macrosEl = card.querySelector('.meal-search-item-macros');
        if (macrosEl) macrosEl.innerHTML = `<span class="meal-search-item-weight">${ds} порц.</span>Б ${formatMacro(sc.protein, 1)} · Ж ${formatMacro(sc.fat, 1)} · У ${formatMacro(sc.carbs, 1)} · ${Math.round(sc.calories)} ккал`;
    });
}

function removeFoodCardFromSearchDOM(foodId) {
    if (!mealOverlayEl) return;
    mealOverlayEl.querySelectorAll(`.meal-search-item[data-food-id="${foodId}"]`).forEach(card => {
        card.style.transition = 'opacity .25s ease, max-height .3s ease';
        card.style.opacity = '0';
        card.style.maxHeight = card.offsetHeight + 'px';
        card.style.overflow = 'hidden';
        setTimeout(() => card.remove(), 300);
    });
}

function removeRecipeCardFromSearchDOM(recipeId) {
    if (!mealOverlayEl) return;
    mealOverlayEl.querySelectorAll(`.meal-search-item[data-recipe-id="${recipeId}"]`).forEach(card => {
        card.style.transition = 'opacity .25s ease, max-height .3s ease';
        card.style.opacity = '0';
        card.style.maxHeight = card.offsetHeight + 'px';
        card.style.overflow = 'hidden';
        setTimeout(() => card.remove(), 300);
    });
}

function prependFoodCardToSearchDOM(food) {
    if (!mealOverlayEl || !food) return;
    const searchScreen = mealOverlayEl.querySelector('.meal-search-screen') || mealOverlayEl;
    const panels = searchScreen.querySelectorAll('.meal-search-tab-panel');
    panels.forEach(panel => {
        const tab = panel.dataset.tab;
        if (tab !== 'products') return;
        const list = panel.querySelector('.meal-search-list');
        if (!list) return;
        const card = createFoodSearchSwipeItem(food, null);
        card.style.opacity = '0';
        card.style.transition = 'opacity .3s ease';
        list.prepend(card);
        requestAnimationFrame(() => { card.style.opacity = '1'; });
    });
    setTimeout(() => initMealSwipe(), 0);
}

function prependRecipeCardToSearchDOM(recipe) {
    if (!mealOverlayEl || !recipe) return;
    const searchScreen = mealOverlayEl.querySelector('.meal-search-screen') || mealOverlayEl;
    const panels = searchScreen.querySelectorAll('.meal-search-tab-panel');
    panels.forEach(panel => {
        const tab = panel.dataset.tab;
        if (tab !== 'recipes') return;
        const list = panel.querySelector('.meal-search-list');
        if (!list) return;
        const card = createRecipeSearchSwipeItem(recipe, null);
        card.style.opacity = '0';
        card.style.transition = 'opacity .3s ease';
        list.prepend(card);
        requestAnimationFrame(() => { card.style.opacity = '1'; });
    });
    setTimeout(() => initMealSwipe(), 0);
}

async function addFoodToMeal(foodId) {
    const cycleRef = getCycleDocRef();
    const mealRef = doc(cycleRef, 'meals', state.selectedDate);

    const foodsMap = await getFoodsMap();
    const food = foodsMap[foodId];

    if (!food) {
        showToast('Продукт не найден');
        return;
    }

    await setDoc(mealRef, {
        [state.currentMealId]: arrayUnion({
            id: crypto.randomUUID(),
            foodId,
            grams: Number(food.defaultAmount || food.baseAmount || 100),

            name: food.name || '',
            description: food.description || '',
            baseAmount: Number(food.baseAmount || 100),
            baseUnit: food.baseUnit || 'г',

            protein: Number(food.protein || 0),
            fat: Number(food.fat || 0),
            carbs: Number(food.carbs || 0),
            calories: Number(food.calories || 0)
        })
    }, { merge: true });
}

// функцию полного удаления продукта
async function deleteFood(foodId) {
    const foodRef = await getFoodDocumentRef(foodId);
    if (!foodRef) return;

    await deleteDoc(foodRef);

    if (foodsMapCache && foodsMapLibraryKey === getMealLibraryContextKey()) {
        delete foodsMapCache[foodId];
    }

    foodsPreviewCache = null;
    foodsPreviewCacheKey = null;
    historyPreviewCache = null;
    historyPreviewCacheKey = null;
}

async function deleteRecipe(recipeId) {
    const recipeRef = await getRecipeDocumentRef(recipeId);
    if (!recipeRef) return;

    await deleteDoc(recipeRef);

    if (recipesCache && recipesCacheLibraryKey === getMealLibraryContextKey()) {
        recipesCache = recipesCache.filter(r => r && r.id !== recipeId);
    }

    recipesPreviewCache = null;
    recipesPreviewCacheKey = null;
    historyPreviewCache = null;
    historyPreviewCacheKey = null;
}

// =================================================================
// 📡 ПОДПИСКА
// =================================================================
async function subscribeMeals() {
    const selectedDateAtSubscribe = state.selectedDate;
    const cycleRef = getCycleDocRef();
    if (!cycleRef) return;

    const mealRef = doc(cycleRef, 'meals', selectedDateAtSubscribe);

    resetMealsListener();

    try {
        const cachedSnap = await getDocFromCache(mealRef);
        if (cachedSnap.exists() && state.selectedDate === selectedDateAtSubscribe) {
            const cachedData = cachedSnap.data();
            state.mealsData = cachedData;
            mealsDataLoadedDate = selectedDateAtSubscribe;
            initOpenStateForCurrentDay(cachedData);
            const hasFoodForSelectedDate = hasAnyFoodInDoc(cachedData);
            updateCachedWeekPresenceForDate(selectedDateAtSubscribe, hasFoodForSelectedDate);
            updateCachedMonthMealsDailySummaryForDate(selectedDateAtSubscribe, cachedData);
            applyWeekRowPresence({ [selectedDateAtSubscribe]: hasFoodForSelectedDate });
            rebuildMealsSection();
            renderMeals(cachedData);
            scheduleMealRootScrollAvailabilitySync();
        }
    } catch (_) { /* no cache hit */ }

    unsubscribeMeals = onSnapshot(mealRef, (docSnap) => {
        if (selectedDateAtSubscribe !== state.selectedDate) return;

        const data = docSnap.exists() ? docSnap.data() : {};
        const newStructure = getMealKeysFromData(data).join('|');

        state.mealsData = data;
        mealsDataLoadedDate = selectedDateAtSubscribe;
        initOpenStateForCurrentDay(data);
        const hasFoodForSelectedDate = hasAnyFoodInDoc(data);
        updateCachedWeekPresenceForDate(selectedDateAtSubscribe, hasFoodForSelectedDate);
        updateCachedMonthMealsDailySummaryForDate(selectedDateAtSubscribe, data);
        applyWeekRowPresence({ [selectedDateAtSubscribe]: hasFoodForSelectedDate });

        if (newStructure !== lastRenderedMealStructure) {
            state.mealsData = data;
            initOpenStateForCurrentDay(data);

            rebuildMealsSection();
            renderMeals(data);
            scheduleMealRootScrollAvailabilitySync();
            return;
        }

        renderMeals(data);
        scheduleMealRootScrollAvailabilitySync();
    });
}

async function getFoodsMap(force = false) {
    const libKey = getMealLibraryContextKey();

    if (!force && foodsMapCache && foodsMapLibraryKey === libKey) {
        return foodsMapCache;
    }

    const map = {};
    const cycleRef = getCycleDocRef();
    const libCol = getMealLibraryFoodsCollection();

    if (libCol) {
        try {
            const libSnap = await getDocs(libCol);
            libSnap.forEach(d => {
                map[d.id] = d.data();
            });
        } catch (e) {
            console.warn('getFoodsMap: library read failed', e?.code);
        }
    }

    if (cycleRef) {
        try {
            const legacySnap = await getDocs(collection(cycleRef, 'foods'));
            legacySnap.forEach(d => {
                if (!map[d.id]) map[d.id] = d.data();
            });
        } catch (e) {
            console.warn('getFoodsMap: cycle foods read skipped', e?.code);
        }
    }

    if (!libCol && !cycleRef) {
        foodsMapCache = null;
        foodsMapLibraryKey = null;
        return {};
    }

    foodsMapCache = map;
    foodsMapLibraryKey = libKey;

    return map;
}

// =================================================================
// 🔎 MEAL SEARCH: lightweight previews (DB queries with limit)
// =================================================================
const MEAL_SEARCH_PREVIEW_LIMIT = 20;

function normalizeSearchText(s) {
    return String(s || '').toLowerCase().replace(/ё/g, 'е').trim();
}

function getMealSearchWords(value) {
    return normalizeSearchText(value)
        .split(/[^a-zа-я0-9]+/iu)
        .map(word => word.trim())
        .filter(word => word.length >= 2);
}

function buildMealSearchTokens(value) {
    const tokens = new Set();
    getMealSearchWords(value).forEach(word => {
        const maxLen = Math.min(word.length, 32);
        for (let len = 2; len <= maxLen; len += 1) {
            tokens.add(word.slice(0, len));
        }
    });
    return Array.from(tokens).slice(0, 240);
}

function getMealSearchPrimaryToken(value) {
    return getMealSearchWords(value)
        .sort((a, b) => b.length - a.length || a.localeCompare(b, 'ru'))[0] || '';
}

function mealSearchTextMatchesQuery(text, queryText) {
    const queryWords = getMealSearchWords(queryText);
    if (!queryWords.length) return true;

    const textWords = getMealSearchWords(text);
    if (!textWords.length) return false;

    return queryWords.every(queryWord =>
        textWords.some(textWord => textWord.startsWith(queryWord))
    );
}

function filterMealSearchRowsByText(rows, queryText, getText) {
    const queryWords = getMealSearchWords(queryText);
    if (!queryWords.length) return rows;
    return rows.filter(row => mealSearchTextMatchesQuery(getText(row), queryText));
}

async function ensureMealSearchIndexFieldsOnce() {
    const libKey = getMealLibraryContextKey();
    if (!libKey || libKey === 'none') return;

    const foodsCol = getMealLibraryFoodsCollection();
    const recipesCol = getMealLibraryRecipesCollection();
    if (!foodsCol && !recipesCol) return;

    const key = `mealSearchIndexLibraryV6:${libKey}`;
    if (localStorage.getItem(key) === '1') return;

    try {
        const db = foodsCol?.firestore || recipesCol?.firestore;
        if (!db) return;

        if (foodsCol) {
            try {
                const foodsSnap = await getDocs(foodsCol);
                const docs = foodsSnap.docs || [];
                let batch = writeBatch(db);
                let ops = 0;

                for (const d of docs) {
                    const data = d.data() || {};
                    const patch = {};

                    if (!(typeof data.nameLower === 'string' && data.nameLower.length)) {
                        patch.nameLower = normalizeSearchText(data.name || '');
                    }

                    if (!Array.isArray(data.searchTokens) || !data.searchTokens.length) {
                        patch.searchTokens = buildMealSearchTokens(data.name || '');
                    }

                    if (!Object.keys(patch).length) continue;

                    batch.update(d.ref, patch);
                    ops += 1;
                    if (ops >= 400) {
                        await batch.commit();
                        batch = writeBatch(db);
                        ops = 0;
                    }
                }
                if (ops) await batch.commit();
            } catch (e) {
                console.warn('ensureMealSearchIndexFieldsOnce foods', e?.code);
            }
        }

        if (recipesCol) {
            try {
                const recipesSnap = await getDocs(recipesCol);
                const docs = recipesSnap.docs || [];
                let batch = writeBatch(db);
                let ops = 0;

                for (const d of docs) {
                    const data = d.data() || {};
                    const patch = {};

                    if (!(typeof data.titleLower === 'string' && data.titleLower.length)) {
                        patch.titleLower = normalizeSearchText(data.title || '');
                    }

                    if (!Array.isArray(data.searchTokens) || !data.searchTokens.length) {
                        patch.searchTokens = buildMealSearchTokens(data.title || '');
                    }

                    if (data.createdAt === undefined || data.createdAt === null) {
                        patch.createdAt = Date.now();
                    }

                    if (data.usageCount === undefined || data.usageCount === null) {
                        patch.usageCount = 0;
                    }
                    if (data.lastUsedAt === undefined || data.lastUsedAt === null) {
                        patch.lastUsedAt = 0;
                    }

                    if (!Object.keys(patch).length) continue;

                    batch.update(d.ref, patch);
                    ops += 1;
                    if (ops >= 400) {
                        await batch.commit();
                        batch = writeBatch(db);
                        ops = 0;
                    }
                }
                if (ops) await batch.commit();
            } catch (e) {
                console.warn('ensureMealSearchIndexFieldsOnce recipes', e?.code);
            }
        }

        localStorage.setItem(key, '1');
    } catch (e) {
        console.warn('ensureMealSearchIndexFieldsOnce failed', e);
    }
}

// Note: cycleRef.firestore exists in modular SDK doc refs.

function getMealSearchCycleKey() {
    return String(state.selectedCycleId || '');
}

async function getFoodsPreview(sortId, take = MEAL_SEARCH_PREVIEW_LIMIT) {
    const foodsCol = getMealLibraryFoodsCollection();
    if (!foodsCol) return [];
    const libKey = getMealLibraryContextKey();
    const cacheKey = `${libKey}|foods|v8|${String(sortId || '')}|${take}`;
    if (foodsPreviewCache && foodsPreviewCacheKey === cacheKey) return foodsPreviewCache;

    let field = 'createdAt';
    let dir = 'desc';
    if (sortId === 'popular') field = 'usageCount';
    if (sortId === 'az') { field = 'name'; dir = 'asc'; }
    if (sortId === 'za') { field = 'name'; dir = 'desc'; }

    const lim = Math.max(40, take * 3);
    let items = [];
    try {
        const snap = await getDocs(query(foodsCol, orderBy(field, dir), limit(lim)));
        items = (snap.docs || []).map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
        console.warn('getFoodsPreview failed', e?.code);
        return [];
    }

    foodsPreviewCache = items;
    foodsPreviewCacheKey = cacheKey;
    return items;
}

async function getRecipesPreview(sortId, take = MEAL_SEARCH_PREVIEW_LIMIT) {
    const recipesCol = getMealLibraryRecipesCollection();
    if (!recipesCol) return [];
    const libKey = getMealLibraryContextKey();
    const cacheKey = `${libKey}|recipes|v8|${String(sortId || '')}|${take}`;
    if (recipesPreviewCache && recipesPreviewCacheKey === cacheKey) return recipesPreviewCache;

    let field = 'createdAt';
    let dir = 'desc';
    if (sortId === 'popular') field = 'usageCount';
    if (sortId === 'az') { field = 'title'; dir = 'asc'; }
    if (sortId === 'za') { field = 'title'; dir = 'desc'; }

    const lim = Math.max(40, take * 3);
    let items = [];
    try {
        const snap = await getDocs(query(recipesCol, orderBy(field, dir), limit(lim)));
        items = (snap.docs || []).map(d => ({ id: d.id, ...d.data() }));
    } catch (e) {
        console.warn('getRecipesPreview failed', e?.code);
        return [];
    }

    recipesPreviewCache = items;
    recipesPreviewCacheKey = cacheKey;
    return items;
}

async function getHistoryPreview(sortId, take = 20) {
    const cycleRef = getCycleDocRef();
    if (!cycleRef) return { foods: [], recipes: [] };
    const cycleKey = getMealSearchCycleKey();
    const libKey = getMealLibraryContextKey();
    const cacheKey = `${cycleKey}|${libKey}|history|v11|${take}`;
    if (historyPreviewCache && historyPreviewCacheKey === cacheKey) return historyPreviewCache;

    const foodLast = new Map();
    const foodLastItem = new Map();
    const recipeLast = new Map();
    const recipeLastItem = new Map();
    let seq = 0;

    let mealDocsSnap;
    try {
        mealDocsSnap = await getDocs(collection(cycleRef, 'meals'));
    } catch (e) {
        console.warn('getHistoryPreview: cannot read cycle meals', e?.code);
        historyPreviewCache = { foods: [], recipes: [] };
        historyPreviewCacheKey = cacheKey;
        return historyPreviewCache;
    }

    const dayDocs = (mealDocsSnap.docs || []).slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
    for (const d of dayDocs) {
        const data = d.data() || {};
        const mealKeys = getMealKeysFromData(data);
        for (const mealId of mealKeys) {
            const items = data[mealId];
            if (!Array.isArray(items)) continue;
            for (const item of items) {
                if (!item || typeof item !== 'object') continue;
                if (item.recipeId || item.isRecipe) {
                    const rid = String(item.recipeId || '').trim();
                    if (!rid) continue;
                    recipeLast.set(rid, seq);
                    recipeLastItem.set(rid, item);
                } else if (item.foodId) {
                    const fid = String(item.foodId).trim();
                    if (!fid) continue;
                    foodLast.set(fid, seq);
                    foodLastItem.set(fid, item);
                }
                seq += 1;
            }
        }
    }

    const foodsMap = await getFoodsMap();
    const recipesAll = await getRecipes('');
    const recipeById = new Map((recipesAll || []).map(r => [String(r.id), r]));

    const allEntries = [];
    for (const [fid, lastSeq] of foodLast) {
        allEntries.push({ type: 'food', id: fid, lastSeq });
    }
    for (const [rid, lastSeq] of recipeLast) {
        allEntries.push({ type: 'recipe', id: rid, lastSeq });
    }
    allEntries.sort((a, b) => b.lastSeq - a.lastSeq);

    const foods = [];
    const recipes = [];
    let count = 0;

    for (const entry of allEntries) {
        if (count >= take) break;
        if (entry.type === 'food') {
            const meta = foodsMap[entry.id];
            if (meta) {
                foods.push({ id: entry.id, ...meta, lastUsedAt: entry.lastSeq });
            } else {
                const snap = foodLastItem.get(entry.id) || null;
                foods.push({
                    id: entry.id,
                    name: String(snap?.name || 'Продукт'),
                    description: String(snap?.description || ''),
                    baseAmount: Number(snap?.baseAmount || 100),
                    baseUnit: String(snap?.baseUnit || 'г'),
                    protein: Number(snap?.protein || 0),
                    fat: Number(snap?.fat || 0),
                    carbs: Number(snap?.carbs || 0),
                    calories: Number(snap?.calories || 0),
                    defaultAmount: Number(snap?.grams || snap?.defaultAmount || snap?.baseAmount || 100),
                    lastUsedAt: entry.lastSeq
                });
            }
        } else {
            const meta = recipeById.get(entry.id);
            if (meta) {
                recipes.push({ ...meta, lastUsedAt: entry.lastSeq });
            } else {
                const snap = recipeLastItem.get(entry.id) || null;
                recipes.push({
                    id: entry.id,
                    title: String(snap?.name || snap?.title || 'Рецепт'),
                    description: String(snap?.description || ''),
                    servings: Number(snap?.servings || snap?.baseServings || 1),
                    ingredients: Array.isArray(snap?.ingredients) ? snap.ingredients : [],
                    lastUsedAt: entry.lastSeq
                });
            }
        }
        count++;
    }

    historyPreviewCache = { foods, recipes };
    historyPreviewCacheKey = cacheKey;
    return historyPreviewCache;
}

// =================================================================
// 🍽️ РЕНДЕР ПРИЕМОВ + ПОДСЧЕТ
// =================================================================
async function renderMeals(mealsData) {
    renderMealsFromData(mealsData, null);

    const foodsMap = await getFoodsMap();
    renderMealsFromData(mealsData, foodsMap);
}

function renderMealsFromData(mealsData, foodsMap) {
    const { total, mealTotals } = calcMealsTotalsFast(mealsData, foodsMap);
    mealTotalsCache[getMealTotalsCacheKey()] = total;
    renderMealMacrosRow(total);

    getMealKeysFromData(mealsData || {}).forEach(mealId => {
        const list = document.getElementById(`${mealId}-list`);
        const macrosWrap = document.getElementById(`${mealId}-macros`);
        const macrosContent = document.getElementById(`${mealId}-macros-content`);
        const arrow = document.getElementById(`${mealId}-arrow`);

        if (!list || !macrosWrap || !macrosContent) return;

        list.innerHTML = '';

        const items = Array.isArray(mealsData[mealId]) ? mealsData[mealId] : [];
        const mealTotal = mealTotals[mealId] || { cal: 0, p: 0, f: 0, c: 0 };
        const hasItems = items.length > 0;

        if (!hasItems) {
            macrosWrap.style.display = 'none';
            list.style.display = 'none';
            macrosWrap.classList.remove('meal-card-macros--expanded');

            const headerKcalEl = document.getElementById(`${mealId}-header-kcal`);
            if (headerKcalEl) {
                headerKcalEl.innerHTML = '';
            }

            const photoIndicatorEl = document.getElementById(`${mealId}-photo-indicator`);
            if (photoIndicatorEl) {
                photoIndicatorEl.style.display = 'none';
            }

            if (arrow) {
                arrow.classList.remove('arrow-rotate-open', 'arrow-rotate-close');
                arrow.style.transform = 'rotate(270deg)';
            }

            const swipeEl = document.querySelector(`.meal-swipe[data-meal-id="${mealId}"]`);
            if (swipeEl) {
                setMealHeaderSwipeRadiusDuringSwipe(swipeEl, swipeEl.classList.contains('open'));
            }
            return;
        }

        macrosWrap.style.display = 'flex';
        macrosContent.innerHTML = `
            <div><span>б-</span> ${formatMacro(mealTotal.p, 1)},</div>
            <div><span>ж-</span> ${formatMacro(mealTotal.f, 1)},</div>
            <div><span>у-</span> ${formatMacro(mealTotal.c, 1)}</div>
        `;

        const photoCount = items.filter(isMealPhotoItem).length;
        const photoIndicatorEl = document.getElementById(`${mealId}-photo-indicator`);
        if (photoIndicatorEl) {
            const countEl = photoIndicatorEl.querySelector('.meal-photo-indicator-count');
            if (countEl) {
                countEl.textContent = String(photoCount);
            }
            photoIndicatorEl.style.display = photoCount > 0 ? 'inline-flex' : 'none';
        }

        const headerKcalEl = document.getElementById(`${mealId}-header-kcal`);
        if (headerKcalEl) {
            headerKcalEl.innerHTML = `<span>к-</span> ${Math.round(mealTotal.cal)}`;
        }

        items.forEach((item, index) => {
            if (isMealPhotoItem(item)) {
                list.append(createMealPhotoSwipeItem({
                    item,
                    index,
                    mealId
                }));
                return;
            }

            const snapshotFood = {
                name: item.name,
                description: item.description,
                baseAmount: Number(item.baseAmount),
                baseUnit: item.baseUnit,
                protein: Number(item.protein),
                fat: Number(item.fat),
                carbs: Number(item.carbs),
                calories: Number(item.calories)
            };

            const hasSnapshotFood =
                snapshotFood.name &&
                Number.isFinite(snapshotFood.baseAmount) &&
                !!snapshotFood.baseUnit;

            const food = hasSnapshotFood ? snapshotFood : foodsMap?.[item.foodId];
            if (!food) return;

            list.append(createMealFoodSwipeItem({
                item,
                index,
                mealId,
                food
            }));
        });

        const footer = createElement('div', 'meal-food-list-footer');
        const fBtn1 = createElement('button', 'meal-food-list-footer-btn meal-food-list-footer-btn--camera');
        fBtn1.type = 'button';
        fBtn1.setAttribute('aria-label', 'Сделать фото');
        fBtn1.innerHTML = getMealCameraIconMarkup();
        fBtn1.onclick = () => openMealPhotoCaptureFlow(mealId);
        const fBtn2 = createElement('button', 'meal-food-list-footer-btn meal-food-list-footer-btn--quick-add');
        fBtn2.type = 'button';
        fBtn2.setAttribute('aria-label', 'Быстрое добавление');
        fBtn2.innerHTML = getMealQuickAddIconMarkup();
        fBtn2.onclick = () => openQuickAddForm('main', mealId);

        const fBtn3 = createElement('button', 'meal-food-list-footer-btn meal-food-list-footer-btn--add');
        fBtn3.type = 'button';
        fBtn3.setAttribute('aria-label', 'Добавить');
        fBtn3.innerHTML = `
            <span class="meal-food-list-footer-btn-icon">${getMealAddIconMarkup()}</span>
            <span class="meal-food-list-footer-btn-text">Добавить продукт</span>
        `;
        fBtn3.onclick = () => openMealSearchForMeal(mealId);

        footer.append(fBtn1, fBtn2, fBtn3);
        list.append(footer);

        const openKey = getMealOpenKey(state.selectedDate, mealId);
        const isOpen = !!mealOpenState[openKey];

        list.style.display = isOpen ? 'block' : 'none';
        macrosWrap.classList.toggle('meal-card-macros--expanded', isOpen);

        if (arrow) {
            arrow.classList.remove('arrow-rotate-open', 'arrow-rotate-close');
            arrow.style.transform = isOpen ? 'rotate(90deg)' : 'rotate(270deg)';
        }

        const swipeEl = document.querySelector(`.meal-swipe[data-meal-id="${mealId}"]`);
        if (swipeEl) {
            setMealHeaderSwipeRadiusDuringSwipe(swipeEl, swipeEl.classList.contains('open'));
        }
    });

    setTimeout(() => {
        initMealSwipe();
        scheduleMealRootScrollAvailabilitySync();
    }, 0);

    if (mealScrollRestorePending) {
        requestAnimationFrame(() => {
            restoreMealPageScroll();
        });
    }
}
// =================================================================
// 📅 КАЛЕНДАРЬ
// =================================================================
function openMealCalendarSheet() {
    const today = new Date();
    const todayStr = formatLocalDate(today);
    const selectedDate = state.selectedDate ? parseLocalDate(state.selectedDate) : today;
    let visibleMonth = getMonthStart(selectedDate);
    const rootScrollHost = document.getElementById('root');
    const hadRootScrollLock = rootScrollHost?.classList.contains('meal-calendar-root-locked');

    const overlay = document.createElement('div');
    overlay.className = 'meal-calendar-overlay';

    const panel = document.createElement('div');
    panel.className = 'meal-calendar-sheet';

    const header = document.createElement('div');
    header.className = 'meal-calendar-header';

    const title = document.createElement('div');
    title.className = 'meal-calendar-title';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'meal-calendar-close-btn';
    closeBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M7 10h10M7 14h10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
        </svg>
    `;

    header.append(title, closeBtn);

    const weekdays = document.createElement('div');
    weekdays.className = 'meal-calendar-weekdays';
    ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].forEach(day => {
        const el = document.createElement('div');
        el.className = 'meal-calendar-weekday';
        el.textContent = day;
        weekdays.append(el);
    });

    const monthsViewport = document.createElement('div');
    monthsViewport.className = 'meal-calendar-months-viewport';

    const monthsTrack = document.createElement('div');
    monthsTrack.className = 'meal-calendar-months-track';
    monthsViewport.append(monthsTrack);

    const bottomBar = document.createElement('div');
    bottomBar.className = 'meal-calendar-bottom';

    const todayBtn = document.createElement('button');
    todayBtn.type = 'button';
    todayBtn.className = 'meal-calendar-today-btn';
    todayBtn.textContent = 'Сегодня';

    bottomBar.append(todayBtn);

    panel.append(header, weekdays, monthsViewport, bottomBar);
    overlay.append(panel);
    document.body.append(overlay);

    if (!hadRootScrollLock) {
        rootScrollHost?.classList.add('meal-calendar-root-locked');
    }

    let isClosing = false;
    const animationDuration = 220;
    const swipeThreshold = 40;

    function closeCalendar() {
        if (isClosing) return;
        isClosing = true;

        overlay.classList.remove('open');
        panel.classList.remove('open');

        setTimeout(() => {
            if (!hadRootScrollLock) {
                rootScrollHost?.classList.remove('meal-calendar-root-locked');
            }
            overlay.remove();
        }, 260);
    }

    function selectDate(dateObj) {
        const newDate = formatLocalDate(dateObj);
        closeCalendar();

        setTimeout(() => {
            switchMealDate(newDate);
        }, 160);
    }

    function hasEntryForDate(dateStr) {
        const monthKey = dateStr.slice(0, 7);
        const monthData = monthMealsPresenceCache[monthKey];
        return !!monthData?.[dateStr];
    }

    function syncTodayButtonVisibility() {
        const currentSelected = state.selectedDate ? parseLocalDate(state.selectedDate) : today;
        todayBtn.style.display = isSameDay(currentSelected, today) ? 'none' : 'inline-flex';
    }

    function buildMonthPage(monthDate) {
        const page = document.createElement('div');
        page.className = 'meal-calendar-month-page';
        page.dataset.monthKey = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`;

        const grid = document.createElement('div');
        grid.className = 'meal-calendar-grid';

        const cells = getCalendarMonthMatrix(monthDate);
        const currentSelected = state.selectedDate ? parseLocalDate(state.selectedDate) : today;

        cells.forEach(cellDate => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'meal-calendar-day';

            const dateStr = formatLocalDate(cellDate);
            btn.dataset.date = dateStr;
            const inCurrentMonth = isSameMonth(cellDate, monthDate);
            const isTodayCell = isSameDay(cellDate, today);
            const isSelectedCell = isSameDay(cellDate, currentSelected);
            const hasEntry = inCurrentMonth && hasEntryForDate(dateStr);

            if (!inCurrentMonth) btn.classList.add('is-outside');
            if (isTodayCell) btn.classList.add('is-today');
            if (isSelectedCell) btn.classList.add('is-selected');
            if (hasEntry) btn.classList.add('has-entry');

            btn.innerHTML = `<span class="meal-calendar-day-num">${cellDate.getDate()}</span>`;

            btn.onclick = (event) => {
                if (shouldSuppressMealCalendarDayTap()) {
                    event?.preventDefault?.();
                    return;
                }
                selectDate(cellDate);
            };

            grid.append(btn);
        });

        page.append(grid);
        return page;
    }

    async function preloadMonthPresence(monthDate) {
        await getMonthMealsPresence(monthDate);
    }

    function syncMonthPagePresence(page) {
        if (!page) return;
        const monthKey = page.dataset.monthKey || '';
        const monthData = monthMealsPresenceCache[monthKey] || {};

        page.querySelectorAll('.meal-calendar-day').forEach((btn) => {
            if (btn.classList.contains('is-outside')) {
                btn.classList.remove('has-entry');
                return;
            }

            const dateStr = btn.dataset.date || '';
            btn.classList.toggle('has-entry', !!monthData[dateStr]);
        });
    }

    function syncRenderedMonthTripletPresence() {
        [...monthsTrack.children].forEach((page) => syncMonthPagePresence(page));
    }

    function resetMonthTripletPages(baseMonth) {
        const prevMonth = addMonths(baseMonth, -1);
        const nextMonth = addMonths(baseMonth, 1);

        monthsTrack.replaceChildren(
            buildMonthPage(prevMonth),
            buildMonthPage(baseMonth),
            buildMonthPage(nextMonth)
        );
        monthsTrack.style.transition = 'none';
        monthsTrack.style.transform = 'translate3d(-100%, 0, 0)';

        requestAnimationFrame(() => {
            monthsTrack.style.transition = `transform ${animationDuration}ms ease`;
        });
    }

    function renderMonthTriplet() {
        title.textContent = getCalendarMonthTitle(visibleMonth);
        syncTodayButtonVisibility();
        resetMonthTripletPages(visibleMonth);

        const renderedMonthKey = `${visibleMonth.getFullYear()}-${visibleMonth.getMonth()}`;

        Promise.all([
            preloadMonthPresence(addMonths(visibleMonth, -1)),
            preloadMonthPresence(visibleMonth),
            preloadMonthPresence(addMonths(visibleMonth, 1))
        ]).then(() => {
            if (!document.body.contains(overlay) || isClosing) return;
            const activeMonthKey = `${visibleMonth.getFullYear()}-${visibleMonth.getMonth()}`;
            if (activeMonthKey !== renderedMonthKey) return;
            syncRenderedMonthTripletPresence();
        });
    }

    function changeMealCalendarMonth(direction) {
        visibleMonth = addMonths(visibleMonth, direction);
        renderMonthTriplet();
    }

    attachMonthCarouselSwipe(monthsViewport, monthsTrack, {
        animationDuration,
        swipeThreshold,
        onCommitNext: () => changeMealCalendarMonth(1),
        onCommitPrev: () => changeMealCalendarMonth(-1),
        onHorizontalSwipeEnd: suppressMealCalendarDayTap
    });

    closeBtn.onclick = closeCalendar;

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            closeCalendar();
        }
    });

    todayBtn.onclick = () => {
        selectDate(today);
    };

    renderMonthTriplet();

    requestAnimationFrame(() => {
        overlay.classList.add('open');
        panel.classList.add('open');
    });
}

// =================================================================
// 📅 свап (поведение ближе к iOS: резина за пределами, порог по скорости и смещению, пружинный snap)
// =================================================================
/** Последний или единственный food-swipe в списке приёма — для нижнего border 2px при свайпе. */
function isFoodSwipeLastOrOnlyInMealList(foodSwipeRoot) {
    const list = foodSwipeRoot.closest('.meal-food-list');
    if (!list) return true;

    const rows = [...list.children].filter((el) => el.classList?.contains('food-swipe--meal-item'));
    if (rows.length <= 1) return true;

    const idx = rows.indexOf(foodSwipeRoot);
    return idx === rows.length - 1;
}

function setMealHeaderSwipeRadiusDuringSwipe(swipeItemEl, isSwiping) {
    if (!swipeItemEl || !swipeItemEl.classList) return;

    const isMealHeader = swipeItemEl.classList.contains('meal-swipe--inline-header');
    const isFoodHeader = swipeItemEl.classList.contains('food-swipe--meal-item');
    if (!isMealHeader && !isFoodHeader) return;

    const header = isMealHeader
        ? swipeItemEl.querySelector('.meal-card-header')
        : swipeItemEl.querySelector('.food-info-header');
    if (!header) return;

    const macrosWrap = isMealHeader ? swipeItemEl.querySelector('.meal-card-macros') : null;
    const macrosVisible = isMealHeader && !!macrosWrap && macrosWrap.style.display !== 'none';

    // Когда карточка отодвинута (свайп или open) — делаем полностью «плоско».
    // Когда на месте — радиус как в CSS, но если есть макросы под шапкой,
    // нижние углы у шапки должны быть 0.
    if (isSwiping) {
        header.style.borderRadius = '0px';
        header.style.borderBottomLeftRadius = '0px';
        header.style.borderBottomRightRadius = '0px';
        if (isFoodHeader) {
            header.style.borderBottom = isFoodSwipeLastOrOnlyInMealList(swipeItemEl)
                ? '1px solid #e0e0e0'
                : '1px solid #e0e0e0';
        } else {
            // meal: с видимым meal-card-macros — белая линия стыка; без — 2px #dedede.
            header.style.borderBottom = macrosVisible
                ? '1px solid rgb(255, 255, 255)'
                : '1px solid #e0e0e0';
        }

        return;

    }

    // Карточка на месте:
    // - meal: нижние углы 0 если есть макросы, иначе — как в CSS
    // - food: всё как в CSS
    header.style.borderRadius = '';
    header.style.borderBottomLeftRadius = macrosVisible ? '0px' : '';
    header.style.borderBottomRightRadius = macrosVisible ? '0px' : '';
    header.style.borderBottom = macrosVisible ? '2px solid #ffff' : '';
    header.style.boxShadow = macrosVisible ? 'none' : '';

}

function initMealSwipe() {
    const onSwipeClosedVisual = (r) => setMealHeaderSwipeRadiusDuringSwipe(r, false);
    const onSwipeActiveVisual = (r) => setMealHeaderSwipeRadiusDuringSwipe(r, true);

    function crossCloseOtherStrip(target) {
        if (target.classList.contains('meal-swipe')) {
            document.querySelectorAll('.food-swipe--meal-item.open, .food-swipe--meal-item.open-left').forEach((el) => {
                if (el !== target) closeSwipeRowVisual(el, onSwipeClosedVisual);
            });
        } else if (target.classList.contains('food-swipe')) {
            document.querySelectorAll('.meal-swipe.open').forEach((el) => {
                if (el !== target) closeSwipeRowVisual(el, onSwipeClosedVisual);
            });
        }
    }

    bindSwipeBlock({
        rootSelector: '.meal-swipe',
        contentSelector: '.meal-card-header-content',
        maxSwipe: 120,
        onSwipeActiveVisual,
        onSwipeClosedVisual,
        onBeforeOpen: crossCloseOtherStrip,
        onPureTap: (e, item) => {
            item.dispatchEvent(new CustomEvent('meal-header-pure-tap', { bubbles: true }));
        },
        pureTapIf: (it) => it.classList.contains('meal-swipe')
    });

    bindSwipeBlock({
        rootSelector: '.food-swipe.food-swipe--meal-item',
        contentSelector: '.food-info-header-content',
        maxSwipe: 168,
        onSwipeActiveVisual,
        onSwipeClosedVisual,
        onBeforeOpen: crossCloseOtherStrip,
        edgeWidth: 40,
        edgeWidthLeft: 0,
        maxSwipeLeft: 0
    });

    if (!mealSwipeDocumentBound) {
        document.addEventListener('click', (e) => {
            const openedMeal = document.querySelector('.meal-swipe.open');
            if (openedMeal && !e.target.closest('.meal-swipe')) {
                closeSwipeRowVisual(openedMeal, onSwipeClosedVisual);
            }

            document.querySelectorAll('.food-swipe.food-swipe--meal-item.open, .food-swipe.food-swipe--meal-item.open-left').forEach((openedFood) => {
                if (!e.target.closest('.food-swipe')) {
                    closeSwipeRowVisual(openedFood, onSwipeClosedVisual);
                }
            });
        });

        mealSwipeDocumentBound = true;
    }
}
