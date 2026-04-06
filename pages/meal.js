import {
    doc,
    setDoc,
    getDoc,
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
    documentId
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
const mealOpenState = JSON.parse(localStorage.getItem('mealOpenState') || '{}');
import { getCycleDocRef } from '../script.js';
import { openCycleSelectModal } from '../script.js';
import { debounce } from './supplement.js';
import { openConfirmModal } from '../script.js';
import { renderTopBar } from '../script.js';
import { ensureCycleSelected } from '../script.js';
import { showToast } from '../script.js';
let unsubscribeMeals = null;
let foodsMapCache = null;
let foodsMapCycleId = null;
let lastRenderedMealStructure = '';
let mealTotalsCache = {};
let mealSwipeDocumentBound = false;
let monthMealsPresenceCache = {};
let monthMealsPresenceCycleId = null;
let mealPageScrollY = 0;
let mealScrollRestorePending = false;
let mealMainMounted = false;
let mealMainEl = null;
let mealOverlayEl = null;
let mealShellEl = null;


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
    foodsMapCycleId = null;
    monthMealsPresenceCache = {};
    monthMealsPresenceCycleId = null;
}

export function destroyMealShellState() {
    mealMainMounted = false;
    mealMainEl = null;
    mealOverlayEl = null;
    mealShellEl = null;
}

function getMealScrollTarget() {
    return document.scrollingElement || document.documentElement || document.body;
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
            <div class="meal-summary-card">
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
            </div>
        `;
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
        <div class="meal-summary-card meal-summary-card-no-goal">
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
        </div>
    `;
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


async function saveFoodEntity(foodId, payload) {
    const cycleRef = getCycleDocRef();
    if (!cycleRef || !foodId) return null;

    const cleanPayload = {
        name: String(payload.name || '').trim(),
        description: String(payload.description || '').trim(),
        baseAmount: Number(payload.baseAmount || 0),
        baseUnit: String(payload.baseUnit || 'г').trim(),
        protein: Number(payload.protein || 0),
        fat: Number(payload.fat || 0),
        carbs: Number(payload.carbs || 0),
        calories: Number(payload.calories || 0)
    };

    await updateDoc(doc(cycleRef, 'foods', foodId), cleanPayload);

    if (foodsMapCache) {
        foodsMapCache[foodId] = {
            ...(foodsMapCache[foodId] || {}),
            ...cleanPayload
        };
    }

    return cleanPayload;
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

async function addRecipeToCurrentMeal(recipe, servings) {
    const cycleRef = getCycleDocRef();
    if (!cycleRef || !state.currentMealId) return;

    const mealRef = doc(cycleRef, 'meals', state.selectedDate);

    const baseServings = Math.max(1, Number(recipe.servings || 1));
    const currentServings = Math.max(1, Number(servings || baseServings));
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
            grams: 0,
            baseAmount: 1,
            baseUnit: 'порц',
            protein: totals.protein,
            fat: totals.fat,
            carbs: totals.carbs,
            calories: totals.calories,
            ingredients: ingredients
        })
    }, { merge: true });
}

function addFoodToRecipeDraft(food, grams) {
    const draft = getRecipeDraft();

    if (!Array.isArray(draft.ingredients)) {
        draft.ingredients = [];
    }

    const amountNum = Number(grams || food.defaultAmount || food.baseAmount || 100);
    const unit = food.baseUnit || 'г';

    draft.ingredients.push({
        id: crypto.randomUUID(),
        foodId: state.currentFoodId,
        grams: amountNum,
        amount: `${amountNum} ${unit}`,

        name: food.name || '',
        description: food.description || '',
        baseAmount: Number(food.baseAmount || 100),
        baseUnit: unit,

        protein: Number(food.protein || 0),
        fat: Number(food.fat || 0),
        carbs: Number(food.carbs || 0),
        calories: Number(food.calories || 0)
    });
}


function calcMealsTotalsFast(mealsData = {}, foodsMap = null) {
    const total = { cal: 0, p: 0, f: 0, c: 0 };
    const mealTotals = {};

    Object.keys(mealsData || {}).forEach(mealId => {
        if (!/^meal\d+$/.test(mealId)) return;

        mealTotals[mealId] = { cal: 0, p: 0, f: 0, c: 0 };

        (mealsData[mealId] || []).forEach(item => {
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

            const amount = Number(item.grams || 0);
            const baseAmount = Number(food.baseAmount || 100) || 100;
            const factor = amount / baseAmount;

            const cal = (Number(food.calories) || 0) * factor;
            const p = (Number(food.protein) || 0) * factor;
            const f = (Number(food.fat) || 0) * factor;
            const c = (Number(food.carbs) || 0) * factor;

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
    if (state.selectedDate && state.mealsData) {
        const selectedMonthKey = state.selectedDate.slice(0, 7);
        if (selectedMonthKey === monthKey) {
            result[state.selectedDate] = hasAnyFoodInDoc(state.mealsData);
        }
    }

    monthMealsPresenceCache[monthKey] = result;
    return result;
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
    if (state.selectedDate && state.mealsData) {
        result[state.selectedDate] = hasAnyFoodInDoc(state.mealsData);
    }

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


//  создание карточки приема
function createMealCard(meal) {
    const swipeWrap = createElement('div', 'meal-swipe');
    swipeWrap.dataset.mealId = meal.id;

     const actions = createElement('div', 'swipe-actions right');
     const isBaseMeal = ['meal1', 'meal2', 'meal3'].includes(meal.id);

     actions.innerHTML = `
         <button class="action-btn action-edit meal-action-stub" type="button">
             <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 512 512"><title>Copy-outline SVG Icon</title><rect width="336" height="336" x="128" y="128" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="32" rx="57" ry="57"></rect><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32" d="m383.5 128l.5-24a56.16 56.16 0 0 0-56-56H112a64.19 64.19 0 0 0-64 64v216a56.16 56.16 0 0 0 56 56h24"></path></svg>
         </button>
         ${isBaseMeal ? '' : `
         <button class="action-btn action-delete meal-action-delete" type="button">
             <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
                 <path fill="currentColor" d="M16 1.75V3h5.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H8V1.75C8 .784 8.784 0 9.75 0h4.5C15.216 0 16 .784 16 1.75m-6.5 0V3h5V1.75a.25.25 0 0 0-.25-.25h-4.5a.25.25 0 0 0-.25.25M4.997 6.178a.75.75 0 1 0-1.493.144L4.916 20.92a1.75 1.75 0 0 0 1.742 1.58h10.684a1.75 1.75 0 0 0 1.742-1.581l1.413-14.597a.75.75 0 0 0-1.494-.144l-1.412 14.596a.25.25 0 0 1-.249.226H6.658a.25.25 0 0 1-.249-.226z"/>
                 <path fill="currentColor" d="M9.206 7.501a.75.75 0 0 1 .793.705l.5 8.5A.75.75 0 1 1 9 16.794l-.5-8.5a.75.75 0 0 1 .705-.793Zm6.293.793A.75.75 0 1 0 14 8.206l-.5 8.5a.75.75 0 0 0 1.498.088l.5-8.5Z"/>
             </svg>
         </button>
         `}
     `;

    const card = createElement('div', 'meal-card');
    const swipeContent = createElement('div', 'swipe-content');
    const headerContent = createElement('div', 'meal-card-header-content');
    const header = createElement('div', 'meal-card-header');

    const macros = createElement('div', 'meal-card-macros');
    macros.id = `${meal.id}-macros`;
    macros.style.display = 'none';

    const macrosContent = createElement('div', 'meal-macros-content');
    macrosContent.id = `${meal.id}-macros-content`;
    macrosContent.innerHTML = `
        <div>Б: 0</div>
        <div>Ж: 0</div>
        <div>У: 0</div>
        <div>К: 0</div>
    `;

    const arrow = createElement('div', 'meal-arrow');
    arrow.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24"><title>Ios-arrow-ltr-24-filled SVG Icon</title><path fill="currentColor" d="M12.727 3.687a1 1 0 1 0-1.454-1.374l-8.5 9a1 1 0 0 0 0 1.374l8.5 9.001a1 1 0 1 0 1.454-1.373L4.875 12z"></path></svg>
                `;

    arrow.id = `${meal.id}-arrow`;

    macros.append(macrosContent, arrow);

    const title = createElement('div', 'meal-title', meal.name);

    const addBtn = createElement('button', 'meal-add-btn');
    addBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24"><title>Plus SVG Icon</title><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M12 20v-8m0 0V4m0 8h8m-8 0H4"></path></svg>
            `;

    addBtn.onclick = (e) => {
        e.stopPropagation();

        saveMealPageScroll();
        mealScrollRestorePending = true;

        state.currentMealId = meal.id;
        state.mealView = 'search';
        renderMealPage();
    };

    header.append(title, addBtn);

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
        animateMealArrow(arrow, nextOpen);
    }

    applyOpenState();

    header.addEventListener('click', toggleMeal);
    macros.addEventListener('click', toggleMeal);

    headerContent.append(header);
    swipeContent.append(headerContent,actions);
    card.append(swipeContent,macros,list);
    swipeWrap.append( card);

    const deleteBtn = actions.querySelector('.meal-action-delete');
    const stubBtn = actions.querySelector('.meal-action-stub');

    stubBtn.onclick = (e) => {
        e.stopPropagation();
        openCopyMealSheet(meal.id);
    };

        if (deleteBtn) {
            deleteBtn.onclick = async (e) => {
                e.stopPropagation();

                openConfirmModal(`Удалить ${meal.name}?`, async () => {
                    const cycleRef = getCycleDocRef();
                    const mealRef = doc(cycleRef, 'meals', state.selectedDate);

                    await updateDoc(mealRef, {
                        [meal.id]: deleteField()
                    });

                    delete mealOpenState[getMealOpenKey(state.selectedDate, meal.id)];
                    localStorage.setItem('mealOpenState', JSON.stringify(mealOpenState));
                });
            };
        }

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

            addMealSectionBtn.innerHTML = `
                <svg class="tab-shape" viewBox="0 0 320 76" xmlns="http://www.w3.org/2000/svg">

                              <defs>
                                <mask id="bottomMask2">
                                  <rect x="0" y="20" width="320" height="60" preserveAspectRatio="none fill=" white"=""></rect>
                                </mask>
                              </defs>

                              <!-- основной -->
                              <path d="
                                  M10 0
                                  H310
                                  Q320 0 320 10
                                  V17
                                  Q320 27 310 27

                                  H210
                                  Q190 27 180 36
                                  Q170 46 160 46
                                  Q150 46 140 36
                                  Q130 27 110 27

                                  H10
                                  Q0 27 0 17
                                  V10
                                  Q0 0 10 0
                                  Z
                                " fill="white" stroke="#dedede" stroke-width="1"></path>

                              <!-- усиление снизу -->
                              <path d="
                                  M10 0
                                  H310
                                  Q320 0 320 10
                                  V17
                                  Q320 27 310 27

                                  H210
                                  Q190 27 180 36
                                  Q170 46 160 46
                                  Q150 46 140 36
                                  Q130 27 110 27

                                  H10
                                  Q0 27 0 17
                                  V10
                                  Q0 0 10 0
                                  Z
                                " fill="none" stroke="#dedede" stroke-width="0.5" mask="url(#bottomMask2)"></path>

                            </svg>
                                        `;
                const addMealSectionBtnSpan = createElement('span');
                addMealSectionBtnSpan.innerHTML = `
                                <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24"><title>Plus SVG Icon</title><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M12 20v-8m0 0V4m0 8h8m-8 0H4"></path></svg>
                                                 `;

            addMealSectionBtn.onclick = handleAddMealSection;
            addMealSectionBtn.append(addMealSectionBtnSpan);
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

    mealOverlayEl.innerHTML = '';
    mealOverlayEl.style.display = 'block';
    mealOverlayEl.append(content);
}

function closeMealOverlay() {
    if (!mealOverlayEl) return;
    mealOverlayEl.innerHTML = '';
    mealOverlayEl.style.display = 'none';
}
function setMealBaseTopBarVisible(visible) {
    const topBar = document.querySelector('.top-bar');
    if (!topBar) return;
    topBar.style.display = visible ? '' : 'none';
}


function renderMealMainScreen() {
    if (!mealMainEl) return;

    const currentCycle = state.cycles?.find(c => c.id === state.selectedCycleId);

    mealMainEl.innerHTML = '';

    const contentContainer = createElement('div', 'meal-page');
    mealMainEl.append(contentContainer);

    if (!currentCycle) {
        contentContainer.append(
            createElement('h3', null, 'Питание'),
            createElement('div', 'muted', 'Цикл не найден')
        );
        return;
    }

    const title = createElement('h3');
    title.innerHTML = `Питание: <span>${currentCycle.name}</span>`;
    contentContainer.append(title);

    const weekDates = getWeekDates(state.selectedDate);
    const todayStr = formatLocalDate(new Date());

    const weekPresence = {};
    weekDates.forEach(date => {
        weekPresence[date] = false;
    });

    if (state.selectedDate && state.mealsData) {
        weekPresence[state.selectedDate] = hasAnyFoodInDoc(state.mealsData);
    }

    const weekHeader = createElement('div', 'week-strip-header');

    const weekTitle = createElement('div', 'week-strip-title', getSelectedDayTitle(state.selectedDate));
    weekTitle.id = 'week-strip-title';
    weekHeader.append(weekTitle);

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
        const check = createElement('div', 'week-day-check', hasFood ? '✓' : '');

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
    contentContainer.append(mealsContainer);

    meals.forEach(meal => {
        mealsContainer.append(createMealCard(meal));
    });

    const existingMealKeys = getMealKeysFromData(state.mealsData || {});
    if (existingMealKeys.length < 6) {
        const addMealWrap = createElement('div', 'add-meal-wrap');

        const addMealSectionBtn = createElement('button', 'tab-shape-btn');
        addMealSectionBtn.id = 'add-meal-section-btn';

        addMealSectionBtn.innerHTML = `
            <svg class="tab-shape" viewBox="0 0 320 76" xmlns="http://www.w3.org/2000/svg">

              <defs>
                <mask id="bottomMask2">
                  <rect x="0" y="20" width="320" height="60" preserveAspectRatio="none fill=" white"=""></rect>
                </mask>
              </defs>

              <!-- основной -->
              <path d="
                  M10 0
                  H310
                  Q320 0 320 10
                  V17
                  Q320 27 310 27

                  H210
                  Q190 27 180 36
                  Q170 46 160 46
                  Q150 46 140 36
                  Q130 27 110 27

                  H10
                  Q0 27 0 17
                  V10
                  Q0 0 10 0
                  Z
                " fill="white" stroke="#dedede" stroke-width="1"></path>

              <!-- усиление снизу -->
              <path d="
                  M10 0
                  H310
                  Q320 0 320 10
                  V17
                  Q320 27 310 27

                  H210
                  Q190 27 180 36
                  Q170 46 160 46
                  Q150 46 140 36
                  Q130 27 110 27

                  H10
                  Q0 27 0 17
                  V10
                  Q0 0 10 0
                  Z
                " fill="none" stroke="#dedede" stroke-width="0.5" mask="url(#bottomMask2)"></path>

            </svg>

        `;

        const addMealSectionBtnSpan = createElement('span');
                        addMealSectionBtnSpan.innerHTML = `
                                        <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24"><title>Plus SVG Icon</title><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M12 20v-8m0 0V4m0 8h8m-8 0H4"></path></svg>
                                                         `;




        addMealSectionBtn.onclick = handleAddMealSection;
        addMealSectionBtn.append(addMealSectionBtnSpan);
        addMealWrap.append(addMealSectionBtn);
        contentContainer.append(addMealWrap);
    }

    setTimeout(() => {
        initMealSwipe();
    }, 0);

    subscribeMeals();

    getWeekMealsPresence(weekDates).then((presence) => {
        mealMainEl?.querySelectorAll('.week-day-item').forEach(btn => {
            const date = btn.dataset.date;
            const hasFood = !!presence[date];

            btn.classList.toggle('has-food', hasFood);

            const check = btn.querySelector('.week-day-check');
            if (check) {
                check.textContent = hasFood ? '✓' : '';
            }
        });
    });
}

const RECIPE_CATEGORIES = [
    'Завтрак',
    'Обед',
    'Стартеры',
    'Супы',
    'Салаты',
    'Основные блюда',
    'Гарниры',
    'Хлеб и хлебобулочные изделия',
    'Соусы для салатов',
    'Соусы и приправы',
    'Закуски',
    'Десерты',
    'Напитки',
    'Другое'
];


function createEmptyRecipeDraft() {
    return {
        title: '',
        description: '',
        servings: '',
        prepMinutes: '',
        cookMinutes: '',
        categories: [],
        ingredients: [],
        steps: ['', '', ''],
        photos: [],
        coverPhotoIndex: 0
    };
}

function getRecipeDraft() {
    if (!state.recipeDraft || typeof state.recipeDraft !== 'object') {
        state.recipeDraft = createEmptyRecipeDraft();
    }

    if (!Array.isArray(state.recipeDraft.categories)) {
        state.recipeDraft.categories = [];
    }

    if (!Array.isArray(state.recipeDraft.ingredients)) {
        state.recipeDraft.ingredients = [];
    }

    if (!Array.isArray(state.recipeDraft.steps) || state.recipeDraft.steps.length < 3) {
        state.recipeDraft.steps = ['', '', ''];
    }

    if (!Array.isArray(state.recipeDraft.photos)) {
        state.recipeDraft.photos = [];
    }

    return state.recipeDraft;
}

function getRecipeCategoryValue(draft) {
    return Array.isArray(draft.categories) && draft.categories.length
        ? String(draft.categories[0] || '')
        : '';
}

function setRecipeCategoryValue(draft, value) {
    draft.categories = value ? [value] : [];
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

function openRecipeCategorySheet({ value = '', onSelect }) {
    const overlay = createElement('div', 'copy-meal-sheet-overlay');
    const sheet = createElement('div', 'copy-meal-sheet recipe-category-sheet');

    const header = createElement('div', 'copy-meal-sheet-header');
    const title = createElement('div', 'copy-meal-sheet-title', 'Категория');

    const confirmBtn = createElement('button', 'copy-meal-sheet-confirm', 'Готово');
    confirmBtn.type = 'button';

    const closeBtn = createElement('button', 'copy-meal-sheet-close');
    closeBtn.type = 'button';
    closeBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24">
            <path fill="currentColor" d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59L7.11 5.7A1 1 0 1 0 5.7 7.11L10.59 12L5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4z"/>
        </svg>
    `;

    header.append(closeBtn, title, confirmBtn);

    const listWrap = createElement('div', 'recipe-category-sheet-list');
    const list = createElement('div', 'recipe-category-sheet-items');

    let selectedValue = value || '';

    RECIPE_CATEGORIES.forEach(category => {
        const item = createElement('button', 'recipe-category-sheet-item', category);
        item.type = 'button';

        if (category === selectedValue) {
            item.classList.add('active');
        }

        item.onclick = () => {
            selectedValue = category;
            list.querySelectorAll('.recipe-category-sheet-item').forEach(el => {
                el.classList.toggle('active', el.textContent === category);
            });
        };

        list.append(item);
    });

    function closeSheet() {
        overlay.classList.remove('open');
        sheet.classList.remove('open');
        setTimeout(() => overlay.remove(), 240);
    }

    closeBtn.onclick = closeSheet;

    confirmBtn.onclick = () => {
        if (onSelect) onSelect(selectedValue);
        closeSheet();
    };

    overlay.onclick = (e) => {
        if (e.target === overlay) closeSheet();
    };

    listWrap.append(list);
    sheet.append(header, listWrap);
    overlay.append(sheet);
    document.body.append(overlay);

    requestAnimationFrame(() => {
        overlay.classList.add('open');
        sheet.classList.add('open');
    });
}







// =================================================================
// 🍽️ ГЛАВНАЯ СТРАНИЦА
// =================================================================
export async function renderMealPage() {
    if (!ensureCycleSelected(render)) return;

    state.currentPage = 'meal';

    if (!state.selectedDate) {
        state.selectedDate = formatLocalDate(new Date());
    }

    ensureMealShell();

    const oldTopBar = document.querySelector('.top-bar');
    if (oldTopBar) oldTopBar.remove();

    renderTopBar();
    bindMealCalendarButton();

    const needRenderMain =
        !mealMainMounted ||
        !mealMainEl ||
        !mealShellEl ||
        !document.getElementById('meal-shell') ||
        !mealMainEl.hasChildNodes();

    if (needRenderMain) {
        renderMealMainScreen();
        mealMainMounted = true;
    }

    if (!state.mealView || state.mealView === 'main') {
        closeMealOverlay();
        setMealBaseTopBarVisible(true);
        return;
    }

    setMealBaseTopBarVisible(false);

    if (state.mealView === 'search') return renderMealSearch();
    if (state.mealView === 'create') return renderCreateFood();
    if (state.mealView === 'recipe') return renderCreateRecipe();
    if (state.mealView === 'recipeFoodSearch') return renderRecipeFoodSearch();
    if (state.mealView === 'recipeFoodPreview') return renderRecipeFoodPreview();
    if (state.mealView === 'foodDetails') return renderFoodDetails();
    if (state.mealView === 'recipeDetails') { renderRecipeDetails(); return; }
    if (state.mealView === 'editRecipe') { renderEditRecipe(); eturn; }
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
    if (!saveBtn) return;

    const valid = getMealGoalSaveValidity();

    saveBtn.disabled = !valid;
    saveBtn.classList.toggle('disabled', !valid);
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

    const oldBar = target.querySelector('.meal-goal-top-bar');
    if (oldBar) oldBar.remove();

    const topBar = document.createElement('div');
    topBar.className = 'meal-goal-top-bar';

    const leftBtn = document.createElement('button');
    leftBtn.className = 'meal-goal-top-btn';
    leftBtn.type = 'button';
    leftBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"><title>Ios-arrow-ltr-24-filled SVG Icon</title><path fill="currentColor" d="M12.727 3.687a1 1 0 1 0-1.454-1.374l-8.5 9a1 1 0 0 0 0 1.374l8.5 9.001a1 1 0 1 0 1.454-1.373L4.875 12z"></path></svg>
    `;
    leftBtn.onclick = () => {
        state.mealView = null;
        closeMealOverlay();
        setMealBaseTopBarVisible(true);
    };

    const centerWrap = document.createElement('div');
    centerWrap.className = 'meal-goal-top-actions';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'meal-goal-top-btn meal-goal-top-btn-save disabled';
    saveBtn.type = 'button';
    saveBtn.disabled = true;
    saveBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 512 512">
                  <title>Checkmark-sharp SVG Icon</title>
                  <path fill="none" stroke="currentColor" stroke-linecap="square" stroke-miterlimit="10" stroke-width="44" d="M416 128L192 384l-96-96"></path>
                </svg>
    `;

    saveBtn.onclick = async () => {
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
    };

    centerWrap.append(saveBtn);
    topBar.append(leftBtn, centerWrap);
    target.prepend(topBar);
    updateMealGoalSaveButtonState();
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

    const kcal = createElement('span', 'meal-goal-summary-kcal', `${g.calories} ккал`);
    const dot = createElement('span', 'meal-goal-summary-dot', '•');

    const pLabel = createElement('span', 'meal-goal-summary-macro-label meal-goal-summary-macro-label-protein', 'Б-');
    const pValue = createElement('span', 'meal-goal-summary-macro-value meal-goal-summary-macro-value-protein', String(g.protein));

    const sep1 = createElement('span', 'meal-goal-summary-separator', '/');

    const fLabel = createElement('span', 'meal-goal-summary-macro-label meal-goal-summary-macro-label-fat', 'Ж-');
    const fValue = createElement('span', 'meal-goal-summary-macro-value meal-goal-summary-macro-value-fat', String(g.fat));

    const sep2 = createElement('span', 'meal-goal-summary-separator', '/');

    const cLabel = createElement('span', 'meal-goal-summary-macro-label meal-goal-summary-macro-label-carbs', 'У-');
    const cValue = createElement('span', 'meal-goal-summary-macro-value meal-goal-summary-macro-value-carbs', String(g.carbs));

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
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"><title>Plus SVG Icon</title><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M12 20v-8m0 0V4m0 8h8m-8 0H4"></path></svg>
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
    openMealOverlay(overlayPage);
    renderMealGoalTopBar();

    const goal = getMealGoalState();

    const page = createElement('div', 'meal-goal-page');
    const title = createElement('h3', 'meal-goal-page-title', 'Цели');
    const presets = renderSavedMealGoalPresets();
    const topFone = createElement('div', 'topfone');
    topFone.innerHTML = `
            <svg viewBox="0 0 320 76" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none">

              <!-- белая заливка -->
              <path d="
                  M 0 0
                  C 8.39 14.95, 22.74 25.91, 38.41 32.84
                  C 54.08 39.77, 71.14 42.98, 88.08 45.8
                  C 139.21 52.72, 191.02 51.81, 242.61 51.68
                  C 256.85 51.64, 284.68 49, 298.38 52.9
                  C 311.36 56.6, 320 65.16, 319.33 76
                  L 0 76
                  Z
                " fill="white"></path>

              <!-- border-top -->
              <path d="
                  M 0 0
                  C 8.39 14.95, 22.74 25.91, 38.41 32.84
                  C 54.08 39.77, 71.14 42.98, 88.08 45.8
                  C 139.21 52.72, 191.02 51.81, 242.61 51.68
                  C 256.85 51.64, 284.68 49, 298.38 52.9
                  C 311.36 56.6, 320 65.16, 319.33 76
                " fill="none" stroke="#dedede" stroke-width="0.5"></path>

              <!-- border-left -->
              <line x1="0.25" y1="0" x2="0.25" y2="76" stroke="#dedede" stroke-width="0.5"></line>

            </svg>
        `;



    const dailyBlock = renderDailyGoalBlock(goal);
    const weekdayBlock = renderWeekdayGoalBlock(goal);
    const intervalBlock = renderIntervalGoalBlock(goal);

    page.append(title, presets, topFone, dailyBlock, weekdayBlock, intervalBlock);
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
            state.mealView = 'recipeFoodSearch';
            state.editFoodBackTarget = null;
            renderMealPage();
            return;
        }

        state.mealView = 'search';
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
            state.mealView = 'recipeFoodPreview';
            renderMealPage();
            return;
        }

        state.mealView = 'foodDetails';
        renderMealPage();
    };

    const pageTitle = createElement('h3', 'create-food-page-title', 'Редактировать продукт');

    topBar.append(backBtn);

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

    let selectedUnit = food.baseUnit || 'г';

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

    ['г', 'мл', 'порция'].forEach(unit => {
        const option = createElement('button', 'create-food-unit-dropdown-item', unit);
        option.type = 'button';

        option.onclick = (e) => {
            e.stopPropagation();
            selectedUnit = unit;
            unitValue.textContent = unit;
            unitDropdown.style.display = 'none';
            unitWrap.classList.remove('open');
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

    document.addEventListener('click', () => {
        unitDropdown.style.display = 'none';
        unitWrap.classList.remove('open');
    });

    unitWrap.append(unitField, unitDropdown);

    const portion = createElement('input', 'create-food-input');
    portion.type = 'number';
    portion.inputMode = 'decimal';
    portion.placeholder = 'Например 100';
    portion.value = Number(food.baseAmount || 100);

    const defaultAmount = createElement('input', 'create-food-input');
    defaultAmount.type = 'number';
    defaultAmount.inputMode = 'decimal';
    defaultAmount.placeholder = 'Например 30';
    defaultAmount.value = Number(food.defaultAmount || food.baseAmount || 100);

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

    const rows = [
        createFormRow('Название', name, true),
        createFormRow('Описание', description, true, 'is-textarea'),
        createFormRow('Ед. изм.', unitWrap, true),
        createFormRow('Базовый вес', portion, true),
        createFormRow('Обычная порция', defaultAmount, true),
        createFormRow('Белки', protein, true),
        createFormRow('Жиры', fat, true),
        createFormRow('Углеводы', carbs, true),
        createFormRow('Калории', calories, true)
    ];

    rows.forEach(row => formCard.append(row));

    const actions = createElement('div', 'create-food-actions');

    const saveBtn = createElement('button', 'save-btn create-food-submit-btn', 'Сохранить');
    saveBtn.disabled = true;

    function isFilled(value) {
        return String(value ?? '').trim() !== '';
    }

    function validateForm() {
        const allFilled =
            isFilled(name.value) &&
            isFilled(description.value) &&
            isFilled(selectedUnit) &&
            isFilled(portion.value) &&
            isFilled(defaultAmount.value) &&
            isFilled(protein.value) &&
            isFilled(fat.value) &&
            isFilled(carbs.value) &&
            isFilled(calories.value);

        saveBtn.disabled = !allFilled;
        saveBtn.classList.toggle('active', allFilled);
    }

    [
        name,
        description,
        portion,
        defaultAmount,
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

        const cycleRef = getCycleDocRef();
        const foodRef = doc(cycleRef, 'foods', state.currentFoodId);

        const updatedFood = {
            name: name.value.trim(),
            description: description.value.trim(),
            baseUnit: selectedUnit,
            baseAmount: Number(portion.value),
            defaultAmount: Number(defaultAmount.value),
            protein: Number(protein.value),
            fat: Number(fat.value),
            carbs: Number(carbs.value),
            calories: Number(calories.value)
        };

        await updateDoc(foodRef, updatedFood);

        if (foodsMapCache && foodsMapCycleId === state.selectedCycleId) {
            foodsMapCache[state.currentFoodId] = {
                ...foodsMapCache[state.currentFoodId],
                ...updatedFood
            };
        }

        const backTarget = state.editFoodBackTarget || 'foodDetails';

        if (backTarget === 'recipeFoodPreview') {
            state.mealView = 'recipeFoodPreview';
            state.editFoodBackTarget = null;
            renderMealPage();
            return;
        }

        state.mealView = 'foodDetails';
        state.editFoodBackTarget = null;
        renderMealPage();
    };

    actions.append(saveBtn);

    container.append(topBar, pageTitle, formCard, actions);
    openMealOverlay(container);

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
    const foodsMap = await getFoodsMap();

    let food = null;
    let currentAmount = 0;
    let showEditButton = false;
    let selectedMealId = null;

    if (source === 'foods') {
        food = foodsMap[state.currentFoodId];

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
                    state.mealView = 'search';
                    renderMealPage();
                    return;
                }

                if (isMealSource) {
                    state.mealView = null;
                    closeMealOverlay();
                    setMealBaseTopBarVisible(true);
                    return;
                }
            };

            topBarCreateFood.append(backBtn);
            container.append(
                topBarCreateFood,
                createElement('h3', null, 'Продукт не найден')
            );
            openMealOverlay(container);
            return;
        }

        currentAmount = Number(food.defaultAmount || food.baseAmount || 100);
        showEditButton = true;
    } else {
        const mealId = state.currentMealDetailsId;
        const itemIndex = state.currentMealItemIndex;
        const items = state.mealsData?.[mealId] || [];
        const mealItem = items[itemIndex];

        if (!mealItem) {
            showToast('Продукт в приеме не найден');
            state.mealView = null;
            closeMealOverlay();
            setMealBaseTopBarVisible(true);
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

        if (source === 'foods') {
            state.mealView = 'search';
            renderMealSearch();
            return;
        }

        state.mealView = null;
        closeMealOverlay();
        setMealBaseTopBarVisible(true);
    };

    const title = createElement('h3', null, food.name || 'Продукт');

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
    } else if (isFoodsSource || isRecipeFoodsSource) {
        saveBtn = createElement('button', 'food-add-btn meal-search-add-btn');
        saveBtn.type = 'button';
        saveBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24">
                <title>Plus SVG Icon</title>
                <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M12 20v-8m0 0V4m0 8h8m-8 0H4"></path>
            </svg>
        `;
    }

    BlocksaveBtn.append(saveBtn);

    const deleteBtnWrap = createElement('div', 'block-delete-btn');
    const deleteBtn = createElement('button', 'delete-food-from-meal-btn');
       deleteBtn.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"><title>Trash-24 SVG Icon</title><path fill="currentColor" d="M16 1.75V3h5.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H8V1.75C8 .784 8.784 0 9.75 0h4.5C15.216 0 16 .784 16 1.75m-6.5 0V3h5V1.75a.25.25 0 0 0-.25-.25h-4.5a.25.25 0 0 0-.25.25M4.997 6.178a.75.75 0 1 0-1.493.144L4.916 20.92a1.75 1.75 0 0 0 1.742 1.58h10.684a1.75 1.75 0 0 0 1.742-1.581l1.413-14.597a.75.75 0 0 0-1.494-.144l-1.412 14.596a.25.25 0 0 1-.249.226H6.658a.25.25 0 0 1-.249-.226z"></path><path fill="currentColor" d="M9.206 7.501a.75.75 0 0 1 .793.705l.5 8.5A.75.75 0 1 1 9 16.794l-.5-8.5a.75.75 0 0 1 .705-.793Zm6.293.793A.75.75 0 1 0 14 8.206l-.5 8.5a.75.75 0 0 0 1.498.088l.5-8.5Z"></path></svg>
            `;

            deleteBtn.onclick = () => {
                openConfirmModal('Удалить продукт из приема?', async () => {
                    await removeFoodFromMeal(state.currentMealDetailsId, state.currentMealItemIndex);
                    showToast('Продукт удалён');

                    state.mealView = null;
                    closeMealOverlay();
                    setMealBaseTopBarVisible(true);
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
               await updateFoodDefaultAmount(state.currentFoodId, newAmount);

               const foodsMap = await getFoodsMap();
               const updatedFood = foodsMap[state.currentFoodId];

               if (!updatedFood) {
                   showToast('Продукт не найден');
                   return;
               }

               await addFoodSnapshotToCurrentMeal(updatedFood, newAmount);

               showToast('Продукт добавлен в прием');

               state.mealView = 'search';
               renderMealSearch();
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

               state.mealView = null;
               closeMealOverlay();
               setMealBaseTopBarVisible(true);
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



    deleteBtnWrap.append(deleteBtn);
    BlocksaveBtn.append(saveBtn);
        if (source === 'meal') {
            topBarCreateFood.append(backBtn, deleteBtnWrap, BlocksaveBtn);
        } else {
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
        topBarCreateFood,
        title,
        ...(titleDesc ? [titleDesc] : []),
        topBlockCreateFood,
        currentValuesWrap,
        passportBlock
    );

    if (showEditButton) {
        const editBtn = createElement('button', 'edit-meal-search-main-action');
        editBtn.innerHTML = `
            <span class="btn-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24">
                    <path fill="currentColor" d="M3.548 20.938h16.9a.5.5 0 0 0 0-1h-16.9a.5.5 0 0 0 0 1M9.71 17.18a2.587 2.587 0 0 0 1.12-.65l9.54-9.54a1.75 1.75 0 0 0 0-2.47l-.94-.93a1.788 1.788 0 0 0-2.47 0l-9.54 9.53a2.473 2.473 0 0 0-.64 1.12L6.04 17a.737.737 0 0 0 .19.72a.767.767 0 0 0 .53.22Zm.41-1.36a1.468 1.468 0 0 1-.67.39l-.97.26l-1-1l.26-.97a1.521 1.521 0 0 1 .39-.67l.38-.37l1.99 1.99Zm1.09-1.08l-1.99-1.99l6.73-6.73l1.99 1.99Zm8.45-8.45L18.65 7.3l-1.99-1.99l1.01-1.02a.748.748 0 0 1 1.06 0l.93.94a.754.754 0 0 1 0 1.06"></path>
                </svg>
            </span>
            <span class="btn-text">Изменить пищевую ценность</span>
        `;

        editBtn.onclick = () => {
            state.mealView = 'editFood';
            renderEditFood();
        };
        container.append(editBtn);
    }

    openMealOverlay(container);
}


async function renderRecipeDetails() {
    ensureMealShell();
    setMealBaseTopBarVisible(false);

    const cycleRef = getCycleDocRef();
    if (!cycleRef || !state.currentRecipeId) return;

    const recipeSnap = await getDoc(doc(cycleRef, 'recipes', state.currentRecipeId));

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
            state.mealView = 'search';
            state.recipeServingsDraft = null;
            renderMealPage();
        };

        topBarCreateFood.append(backBtn);
        container.append(
            topBarCreateFood,
            createElement('h3', null, 'Рецепт не найден')
        );
        openMealOverlay(container);
        return;
    }

    const recipe = {
        id: recipeSnap.id,
        ...recipeSnap.data()
    };

    let currentAmount = Number(state.recipeServingsDraft || recipe.servings || 1);
    if (!currentAmount || currentAmount <= 0) {
        currentAmount = Number(recipe.servings || 1) || 1;
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
        state.mealView = 'search';
        state.recipeServingsDraft = null;
        renderMealPage();
    };

    const title = createElement('h3', null, recipe.title || 'Рецепт');

    const titleDesc = recipe.description?.trim()
        ? createElement('div', 'food-title-description', recipe.description)
        : null;

    const topBlockCreateFood = createElement('div','topBlock-create-food');

    const inlineSaveBtn = createElement('button', 'food-inline-save-btn');
    inlineSaveBtn.type = 'button';
    inlineSaveBtn.textContent = 'Сохранить';

    const amountInput = createElement('input', 'input');
    amountInput.type = 'number';
    amountInput.placeholder = 'Порции';
    amountInput.value = currentAmount;

    const unitInput = createElement('input', 'input');
    unitInput.value = 'порц';
    unitInput.disabled = true;

    const BlocksaveBtn = createElement('div', 'block-save-btn active');
    const saveBtn = createElement('button', 'food-add-btn meal-search-add-btn');
    saveBtn.type = 'button';
    saveBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24">
            <title>Plus SVG Icon</title>
            <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M12 20v-8m0 0V4m0 8h8m-8 0H4"></path>
        </svg>
    `;

    BlocksaveBtn.append(saveBtn);
    topBarCreateFood.append(backBtn, BlocksaveBtn);

    const currentValuesWrap = createElement('div', 'food-current-card');

    function getRecipeTotals(servings) {
        const baseServings = Math.max(1, Number(recipe.servings || 1));
        const currentServings = Math.max(1, Number(servings || baseServings));
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

    inlineSaveBtn.onclick = async () => {
        const newAmount = Number(amountInput.value || 0);

        if (!newAmount || newAmount <= 0) {
            showToast('Введите корректное количество порций');
            return;
        }

        try {
            inlineSaveBtn.disabled = true;

            await updateDoc(doc(cycleRef, 'recipes', recipe.id), {
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
            state.mealView = 'search';
            renderMealPage();
        } catch (error) {
            console.error(error);
            showToast('Ошибка при добавлении');
        } finally {
            saveBtn.disabled = false;
        }
    };

    const passportBlock = createElement('div', 'food-passport-block');

    function renderPassportBlock() {
        const baseServings = Math.max(1, Number(recipe.servings || 1));
        const currentServings = Math.max(1, Number(amountInput.value || baseServings));
        const factor = currentServings / baseServings;

        const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];

        passportBlock.innerHTML = `
            <div class="food-passport-title">Состав рецепта</div>
            <div class="food-passport-divider"></div>

            <div class="food-passport-portion-row">
                <span>Порций</span>
                <span>${currentServings}</span>
            </div>

            <div class="food-passport-bar"></div>

            <div class="food-passport-portion-label">ингредиенты</div>

            <div class="food-passport-bar"></div>
        `;

        ingredients.forEach((item, index) => {
            const grams = Number(item.grams || item.baseAmount || 0) * factor;
            const protein = Number(item.protein || 0) * factor;
            const fat = Number(item.fat || 0) * factor;
            const carbs = Number(item.carbs || 0) * factor;
            const calories = Number(item.calories || 0) * factor;

            const row = createElement('div', `food-passport-row ${index === ingredients.length - 1 ? 'food-passport-row-last' : ''}`);
            row.innerHTML = `
                <div class="food-passport-name">${item.name || 'Без названия'}</div>
                <div class="food-passport-value">
                    ${formatMacro(grams, 1)}${item.baseUnit || 'г'} · Б ${formatMacro(protein, 1)} · Ж ${formatMacro(fat, 1)} · У ${formatMacro(carbs, 1)} · ${Math.round(calories)} кал
                </div>
            `;
            passportBlock.append(row);
        });

        const bottomBar = createElement('div', 'food-passport-bar food-passport-bar-bottom');
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
    topBlockCreateFood.append(amountRow, unitRow, inlineSaveBtn);

    renderCurrentValuesBlock();
    renderPassportBlock();

    container.append(
        topBarCreateFood,
        title,
        ...(titleDesc ? [titleDesc] : []),
        topBlockCreateFood,
        currentValuesWrap,
        passportBlock
    );

    const editBtn = createElement('button', 'edit-meal-search-main-action');
    editBtn.type = 'button';
    editBtn.innerHTML = `
        <span class="btn-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24">
                <path fill="currentColor" d="M3.548 20.938h16.9a.5.5 0 0 0 0-1h-16.9a.5.5 0 0 0 0 1M9.71 17.18a2.587 2.587 0 0 0 1.12-.65l9.54-9.54a1.75 1.75 0 0 0 0-2.47l-.94-.93a1.788 1.788 0 0 0-2.47 0l-9.54 9.53a2.473 2.473 0 0 0-.64 1.12L6.04 17a.737.737 0 0 0 .19.72a.767.767 0 0 0 .53.22Zm.41-1.36a1.468 1.468 0 0 1-.67.39l-.97.26l-1-1l.26-.97a1.521 1.521 0 0 1 .39-.67l.38-.37l1.99 1.99Zm1.09-1.08l-1.99-1.99l6.73-6.73l1.99 1.99Zm8.45-8.45L18.65 7.3l-1.99-1.99l1.01-1.02a.748.748 0 0 1 1.06 0l.93.94a.754.754 0 0 1 0 1.06"></path>
            </svg>
        </span>
        <span class="btn-text">Редактировать рецепт</span>
    `;

    editBtn.onclick = () => {
        state.recipeServingsDraft = null;
        state.mealView = 'editRecipe';
        renderMealPage();
    };

    container.append(editBtn);

    openMealOverlay(container);
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

    // ===== row: day =====
    const dayRowObj = makePickerRow('За день');
    const dayPicker = makeFancyDateButton(state.selectedDate || '');

    dayRowObj.right.append(dayPicker.wrap);

    // ===== row: range =====
    const rangeRowObj = makePickerRow('Период');
    const startPicker = makeFancyDateButton('');
    const endPicker = makeFancyDateButton('');

    const dash = document.createElement('span');
    dash.textContent = '—';
    dash.style.color = '#666';
    dash.style.fontWeight = '700';

    rangeRowObj.right.append(startPicker.wrap, dash, endPicker.wrap);

    // ===== interactions =====
        dayPicker.input.onchange = () => {
            selectedMode = 'day';
            startPicker.setValue('');
            endPicker.setValue('');
            activateRow(dayRowObj.row, rangeRowObj.row);
        };

        function handleRangeChange() {
            selectedMode = 'range';
            dayPicker.setValue('');
            activateRow(rangeRowObj.row, dayRowObj.row);
        }

        startPicker.input.onchange = handleRangeChange;
        endPicker.input.onchange = handleRangeChange;

        dayRowObj.row.onclick = (e) => {
            if (e.target.closest('button')) return;
            dayPicker.openPickerDirectly();
        };

        rangeRowObj.row.onclick = (e) => {
            if (e.target.closest('button')) return;
            startPicker.openPickerDirectly();
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
async function removeFoodFromMeal(mealId, index){

    const cycleRef = getCycleDocRef();
    const mealRef = doc(cycleRef, 'meals', state.selectedDate);

    const snap = await getDoc(mealRef);
    const data = snap.data();

    const updated = [...(data[mealId] || [])];
    updated.splice(index, 1);

    await updateDoc(mealRef, {
        [mealId]: updated
    });
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
    if (!state.mealSearchSort) {
        state.mealSearchSort = 'recent';
    }
}

function getMealSearchSectionTitle() {
    if (state.mealSearchTab === 'products') return 'Мои продукты';
    if (state.mealSearchTab === 'recipes') return 'Мои рецепты';
    return 'История';
}

function getMealSearchSortLabel() {
    ensureMealSearchSortState();

    if (state.mealSearchSort === 'popular') return 'Самые используемые';
    if (state.mealSearchSort === 'az') return 'от А до Я';
    if (state.mealSearchSort === 'za') return 'от Я до А';
    return 'Недавние';
}

function sortFoodsForMealSearch(foods = []) {
    ensureMealSearchSortState();

    const sorted = [...foods];

    if (state.mealSearchSort === 'az') {
        sorted.sort((a, b) => (a.name || '').localeCompare((b.name || ''), 'ru'));
        return sorted;
    }

    if (state.mealSearchSort === 'za') {
        sorted.sort((a, b) => (b.name || '').localeCompare((a.name || ''), 'ru'));
        return sorted;
    }

    if (state.mealSearchSort === 'popular') {
        sorted.sort((a, b) => {
            const aCount = Number(a.usageCount || 0);
            const bCount = Number(b.usageCount || 0);
            if (bCount !== aCount) return bCount - aCount;

            const aTime = Number(a.createdAt || 0);
            const bTime = Number(b.createdAt || 0);
            if (bTime !== aTime) return bTime - aTime;

            return (a.name || '').localeCompare((b.name || ''), 'ru');
        });
        return sorted;
    }

    sorted.sort((a, b) => {
        const aTime = Number(a.createdAt || 0);
        const bTime = Number(b.createdAt || 0);
        if (bTime !== aTime) return bTime - aTime;
        return (a.name || '').localeCompare((b.name || ''), 'ru');
    });

    return sorted;
}

function sortRecipesForMealSearch(recipes = []) {
    ensureMealSearchSortState();

    const sorted = [...recipes];

    if (state.mealSearchSort === 'az') {
        sorted.sort((a, b) => (a.name || '').localeCompare((b.name || ''), 'ru'));
        return sorted;
    }

    if (state.mealSearchSort === 'za') {
        sorted.sort((a, b) => (b.name || '').localeCompare((a.name || ''), 'ru'));
        return sorted;
    }

    if (state.mealSearchSort === 'popular') {
        sorted.sort((a, b) => {
            const aCount = Number(a.usageCount || 0);
            const bCount = Number(b.usageCount || 0);
            if (bCount !== aCount) return bCount - aCount;

            const aTime = Number(a.createdAt || 0);
            const bTime = Number(b.createdAt || 0);
            if (bTime !== aTime) return bTime - aTime;

            return (a.name || '').localeCompare((b.name || ''), 'ru');
        });
        return sorted;
    }

    sorted.sort((a, b) => {
        const aTime = Number(a.createdAt || 0);
        const bTime = Number(b.createdAt || 0);
        if (bTime !== aTime) return bTime - aTime;
        return (a.name || '').localeCompare((b.name || ''), 'ru');
    });

    return sorted;
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

    const mealOptions = getMealSearchOptions();
    if (!mealOptions.some(opt => opt.id === state.currentMealId)) {
        state.currentMealId = mealOptions[0]?.id || 'meal1';
    }

    let loadRequestId = 0;
    let stopAutoHide = null;

    const screen = createElement('div', 'meal-search-screen');
    const sticky = createElement('div', 'meal-search-sticky');
    const body = createElement('div', 'meal-search-body');

    // ===== Верхняя строка
    const topRow = createElement('div', 'meal-search-topbar');

    const backBtn = createElement('button', 'meal-search-back-btn');
    backBtn.type = 'button';
    backBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"><title>Ios-arrow-ltr-24-filled SVG Icon</title><path fill="currentColor" d="M12.727 3.687a1 1 0 1 0-1.454-1.374l-8.5 9a1 1 0 0 0 0 1.374l8.5 9.001a1 1 0 1 0 1.454-1.373L4.875 12z"></path></svg>
    `;
    backBtn.onclick = () => {
        state.mealView = null;
        closeMealOverlay();
        setMealBaseTopBarVisible(true);
    };

const titleWrap = createElement('div', 'meal-search-meal-picker');
const titleBtn = createElement('button', 'meal-search-meal-trigger');
titleBtn.type = 'button';

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

function closeMealPicker() {
    titleWrap.classList.remove('open');
    dropdown.classList.remove('open');
    menuBackdrop.remove();
}

function openMealPicker() {
    sticky.classList.remove('is-hidden');
    titleWrap.classList.add('open');
    dropdown.classList.add('open');
    screen.append(menuBackdrop);
}

menuBackdrop.onclick = closeMealPicker;

titleBtn.onclick = () => {
    if (titleWrap.classList.contains('open')) {
        closeMealPicker();
    } else {
        openMealPicker();
    }
};

mealOptions.forEach(opt => {
    const item = createElement('button', 'meal-search-picker-item', opt.label);
    item.type = 'button';

    if (opt.id === state.currentMealId) {
        item.classList.add('active');
    }

    item.onclick = () => {
        state.currentMealId = opt.id;
        titleText.textContent = opt.label;

        dropdown.querySelectorAll('.meal-search-picker-item').forEach(btn => {
            btn.classList.toggle('active', btn === item);
        });

        closeMealPicker();
    };

    dropdown.append(item);
});

titleWrap.append(dropdown);

topRow.append(backBtn, titleWrap);

    // ===== Поиск
    const searchBox = createElement('div', 'meal-search-box');

    const searchIcon = createElement('div', 'meal-search-icon');
    searchIcon.innerHTML = `
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/>
            <path d="M16 16l5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
    `;

    const input = createElement('input', 'meal-search-input');
    input.placeholder = 'Поиск еды';
    input.autocomplete = 'off';
    input.spellcheck = false;

    searchBox.append(searchIcon, input);

    // ===== Tabs
    const tabsRow = createElement('div', 'meal-search-tabs');

    const tabAll = createElement('button', 'meal-search-tab', 'Все');
    const tabProducts = createElement('button', 'meal-search-tab', 'Мои продукты');
    const tabRecipes = createElement('button', 'meal-search-tab', 'Мои рецепты');

    function updateTabs() {
        [tabAll, tabProducts, tabRecipes].forEach(tab => tab.classList.remove('active'));

        if (state.mealSearchTab === 'all') tabAll.classList.add('active');
        if (state.mealSearchTab === 'products') tabProducts.classList.add('active');
        if (state.mealSearchTab === 'recipes') tabRecipes.classList.add('active');
    }

    tabAll.onclick = () => {
        if (state.mealSearchTab === 'all') return;
        state.mealSearchTab = 'all';
        updateTabs();
        sectionTitle.textContent = getMealSearchSectionTitle();
        loadAndRender();
    };

    tabProducts.onclick = () => {
        if (state.mealSearchTab === 'products') return;
        state.mealSearchTab = 'products';
        updateTabs();
        sectionTitle.textContent = getMealSearchSectionTitle();
        loadAndRender();
    };

    tabRecipes.onclick = () => {
        if (state.mealSearchTab === 'recipes') return;
        state.mealSearchTab = 'recipes';
        updateTabs();
        sectionTitle.textContent = getMealSearchSectionTitle();
        loadAndRender();
    };

    tabsRow.append(tabAll, tabProducts, tabRecipes);
    updateTabs();

    // ===== Actions
    const actionsWrap = createElement('div', 'meal-search-actions');

    // ===== History title + sort
    const sectionHead = createElement('div', 'meal-search-section-head');
    const sectionTitle = createElement('div', 'meal-search-section-title-main', getMealSearchSectionTitle());

    const sortBtn = createElement('button', 'meal-search-sort-btn');
    sortBtn.type = 'button';
    sortBtn.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M6 7h12M9 12h9M12 17h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <span>${getMealSearchSortLabel()}</span>
    `;

    sectionHead.append(sectionTitle, sortBtn);
    sortBtn.onclick = () => {
        openMealSearchSortSheet({
            onApply: () => {
                const labelEl = sortBtn.querySelector('span');
                if (labelEl) {
                    labelEl.textContent = getMealSearchSortLabel();
                }

                sectionTitle.textContent = getMealSearchSectionTitle();
                loadAndRender();
            }
        });
    };

    // ===== List
    const list = createElement('div', 'food-list meal-search-list');

    async function loadAndRender() {
        const requestId = ++loadRequestId;
        const query = (input.value || '').toLowerCase().trim();

        actionsWrap.innerHTML = '';
        list.innerHTML = '';

        if (state.mealSearchTab === 'all') {
                    const addFastFoodBtn = createElement('button', 'addFast meal-search-main-action');
                    addFastFoodBtn.innerHTML = `

                        <span class="btn-text">Быстрое добавление</span>
                    `;

                    addFastFoodBtn.type = 'button';

                    addFastFoodBtn.onclick = () => {
                        state.mealView = 'create';
                        renderCreateFood();
                    };
                    actionsWrap.append(addFastFoodBtn);

                    let foods = await getFoods(query);
                    if (requestId !== loadRequestId) return;

                    foods = sortFoodsForMealSearch(foods);
                    renderFoodList(list, foods, loadAndRender);
                    return;
                }

        if (state.mealSearchTab === 'products') {
            const addFoodBtn = createElement('button', 'meal-search-main-action');
            addFoodBtn.innerHTML = `
                <span class="btn-icon">
                    <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24"><title>Plus SVG Icon</title><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M12 20v-8m0 0V4m0 8h8m-8 0H4"></path></svg>
                </span>
                <span class="btn-text">Создать продукт</span>
            `;

            addFoodBtn.type = 'button';

            addFoodBtn.onclick = () => {
                state.createFoodBackTarget = 'search';
                state.mealView = 'create';
                renderMealPage();
            };

            actionsWrap.append(addFoodBtn);

            let foods = await getFoods(query);
            if (requestId !== loadRequestId) return;

            foods = sortFoodsForMealSearch(foods);
            renderFoodList(list, foods, loadAndRender);
            return;
        }

        if (state.mealSearchTab === 'recipes') {
            const addRecipeBtn = createElement('button', 'meal-search-main-action');
            addRecipeBtn.innerHTML = `
                            <span class="btn-icon">
                                <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24"><title>Plus SVG Icon</title><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M12 20v-8m0 0V4m0 8h8m-8 0H4"></path></svg>
                            </span>
                            <span class="btn-text">Создать рецепт</span>
                        `;
            addRecipeBtn.type = 'button';
            addRecipeBtn.onclick = () => {
                saveMealPageScroll();
                mealScrollRestorePending = true;

                state.recipeDraft = createEmptyRecipeDraft();
                state.mealView = 'recipe';
                renderMealPage();
            };
            actionsWrap.append(addRecipeBtn);

            let recipes = await getRecipes(query);
            if (requestId !== loadRequestId) return;

            recipes = sortRecipesForMealSearch(recipes);
           renderRecipeList(list, recipes, loadAndRender);
            return;
        }

        let [foods, recipes] = await Promise.all([
            getFoods(query),
            getRecipes(query)
        ]);

        if (requestId !== loadRequestId) return;

        foods = sortFoodsForMealSearch(foods);
        recipes = sortRecipesForMealSearch(recipes);

        renderMixedFoodAndRecipes(list, foods, recipes, loadAndRender);
    }

    input.addEventListener('input', debounce(() => {
        loadAndRender();
    }, 250));

    sticky.append(topRow, searchBox, tabsRow, actionsWrap);
    body.append(sectionHead, list);
    screen.append(sticky, body);
    openMealOverlay(screen);

    stopAutoHide = initMealSearchAutoHide(screen, sticky, () => {
        const isOpen = titleWrap.classList.contains('open');
        if (isOpen) {
            titleWrap.classList.remove('open');
            dropdown.classList.remove('open');
            menuBackdrop.remove();
        }
    });

    loadAndRender();
}


// ================================ страница поиск продуктов для рецепта
async function renderRecipeFoodSearch() {
    ensureMealShell();
    setMealBaseTopBarVisible(false);

    if (typeof state.recipeFoodSearchQuery !== 'string') {
        state.recipeFoodSearchQuery = '';
    }

    const screen = createElement('div', 'meal-search-screen recipe-food-search-screen');
    const sticky = createElement('div', 'meal-search-sticky');
    const body = createElement('div', 'meal-search-body');

    // ===== Верхняя строка
    const topRow = createElement('div', 'meal-search-topbar');

    const backBtn = createElement('button', 'meal-search-back-btn');
    backBtn.type = 'button';
    backBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24">
            <path fill="currentColor" d="M10.733 19.79a.75.75 0 0 1-1.056-.074l-6-7a.75.75 0 0 1 0-.977l6-7a.75.75 0 1 1 1.14.977L5.255 12l5.562 6.487a.75.75 0 0 1-.074 1.056"/>
            <path fill="currentColor" d="M4.75 12a.75.75 0 0 1 .75-.75h14a.75.75 0 0 1 0 1.5h-14a.75.75 0 0 1-.75-.75"/>
        </svg>
    `;

    backBtn.onclick = () => {
        if (state.createRecipeBackTarget === 'editRecipe') {
            state.mealView = 'editRecipe';
            renderMealPage();
            return;
        }

        state.mealView = 'recipe';
        renderMealPage();
    };

    const title = createElement('div', 'meal-search-title', 'Добавить ингредиент');

    const rightStub = createElement('div', 'meal-search-topbar-stub');

    topRow.append(backBtn, title, rightStub);


    // ===== Поиск
    const searchWrap = createElement('div', 'meal-search-input-wrap');

    const searchInput = createElement('input', 'meal-search-input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Поиск продуктов';
    searchInput.value = state.recipeFoodSearchQuery || '';
    searchInput.autocomplete = 'off';
    searchInput.spellcheck = false;

    const searchIcon = createElement('div', 'meal-search-input-icon');
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
    updateRecipeSearchClearBtn();

    // ===== Кнопка создать продукт
    const actions = createElement('div', 'meal-search-actions');

    const createFoodBtn = createElement('button', 'meal-search-main-action');
    createFoodBtn.type = 'button';
    createFoodBtn.textContent = 'Создать продукт';

    createFoodBtn.onclick = () => {
        state.createFoodBackTarget = 'recipeFoodSearch';
        state.mealView = 'create';
        renderMealPage();
    };

    actions.append(createFoodBtn);

    // ===== Список
    const list = createElement('div', 'food-list meal-search-list');

    async function loadAndRenderFoods() {
        const query = (state.recipeFoodSearchQuery || '').trim();
        const foods = await getFoods(query);

        list.innerHTML = '';

        if (!foods.length) {
            const empty = createElement('div', 'meal-search-empty', 'Ничего не найдено');
            list.append(empty);
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

    sticky.append(topRow, searchWrap, actions);
    body.append(list);
    screen.append(sticky, body);

    openMealOverlay(screen);
    await loadAndRenderFoods();
}

async function renderRecipeFoodPreview() {
    ensureMealShell();
    setMealBaseTopBarVisible(false);

    const foodsMap = await getFoodsMap();
    const food = foodsMap[state.recipeSelectedFoodId];

    if (!food) {
        const container = createElement('div', 'create-food');
        const topBarCreateFood = createElement('div', 'topBar-create-food');
        const backBtn = createElement('button', 'back-btn');
        backBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24">
                <title>Ios-arrow-ltr-24-filled SVG Icon</title>
                <path fill="currentColor" d="M12.727 3.687a1 1 0 1 0-1.454-1.374l-8.5 9a1 1 0 0 0 0 1.374l8.5 9.001a1 1 0 1 0 1.454-1.373L4.875 12z"></path>
            </svg>
        `;

        backBtn.onclick = () => {
            state.mealView = 'recipeFoodSearch';
            renderMealPage();
        };

        topBarCreateFood.append(backBtn);
        container.append(
            topBarCreateFood,
            createElement('h3', null, 'Продукт не найден')
        );

        openMealOverlay(container);
        return;
    }

    let currentAmount = Number(food.defaultAmount || food.baseAmount || 100);

    const container = createElement('div', 'create-food');
    const topBarCreateFood = createElement('div', 'topBar-create-food');

    const backBtn = createElement('button', 'back-btn');
    backBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24">
            <title>Ios-arrow-ltr-24-filled SVG Icon</title>
            <path fill="currentColor" d="M12.727 3.687a1 1 0 1 0-1.454-1.374l-8.5 9a1 1 0 0 0 0 1.374l8.5 9.001a1 1 0 1 0 1.454-1.373L4.875 12z"></path>
        </svg>
    `;

    backBtn.onclick = () => {
        state.mealView = 'recipeFoodSearch';
        renderMealPage();
    };

    const title = createElement('h3', null, food.name || 'Продукт');

    const titleDesc = food.description?.trim()
        ? createElement('div', 'food-title-description', food.description)
        : null;

    const topBlockCreateFood = createElement('div', 'topBlock-create-food');
    const inlineSaveBtn = createElement('button', 'food-inline-save-btn');
    inlineSaveBtn.type = 'button';
    inlineSaveBtn.textContent = 'Сохранить';
    const amountInput = createElement('input', 'input');
    amountInput.type = 'number';
    amountInput.placeholder = 'Порция';
    amountInput.value = currentAmount;

    const unitInput = createElement('input', 'input');
    unitInput.value = food.baseUnit || 'г';
    unitInput.disabled = true;

    const BlocksaveBtn = createElement('div', 'block-save-btn active');
    const saveBtn = createElement('button', 'food-add-btn meal-search-add-btn');
    saveBtn.type = 'button';
    saveBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24">
            <title>Plus SVG Icon</title>
            <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M12 20v-8m0 0V4m0 8h8m-8 0H4"></path>
        </svg>
    `;

    const currentValuesWrap = createElement('div', 'food-current-card');
    function addCurrentFoodToRecipeDraft(selectedAmount) {
        const scaled = getScaledFoodValues(food, selectedAmount);
        const draft = getRecipeDraft();

        if (!Array.isArray(draft.ingredients)) {
            draft.ingredients = [];
        }

        draft.ingredients.push({
            id: crypto.randomUUID(),
            foodId: state.recipeSelectedFoodId,
            name: food.name || '',
            description: food.description || '',
            amount: `${selectedAmount} ${food.baseUnit || 'г'}`,
            baseAmount: Number(food.baseAmount || 100) || 100,
            baseUnit: food.baseUnit || 'г',
            selectedAmount,
            protein: Number(scaled.protein || 0),
            fat: Number(scaled.fat || 0),
            carbs: Number(scaled.carbs || 0),
            calories: Number(scaled.calories || 0)
        });
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

        try {
            saveBtn.disabled = true;

            await updateFoodDefaultAmount(state.recipeSelectedFoodId, newAmount);

            food.defaultAmount = newAmount;

            addCurrentFoodToRecipeDraft(newAmount);

            showToast('Ингредиент добавлен в рецепт');

            state.mealView = 'recipeFoodSearch';
            renderMealPage();
        } catch (error) {
            console.error(error);
            showToast('Ошибка при добавлении');
        } finally {
            saveBtn.disabled = false;
        }
    };

    inlineSaveBtn.onclick = async () => {
        const newAmount = Number(amountInput.value || 0);

        if (!newAmount || newAmount <= 0) {
            showToast('Введите корректное количество');
            return;
        }

        try {
            inlineSaveBtn.disabled = true;

            await updateFoodDefaultAmount(state.recipeSelectedFoodId, newAmount);

            food.defaultAmount = newAmount;
            currentAmount = newAmount;

            showToast('Порция сохранена');
            renderCurrentValuesBlock();
        } catch (error) {
            console.error(error);
            showToast('Ошибка при сохранении');
        } finally {
            inlineSaveBtn.disabled = false;
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

    BlocksaveBtn.append(saveBtn);
    topBarCreateFood.append(backBtn, BlocksaveBtn);

    amountRow.append(plusMinusIcon, amountInput);
    unitRow.append(listIcon, unitInput);
    topBlockCreateFood.append(amountRow, unitRow, inlineSaveBtn);

    container.append(
        topBarCreateFood,
        title,
        ...(titleDesc ? [titleDesc] : []),
        topBlockCreateFood,
        currentValuesWrap,
        passportBlock
    );

    const editBtn = createElement('button', 'edit-meal-search-main-action');
    editBtn.innerHTML = `
        <span class="btn-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24">
                <path fill="currentColor" d="M3.548 20.938h16.9a.5.5 0 0 0 0-1h-16.9a.5.5 0 0 0 0 1M9.71 17.18a2.587 2.587 0 0 0 1.12-.65l9.54-9.54a1.75 1.75 0 0 0 0-2.47l-.94-.93a1.788 1.788 0 0 0-2.47 0l-9.54 9.53a2.473 2.473 0 0 0-.64 1.12L6.04 17a.737.737 0 0 0 .19.72a.767.767 0 0 0 .53.22Zm.41-1.36a1.468 1.468 0 0 1-.67.39l-.97.26l-1-1l.26-.97a1.521 1.521 0 0 1 .39-.67l.38-.37l1.99 1.99Zm1.09-1.08l-1.99-1.99l6.73-6.73l1.99 1.99Zm8.45-8.45L18.65 7.3l-1.99-1.99l1.01-1.02a.748.748 0 0 1 1.06 0l.93.94a.754.754 0 0 1 0 1.06"></path>
            </svg>
        </span>
        <span class="btn-text">Изменить пищевую ценность</span>
    `;

    editBtn.onclick = () => {
        state.currentFoodId = state.recipeSelectedFoodId;
        state.editFoodBackTarget = 'recipeFoodPreview';
        state.mealView = 'editFood';
        renderEditFood();
    };

    container.append(editBtn);

    openMealOverlay(container);
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
        state.mealView = state.createFoodBackTarget || 'search';
        state.createFoodBackTarget = null;
        renderMealPage();
    };

    const pageTitle = createElement('h3', 'create-food-page-title', 'Новый продукт');

    topBar.append(backBtn);

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

    ['г', 'мл', 'порция'].forEach(unit => {
        const option = createElement('button', 'create-food-unit-dropdown-item', unit);
        option.type = 'button';

        option.onclick = (e) => {
            e.stopPropagation();
            selectedUnit = unit;
            unitValue.textContent = unit;
            unitDropdown.style.display = 'none';
            unitWrap.classList.remove('open');
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

    document.addEventListener('click', () => {
        unitDropdown.style.display = 'none';
        unitWrap.classList.remove('open');
    });

    unitWrap.append(unitField, unitDropdown);

    const portion = createElement('input', 'create-food-input');
    portion.type = 'number';
    portion.inputMode = 'decimal';
    portion.placeholder = 'Например 100';

    const defaultAmount = createElement('input', 'create-food-input');
    defaultAmount.type = 'number';
    defaultAmount.inputMode = 'decimal';
    defaultAmount.placeholder = 'Например 30';

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
        createFormRow('Описание', description, true, 'is-textarea'),
        createFormRow('Ед. изм.', unitWrap, true),
        createFormRow('Базовый вес', portion, true),
        createFormRow('Размер порции', defaultAmount, true),
        createFormRow('Белки', protein, true),
        createFormRow('Жиры', fat, true),
        createFormRow('Углеводы', carbs, true),
        createFormRow('Калории', calories, true)
    ];

    rows.forEach(row => formCard.append(row));

    const actions = createElement('div', 'create-food-actions');

    const saveBtn = createElement('button', 'save-btn create-food-submit-btn', 'Добавить');
    saveBtn.disabled = true;

    function isFilled(value) {
        return String(value ?? '').trim() !== '';
    }

    function validateForm() {
        const allFilled =
            isFilled(name.value) &&
            isFilled(description.value) &&
            isFilled(selectedUnit) &&
            isFilled(portion.value) &&
            isFilled(defaultAmount.value) &&
            isFilled(protein.value) &&
            isFilled(fat.value) &&
            isFilled(carbs.value) &&
            isFilled(calories.value);

        saveBtn.disabled = !allFilled;
        saveBtn.classList.toggle('active', allFilled);
    }

    [
        name,
        description,
        unitField,
        portion,
        defaultAmount,
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

        await addFood({
            name: name.value.trim(),
            description: description.value.trim(),
            baseUnit: selectedUnit,
            baseAmount: Number(portion.value),
            protein: Number(protein.value),
            fat: Number(fat.value),
            carbs: Number(carbs.value),
            calories: Number(calories.value),
            defaultAmount: Number(defaultAmount.value)
        });

        state.mealView = state.createFoodBackTarget || 'search';
        state.createFoodBackTarget = null;
        renderMealPage();
    };

    actions.append(saveBtn);

    container.append(topBar, pageTitle, formCard, actions);
    openMealOverlay(container);

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
    const hasDescription = isRecipeFilled(draft.description);
    const hasServings = Number(draft.servings || 0) > 0;
    const hasPrep = Number(draft.prepMinutes || 0) > 0;
    const hasCook = Number(draft.cookMinutes || 0) > 0;
    const hasCategory = Array.isArray(draft.categories) && draft.categories.length >= 1;

    const filledIngredients = (draft.ingredients || []).filter(item =>
        isRecipeFilled(item?.name) && isRecipeFilled(item?.amount)
    );

    const filledSteps = (draft.steps || []).filter(step => isRecipeFilled(step));
    const hasPhoto = Array.isArray(draft.photos) && draft.photos.length >= 1;

    return (
        hasTitle &&
        hasDescription &&
        hasServings &&
        hasPrep &&
        hasCook &&
        hasCategory &&
        filledIngredients.length >= 3 &&
        filledSteps.length >= 3 &&
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
        renderMealPage();
    };

    const saveBtn = createElement('button', 'save-btn create-food-submit-btn disabled', 'Сохранить');
    saveBtn.type = 'button';
    saveBtn.disabled = true;

    topBar.append(backBtn, saveBtn);

    const pageTitle = createElement('h3', 'create-food-page-title', 'Новый рецепт');

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

    const prepWrap = createElement('div', 'input-with-suffix');
    const prepInput = createElement('input', 'create-food-input');
    prepInput.type = 'number';
    prepInput.inputMode = 'decimal';
    prepInput.placeholder = '30';
    prepInput.value = draft.prepMinutes || '';
    prepInput.autocomplete = 'off';
    const suffix = createElement('div', 'input-suffix', 'мин.');

    prepWrap.append(prepInput, suffix);

    const categoryBtn = createElement('button', 'create-food-input create-food-picker-field recipe-category-field');
    categoryBtn.type = 'button';

    const categoryValue = createElement('span', 'create-food-picker-value', getRecipeCategoryValue(draft) || 'Выбрать категорию');

    const categoryArrow = createElement('span', 'create-food-picker-arrow');
    categoryArrow.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
    `;

    categoryBtn.append(categoryValue, categoryArrow);

    const ingredientsWrap = createElement('div', 'recipe-form-ingredients-wrap');
    const ingredientsControl = createElement('div', 'recipe-ingredients-control');

    const addIngredientBtn = createElement('button', 'meal-search-main-action recipe-add-ingredient-btn');
    addIngredientBtn.type = 'button';
    addIngredientBtn.innerHTML = `
                             <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"><title>Plus SVG Icon</title><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M12 20v-8m0 0V4m0 8h8m-8 0H4"></path></svg>
                         `;
    addIngredientBtn.onclick = () => {
        state.mealView = 'recipeFoodSearch';
        renderMealPage();
    };

    const ingredientsList = createElement('div', 'recipe-form-ingredients-list');
    const ingredientsTotals = createElement('div', 'recipe-form-ingredients-totals');
    ingredientsWrap.append(ingredientsList, ingredientsTotals);
    ingredientsControl.append(ingredientsWrap);

    const stepsWrap = createElement('div', 'recipe-form-steps-wrap');
    const addStepBtnWrap = createElement('div', 'add-Step-Btn-Wrap');

    const addStepBtn = createElement('button', 'meal-search-main-action recipe-add-step-btn');
    addStepBtn.type = 'button';
    addStepBtn.innerHTML = `
                            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"><title>Plus SVG Icon</title><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M12 20v-8m0 0V4m0 8h8m-8 0H4"></path></svg>
                                        `;

    function ensureDraftSteps() {
        if (!Array.isArray(draft.steps) || draft.steps.length < 3) {
            draft.steps = ['', '', ''];
        }
    }

    function renderSteps() {
        ensureDraftSteps();
        stepsWrap.innerHTML = '';

        draft.steps.forEach((value, index) => {
            const row = createElement('div', 'recipe-step-row');

            const input = document.createElement('textarea');
            input.className = 'create-food-input create-food-textarea recipe-step-input';
            input.rows = 3;
            input.placeholder = `Шаг ${index + 1}`;
            input.value = value || '';

            input.oninput = () => {
                draft.steps[index] = input.value;
                validateRecipeForm();
            };

            const head = createElement('div', 'recipe-step-head');
            const blockRemove = createElement('div', 'block-remove');
            const label = createElement('div', 'recipe-step-label', `Шаг ${index + 1}`);

            head.append(label);

            // Удалять можно только шаги после первых трех
            if (index >= 3) {
                const removeBtn = createElement('button', 'recipe-step-remove-btn');

                removeBtn.innerHTML = ` <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24">
                                    <path fill="currentColor" d="M16 1.75V3h5.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H8V1.75C8 .784 8.784 0 9.75 0h4.5C15.216 0 16 .784 16 1.75m-6.5 0V3h5V1.75a.25.25 0 0 0-.25-.25h-4.5a.25.25 0 0 0-.25.25M4.997 6.178a.75.75 0 1 0-1.493.144L4.916 20.92a1.75 1.75 0 0 0 1.742 1.58h10.684a1.75 1.75 0 0 0 1.742-1.581l1.413-14.597a.75.75 0 0 0-1.494-.144l-1.412 14.596a.25.25 0 0 1-.249.226H6.658a.25.25 0 0 1-.249-.226z"></path>
                                    <path fill="currentColor" d="M9.206 7.501a.75.75 0 0 1 .793.705l.5 8.5A.75.75 0 1 1 9 16.794l-.5-8.5a.75.75 0 0 1 .705-.793Zm6.293.793A.75.75 0 1 0 14 8.206l-.5 8.5a.75.75 0 0 0 1.498.088l.5-8.5Z"></path>
                                </svg> `;
                removeBtn.type = 'button';
                removeBtn.onclick = () => {
                    draft.steps.splice(index, 1);

                    // на всякий случай не даем уйти ниже 3
                    if (draft.steps.length < 3) {
                        draft.steps = ['', '', ''];
                    }

                    renderSteps();
                    validateRecipeForm();
                };

                blockRemove.append(removeBtn);
            }

            row.append( blockRemove, head, input);
            stepsWrap.append(row);
        });

        // максимум 7 шагов
        addStepBtn.style.display = draft.steps.length >= 7 ? 'none' : 'inline-flex';
    }

    addStepBtn.onclick = () => {
        ensureDraftSteps();
        draft.steps.push('');
        renderSteps();
        validateRecipeForm();
    };

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
            removeBtn.onclick = () => {
                draft.ingredients.splice(index, 1);
                renderIngredientsBlock();
                validateRecipeForm();
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

    categoryBtn.onclick = () => {
        openRecipeCategorySheet({
            value: getRecipeCategoryValue(draft),
            onSelect: (selected) => {
                setRecipeCategoryValue(draft, selected);
                categoryValue.textContent = selected || 'Выбрать категорию';
                validateRecipeForm();
            }
        });
    };

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

    prepInput.oninput = () => {
        draft.prepMinutes = prepInput.value;
        validateRecipeForm();
    };

    formCard.append(
        createFormRow('Название рецепта', titleInput, true),
        createFormRow('Описание', descriptionInput, true, 'is-textarea'),
        createFormRow('Кол-во порций', servingsInput, true),
        createFormRow('Время приготовления', prepWrap, false),
        createFormRow('Категория', categoryBtn, true),
        createFormRow(
            'Ингредиенты',
            ingredientsControl,
            true,
            'recipe-row-ingredients',
            addIngredientBtn
        ),
        createFormRow('Способ приготовления', stepsWrap, false, 'recipe-row-steps')
    );


addStepBtnWrap.append(addStepBtn);
    renderIngredientsBlock();
    renderSteps();
    stepsWrap.after(addStepBtnWrap);

    function isFilled(value) {
        return String(value ?? '').trim() !== '';
    }

    function validateRecipeForm() {
        const hasRequiredTitle = isFilled(draft.title);
        const hasRequiredDescription = isFilled(draft.description);
        const hasRequiredServings = isFilled(draft.servings);
        const hasCategory = isFilled(getRecipeCategoryValue(draft));
        const hasEnoughIngredients = Array.isArray(draft.ingredients) && draft.ingredients.length >= 3;

        const isValid =
            hasRequiredTitle &&
            hasRequiredDescription &&
            hasRequiredServings &&
            hasCategory &&
            hasEnoughIngredients;

        saveBtn.disabled = !isValid;
        saveBtn.classList.toggle('active', isValid);
        saveBtn.classList.toggle('disabled', !isValid);
    }

    saveBtn.onclick = async () => {
        if (saveBtn.disabled) return;

        const cycleRef = getCycleDocRef();
        if (!cycleRef) return;

        const recipePayload = {
            title: String(draft.title || '').trim(),
            description: String(draft.description || '').trim(),
            servings: String(draft.servings || '').trim(),
            prepMinutes: String(draft.prepMinutes || '').trim(),
            cookMinutes: String(draft.cookMinutes || '').trim(),
            categories: Array.isArray(draft.categories) ? draft.categories : [],
            ingredients: Array.isArray(draft.ingredients) ? draft.ingredients : [],
            steps: Array.isArray(draft.steps)
                ? draft.steps.map(step => String(step || '').trim()).filter(Boolean)
                : []
        };

        await addDoc(collection(cycleRef, 'recipes'), recipePayload);

        showToast('Рецепт сохранён');
        state.recipeDraft = createEmptyRecipeDraft();
        state.mealView = 'search';
        renderMealPage();
    };

    container.append(topBar, pageTitle, formCard);
    openMealOverlay(container);

    validateRecipeForm();
}



async function renderEditRecipe() {
    ensureMealShell();
    setMealBaseTopBarVisible(false);

    const cycleRef = getCycleDocRef();
    if (!cycleRef || !state.currentRecipeId) return;

    const recipeSnap = await getDoc(doc(cycleRef, 'recipes', state.currentRecipeId));

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

    const draft = {
        title: String(recipe.title || ''),
        description: String(recipe.description || ''),
        servings: String(recipe.servings || ''),
        prepMinutes: String(recipe.prepMinutes || ''),
        cookMinutes: String(recipe.cookMinutes || ''),
        categories: Array.isArray(recipe.categories) ? [...recipe.categories] : [],
        ingredients: Array.isArray(recipe.ingredients) ? recipe.ingredients.map(item => ({ ...item })) : [],
        steps: Array.isArray(recipe.steps) && recipe.steps.length
            ? recipe.steps.map(step => String(step || ''))
            : ['', '', '']
    };

    while (draft.steps.length < 3) {
        draft.steps.push('');
    }

    const container = createElement('div', 'create-food create-food-form-page recipe-create-page');

    const topBar = createElement('div', 'create-food-topbar');

    const backBtn = createElement('button', 'back-btn');
    backBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24">
            <path fill="currentColor" d="M12.727 3.687a1 1 0 1 0-1.454-1.374l-8.5 9a1 1 0 0 0 0 1.374l8.5 9.001a1 1 0 1 0 1.454-1.373L4.875 12z"/>
        </svg>
    `;
    backBtn.onclick = () => {
        state.mealView = 'recipeDetails';
        renderMealPage();
    };

    const saveBtn = createElement('button', 'save-btn create-food-submit-btn disabled', 'Сохранить изменения');
    saveBtn.type = 'button';
    saveBtn.disabled = true;

    topBar.append(backBtn, saveBtn);

    const pageTitle = createElement('h3', 'create-food-page-title', 'Редактировать рецепт');

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

    const prepWrap = createElement('div', 'input-with-suffix');

    const prepInput = createElement('input', 'create-food-input');
    prepInput.type = 'number';
    prepInput.inputMode = 'decimal';
    prepInput.placeholder = 'Например 30';
    prepInput.value = draft.prepMinutes || '';
    prepInput.autocomplete = 'off';

    const prepSuffix = createElement('div', 'input-suffix', 'мин.');

    prepWrap.append(prepInput, prepSuffix);

    const categoryBtn = createElement('button', 'create-food-input create-food-picker-field recipe-category-field');
    categoryBtn.type = 'button';

    const categoryValue = createElement(
        'span',
        'create-food-picker-value',
        getRecipeCategoryValue(draft) || 'Выбрать категорию'
    );

    const categoryArrow = createElement('span', 'create-food-picker-arrow');
    categoryArrow.innerHTML = `
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
    `;

    categoryBtn.append(categoryValue, categoryArrow);

    const ingredientsWrap = createElement('div', 'recipe-form-ingredients-wrap');
    const ingredientsControl = createElement('div', 'recipe-ingredients-control');

    const addIngredientBtn = createElement('button', 'meal-search-main-action recipe-add-ingredient-btn');
    addIngredientBtn.type = 'button';
    addIngredientBtn.innerHTML = `
                             <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"><title>Plus SVG Icon</title><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M12 20v-8m0 0V4m0 8h8m-8 0H4"></path></svg>
                         `;
    addIngredientBtn.onclick = () => {
        state.recipeDraft = {
            ...draft,
            categories: [...draft.categories],
            ingredients: draft.ingredients.map(item => ({ ...item })),
            steps: [...draft.steps]
        };
        state.createRecipeBackTarget = 'editRecipe';
        state.mealView = 'recipeFoodSearch';
        renderMealPage();
    };

    const ingredientsList = createElement('div', 'recipe-form-ingredients-list');
    const ingredientsTotals = createElement('div', 'recipe-form-ingredients-totals');

    ingredientsWrap.append(ingredientsList, ingredientsTotals);
    ingredientsControl.append(ingredientsWrap);

    const stepsWrap = createElement('div', 'recipe-form-steps-wrap');
    const addStepBtnWrap = createElement('div', 'add-Step-Btn-Wrap');

    const addStepBtn = createElement('button', 'meal-search-main-action recipe-add-step-btn');
    addStepBtn.type = 'button';
    addStepBtn.innerHTML = `
                             <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"><title>Plus SVG Icon</title><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2" d="M12 20v-8m0 0V4m0 8h8m-8 0H4"></path></svg>
                             `;

    const MIN_RECIPE_STEPS = 3;
    const MAX_RECIPE_STEPS = 7;

    function ensureDraftSteps() {
        if (!Array.isArray(draft.steps) || draft.steps.length < MIN_RECIPE_STEPS) {
            draft.steps = Array(MIN_RECIPE_STEPS).fill('');
        }
    }

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
            removeBtn.onclick = () => {
                draft.ingredients.splice(index, 1);
                renderIngredientsBlock();
                validateRecipeForm();
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

    function renderSteps() {
        ensureDraftSteps();
        stepsWrap.innerHTML = '';

        draft.steps.forEach((value, index) => {
            const row = createElement('div', 'recipe-step-row');

            const input = document.createElement('textarea');
            input.className = 'create-food-input create-food-textarea recipe-step-input';
            input.rows = 1;
            input.placeholder = `Шаг ${index + 1}`;
            input.value = value || '';

            input.oninput = () => {
                draft.steps[index] = input.value;
                validateRecipeForm();
            };

            const head = createElement('div', 'recipe-step-head');
            const blockRemove = createElement('div', 'block-remove');
            const label = createElement('div', 'recipe-step-label', `Шаг ${index + 1}`);

            head.append(label);

            if (index >= MIN_RECIPE_STEPS) {
                const removeBtn = createElement('button', 'recipe-step-remove-btn');
                removeBtn.innerHTML = `
                                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24">
                                           <path fill="currentColor" d="M16 1.75V3h5.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H8V1.75C8 .784 8.784 0 9.75 0h4.5C15.216 0 16 .784 16 1.75m-6.5 0V3h5V1.75a.25.25 0 0 0-.25-.25h-4.5a.25.25 0 0 0-.25.25M4.997 6.178a.75.75 0 1 0-1.493.144L4.916 20.92a1.75 1.75 0 0 0 1.742 1.58h10.684a1.75 1.75 0 0 0 1.742-1.581l1.413-14.597a.75.75 0 0 0-1.494-.144l-1.412 14.596a.25.25 0 0 1-.249.226H6.658a.25.25 0 0 1-.249-.226z"></path>
                                           <path fill="currentColor" d="M9.206 7.501a.75.75 0 0 1 .793.705l.5 8.5A.75.75 0 1 1 9 16.794l-.5-8.5a.75.75 0 0 1 .705-.793Zm6.293.793A.75.75 0 1 0 14 8.206l-.5 8.5a.75.75 0 0 0 1.498.088l.5-8.5Z"></path>
                                       </svg>`;


                removeBtn.type = 'button';
                removeBtn.onclick = () => {
                    draft.steps.splice(index, 1);

                    if (draft.steps.length < MIN_RECIPE_STEPS) {
                        draft.steps = Array(MIN_RECIPE_STEPS).fill('');
                    }

                    renderSteps();
                    validateRecipeForm();
                };

                blockRemove.append(removeBtn);
            }

            row.append(blockRemove, head, input);
            stepsWrap.append(row);
        });

        addStepBtn.style.display = draft.steps.length >= MAX_RECIPE_STEPS ? 'none' : 'inline-flex';
    }

    addStepBtn.onclick = () => {
        ensureDraftSteps();

        if (draft.steps.length >= MAX_RECIPE_STEPS) return;

        draft.steps.push('');
        renderSteps();
        validateRecipeForm();
    };

    categoryBtn.onclick = () => {
        openRecipeCategorySheet({
            value: getRecipeCategoryValue(draft),
            onSelect: (selected) => {
                setRecipeCategoryValue(draft, selected);
                categoryValue.textContent = selected || 'Выбрать категорию';
                validateRecipeForm();
            }
        });
    };

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

    prepInput.oninput = () => {
        draft.prepMinutes = prepInput.value;
        validateRecipeForm();
    };

    formCard.append(
        createFormRow('Название рецепта', titleInput, true),
        createFormRow('Описание', descriptionInput, true, 'is-textarea'),
        createFormRow('Кол-во порций', servingsInput, true),
        createFormRow('Время приготовления', prepWrap, false),
        createFormRow('Категория', categoryBtn, true),
        createFormRow(
            'Ингредиенты',
            ingredientsControl,
            true,
            'recipe-row-ingredients',
            addIngredientBtn
        ),
        createFormRow('Способ приготовления', stepsWrap, false, 'recipe-row-steps')
    );
    addStepBtnWrap.append(addStepBtn);
    stepsWrap.after(addStepBtnWrap);

    function isFilled(value) {
        return String(value ?? '').trim() !== '';
    }

    function validateRecipeForm() {
        const hasRequiredTitle = isFilled(draft.title);
        const hasRequiredDescription = isFilled(draft.description);
        const hasRequiredServings = isFilled(draft.servings);
        const hasCategory = isFilled(getRecipeCategoryValue(draft));
        const hasEnoughIngredients = Array.isArray(draft.ingredients) && draft.ingredients.length >= 3;

        const isValid =
            hasRequiredTitle &&
            hasRequiredDescription &&
            hasRequiredServings &&
            hasCategory &&
            hasEnoughIngredients;

        saveBtn.disabled = !isValid;
        saveBtn.classList.toggle('active', isValid);
        saveBtn.classList.toggle('disabled', !isValid);
    }

    saveBtn.onclick = async () => {
        if (saveBtn.disabled) return;

        const updatedRecipePayload = {
            title: String(draft.title || '').trim(),
            description: String(draft.description || '').trim(),
            servings: String(draft.servings || '').trim(),
            prepMinutes: String(draft.prepMinutes || '').trim(),
            cookMinutes: String(draft.cookMinutes || '').trim(),
            categories: Array.isArray(draft.categories) ? draft.categories : [],
            ingredients: Array.isArray(draft.ingredients) ? draft.ingredients : [],
            steps: Array.isArray(draft.steps)
                ? draft.steps.map(step => String(step || '').trim()).filter(Boolean)
                : []
        };

        await updateDoc(doc(cycleRef, 'recipes', recipe.id), updatedRecipePayload);

        showToast('Изменения сохранены');
        state.recipeDraft = createEmptyRecipeDraft();
        state.recipeServingsDraft = null;
        state.createRecipeBackTarget = null;
        state.mealView = 'recipeDetails';
        renderMealPage();
    };

    renderIngredientsBlock();
    renderSteps();

    container.append(topBar, pageTitle, formCard);
    openMealOverlay(container);

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
    const cycleRef = getCycleDocRef();
    if (!cycleRef) return [];

    const q = String(query || '').toLowerCase().trim();

    const snap = await getDocs(collection(cycleRef, 'recipes'));

    return snap.docs
        .map(docSnap => ({
            id: docSnap.id,
            ...docSnap.data()
        }))
        .filter(recipe => {
            const title = String(recipe.title || '').toLowerCase();
            const description = String(recipe.description || '').toLowerCase();
            const category = Array.isArray(recipe.categories)
                ? recipe.categories.join(' ').toLowerCase()
                : '';

            return !q ||
                title.includes(q) ||
                description.includes(q) ||
                category.includes(q);
        })
        .sort((a, b) => {
            const aTitle = String(a.title || '');
            const bTitle = String(b.title || '');
            return aTitle.localeCompare(bTitle, 'ru');
        });
}
// ========================= helper для одной карточки продукта со свайпом
function createFoodSearchSwipeItem(food, onDeleted) {
    const swipeWrap = createElement('div', 'meal-swipe');
    swipeWrap.dataset.foodId = food.id;

    const actions = createElement('div', 'swipe-actions right');
    actions.innerHTML = `
        <button class="action-btn action-delete" type="button">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
                <path fill="currentColor" d="M16 1.75V3h5.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H8V1.75C8 .784 8.784 0 9.75 0h4.5C15.216 0 16 .784 16 1.75m-6.5 0V3h5V1.75a.25.25 0 0 0-.25-.25h-4.5a.25.25 0 0 0-.25.25M4.997 6.178a.75.75 0 1 0-1.493.144L4.916 20.92a1.75 1.75 0 0 0 1.742 1.58h10.684a1.75 1.75 0 0 0 1.742-1.581l1.413-14.597a.75.75 0 0 0-1.494-.144l-1.412 14.596a.25.25 0 0 1-.249.226H6.658a.25.25 0 0 1-.249-.226z"/>
                <path fill="currentColor" d="M9.206 7.501a.75.75 0 0 1 .793.705l.5 8.5A.75.75 0 1 1 9 16.794l-.5-8.5a.75.75 0 0 1 .705-.793Zm6.293.793A.75.75 0 1 0 14 8.206l-.5 8.5a.75.75 0 0 0 1.498.088l.5-8.5Z"/>
            </svg>
        </button>
    `;

    const item = createElement('div', 'food-item meal-search-item');
    const swipeСontent = createElement('div', 'swipe-content food-swipe');

    const ContentHeader = createElement('div', 'food-info-header-content');
    const FiHeader = createElement('div', 'food-info-header');
    const info = createElement('div', 'food-info meal-search-item-info');
    info.innerHTML = `
        <div class="meal-search-item-name">${food.name}</div>

        <div class="meal-search-item-sub">
        <span>${getFoodSubtitleByAmount(food, Number(food.defaultAmount || food.baseAmount || 100))}</span>
          ${food.description?.trim() ? `
                          <span class="meal-search-item-description">${food.description}</span>
                      ` : ''}
        </div>
    `;

    info.style.cursor = 'pointer';

   info.onclick = (e) => {
       e.stopPropagation();

       saveMealPageScroll();
       mealScrollRestorePending = true;

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

    const deleteBtn = actions.querySelector('.action-delete');
    deleteBtn.onclick = async (e) => {
        e.stopPropagation();

        openConfirmModal(`Удалить продукт «${food.name}»?`, async () => {
            await deleteFood(food.id);
            if (onDeleted) await onDeleted();
        });
    };

    FiHeader.append(info, addBtn);
    ContentHeader.append(FiHeader);
swipeСontent.append(ContentHeader);
    item.append(swipeСontent, actions);
    swipeWrap.append(item);

    return swipeWrap;
}

function getScaledRecipeValues(recipe, servings) {
    const baseServings = Math.max(1, Number(recipe.servings || 1));
    const currentServings = Math.max(1, Number(servings || baseServings));
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

function createRecipeSearchSwipeItem(recipe, onDeleted = null) {
    const swipeWrap = createElement('div', 'meal-swipe');
    swipeWrap.dataset.recipeId = recipe.id;

    const actions = createElement('div', 'swipe-actions right');
    actions.innerHTML = `
        <button class="action-btn action-delete" type="button">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
                <path fill="currentColor" d="M16 1.75V3h5.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H8V1.75C8 .784 8.784 0 9.75 0h4.5C15.216 0 16 .784 16 1.75m-6.5 0V3h5V1.75a.25.25 0 0 0-.25-.25h-4.5a.25.25 0 0 0-.25.25M4.997 6.178a.75.75 0 1 0-1.493.144L4.916 20.92a1.75 1.75 0 0 0 1.742 1.58h10.684a1.75 1.75 0 0 0 1.742-1.581l1.413-14.597a.75.75 0 0 0-1.494-.144l-1.412 14.596a.25.25 0 0 1-.249.226H6.658a.25.25 0 0 1-.249-.226z"/>
                <path fill="currentColor" d="M9.206 7.501a.75.75 0 0 1 .793.705l.5 8.5A.75.75 0 1 1 9 16.794l-.5-8.5a.75.75 0 0 1 .705-.793Zm6.293.793A.75.75 0 1 0 14 8.206l-.5 8.5a.75.75 0 0 0 1.498.088l.5-8.5Z"/>
            </svg>
        </button>
    `;

    const item = createElement('div', 'food-item meal-search-item');
    const swipeContent = createElement('div', 'swipe-content food-swipe');

    const contentHeader = createElement('div', 'food-info-header-content');
    const foodHeader = createElement('div', 'food-info-header');

    const info = createElement('div', 'food-info meal-search-item-info');

    const scaled = getScaledRecipeValues(recipe, Number(recipe.servings || 1));

    info.innerHTML = `
        <div class="meal-search-item-name">${recipe.title || 'Без названия'}</div>
        <div class="meal-search-item-sub">
            <span>${Number(recipe.servings || 1)} порц. · Б ${formatMacro(scaled.protein, 1)} · Ж ${formatMacro(scaled.fat, 1)} · У ${formatMacro(scaled.carbs, 1)} · К ${Math.round(scaled.calories)}</span>
            ${recipe.description?.trim()
                ? `<span class="meal-search-item-description">${recipe.description}</span>`
                : ''}
        </div>
    `;

    info.style.cursor = 'pointer';

    const openRecipeDetails = () => {
        saveMealPageScroll();
        mealScrollRestorePending = true;

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

        await addRecipeToCurrentMeal(recipe, Number(recipe.servings || 1));
        showToast('Рецепт добавлен в прием');
    };

    const deleteBtn = actions.querySelector('.action-delete');
    deleteBtn.onclick = async (e) => {
        e.stopPropagation();

        openConfirmModal(`Удалить рецепт «${recipe.title || 'Без названия'}»?`, async () => {
            const cycleRef = getCycleDocRef();
            if (!cycleRef) return;

            await deleteDoc(doc(cycleRef, 'recipes', recipe.id));

            if (typeof onDeleted === 'function') {
                await onDeleted();
            }
        });
    };

    foodHeader.append(info, addBtn);
    contentHeader.append(foodHeader);
    swipeContent.append(contentHeader);
    item.append(swipeContent, actions);
    swipeWrap.append(item);

    return swipeWrap;
}

function createMealFoodSwipeItem({ item, index, mealId, food }) {
    const swipeWrap = createElement('div', 'food-swipe');
    swipeWrap.dataset.mealId = mealId;
    swipeWrap.dataset.itemIndex = String(index);

    const row = createElement('div', 'meal-food-item');

    const actions = createElement('div', 'swipe-actions right');
    actions.innerHTML = `
        <button class="action-btn action-delete" type="button">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
                <path fill="currentColor" d="M16 1.75V3h5.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H8V1.75C8 .784 8.784 0 9.75 0h4.5C15.216 0 16 .784 16 1.75m-6.5 0V3h5V1.75a.25.25 0 0 0-.25-.25h-4.5a.25.25 0 0 0-.25.25M4.997 6.178a.75.75 0 1 0-1.493.144L4.916 20.92a1.75 1.75 0 0 0 1.742 1.58h10.684a1.75 1.75 0 0 0 1.742-1.581l1.413-14.597a.75.75 0 0 0-1.494-.144l-1.412 14.596a.25.25 0 0 1-.249.226H6.658a.25.25 0 0 1-.249-.226z"></path>
                <path fill="currentColor" d="M9.206 7.501a.75.75 0 0 1 .793.705l.5 8.5A.75.75 0 1 1 9 16.794l-.5-8.5a.75.75 0 0 1 .705-.793Zm6.293.793A.75.75 0 1 0 14 8.206l-.5 8.5a.75.75 0 0 0 1.498.088l.5-8.5Z"></path>
            </svg>
        </button>
    `;

    const content = createElement('div', 'food-info-header-content');
    const header = createElement('div', 'food-info-header');
    const text = createElement('div', 'meal-food-text');

    const factor = Number(item.grams || 0) / (Number(food.baseAmount || 100) || 100);
    const cal = (Number(food.calories) || 0) * factor;
    const p = (Number(food.protein) || 0) * factor;
    const f = (Number(food.fat) || 0) * factor;
    const c = (Number(food.carbs) || 0) * factor;

    text.style.cursor = 'pointer';
    text.innerHTML = `
        <div class="meal-food-top">
            <span>${food.name}</span>

        </div>
        <div class="meal-food-grams">
            <span>${formatMacro(item.grams, 1)} ${food.baseUnit || 'г'}</span>
        </div>
        <div class="meal-food-macros">
            <span>${formatMacro(p, 1)}</span>
            <span>${formatMacro(f, 1)}</span>
            <span>${formatMacro(c, 1)}</span>
            <span>${Math.round(cal)}</span>
        </div>
    `;

    const openArrow = createElement('div', 'meal-food-open-arrow');
    openArrow.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24">
            <title>Ios-arrow-rtl-24-regular SVG Icon</title>
            <path fill="currentColor" d="m19.704 12l-8.491-8.727a.75.75 0 1 1 1.075-1.046l9 9.25a.75.75 0 0 1 0 1.046l-9 9.25a.75.75 0 1 1-1.075-1.046z"/>
        </svg>
    `;

    text.onclick = (e) => {
        e.stopPropagation();

        saveMealPageScroll();
        mealScrollRestorePending = true;

        state.currentFoodId = item.foodId;
        state.foodDetailsSource = 'meal';
        state.currentMealItemIndex = index;
        state.currentMealDetailsId = mealId;
        state.mealView = 'foodDetails';

        renderMealPage();
    };

    const deleteBtn = actions.querySelector('.action-delete');
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

            await updateDoc(mealRef, {
                [mealId]: mealItems
            });
        });
    };

    header.append(text, openArrow);
    content.append(header);
    row.append(content, actions);
    swipeWrap.append(row);

    return swipeWrap;
}

function createRecipeFoodSearchSwipeItem(food, onDeleted = null) {
    const swipeWrap = createElement('div', 'meal-swipe');
    swipeWrap.dataset.foodId = food.id;

    const actions = createElement('div', 'swipe-actions right');
    actions.innerHTML = `
        <button class="action-btn action-delete" type="button">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
                <path fill="currentColor" d="M16 1.75V3h5.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H8V1.75C8 .784 8.784 0 9.75 0h4.5C15.216 0 16 .784 16 1.75m-6.5 0V3h5V1.75a.25.25 0 0 0-.25-.25h-4.5a.25.25 0 0 0-.25.25M4.997 6.178a.75.75 0 1 0-1.493.144L4.916 20.92a1.75 1.75 0 0 0 1.742 1.58h10.684a1.75 1.75 0 0 0 1.742-1.581l1.413-14.597a.75.75 0 0 0-1.494-.144l-1.412 14.596a.25.25 0 0 1-.249.226H6.658a.25.25 0 0 1-.249-.226z"/>
                <path fill="currentColor" d="M9.206 7.501a.75.75 0 0 1 .793.705l.5 8.5A.75.75 0 1 1 9 16.794l-.5-8.5a.75.75 0 0 1 .705-.793Zm6.293.793A.75.75 0 1 0 14 8.206l-.5 8.5a.75.75 0 0 0 1.498.088l.5-8.5Z"/>
            </svg>
        </button>
    `;

    const item = createElement('div', 'food-item meal-search-item');
    const swipeContent = createElement('div', 'swipe-content food-swipe');

    const contentHeader = createElement('div', 'food-info-header-content');
    const foodHeader = createElement('div', 'food-info-header');

    const info = createElement('div', 'food-info meal-search-item-info');
    info.innerHTML = `
        <div class="meal-search-item-name">${food.name}</div>

        <div class="meal-search-item-sub">
            <span>${getFoodSubtitleByAmount(food, Number(food.defaultAmount || food.baseAmount || 100))}</span>
            ${food.description?.trim()
                ? `<span class="meal-search-item-description">${food.description}</span>`
                : ''}
        </div>
    `;

    info.style.cursor = 'pointer';

    const openPreview = () => {
        saveMealPageScroll();
        mealScrollRestorePending = true;

        state.recipeSelectedFoodId = food.id;
        state.recipeFoodPreviewBackTarget = 'recipeFoodSearch';
        state.mealView = 'recipeFoodPreview';
        renderMealPage();
    };

    info.onclick = (e) => {
        e.stopPropagation();
        openPreview();
    };

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

        const draft = getRecipeDraft();

        if (!Array.isArray(draft.ingredients)) {
            draft.ingredients = [];
        }

        draft.ingredients.push({
            id: crypto.randomUUID(),
            foodId: food.id,
            name: food.name || '',
            amount: `${Number(food.defaultAmount || food.baseAmount || 100) || 100} ${food.baseUnit || 'г'}`,
            baseAmount: Number(food.baseAmount || 100) || 100,
            baseUnit: food.baseUnit || 'г',
            protein: Number(food.protein || 0),
            fat: Number(food.fat || 0),
            carbs: Number(food.carbs || 0),
            calories: Number(food.calories || 0),
            description: food.description || ''
        });

        showToast('Добавлено в рецепт');
    };

    const deleteBtn = actions.querySelector('.action-delete');
    deleteBtn.onclick = (e) => {
        e.stopPropagation();

        openConfirmModal(`Удалить продукт «${food.name}»?`, async () => {
            const cycleRef = getCycleDocRef();
            if (!cycleRef) return;

            await deleteDoc(doc(cycleRef, 'foods', food.id));

            if (foodsMapCache && foodsMapCycleId === state.selectedCycleId) {
                delete foodsMapCache[food.id];
            }

            if (typeof onDeleted === 'function') {
                await onDeleted();
            }
        });
    };

    foodHeader.append(info, addBtn);
    contentHeader.append(foodHeader);
    swipeContent.append(contentHeader);
    item.append(swipeContent, actions);
    swipeWrap.append(item);

    return swipeWrap;
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

    setTimeout(() => {
        initMealSwipe();
    }, 0);
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

    setTimeout(() => {
        initMealSwipe();
    }, 0);
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

    setTimeout(() => {
        initMealSwipe();
    }, 0);
}


function renderMixedFoodAndRecipes(container, foods, recipes, onDeleted = null) {
    container.innerHTML = '';

    if ((!foods || !foods.length) && (!recipes || !recipes.length)) {
        const empty = createElement('div', 'meal-search-empty', 'Ничего не найдено');
        container.append(empty);
        return;
    }

    if (foods && foods.length) {
        renderFoodListAppend(container, foods, onDeleted);
    }

    if (recipes && recipes.length) {
        renderRecipeListAppend(container, recipes);
    }
}

function renderFoodListAppend(container, foods, onDeleted = null) {
    foods.forEach(food => {
        container.append(createFoodSearchSwipeItem(food, onDeleted));
    });

    setTimeout(() => {
        initMealSwipe();
    }, 0);
}

function renderRecipeListAppend(container, recipes) {
    recipes.forEach(recipe => {
        const item = createElement('div', 'food-item meal-search-item');

        const info = createElement('div', 'food-info meal-search-item-info');
        info.innerHTML = `
            <div class="meal-search-item-name">${recipe.name}</div>
            <div class="meal-search-item-sub">Рецепт</div>
        `;

        const addBtn = createElement('button', 'food-add-btn meal-search-add-btn', '+');
        addBtn.type = 'button';

        addBtn.onclick = () => {
            saveMealPageScroll();
            mealScrollRestorePending = true;

            state.recipeDraft = createEmptyRecipeDraft();
            state.mealView = 'recipe';
            renderMealPage();
        };

        item.append(info, addBtn);
        container.append(item);
    });
}



async function addFood(food) {
    const cycleRef = getCycleDocRef();

    const payload = {
        ...food,
        createdAt: Date.now()
    };

    const docRef = await addDoc(collection(cycleRef, 'foods'), payload);

    if (foodsMapCache && foodsMapCycleId === state.selectedCycleId) {
        foodsMapCache[docRef.id] = payload;
    }

    return docRef.id;
}


async function updateFoodDefaultAmount(foodId, defaultAmount) {
    const cycleRef = getCycleDocRef();
    const foodRef = doc(cycleRef, 'foods', foodId);

    await updateDoc(foodRef, {
        defaultAmount: Number(defaultAmount || 0)
    });

    if (foodsMapCache && foodsMapCycleId === state.selectedCycleId && foodsMapCache[foodId]) {
        foodsMapCache[foodId].defaultAmount = Number(defaultAmount || 0);
    }
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
    const cycleRef = getCycleDocRef();
    const foodRef = doc(cycleRef, 'foods', foodId);

    await deleteDoc(foodRef);

    if (foodsMapCache && foodsMapCycleId === state.selectedCycleId) {
        delete foodsMapCache[foodId];
    }
}

// =================================================================
// 📡 ПОДПИСКА
// =================================================================
function subscribeMeals() {
    const selectedDateAtSubscribe = state.selectedDate;
    const cycleRef = getCycleDocRef();
    const mealRef = doc(cycleRef, 'meals', selectedDateAtSubscribe);

    resetMealsListener();

    unsubscribeMeals = onSnapshot(mealRef, (docSnap) => {
        if (selectedDateAtSubscribe !== state.selectedDate) return;

        const data = docSnap.exists() ? docSnap.data() : {};
        const newStructure = getMealKeysFromData(data).join('|');

        state.mealsData = data;
        initOpenStateForCurrentDay(data);

        if (newStructure !== lastRenderedMealStructure) {
            state.mealsData = data;
            initOpenStateForCurrentDay(data);

            rebuildMealsSection();
            renderMeals(data);
            return;
        }

        renderMeals(data);
    });
}

async function getFoodsMap(force = false) {
    const cycleId = state.selectedCycleId;

    if (!force && foodsMapCache && foodsMapCycleId === cycleId) {
        return foodsMapCache;
    }

    const cycleRef = getCycleDocRef();
    const snapshot = await getDocs(collection(cycleRef, 'foods'));

    const map = {};
    snapshot.forEach(doc => {
        map[doc.id] = doc.data();
    });

    foodsMapCache = map;
    foodsMapCycleId = cycleId;

    return map;
}

// =================================================================
// 🍽️ РЕНДЕР ПРИЕМОВ + ПОДСЧЕТ
// =================================================================
async function renderMeals(mealsData) {
    const fastCalc = calcMealsTotalsFast(mealsData);
    mealTotalsCache[getMealTotalsCacheKey()] = fastCalc.total;
    renderMealMacrosRow(fastCalc.total);

    const foodsMap = await getFoodsMap();
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

            if (arrow) {
                arrow.classList.remove('arrow-rotate-open', 'arrow-rotate-close');
                arrow.style.transform = 'rotate(270deg)';
            }
            return;
        }

        macrosWrap.style.display = 'flex';
        macrosContent.innerHTML = `
            <div>Б: ${formatMacro(mealTotal.p, 1)}</div>
            <div>Ж: ${formatMacro(mealTotal.f, 1)}</div>
            <div>У: ${formatMacro(mealTotal.c, 1)}</div>
            <div>К: ${Math.round(mealTotal.cal)}</div>
        `;

        items.forEach((item, index) => {
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

            const food = hasSnapshotFood ? snapshotFood : foodsMap[item.foodId];
            if (!food) return;

            list.append(createMealFoodSwipeItem({
                item,
                index,
                mealId,
                food
            }));
        });

        const openKey = getMealOpenKey(state.selectedDate, mealId);
        const isOpen = !!mealOpenState[openKey];

        list.style.display = isOpen ? 'block' : 'none';

        if (arrow) {
            arrow.classList.remove('arrow-rotate-open', 'arrow-rotate-close');
            arrow.style.transform = isOpen ? 'rotate(90deg)' : 'rotate(270deg)';
        }
    });

    setTimeout(() => {
        initMealSwipe();
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
    ['П', 'В', 'С', 'Ч', 'П', 'С', 'В'].forEach(day => {
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

    let isClosing = false;
    let touchStartX = 0;
    let touchCurrentX = 0;
    let isDragging = false;
    let isAnimating = false;

    function closeCalendar() {
        if (isClosing) return;
        isClosing = true;

        overlay.classList.remove('open');
        panel.classList.remove('open');

        setTimeout(() => {
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

    function buildMonthPage(monthDate) {
        const page = document.createElement('div');
        page.className = 'meal-calendar-month-page';

        const grid = document.createElement('div');
        grid.className = 'meal-calendar-grid';

        const cells = getCalendarMonthMatrix(monthDate);
        const currentSelected = state.selectedDate ? parseLocalDate(state.selectedDate) : today;

        cells.forEach(cellDate => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'meal-calendar-day';

            const dateStr = formatLocalDate(cellDate);
            const inCurrentMonth = isSameMonth(cellDate, monthDate);
            const isTodayCell = isSameDay(cellDate, today);
            const isSelectedCell = isSameDay(cellDate, currentSelected);
            const hasEntry = inCurrentMonth && hasEntryForDate(dateStr);

            if (!inCurrentMonth) btn.classList.add('is-outside');
            if (isTodayCell) btn.classList.add('is-today');
            if (isSelectedCell) btn.classList.add('is-selected');
            if (hasEntry) btn.classList.add('has-entry');

            btn.innerHTML = `<span class="meal-calendar-day-num">${cellDate.getDate()}</span>`;

            btn.onclick = () => {
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

    function renderMonthTriplet() {
        title.textContent = getCalendarMonthTitle(visibleMonth);

        monthsTrack.innerHTML = '';

        const prevMonth = addMonths(visibleMonth, -1);
        const nextMonth = addMonths(visibleMonth, 1);

        const prevPage = buildMonthPage(prevMonth);
        const currentPage = buildMonthPage(visibleMonth);
        const nextPage = buildMonthPage(nextMonth);

        monthsTrack.append(prevPage, currentPage, nextPage);

        monthsTrack.style.transition = 'none';
        monthsTrack.style.transform = 'translate3d(-100%, 0, 0)';

        requestAnimationFrame(() => {
            monthsTrack.style.transition = 'transform 0.22s ease';
        });

        Promise.all([
            preloadMonthPresence(prevMonth),
            preloadMonthPresence(visibleMonth),
            preloadMonthPresence(nextMonth)
        ]).then(() => {
            if (!document.body.contains(overlay) || isClosing) return;
            title.textContent = getCalendarMonthTitle(visibleMonth);

            monthsTrack.innerHTML = '';
            monthsTrack.append(
                buildMonthPage(prevMonth),
                buildMonthPage(visibleMonth),
                buildMonthPage(nextMonth)
            );
            monthsTrack.style.transition = 'none';
            monthsTrack.style.transform = 'translate3d(-100%, 0, 0)';

            requestAnimationFrame(() => {
                monthsTrack.style.transition = 'transform 0.22s ease';
            });
        });
    }

    function animateTo(direction) {
        if (isAnimating) return;
        isAnimating = true;

        monthsTrack.style.transition = 'transform 0.22s ease';

        if (direction === 'next') {
            monthsTrack.style.transform = 'translate3d(-200%, 0, 0)';
            setTimeout(() => {
                visibleMonth = addMonths(visibleMonth, 1);
                renderMonthTriplet();
                isAnimating = false;
            }, 220);
            return;
        }

        if (direction === 'prev') {
            monthsTrack.style.transform = 'translate3d(0%, 0, 0)';
            setTimeout(() => {
                visibleMonth = addMonths(visibleMonth, -1);
                renderMonthTriplet();
                isAnimating = false;
            }, 220);
            return;
        }

        monthsTrack.style.transform = 'translate3d(-100%, 0, 0)';
        setTimeout(() => {
            isAnimating = false;
        }, 220);
    }

    monthsViewport.addEventListener('touchstart', (e) => {
        if (isAnimating) return;
        if (!e.touches || !e.touches.length) return;

        touchStartX = e.touches[0].clientX;
        touchCurrentX = touchStartX;
        isDragging = true;
        monthsTrack.style.transition = 'none';
    }, { passive: true });

    monthsViewport.addEventListener('touchmove', (e) => {
        if (!isDragging || isAnimating) return;
        if (!e.touches || !e.touches.length) return;

        touchCurrentX = e.touches[0].clientX;
        const deltaX = touchCurrentX - touchStartX;
        const width = monthsViewport.offsetWidth || 1;
        const percent = (deltaX / width) * 100;

        monthsTrack.style.transform = `translate3d(calc(-100% + ${percent}%), 0, 0)`;
    }, { passive: true });

    monthsViewport.addEventListener('touchend', () => {
        if (!isDragging || isAnimating) return;
        isDragging = false;

        const deltaX = touchCurrentX - touchStartX;

        if (deltaX <= -40) {
            animateTo('next');
        } else if (deltaX >= 40) {
            animateTo('prev');
        } else {
            animateTo('current');
        }
    });

    closeBtn.onclick = closeCalendar;

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            closeCalendar();
        }
    });

    todayBtn.onclick = () => {
        const todayMonth = getMonthStart(today);

        if (!isSameMonth(visibleMonth, todayMonth)) {
            visibleMonth = todayMonth;
            renderMonthTriplet();
            return;
        }

        closeCalendar();

        setTimeout(() => {
            switchMealDate(todayStr);
        }, 160);
    };

    renderMonthTriplet();

    requestAnimationFrame(() => {
        overlay.classList.add('open');
        panel.classList.add('open');
    });
}

// =================================================================
// 📅 свап
// =================================================================

function bindSwipeBlock({
    rootSelector,
    contentSelector,
    maxSwipe,
    openAt = Math.max(35, Math.round(maxSwipe * 0.58))
}) {
    const swipeItems = document.querySelectorAll(rootSelector);

    swipeItems.forEach(item => {
        const content = item.querySelector(contentSelector);
        if (!content) return;

        const bindKey = `swipeBound_${contentSelector.replace(/[^a-z0-9]/gi, '_')}`;
        if (item.dataset[bindKey] === '1') return;
        item.dataset[bindKey] = '1';

        let startX = 0;
        let currentX = 0;
        let isDragging = false;
        let moved = false;

        function closeSwipe(target = item) {
            const targetContent = target.querySelector(contentSelector);
            if (!targetContent) return;

            target.classList.remove('open');
            targetContent.style.transform = 'translateX(0px)';
        }

        function openSwipe(target = item) {
            const opened = document.querySelector(`${rootSelector}.open`);
            if (opened && opened !== target) {
                const openedContent = opened.querySelector(contentSelector);
                if (openedContent) {
                    opened.classList.remove('open');
                    openedContent.style.transform = 'translateX(0px)';
                }
            }

            const targetContent = target.querySelector(contentSelector);
            if (!targetContent) return;

            target.classList.add('open');
            targetContent.style.transform = `translateX(-${maxSwipe}px)`;
        }

        content.addEventListener('pointerdown', (e) => {
            if (e.target.closest('.action-btn')) return;

            startX = e.clientX;
            currentX = 0;
            isDragging = true;
            moved = false;
            content.style.transition = 'none';
        });

        content.addEventListener('pointermove', (e) => {
            if (!isDragging) return;

            currentX = e.clientX - startX;

            if (Math.abs(currentX) > 6) moved = true;

            if (currentX < 0) {
                const translate = Math.max(currentX, -maxSwipe);
                content.style.transform = `translateX(${translate}px)`;
            }

            if (currentX > 0 && item.classList.contains('open')) {
                const translate = Math.min(-maxSwipe + currentX, 0);
                content.style.transform = `translateX(${translate}px)`;
            }
        });

        function endSwipe() {
            if (!isDragging) return;
            isDragging = false;
            content.style.transition = 'transform 0.2s ease';

            if (!moved) return;

            if (currentX < -openAt) {
                openSwipe(item);
            } else if (currentX > openAt / 2) {
                closeSwipe(item);
            } else {
                if (item.classList.contains('open')) {
                    openSwipe(item);
                } else {
                    closeSwipe(item);
                }
            }
        }

        content.addEventListener('pointerup', endSwipe);
        content.addEventListener('pointercancel', endSwipe);
        content.addEventListener('lostpointercapture', endSwipe);
    });
}

function initMealSwipe() {
    bindSwipeBlock({
        rootSelector: '.meal-swipe',
        contentSelector: '.meal-card-header-content',
        maxSwipe: 120,
        openAt: 70
    });

    bindSwipeBlock({
        rootSelector: '.food-swipe',
        contentSelector: '.food-info-header-content',
        maxSwipe: 65,
        openAt: 38
    });

    if (!mealSwipeDocumentBound) {
        document.addEventListener('click', (e) => {
            const openedMeal = document.querySelector('.meal-swipe.open');
            if (openedMeal && !e.target.closest('.meal-swipe')) {
                const content = openedMeal.querySelector('.meal-card-header-content');
                if (content) {
                    openedMeal.classList.remove('open');
                    content.style.transform = 'translateX(0px)';
                }
            }

            const openedFood = document.querySelector('.food-swipe.open');
            if (openedFood && !e.target.closest('.food-swipe')) {
                const content = openedFood.querySelector('.food-info-header-content');
                if (content) {
                    openedFood.classList.remove('open');
                    content.style.transform = 'translateX(0px)';
                }
            }
        });

        mealSwipeDocumentBound = true;
    }
}