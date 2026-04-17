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

