import { addDoc, deleteDoc, doc, updateDoc } from '../firestore-ops.js';

export function createClient(clientsCollection, data) {
    if (!clientsCollection) return Promise.reject(new Error('clients_collection_missing'));
    return addDoc(clientsCollection, { ...data });
}

export function updateClient(clientsCollection, clientId, patch) {
    if (!clientsCollection || !clientId) return Promise.reject(new Error('client_ref_missing'));
    return updateDoc(doc(clientsCollection, clientId), { ...patch });
}

export function deleteClient(clientsCollection, clientId) {
    if (!clientsCollection || !clientId) return Promise.reject(new Error('client_ref_missing'));
    return deleteDoc(doc(clientsCollection, clientId));
}
