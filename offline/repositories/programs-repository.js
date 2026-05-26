import { createKeyedBackgroundWriter } from '../background-write-queue.js';
import { addDoc, deleteDoc, doc, updateDoc } from '../firestore-ops.js';

const programExercisesWriter = createKeyedBackgroundWriter({ delayMs: 420 });

export function cloneProgramExercisesSnapshot(exercises = []) {
    return JSON.parse(JSON.stringify(Array.isArray(exercises) ? exercises : []));
}

export function scheduleProgramExercisesSave(programsCollection, programId, exercises, options = {}) {
    if (!programsCollection || !programId) return Promise.resolve();

    const snapshot = cloneProgramExercisesSnapshot(exercises);
    const delayMs = Number.isFinite(options.delayMs) ? Math.max(0, Number(options.delayMs)) : 420;

    return programExercisesWriter.schedule(
        String(programId),
        () => updateDoc(doc(programsCollection, programId), { exercises: snapshot }),
        { delayMs }
    );
}

export function queueProgramExercisesSave(programsCollection, programId, exercises, options = {}) {
    const onError = typeof options.onError === 'function' ? options.onError : null;
    const errorMessage = options.errorMessage || 'Не удалось сохранить изменения тренировки';

    void scheduleProgramExercisesSave(programsCollection, programId, exercises, options).catch((error) => {
        console.error('[program-save] failed:', error);
        onError?.(error, errorMessage);
    });
}

export function createProgram(programsCollection, data) {
    if (!programsCollection) return Promise.reject(new Error('programs_collection_missing'));
    return addDoc(programsCollection, { ...data });
}

export function updateProgramDocument(programsCollection, programId, patch) {
    if (!programsCollection || !programId) return Promise.reject(new Error('program_ref_missing'));
    return updateDoc(doc(programsCollection, programId), { ...patch });
}

export function deleteProgram(programsCollection, programId) {
    if (!programsCollection || !programId) return Promise.reject(new Error('program_ref_missing'));
    return deleteDoc(doc(programsCollection, programId));
}
