const MEDIA_CACHE_DB_NAME = 'training-diary-media-cache-v1';
const MEDIA_CACHE_STORE_NAME = 'mediaFiles';
const mediaObjectUrlCache = new Map();

let mediaCacheDbPromise = null;

function canUseMediaCache() {
    return typeof indexedDB !== 'undefined' && typeof fetch === 'function';
}

function normalizeCacheUrl(url) {
    const normalized = String(url || '').trim();
    if (!normalized) return '';
    if (/^(blob:|data:)/i.test(normalized)) return normalized;
    if (!/^https?:\/\//i.test(normalized)) return '';
    return normalized;
}

function wrapRequest(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('indexeddb_request_failed'));
    });
}

function openMediaCacheDb() {
    if (!canUseMediaCache()) {
        return Promise.resolve(null);
    }

    if (!mediaCacheDbPromise) {
        mediaCacheDbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(MEDIA_CACHE_DB_NAME, 1);

            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(MEDIA_CACHE_STORE_NAME)) {
                    db.createObjectStore(MEDIA_CACHE_STORE_NAME, { keyPath: 'url' });
                }
            };

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error('indexeddb_open_failed'));
        }).catch((error) => {
            console.warn('[media-cache] db open failed:', error);
            mediaCacheDbPromise = null;
            return null;
        });
    }

    return mediaCacheDbPromise;
}

async function readCachedMediaRecord(url) {
    const normalized = normalizeCacheUrl(url);
    if (!normalized || /^(blob:|data:)/i.test(normalized)) return null;

    const db = await openMediaCacheDb();
    if (!db) return null;

    const tx = db.transaction(MEDIA_CACHE_STORE_NAME, 'readonly');
    return wrapRequest(tx.objectStore(MEDIA_CACHE_STORE_NAME).get(normalized)).catch(() => null);
}

async function writeCachedMediaRecord(record) {
    const db = await openMediaCacheDb();
    if (!db) return false;

    const tx = db.transaction(MEDIA_CACHE_STORE_NAME, 'readwrite');
    await wrapRequest(tx.objectStore(MEDIA_CACHE_STORE_NAME).put(record));
    return true;
}

export async function getCachedMediaObjectUrl(url) {
    const normalized = normalizeCacheUrl(url);
    if (!normalized) return null;
    if (/^(blob:|data:)/i.test(normalized)) return normalized;

    if (mediaObjectUrlCache.has(normalized)) {
        return mediaObjectUrlCache.get(normalized);
    }

    const record = await readCachedMediaRecord(normalized);
    if (!record?.blob) return null;

    const objectUrl = URL.createObjectURL(record.blob);
    mediaObjectUrlCache.set(normalized, objectUrl);
    return objectUrl;
}

export async function cacheRemoteMediaUrl(url, options = {}) {
    const normalized = normalizeCacheUrl(url);
    if (!normalized || /^(blob:|data:)/i.test(normalized)) {
        return { ok: false, skipped: 'unsupported-url' };
    }

    if (options.force !== true) {
        const existing = await readCachedMediaRecord(normalized);
        if (existing?.blob) {
            return {
                ok: true,
                cached: true,
                url: normalized,
                size: Number(existing.size || existing.blob.size || 0)
            };
        }
    }

    const response = await fetch(normalized, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit'
    });

    if (!response.ok) {
        throw new Error(`media_fetch_failed_${response.status}`);
    }

    const blob = await response.blob();
    if (!blob || blob.size <= 0) {
        throw new Error('media_blob_empty');
    }

    await writeCachedMediaRecord({
        url: normalized,
        blob,
        size: Number(blob.size || 0),
        contentType: String(blob.type || response.headers.get('content-type') || '').trim(),
        updatedAt: Date.now()
    });

    return {
        ok: true,
        cached: true,
        url: normalized,
        size: Number(blob.size || 0)
    };
}

export async function preloadMediaUrls(urls = [], options = {}) {
    const normalizedUrls = Array.from(new Set(
        (Array.isArray(urls) ? urls : [])
            .map((url) => normalizeCacheUrl(url))
            .filter((url) => url && /^https?:\/\//i.test(url))
    ));

    if (!normalizedUrls.length) {
        return { ok: true, total: 0, cached: 0, failed: 0 };
    }

    const concurrency = Math.max(1, Math.min(4, Number(options.concurrency) || 3));
    let cursor = 0;
    let cached = 0;
    let failed = 0;

    async function worker() {
        while (cursor < normalizedUrls.length) {
            const currentIndex = cursor;
            cursor += 1;
            try {
                await cacheRemoteMediaUrl(normalizedUrls[currentIndex], options);
                cached += 1;
            } catch (error) {
                failed += 1;
                console.warn('[media-cache] preload failed:', normalizedUrls[currentIndex], error);
            }
        }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, normalizedUrls.length) }, () => worker()));

    return {
        ok: failed === 0,
        total: normalizedUrls.length,
        cached,
        failed
    };
}

export function releaseMediaObjectUrls() {
    mediaObjectUrlCache.forEach((objectUrl) => {
        try {
            URL.revokeObjectURL(objectUrl);
        } catch (_) {}
    });
    mediaObjectUrlCache.clear();
}

if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
        releaseMediaObjectUrls();
    });
}
