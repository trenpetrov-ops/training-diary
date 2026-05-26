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
    runTransaction as firebaseRunTransaction,
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

function getWriteGuardState() {
    try {
        if (typeof window === 'undefined') return null;
        const guard = window.__TRAINING_DIARY_WRITE_GUARD__;
        if (typeof guard !== 'function') return null;
        return guard() || null;
    } catch (_) {
        return null;
    }
}

function createWriteLockError(message, context) {
    const error = new Error(
        String(message || '').trim()
            || 'Аккаунт уже открыт на другом телефоне. На этом устройстве изменения заблокированы.'
    );
    error.code = 'exclusive-session/read-only';
    error.context = context || 'firestore-write';
    return error;
}

function ensureWriteAllowed(context) {
    const state = getWriteGuardState();
    if (state?.blocked) {
        throw createWriteLockError(state.message, context);
    }
}

export async function addDoc(collectionRef, data) {
    ensureWriteAllowed('addDoc');
    if (!shouldResolveOptimistically()) {
        return trackWrite(firebaseAddDoc(collectionRef, data), 'addDoc');
    }

    const docRef = doc(collectionRef);
    trackWrite(firebaseSetDoc(docRef, data), 'addDoc');
    return docRef;
}

export function setDoc(reference, data, options) {
    ensureWriteAllowed('setDoc');
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
    ensureWriteAllowed('updateDoc');
    const promise = firebaseUpdateDoc(reference, ...args);

    if (shouldResolveOptimistically()) {
        trackWrite(promise, 'updateDoc');
        return Promise.resolve();
    }

    return trackWrite(promise, 'updateDoc');
}

export function deleteDoc(reference) {
    ensureWriteAllowed('deleteDoc');
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
            ensureWriteAllowed('writeBatch.set');
            batch.set(...args);
            return proxy;
        },
        update(...args) {
            ensureWriteAllowed('writeBatch.update');
            batch.update(...args);
            return proxy;
        },
        delete(...args) {
            ensureWriteAllowed('writeBatch.delete');
            batch.delete(...args);
            return proxy;
        },
        commit() {
            ensureWriteAllowed('writeBatch.commit');
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

export function runTransaction(...args) {
    ensureWriteAllowed('runTransaction');
    return firebaseRunTransaction(...args);
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
    serverTimestamp,
    startAfter,
    startAt,
    where
};
