import { createKeyedBackgroundWriter } from '../background-write-queue.js';
import { deleteDoc, deleteField, doc, setDoc, updateDoc } from '../firestore-ops.js';

const mealsDocWriter = createKeyedBackgroundWriter({ delayMs: 420 });
const MEAL_ORDER_FIELD = 'mealOrder';
const MEAL_NOTES_FIELD = 'mealNotes';
const MEAL_NOTE_MAX_LENGTH = 40;

function normalizeMealNoteText(note) {
    return String(note ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MEAL_NOTE_MAX_LENGTH);
}

export function cloneMealItemsArray(items = []) {
    return (Array.isArray(items) ? items : []).map((item) => ({ ...item }));
}

function normalizeMealOrder(mealsData = {}, fallbackMealIds = []) {
    const explicitOrder = Array.isArray(mealsData?.[MEAL_ORDER_FIELD]) ? mealsData[MEAL_ORDER_FIELD] : [];
    const knownMealIds = new Set(
        [
            ...Object.keys(mealsData || {}).filter((mealId) => /^meal\d+$/.test(mealId)),
            ...explicitOrder.filter((mealId) => /^meal\d+$/.test(String(mealId || '').trim())),
            ...(Array.isArray(fallbackMealIds) ? fallbackMealIds : [])
        ]
            .map((mealId) => String(mealId || '').trim())
            .filter(Boolean)
    );
    const ordered = [];
    const seen = new Set();

    explicitOrder.forEach((mealId) => {
        const normalizedMealId = String(mealId || '').trim();
        if (!knownMealIds.has(normalizedMealId) || seen.has(normalizedMealId)) return;
        seen.add(normalizedMealId);
        ordered.push(normalizedMealId);
    });

    fallbackMealIds.forEach((mealId) => {
        const normalizedMealId = String(mealId || '').trim();
        if (!knownMealIds.has(normalizedMealId) || seen.has(normalizedMealId)) return;
        seen.add(normalizedMealId);
        ordered.push(normalizedMealId);
    });

    return ordered;
}

function normalizeMealNotes(mealsData = {}) {
    const source = mealsData?.[MEAL_NOTES_FIELD];
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        return {};
    }

    const normalized = {};
    Object.keys(source).forEach((mealId) => {
        if (!/^meal\d+$/.test(mealId)) return;
        const note = normalizeMealNoteText(source[mealId]);
        if (!note) return;
        normalized[mealId] = note;
    });
    return normalized;
}

export function normalizeMealsDataSnapshot(mealsData = {}, options = {}) {
    const preserveEmptyMealIds = new Set(
        (Array.isArray(options?.preserveEmptyMealIds) ? options.preserveEmptyMealIds : [])
            .map((mealId) => String(mealId || '').trim())
            .filter(Boolean)
    );

    const normalized = {};
    Object.keys(mealsData || {}).forEach((mealId) => {
        if (!/^meal\d+$/.test(mealId)) return;
        const items = cloneMealItemsArray(mealsData[mealId]);
        if (items.length > 0 || preserveEmptyMealIds.has(mealId)) {
            normalized[mealId] = items;
        }
    });

    const normalizedMealOrder = normalizeMealOrder(
        mealsData,
        [
            ...Object.keys(normalized).filter((mealId) => /^meal\d+$/.test(mealId)),
            ...Array.from(preserveEmptyMealIds)
        ]
    );
    if (normalizedMealOrder.length) {
        normalized[MEAL_ORDER_FIELD] = normalizedMealOrder;
    }

    const normalizedMealNotes = normalizeMealNotes(mealsData);
    if (Object.keys(normalizedMealNotes).length > 0) {
        normalized[MEAL_NOTES_FIELD] = normalizedMealNotes;
    }

    return normalized;
}

function hasAnyMealField(data = {}) {
    return Object.keys(data).some((key) => /^meal\d+$/.test(key) && Array.isArray(data[key]));
}

function hasAnyMealNote(data = {}) {
    const source = data?.[MEAL_NOTES_FIELD];
    return !!source && typeof source === 'object' && !Array.isArray(source) && Object.keys(source).length > 0;
}

export function hasAnyFoodInMealsSnapshot(data = {}) {
    return Object.keys(data).some(
        (key) => /^meal\d+$/.test(key) && Array.isArray(data[key]) && data[key].length > 0
    );
}

export function saveMealsDataDocument(cycleRef, dateStr, mealsData, options = {}) {
    if (!cycleRef || !dateStr) return Promise.resolve();

    const snapshot = normalizeMealsDataSnapshot(mealsData, options);
    const mealRef = doc(cycleRef, 'meals', dateStr);
    if (hasAnyMealField(snapshot) || hasAnyMealNote(snapshot)) {
        return setDoc(mealRef, snapshot);
    }
    return deleteDoc(mealRef);
}

export function queueMealsDataSave(cycleRef, dateStr, mealsData, options = {}) {
    if (!cycleRef || !dateStr) return;

    const snapshot = normalizeMealsDataSnapshot(mealsData, options);
    const writerKey = `${cycleRef.path}::${dateStr}`;
    const delayMs = Number.isFinite(options.delayMs) ? Math.max(0, Number(options.delayMs)) : 420;
    const onError = typeof options.onError === 'function' ? options.onError : null;
    const errorMessage = options.errorMessage || 'Не удалось сохранить изменения в питании';

    void mealsDocWriter.schedule(
        writerKey,
        () => saveMealsDataDocument(cycleRef, dateStr, snapshot, options),
        { delayMs }
    ).catch((error) => {
        console.error('[meal-save] failed:', error);
        onError?.(error, errorMessage);
    });
}

export function updateMealsDataDocument(cycleRef, dateStr, patch, options = {}) {
    if (!cycleRef || !dateStr) return Promise.resolve();

    const normalizedPatch = { ...(patch || {}) };
    const cleanupEmptyMealIds = Array.isArray(options?.cleanupEmptyMealIds)
        ? options.cleanupEmptyMealIds
        : [];

    cleanupEmptyMealIds.forEach((mealId) => {
        const key = String(mealId || '').trim();
        if (!key || normalizedPatch[key] !== undefined) return;
        normalizedPatch[key] = deleteField();
    });

    return updateDoc(doc(cycleRef, 'meals', dateStr), normalizedPatch);
}

export function saveMealGoalConfigPatch(cycleRef, patch) {
    if (!cycleRef) return Promise.resolve();
    return setDoc(cycleRef, {
        mealGoalConfig: { ...(patch || {}) }
    }, { merge: true });
}

export function clearMealGoalConfig(cycleRef) {
    if (!cycleRef) return Promise.resolve();
    return updateDoc(cycleRef, {
        mealGoalConfig: deleteField()
    });
}
