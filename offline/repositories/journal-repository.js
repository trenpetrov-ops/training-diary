import {
    addDoc,
    deleteDoc,
    doc,
    query,
    where,
    getDocs,
    updateDoc,
    writeBatch
} from '../firestore-ops.js';

export function createJournalRecord(journalCollection, data) {
    if (!journalCollection) return Promise.reject(new Error('journal_collection_missing'));
    return addDoc(journalCollection, { ...data });
}

export function deleteJournalRecord(journalCollection, recordId) {
    if (!journalCollection || !recordId) return Promise.reject(new Error('journal_ref_missing'));
    return deleteDoc(doc(journalCollection, recordId));
}

export async function deleteJournalRecordsByIds(firestoreDb, journalCollection, recordIds = []) {
    if (!firestoreDb || !journalCollection) throw new Error('journal_batch_missing');
    const ids = Array.from(new Set((recordIds || []).filter(Boolean)));
    if (!ids.length) return 0;

    const batch = writeBatch(firestoreDb);
    ids.forEach((recordId) => {
        batch.delete(doc(journalCollection, recordId));
    });
    await batch.commit();
    return ids.length;
}

export function updateJournalRecord(journalCollection, recordId, patch) {
    if (!journalCollection || !recordId) return Promise.reject(new Error('journal_ref_missing'));
    return updateDoc(doc(journalCollection, recordId), { ...patch });
}

export async function replacePlannedTrainingWithCompleted(firestoreDb, journalCollection, dateStr, trainingRecord) {
    if (!firestoreDb || !journalCollection) throw new Error('journal_batch_missing');

    const plannedQuery = query(
        journalCollection,
        where('date', '==', dateStr),
        where('isPlanned', '==', true)
    );
    const snapshot = await getDocs(plannedQuery);
    const batch = writeBatch(firestoreDb);

    snapshot.docs.forEach((docSnap) => {
        batch.delete(docSnap.ref);
    });

    const nextRecordRef = doc(journalCollection);
    batch.set(nextRecordRef, {
        ...trainingRecord,
        isPlanned: false
    });

    await batch.commit();
    return nextRecordRef;
}
