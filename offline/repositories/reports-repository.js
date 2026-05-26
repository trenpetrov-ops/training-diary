import { addDoc, deleteDoc, doc, updateDoc } from '../firestore-ops.js';

export function createReport(reportsCollection, data) {
    if (!reportsCollection) return Promise.reject(new Error('reports_collection_missing'));
    return addDoc(reportsCollection, { ...data });
}

export function updateReport(reportsCollection, reportId, data) {
    if (!reportsCollection || !reportId) return Promise.reject(new Error('report_ref_missing'));
    return updateDoc(doc(reportsCollection, reportId), { ...data });
}

export function deleteReportDocument(reportsCollection, reportId) {
    if (!reportsCollection || !reportId) return Promise.reject(new Error('report_ref_missing'));
    return deleteDoc(doc(reportsCollection, reportId));
}
