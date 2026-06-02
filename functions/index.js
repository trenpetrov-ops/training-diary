const admin = require('firebase-admin');
const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const crypto = require('crypto');

// Local dev: load functions/.env if present
try {
  // eslint-disable-next-line global-require
  require('dotenv').config();
} catch (_) {
  // ignore
}

admin.initializeApp();

// FatSecret OAuth 1.0 (server-to-server signed requests)
// Store these in Firebase secrets:
// - FATSECRET_CONSUMER_KEY
// - FATSECRET_CONSUMER_SECRET
const FATSECRET_CONSUMER_KEY = defineSecret('FATSECRET_CONSUMER_KEY');
const FATSECRET_CONSUMER_SECRET = defineSecret('FATSECRET_CONSUMER_SECRET');

const FATSECRET_ENDPOINT = 'https://platform.fatsecret.com/rest/server.api';
const APP_ARTIFACT_ID = admin.app().options.projectId || process.env.GCLOUD_PROJECT || 'training-diary-51f0f';

const DAILY_LIMIT = 5000;
const QUOTA_DOC_PREFIX = 'fatsecret_basic';

function utcDayKey(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function nextUtcMidnightIso(d = new Date()) {
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0);
  return new Date(t).toISOString();
}

function rfc3986Encode(str) {
  return encodeURIComponent(str)
    .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function buildOauth1Params(consumerKey) {
  return {
    oauth_consumer_key: consumerKey,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_version: '1.0'
  };
}

function normalizeAndSortParams(params) {
  const entries = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => [String(k), String(v)]);

  // Sort by encoded key then encoded value (lexicographically)
  entries.sort((a, b) => {
    const ak = rfc3986Encode(a[0]);
    const bk = rfc3986Encode(b[0]);
    if (ak < bk) return -1;
    if (ak > bk) return 1;
    const av = rfc3986Encode(a[1]);
    const bv = rfc3986Encode(b[1]);
    if (av < bv) return -1;
    if (av > bv) return 1;
    return 0;
  });

  return entries;
}

function buildSignatureBaseString(httpMethod, url, params) {
  const normalizedPairs = normalizeAndSortParams(params)
    .map(([k, v]) => `${rfc3986Encode(k)}=${rfc3986Encode(v)}`)
    .join('&');

  return [
    httpMethod.toUpperCase(),
    rfc3986Encode(url),
    rfc3986Encode(normalizedPairs)
  ].join('&');
}

function signHmacSha1(baseString, consumerSecret, accessSecret = '') {
  const key = `${rfc3986Encode(consumerSecret)}&${rfc3986Encode(accessSecret)}`;
  return crypto.createHmac('sha1', key).update(baseString).digest('base64');
}

function toFormBody(params) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

async function checkAndIncrementQuota(cost = 1) {
  const db = admin.firestore();
  const day = utcDayKey();
  const docId = `${QUOTA_DOC_PREFIX}_${day}`;
  const ref = db.collection('apiQuotas').doc(docId);

  return await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const used = Number(snap.exists ? snap.data()?.usedCalls : 0) || 0;

    if (used + cost > DAILY_LIMIT) {
      return {
        allowed: false,
        usedCalls: used,
        dailyLimit: DAILY_LIMIT,
        resetAt: nextUtcMidnightIso()
      };
    }

    tx.set(ref, {
      usedCalls: used + cost,
      dailyLimit: DAILY_LIMIT,
      day,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    return {
      allowed: true,
      usedCalls: used + cost,
      dailyLimit: DAILY_LIMIT,
      resetAt: nextUtcMidnightIso()
    };
  });
}

async function fatsecretCall({ methodName, extraParams, consumerKey, consumerSecret }) {
  const oauthParams = buildOauth1Params(consumerKey);
  const params = {
    method: methodName,
    format: 'json',
    ...extraParams,
    ...oauthParams
  };

  const baseString = buildSignatureBaseString('POST', FATSECRET_ENDPOINT, params);
  const signature = signHmacSha1(baseString, consumerSecret);
  params.oauth_signature = signature;

  const res = await fetch(FATSECRET_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: toFormBody(params)
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (_) {
    json = null;
  }

  if (!res.ok) {
    const err = new Error(`FatSecret HTTP ${res.status}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }

  if (json?.error) {
    const err = new Error(json.error?.message || 'FatSecret error');
    err.status = 400;
    err.code = json.error?.code;
    err.body = json;
    throw err;
  }

  return json;
}

function jsonResponse(res, status, payload) {
  res.set('cache-control', 'no-store');
  res.status(status).json(payload);
}

function getFatSecretConsumerCreds() {
  const key = FATSECRET_CONSUMER_KEY.value() || process.env.FATSECRET_CONSUMER_KEY || '';
  const secret = FATSECRET_CONSUMER_SECRET.value() || process.env.FATSECRET_CONSUMER_SECRET || '';
  return { key: String(key).trim(), secret: String(secret).trim() };
}

function withCors(req, res) {
  // Hosting rewrite makes this same-origin, but keep CORS safe for local dev.
  res.set('access-control-allow-origin', '*');
  res.set('access-control-allow-methods', 'POST, OPTIONS');
  res.set('access-control-allow-headers', 'content-type, authorization');
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return true;
  }
  return false;
}

function readBearerToken(req) {
  const authHeader = String(req.headers.authorization || '');
  const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  return tokenMatch?.[1]?.trim() || '';
}

function normalizeSessionString(value, maxLength = 160) {
  return String(value || '').trim().slice(0, maxLength);
}

function getUserAuthSessionRef(uid) {
  return admin
    .firestore()
    .doc(`artifacts/${APP_ARTIFACT_ID}/users/${uid}/private/authSession`);
}

function isIsoDayString(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
}

function normalizeImportedDayString(value) {
  const raw = String(value || '').trim();
  if (!isIsoDayString(raw)) return '';

  const [yearRaw, monthRaw, dayRaw] = raw.split('-');
  let year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);

  if (year >= 2400 && year <= 2700) {
    year -= 543;
  }

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return '';

  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return '';
  }

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function timingSafeHexEqual(leftHex, rightHex) {
  try {
    const left = Buffer.from(String(leftHex || ''), 'hex');
    const right = Buffer.from(String(rightHex || ''), 'hex');
    if (!left.length || !right.length || left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
  } catch (_) {
    return false;
  }
}

function toWholeMetric(value, { nullable = false } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return nullable ? null : 0;
  return Math.round(numeric);
}

function toDecimalMetric(value, { nullable = false, precision = 2, mode = 'round' } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return nullable ? null : 0;
  const factor = 10 ** precision;
  if (mode === 'floor') {
    return Math.floor(numeric * factor) / factor;
  }
  return Math.round(numeric * factor) / factor;
}

function extractUidFromPrivateDocPath(path) {
  const parts = String(path || '').split('/');
  const usersIndex = parts.indexOf('users');
  if (usersIndex === -1 || !parts[usersIndex + 1]) return '';
  return String(parts[usersIndex + 1] || '').trim();
}

function resolveIncomingTokenHash(token) {
  const normalized = String(token || '').trim();
  if (/^[a-f0-9]{64}$/i.test(normalized)) {
    return normalized.toLowerCase();
  }
  return sha256Hex(normalized);
}

exports.appleHealthImport = onRequest(
  {
    region: 'us-central1'
  },
  async (req, res) => {
    if (withCors(req, res)) return;
    if (req.method !== 'POST') {
      return jsonResponse(res, 405, { ok: false, error: 'method_not_allowed' });
    }

    try {
      let uid = String(req.body?.uid || '').trim();
      const debugMode = req.body?.debug === true || req.query?.debug === '1' || String(req.headers['x-apple-health-debug'] || '') === '1';
      const rawDate = String(req.body?.date || '').trim();
      const date = normalizeImportedDayString(rawDate);
      const metrics = req.body?.metrics && typeof req.body.metrics === 'object' ? req.body.metrics : {};
      const authHeader = String(req.headers.authorization || '');
      const tokenMatch = authHeader.match(/^Bearer\s+(.+)$/i);
      const token = tokenMatch?.[1]?.trim() || '';

      if (!date) {
        return jsonResponse(res, 400, { ok: false, error: 'invalid_date' });
      }
      if (!token) {
        return jsonResponse(res, 401, { ok: false, error: 'missing_token' });
      }

      const db = admin.firestore();
      const incomingHash = resolveIncomingTokenHash(token);
      const debug = debugMode ? {
        appArtifactId: APP_ARTIFACT_ID,
        providedUid: uid || null,
        tokenLength: token.length,
        incomingHash,
        rawDate,
        normalizedDate: date
      } : null;

      if (!uid) {
        let resolvedUid = '';
        const tokenMapRef = db.doc(`artifacts/${APP_ARTIFACT_ID}/appleHealthImportTokens/${incomingHash}`);
        const tokenMapSnap = await tokenMapRef.get();
        if (debug) {
          debug.tokenMapPath = tokenMapRef.path;
          debug.tokenMapExists = tokenMapSnap.exists;
          debug.tokenMapUid = tokenMapSnap.exists ? String(tokenMapSnap.data()?.uid || '') : '';
        }
        if (tokenMapSnap.exists) {
          resolvedUid = String(tokenMapSnap.data()?.uid || '').trim();
        }

        if (!resolvedUid) {
          try {
            const tokenQuery = await db
              .collectionGroup('private')
              .where('tokenHash', '==', incomingHash)
              .limit(1)
              .get();

            if (debug) {
              debug.privateMatchCount = tokenQuery.size;
              debug.privateMatchPath = tokenQuery.empty ? '' : String(tokenQuery.docs[0]?.ref?.path || '');
            }

            if (!tokenQuery.empty) {
              resolvedUid = extractUidFromPrivateDocPath(tokenQuery.docs[0]?.ref?.path);
              if (resolvedUid) {
                await tokenMapRef.set({
                  uid: resolvedUid,
                  source: 'server_repair',
                  updatedAt: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
              }
            }
          } catch (repairError) {
            console.warn('appleHealthImport token repair failed', repairError);
          }
        }

        if (!resolvedUid) {
          return jsonResponse(res, 403, debug ? { ok: false, error: 'invalid_token', debug } : { ok: false, error: 'invalid_token' });
        }

        uid = resolvedUid;
        if (!uid) {
          return jsonResponse(res, 500, debug ? { ok: false, error: 'uid_resolution_failed', debug } : { ok: false, error: 'uid_resolution_failed' });
        }
      } else {
        const tokenRef = db.doc(`artifacts/${APP_ARTIFACT_ID}/users/${uid}/private/appleHealthImport`);
        const tokenSnap = await tokenRef.get();
        const tokenHash = String(tokenSnap.data()?.tokenHash || '').trim();
        if (debug) {
          debug.directTokenRefPath = tokenRef.path;
          debug.directTokenHash = tokenHash;
        }
        if (!tokenHash) {
          return jsonResponse(res, 403, debug ? { ok: false, error: 'token_not_configured', debug } : { ok: false, error: 'token_not_configured' });
        }

        if (!timingSafeHexEqual(incomingHash, tokenHash)) {
          return jsonResponse(res, 403, debug ? { ok: false, error: 'invalid_token', debug } : { ok: false, error: 'invalid_token' });
        }
      }

      const payload = {
        date,
        steps: toWholeMetric(metrics.steps),
        activeKcal: toDecimalMetric(metrics.activeKcal, { precision: 1, mode: 'floor' }),
        restingKcal: toDecimalMetric(metrics.restingKcal, { precision: 1, mode: 'floor' }),
        exerciseMinutes: toWholeMetric(metrics.exerciseMinutes),
        distanceKm: toDecimalMetric(metrics.distanceKm, { precision: 2 }),
        heartRateAvg: toWholeMetric(metrics.heartRateAvg),
        standHours: toWholeMetric(metrics.standHours, { nullable: true }),
        source: 'apple_shortcuts',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      const healthRef = db.doc(`artifacts/${APP_ARTIFACT_ID}/users/${uid}/healthDaily/${date}`);
      await healthRef.set(payload, { merge: true });

      return jsonResponse(res, 200, { ok: true, date });
    } catch (error) {
      console.error('appleHealthImport failed', error);
      return jsonResponse(res, 500, {
        ok: false,
        error: 'internal_error'
      });
    }
  }
);

exports.claimExclusiveSession = onRequest(
  {
    region: 'us-central1'
  },
  async (req, res) => {
    if (withCors(req, res)) return;
    if (req.method !== 'POST') {
      return jsonResponse(res, 405, { ok: false, error: 'method_not_allowed' });
    }

    try {
      const token = readBearerToken(req);
      if (!token) {
        return jsonResponse(res, 401, { ok: false, error: 'missing_token' });
      }

      const decoded = await admin.auth().verifyIdToken(token);
      const uid = normalizeSessionString(decoded?.uid, 128);
      const authTime = Number(decoded?.auth_time || 0);
      const deviceId = normalizeSessionString(req.body?.deviceId, 160);
      const platform = normalizeSessionString(req.body?.platform, 80);
      const deviceLabel = normalizeSessionString(req.body?.deviceLabel, 120);
      const previewOnly = req.body?.previewOnly === true;

      if (!uid || !Number.isFinite(authTime) || authTime <= 0) {
        return jsonResponse(res, 401, { ok: false, error: 'invalid_token' });
      }
      if (!deviceId) {
        return jsonResponse(res, 400, { ok: false, error: 'missing_device_id' });
      }

      const sessionRef = getUserAuthSessionRef(uid);
      const claimResult = await admin.firestore().runTransaction(async (tx) => {
        const snap = await tx.get(sessionRef);
        const current = snap.exists ? (snap.data() || {}) : {};
        const currentMinAuthTime = Number(current.minAuthTime || 0);
        const currentDeviceId = normalizeSessionString(current.activeDeviceId, 160);

        if (currentMinAuthTime > authTime) {
          return {
            ok: false,
            error: 'stale_session',
            activeDeviceId: currentDeviceId || null,
            activeDeviceLabel: normalizeSessionString(current.deviceLabel, 120) || null,
            minAuthTime: currentMinAuthTime || 0
          };
        }

        const currentDeviceLabel = normalizeSessionString(current.deviceLabel, 120);
        const wouldTakeOver = Boolean(currentDeviceId && currentDeviceId !== deviceId);

        if (previewOnly) {
          return {
            ok: true,
            previewOnly: true,
            wouldTakeOver,
            activeDeviceId: currentDeviceId || null,
            activeDeviceLabel: currentDeviceLabel || null,
            minAuthTime: currentMinAuthTime || 0,
            version: Number(current.version || 0) || 0
          };
        }

        const version = (Number(current.version || 0) || 0) + 1;
        const tookOver = wouldTakeOver;
        const payload = {
          activeDeviceId: deviceId,
          minAuthTime: authTime,
          version,
          lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
          claimedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

        if (!snap.exists) {
          payload.createdAt = admin.firestore.FieldValue.serverTimestamp();
        }
        if (platform) {
          payload.platform = platform;
        }
        if (deviceLabel) {
          payload.deviceLabel = deviceLabel;
        }

        tx.set(sessionRef, payload, { merge: true });

        return {
          ok: true,
          deviceId,
          authTime,
          version,
          tookOver,
          previousDeviceId: tookOver ? currentDeviceId : null
        };
      });

      if (!claimResult.ok) {
        return jsonResponse(res, 409, claimResult);
      }

      if (claimResult.tookOver) {
        await admin.auth().revokeRefreshTokens(uid);
        claimResult.reauthCustomToken = await admin.auth().createCustomToken(uid);
        claimResult.revokedOtherSessions = true;
      } else {
        claimResult.revokedOtherSessions = false;
      }

      return jsonResponse(res, 200, claimResult);
    } catch (error) {
      if (String(error?.code || '').startsWith('auth/')) {
        return jsonResponse(res, 401, { ok: false, error: 'invalid_token' });
      }
      console.error('claimExclusiveSession failed', error);
      return jsonResponse(res, 500, { ok: false, error: 'internal_error' });
    }
  }
);

exports.fatsecretSearch = onRequest(
  {
    region: 'us-central1',
    secrets: [FATSECRET_CONSUMER_KEY, FATSECRET_CONSUMER_SECRET]
  },
  async (req, res) => {
    if (withCors(req, res)) return;
    if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'method_not_allowed' });

    const q = String(req.body?.q || '').trim();
    const page = Math.max(0, Number(req.body?.page || 0) || 0);
    const maxResults = Math.min(50, Math.max(1, Number(req.body?.maxResults || 20) || 20));

    if (q.length < 2) {
      return jsonResponse(res, 200, { items: [], meta: { query: q, page, maxResults } });
    }

    const creds = getFatSecretConsumerCreds();
    if (!creds.key || !creds.secret) {
      return jsonResponse(res, 500, {
        error: 'missing_fatsecret_credentials',
        message: 'FatSecret ключи не настроены на сервере.'
      });
    }

    const quota = await checkAndIncrementQuota(1);
    if (!quota.allowed) {
      return jsonResponse(res, 429, {
        error: 'quota_exhausted',
        message: 'Сегодня лимит запросов к базе исчерпан. Попробуйте снова завтра.',
        quota
      });
    }

    try {
      const json = await fatsecretCall({
        methodName: 'foods.search',
        extraParams: {
          search_expression: q,
          page_number: page,
          max_results: maxResults
        },
        consumerKey: creds.key,
        consumerSecret: creds.secret
      });

      const foods = json?.foods?.food;
      const list = Array.isArray(foods) ? foods : (foods ? [foods] : []);
      const totalResults = Number(json?.foods?.total_results ?? 0) || 0;

      return jsonResponse(res, 200, {
        items: list.map((f) => ({
          id: f.food_id,
          name: f.food_name,
          description: f.food_description,
          brand: f.brand_name || null,
          type: f.food_type || null,
          url: f.food_url || null
        })),
        quota,
        meta: { query: q, page, maxResults, totalResults }
      });
    } catch (e) {
      console.error('fatsecretSearch error', e);
      return jsonResponse(res, 502, {
        error: 'upstream_error',
        message: 'Не удалось получить данные из базы. Попробуйте позже.',
        details: e?.code ? { code: e.code } : undefined
      });
    }
  }
);

exports.fatsecretFoodGet = onRequest(
  {
    region: 'us-central1',
    secrets: [FATSECRET_CONSUMER_KEY, FATSECRET_CONSUMER_SECRET]
  },
  async (req, res) => {
    if (withCors(req, res)) return;
    if (req.method !== 'POST') return jsonResponse(res, 405, { error: 'method_not_allowed' });

    const foodId = String(req.body?.foodId || '').trim();
    if (!foodId) return jsonResponse(res, 400, { error: 'bad_request', message: 'foodId is required' });

    const creds = getFatSecretConsumerCreds();
    if (!creds.key || !creds.secret) {
      return jsonResponse(res, 500, {
        error: 'missing_fatsecret_credentials',
        message: 'FatSecret ключи не настроены на сервере.'
      });
    }

    const quota = await checkAndIncrementQuota(1);
    if (!quota.allowed) {
      return jsonResponse(res, 429, {
        error: 'quota_exhausted',
        message: 'Сегодня лимит запросов к базе исчерпан. Попробуйте снова завтра.',
        quota
      });
    }

    try {
      const json = await fatsecretCall({
        methodName: 'food.get.v2',
        extraParams: { food_id: foodId },
        consumerKey: creds.key,
        consumerSecret: creds.secret
      });

      const food = json?.food;
      return jsonResponse(res, 200, { food, quota });
    } catch (e) {
      console.error('fatsecretFoodGet error', e);
      return jsonResponse(res, 502, {
        error: 'upstream_error',
        message: 'Не удалось получить детали продукта. Попробуйте позже.',
        details: e?.code ? { code: e.code } : undefined
      });
    }
  }
);

