import { createKeyedBackgroundWriter } from '../background-write-queue.js';
import { updateDoc } from '../firestore-ops.js';

const supplementPlanWriter = createKeyedBackgroundWriter({ delayMs: 650 });

export function cloneSupplementPlanSnapshot(planData = { supplements: [], data: [], doseMerges: [] }) {
    return JSON.parse(JSON.stringify(planData || { supplements: [], data: [], doseMerges: [] }));
}

export function saveSupplementPlanDocument(cycleRef, planData) {
    if (!cycleRef) return Promise.resolve();
    return updateDoc(cycleRef, { supplementPlan: cloneSupplementPlanSnapshot(planData) });
}

export function queueSupplementPlanSave(cycleRef, planData, options = {}) {
    if (!cycleRef || !planData) return;

    const snapshot = cloneSupplementPlanSnapshot(planData);
    const delayMs = Number.isFinite(options.delayMs) ? Math.max(0, Number(options.delayMs)) : 650;
    const onError = typeof options.onError === 'function' ? options.onError : null;
    const errorMessage = options.errorMessage || 'Не удалось сохранить план добавок';

    void supplementPlanWriter.schedule(
        `${cycleRef.path}::supplementPlan`,
        () => updateDoc(cycleRef, { supplementPlan: snapshot }),
        { delayMs }
    ).catch((error) => {
        console.error('[supplement-save] failed:', error);
        onError?.(error, errorMessage);
    });
}
