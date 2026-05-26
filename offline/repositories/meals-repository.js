import { createKeyedBackgroundWriter } from '../background-write-queue.js';
import { deleteDoc, deleteField, doc, setDoc, updateDoc } from '../firestore-ops.js';

const mealsDocWriter = createKeyedBackgroundWriter({ delayMs: 420 });

export function cloneMealItemsArray(items = []) {
    return (Array.isArray(items) ? items : []).map((item) => ({ ...item }));
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
    return normalized;
}

function hasAnyMealField(data = {}) {
    return Object.keys(data).some((key) => /^meal\d+$/.test(key) && Array.isArray(data[key]));
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
    if (hasAnyMealField(snapshot)) {
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
    const errorMessage = options.errorMessage || 'РќРµ СѓРґР°Р»РѕСЃСЊ СЃРѕС…СЂР°РЅРёС‚СЊ РёР·РјРµРЅРµРЅРёСЏ РІ РїРёС‚Р°РЅРёРё';

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
