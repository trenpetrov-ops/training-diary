const PENDING_MEDIA_DB_NAME = 'training-diary-pending-media-v1';
const PENDING_MEDIA_STORE_NAME = 'uploads';
const PENDING_MEDIA_URL_PREFIX = 'local-media://';

const pendingMediaObjectUrlCache = new Map();
let pendingMediaDbPromise = null;

function canUsePendingMediaQueue() {
    return typeof indexedDB !== 'undefined' && typeof Blob !== 'undefined';
}

function wrapRequest(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('indexeddb_request_failed'));
    });
}

function normalizePendingMediaId(idOrUrl) {
    const raw = String(idOrUrl || '').trim();
    if (!raw) return '';
    if (raw.startsWith(PENDING_MEDIA_URL_PREFIX)) {
        return raw.slice(PENDING_MEDIA_URL_PREFIX.length).trim();
    }
    return raw;
}

function createPendingMediaUrl(id) {
    const normalizedId = normalizePendingMediaId(id);
    return normalizedId ? `${PENDING_MEDIA_URL_PREFIX}${normalizedId}` : '';
}

function cloneTarget(target = null) {
    return target && typeof target === 'object'
        ? JSON.parse(JSON.stringify(target))
        : null;
}

function ensurePendingMediaRecord(record = {}) {
    const id = normalizePendingMediaId(record.id || record.pendingUrl);
    if (!id) return null;

    return {
        id,
        pendingUrl: createPendingMediaUrl(id),
        ownerUid: String(record.ownerUid || '').trim(),
        folder: String(record.folder || 'uploads').trim() || 'uploads',
        fileName: String(record.fileName || 'image.jpg').trim() || 'image.jpg',
        mimeType: String(record.mimeType || 'application/octet-stream').trim() || 'application/octet-stream',
        lastModified: Number(record.lastModified || 0) || Date.now(),
        size: Number(record.size || record.fileBlob?.size || 0) || 0,
        fileBlob: record.fileBlob instanceof Blob ? record.fileBlob : null,
        createdAt: Number(record.createdAt || 0) || Date.now(),
        updatedAt: Number(record.updatedAt || 0) || Date.now(),
        status: String(record.status || 'pending').trim() || 'pending',
        target: cloneTarget(record.target),
        lastError: record.lastError ? String(record.lastError).trim() : '',
        lastAttemptAt: Number(record.lastAttemptAt || 0) || 0
    };
}

function openPendingMediaDb() {
    if (!canUsePendingMediaQueue()) {
        return Promise.resolve(null);
    }

    if (!pendingMediaDbPromise) {
        pendingMediaDbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(PENDING_MEDIA_DB_NAME, 1);

            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(PENDING_MEDIA_STORE_NAME)) {
                    const store = db.createObjectStore(PENDING_MEDIA_STORE_NAME, { keyPath: 'id' });
                    store.createIndex('byOwnerUid', 'ownerUid', { unique: false });
                    store.createIndex('byStatus', 'status', { unique: false });
                }
            };

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error('indexeddb_open_failed'));
        }).catch((error) => {
            console.warn('[pending-media-queue] db open failed:', error);
            pendingMediaDbPromise = null;
            return null;
        });
    }

    return pendingMediaDbPromise;
}

async function readPendingMediaRecord(idOrUrl) {
    const id = normalizePendingMediaId(idOrUrl);
    if (!id) return null;

    const db = await openPendingMediaDb();
    if (!db) return null;

    const tx = db.transaction(PENDING_MEDIA_STORE_NAME, 'readonly');
    return wrapRequest(tx.objectStore(PENDING_MEDIA_STORE_NAME).get(id)).catch(() => null);
}

async function writePendingMediaRecord(record) {
    const normalized = ensurePendingMediaRecord(record);
    if (!normalized) return false;

    const db = await openPendingMediaDb();
    if (!db) return false;

    const tx = db.transaction(PENDING_MEDIA_STORE_NAME, 'readwrite');
    await wrapRequest(tx.objectStore(PENDING_MEDIA_STORE_NAME).put(normalized));
    return true;
}

function revokePendingMediaObjectUrl(url) {
    const normalized = String(url || '').trim();
    const cached = pendingMediaObjectUrlCache.get(normalized);
    if (!cached) return;
    try {
        URL.revokeObjectURL(cached);
    } catch (_) {}
    pendingMediaObjectUrlCache.delete(normalized);
}

export function isPendingMediaUrl(url) {
    return String(url || '').trim().startsWith(PENDING_MEDIA_URL_PREFIX);
}

export async function queuePendingMediaFile(file, options = {}) {
    const blob = file instanceof Blob ? file : null;
    if (!blob) {
        throw new Error('pending_media_file_missing');
    }

    const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `pending-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    const now = Date.now();
    const record = ensurePendingMediaRecord({
        id,
        ownerUid: options.ownerUid,
        folder: options.folder || 'uploads',
        fileName: String(file.name || options.fileName || 'image.jpg').trim() || 'image.jpg',
        mimeType: String(file.type || options.mimeType || blob.type || 'application/octet-stream').trim() || 'application/octet-stream',
        lastModified: Number(file.lastModified || options.lastModified || 0) || now,
        size: Number(blob.size || 0) || 0,
        fileBlob: blob,
        createdAt: now,
        updatedAt: now,
        status: 'pending',
        target: cloneTarget(options.target)
    });

    const ok = await writePendingMediaRecord(record);
    if (!ok) {
        throw new Error('pending_media_queue_unavailable');
    }

    return {
        id: record.id,
        pendingUrl: record.pendingUrl,
        status: record.status
    };
}

export async function getPendingMediaRecord(idOrUrl) {
    const record = await readPendingMediaRecord(idOrUrl);
    return record ? ensurePendingMediaRecord(record) : null;
}

export async function attachPendingMediaTarget(idOrUrl, target = null) {
    const existing = await getPendingMediaRecord(idOrUrl);
    if (!existing) return false;
    existing.target = cloneTarget(target);
    existing.updatedAt = Date.now();
    existing.status = 'pending';
    existing.lastError = '';
    return writePendingMediaRecord(existing);
}

export async function updatePendingMediaState(idOrUrl, patch = {}) {
    const existing = await getPendingMediaRecord(idOrUrl);
    if (!existing) return false;

    const next = ensurePendingMediaRecord({
        ...existing,
        ...patch,
        id: existing.id,
        pendingUrl: existing.pendingUrl,
        target: patch.target === undefined ? existing.target : cloneTarget(patch.target),
        updatedAt: Date.now()
    });

    return writePendingMediaRecord(next);
}

export async function listPendingMediaUploads(options = {}) {
    const db = await openPendingMediaDb();
    if (!db) return [];

    const ownerUid = String(options.ownerUid || '').trim();
    const statusFilter = String(options.status || '').trim();
    const requireTarget = options.requireTarget === true;

    const tx = db.transaction(PENDING_MEDIA_STORE_NAME, 'readonly');
    const records = await wrapRequest(tx.objectStore(PENDING_MEDIA_STORE_NAME).getAll()).catch(() => []);

    return (Array.isArray(records) ? records : [])
        .map((record) => ensurePendingMediaRecord(record))
        .filter(Boolean)
        .filter((record) => !ownerUid || record.ownerUid === ownerUid)
        .filter((record) => !statusFilter || record.status === statusFilter)
        .filter((record) => !requireTarget || !!record.target)
        .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
}

export async function deletePendingMediaUpload(idOrUrl) {
    const record = await getPendingMediaRecord(idOrUrl);
    if (!record) return false;

    const db = await openPendingMediaDb();
    if (!db) return false;

    const tx = db.transaction(PENDING_MEDIA_STORE_NAME, 'readwrite');
    await wrapRequest(tx.objectStore(PENDING_MEDIA_STORE_NAME).delete(record.id));
    revokePendingMediaObjectUrl(record.pendingUrl);
    return true;
}

export async function getPendingMediaObjectUrl(idOrUrl) {
    const pendingUrl = createPendingMediaUrl(idOrUrl);
    if (!pendingUrl) return null;

    if (pendingMediaObjectUrlCache.has(pendingUrl)) {
        return pendingMediaObjectUrlCache.get(pendingUrl);
    }

    const record = await getPendingMediaRecord(idOrUrl);
    if (!record?.fileBlob) return null;

    const objectUrl = URL.createObjectURL(record.fileBlob);
    pendingMediaObjectUrlCache.set(pendingUrl, objectUrl);
    return objectUrl;
}

export function releasePendingMediaObjectUrls() {
    Array.from(pendingMediaObjectUrlCache.keys()).forEach((key) => revokePendingMediaObjectUrl(key));
}

if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
        releasePendingMediaObjectUrls();
    });
}
