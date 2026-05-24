export function createKeyedBackgroundWriter(options = {}) {
    const defaultDelayMs = Number.isFinite(options.delayMs)
        ? Math.max(0, Number(options.delayMs))
        : 0;

    const entries = new Map();

    function ensureEntry(key) {
        const normalizedKey = String(key);
        let entry = entries.get(normalizedKey);
        if (!entry) {
            entry = {
                timerId: 0,
                inFlight: false,
                nextDelayMs: defaultDelayMs,
                factory: null,
                deferreds: []
            };
            entries.set(normalizedKey, entry);
        }
        return { normalizedKey, entry };
    }

    function cleanupIfIdle(key, entry) {
        if (!entry.inFlight && !entry.timerId && !entry.factory && entry.deferreds.length === 0) {
            entries.delete(key);
        }
    }

    async function flush(key) {
        const normalizedKey = String(key);
        const entry = entries.get(normalizedKey);
        if (!entry || entry.inFlight || typeof entry.factory !== 'function') return;

        const currentFactory = entry.factory;
        const deferreds = entry.deferreds.splice(0);
        entry.factory = null;
        entry.timerId = 0;
        entry.inFlight = true;

        try {
            const result = await currentFactory();
            deferreds.forEach(({ resolve }) => resolve(result));
        } catch (error) {
            deferreds.forEach(({ reject }) => reject(error));
        } finally {
            entry.inFlight = false;
            if (typeof entry.factory === 'function') {
                arm(normalizedKey, entry, entry.nextDelayMs);
            } else {
                cleanupIfIdle(normalizedKey, entry);
            }
        }
    }

    function arm(key, entry, delayMs) {
        if (entry.timerId) clearTimeout(entry.timerId);

        const normalizedDelay = Number.isFinite(delayMs)
            ? Math.max(0, Number(delayMs))
            : defaultDelayMs;

        entry.nextDelayMs = normalizedDelay;
        if (entry.inFlight) return;

        entry.timerId = window.setTimeout(() => {
            entry.timerId = 0;
            void flush(key);
        }, normalizedDelay);
    }

    function schedule(key, factory, options = {}) {
        if (typeof factory !== 'function') {
            return Promise.reject(new TypeError('Background writer expects a function factory'));
        }

        const { normalizedKey, entry } = ensureEntry(key);
        entry.factory = factory;

        const delayMs = Number.isFinite(options.delayMs)
            ? Math.max(0, Number(options.delayMs))
            : defaultDelayMs;

        const promise = new Promise((resolve, reject) => {
            entry.deferreds.push({ resolve, reject });
        });

        arm(normalizedKey, entry, delayMs);
        return promise;
    }

    function flushNow(key) {
        const normalizedKey = String(key);
        const entry = entries.get(normalizedKey);
        if (!entry) return Promise.resolve();

        if (entry.timerId) {
            clearTimeout(entry.timerId);
            entry.timerId = 0;
        }

        return flush(normalizedKey);
    }

    return {
        schedule,
        flush: flushNow
    };
}
