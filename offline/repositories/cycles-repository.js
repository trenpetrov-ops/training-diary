import {
    addDoc,
    arrayUnion,
    doc,
    getDoc,
    serverTimestamp,
    updateDoc,
    deleteDoc,
    writeBatch
} from '../firestore-ops.js';

export async function createCycle(firestoreDb, cyclesCollection, cycleData, options = {}) {
    if (!cyclesCollection) throw new Error('cycles_collection_missing');

    const linkedTrainerAccessRef = options.linkedTrainerAccessRef || null;
    if (firestoreDb && linkedTrainerAccessRef) {
        const batch = writeBatch(firestoreDb);
        const cycleRef = doc(cyclesCollection);
        batch.set(cycleRef, { ...cycleData });

        const linkedSnap = await getDoc(linkedTrainerAccessRef);
        if (linkedSnap.exists() && linkedSnap.data()?.fullCycleAccess !== true) {
            batch.update(linkedTrainerAccessRef, {
                allowedCycleIds: arrayUnion(cycleRef.id),
                accessUpdatedAt: serverTimestamp()
            });
        }

        await batch.commit();
        return cycleRef;
    }

    return addDoc(cyclesCollection, { ...cycleData });
}

export function updateCycle(cyclesCollection, cycleId, patch) {
    if (!cyclesCollection || !cycleId) return Promise.reject(new Error('cycle_ref_missing'));
    return updateDoc(doc(cyclesCollection, cycleId), { ...patch });
}

export function deleteCycle(cyclesCollection, cycleId) {
    if (!cyclesCollection || !cycleId) return Promise.reject(new Error('cycle_ref_missing'));
    return deleteDoc(doc(cyclesCollection, cycleId));
}
