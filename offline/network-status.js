import { Network } from '@capacitor/network';
import { setSyncOnline } from './sync-status.js';

const listeners = new Set();

let currentState = {
    online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
    source: 'navigator',
    at: Date.now()
};

let initialized = false;
let cleanupFns = [];

function snapshot() {
    return { ...currentState };
}

function emit() {
    const next = snapshot();
    listeners.forEach((listener) => {
        try {
            listener(next);
        } catch (error) {
            console.warn('[network-status] listener failed:', error);
        }
    });
}

function updateState(online, source = 'unknown') {
    const normalized = online !== false;
    const changed =
        currentState.online !== normalized ||
        currentState.source !== source;

    currentState = {
        online: normalized,
        source,
        at: Date.now()
    };

    setSyncOnline(normalized);
    if (changed) emit();
}

export function getNetworkStatusSnapshot() {
    return snapshot();
}

export function subscribeNetworkStatus(listener) {
    listeners.add(listener);
    try {
        listener(snapshot());
    } catch (error) {
        console.warn('[network-status] initial listener failed:', error);
    }
    return () => listeners.delete(listener);
}

export function isNetworkOffline() {
    return currentState.online === false;
}

export async function initNetworkMonitoring() {
    if (initialized) {
        return () => {};
    }

    initialized = true;
    cleanupFns = [];

    if (typeof window !== 'undefined') {
        const handleOnline = () => updateState(true, 'window');
        const handleOffline = () => updateState(false, 'window');

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        cleanupFns.push(() => window.removeEventListener('online', handleOnline));
        cleanupFns.push(() => window.removeEventListener('offline', handleOffline));
    }

    try {
        const status = await Network.getStatus();
        updateState(Boolean(status?.connected), 'capacitor');
    } catch (_) {
        setSyncOnline(currentState.online);
    }

    try {
        const handle = await Network.addListener('networkStatusChange', (status) => {
            updateState(Boolean(status?.connected), 'capacitor');
        });
        cleanupFns.push(() => {
            try {
                handle.remove();
            } catch (_) {}
        });
    } catch (_) {
        // Browser fallback listeners are enough.
    }

    return () => {
        cleanupFns.forEach((cleanup) => {
            try {
                cleanup();
            } catch (_) {}
        });
        cleanupFns = [];
        initialized = false;
    };
}
