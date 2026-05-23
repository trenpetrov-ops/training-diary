import {
    arrayUnion,
    collection,
    deleteDoc as firebaseDeleteDoc,
    deleteField,
    doc,
    documentId,
    endAt,
    getDoc,
    getDocFromCache,
    getDocs,
    limit,
    onSnapshot,
    orderBy,
    query,
    runTransaction,
    serverTimestamp,
    setDoc as firebaseSetDoc,
    startAfter,
    startAt,
    updateDoc as firebaseUpdateDoc,
    where,
    addDoc as firebaseAddDoc,
    writeBatch as firebaseWriteBatch
} from 'firebase/firestore';

import { isNetworkOffline } from './network-status.js';
import { trackFirestoreBackendPromise } from './sync-status.js';

function shouldResolveOptimistically() {
    return isNetworkOffline();
}

function trackWrite(promise, context) {
    return trackFirestoreBackendPromise(promise, context);
}

export async function addDoc(collectionRef, data) {
    if (!shouldResolveOptimistically()) {
        return trackWrite(firebaseAddDoc(collectionRef, data), 'addDoc');
    }

    const docRef = doc(collectionRef);
    trackWrite(firebaseSetDoc(docRef, data), 'addDoc');
    return docRef;
}

export function setDoc(reference, data, options) {
    const promise = options === undefined
        ? firebaseSetDoc(reference, data)
        : firebaseSetDoc(reference, data, options);

    if (shouldResolveOptimistically()) {
        trackWrite(promise, 'setDoc');
        return Promise.resolve();
    }

    return trackWrite(promise, 'setDoc');
}

export function updateDoc(reference, ...args) {
    const promise = firebaseUpdateDoc(reference, ...args);

    if (shouldResolveOptimistically()) {
        trackWrite(promise, 'updateDoc');
        return Promise.resolve();
    }

    return trackWrite(promise, 'updateDoc');
}

export function deleteDoc(reference) {
    const promise = firebaseDeleteDoc(reference);

    if (shouldResolveOptimistically()) {
        trackWrite(promise, 'deleteDoc');
        return Promise.resolve();
    }

    return trackWrite(promise, 'deleteDoc');
}

export function writeBatch(firestore) {
    const batch = firebaseWriteBatch(firestore);
    const proxy = {
        set(...args) {
            batch.set(...args);
            return proxy;
        },
        update(...args) {
            batch.update(...args);
            return proxy;
        },
        delete(...args) {
            batch.delete(...args);
            return proxy;
        },
        commit() {
            const promise = batch.commit();
            if (shouldResolveOptimistically()) {
                trackWrite(promise, 'writeBatch.commit');
                return Promise.resolve();
            }
            return trackWrite(promise, 'writeBatch.commit');
        }
    };

    return proxy;
}

export {
    arrayUnion,
    collection,
    deleteField,
    doc,
    documentId,
    endAt,
    getDoc,
    getDocFromCache,
    getDocs,
    limit,
    onSnapshot,
    orderBy,
    query,
    runTransaction,
    serverTimestamp,
    startAfter,
    startAt,
    where
};
