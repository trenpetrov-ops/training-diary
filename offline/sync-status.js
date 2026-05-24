const listeners = new Set();

const state = {
    online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
    pendingWrites: 0,
    lastError: null,
    lastSyncedAt: 0
};

function buildSnapshot() {
    let status = 'synced';

    if (state.lastError) {
        status = state.online ? 'error' : 'offline-error';
    } else if (!state.online) {
        status = state.pendingWrites > 0 ? 'offline-pending' : 'offline';
    } else if (state.pendingWrites > 0) {
        status = 'syncing';
    }

    return {
        ...state,
        status,
        hasPendingWrites: state.pendingWrites > 0
    };
}

function emit() {
    const snapshot = buildSnapshot();
    listeners.forEach((listener) => {
        try {
            listener(snapshot);
        } catch (error) {
            console.warn('[sync-status] listener failed:', error);
        }
    });
}

function normalizeError(error, context = 'write') {
    const code = String(error?.code || '').trim();
    const message = String(error?.message || error || 'Unknown sync error').trim();

    return {
        at: Date.now(),
        code,
        context,
        message
    };
}

function onPendingWriteStarted() {
    state.pendingWrites += 1;
    emit();
}

function onPendingWriteFinished() {
    state.pendingWrites = Math.max(0, state.pendingWrites - 1);
    if (state.online && state.pendingWrites === 0 && !state.lastError) {
        state.lastSyncedAt = Date.now();
    }
    emit();
}

export function getSyncStatusSnapshot() {
    return buildSnapshot();
}

export function subscribeSyncStatus(listener) {
    listeners.add(listener);
    try {
        listener(buildSnapshot());
    } catch (error) {
        console.warn('[sync-status] initial listener failed:', error);
    }
    return () => listeners.delete(listener);
}

export function setSyncOnline(online) {
    const normalized = online !== false;
    if (state.online === normalized) return buildSnapshot();

    state.online = normalized;
    if (state.online && state.pendingWrites === 0 && !state.lastError) {
        state.lastSyncedAt = Date.now();
    }
    emit();
    return buildSnapshot();
}

export function setSyncError(error, context = 'write') {
    state.lastError = normalizeError(error, context);
    emit();
    return buildSnapshot();
}

export function clearSyncError() {
    if (!state.lastError) return buildSnapshot();

    state.lastError = null;
    if (state.online && state.pendingWrites === 0) {
        state.lastSyncedAt = Date.now();
    }
    emit();
    return buildSnapshot();
}

export function trackFirestoreBackendPromise(promise, context = 'write') {
    onPendingWriteStarted();

    promise
        .then(() => {
            if (state.lastError) {
                state.lastError = null;
            }
            onPendingWriteFinished();
        })
        .catch((error) => {
            onPendingWriteFinished();
            setSyncError(error, context);
        });

    return promise;
}

export function describeSyncStatus(snapshot = buildSnapshot()) {
    switch (snapshot.status) {
        case 'offline-pending':
            return 'Изменения сохранены на устройстве и отправятся, когда появится интернет';
        case 'offline':
            return 'Нет интернета. Можно работать с уже загруженными данными';
        case 'syncing':
            return 'Сохраняем изменения';
        case 'error':
        case 'offline-error':
            return 'Не удалось сохранить изменения. Проверьте интернет';
        default:
            return 'Все изменения сохранены';
    }
}
