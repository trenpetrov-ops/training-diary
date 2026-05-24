const DEFAULT_CACHE_NAME = 'training-diary-dev';
const DEFAULT_PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './styles.css',
  './icons/icon-192.png',
  './icons/icon-512.png'
];
const CACHE_NAME =
  typeof self.__TD_CACHE_NAME__ === 'string' && self.__TD_CACHE_NAME__.trim()
    ? self.__TD_CACHE_NAME__
    : DEFAULT_CACHE_NAME;
const PRECACHE_URLS =
  Array.isArray(self.__TD_PRECACHE_URLS__) && self.__TD_PRECACHE_URLS__.length
    ? self.__TD_PRECACHE_URLS__
    : DEFAULT_PRECACHE_URLS;
const APP_SHELL_URL = './index.html';

function isCacheableResponse(response) {
  return Boolean(response) && response.ok && (response.type === 'basic' || response.type === 'default');
}

async function putInCache(request, response) {
  if (!isCacheableResponse(response)) return response;

  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
  return response;
}

async function fetchAndCache(request) {
  const response = await fetch(request);
  return putInCache(request, response);
}

async function handleNavigationRequest(request) {
  try {
    return await fetchAndCache(request);
  } catch (error) {
    return (
      (await caches.match(request)) ||
      (await caches.match(APP_SHELL_URL)) ||
      (await caches.match('./'))
    );
  }
}

async function handleSameOriginAssetRequest(request) {
  const cached = await caches.match(request);
  if (cached) {
    void fetchAndCache(request).catch(() => {});
    return cached;
  }

  try {
    return await fetchAndCache(request);
  } catch (error) {
    return caches.match(request);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
          return Promise.resolve();
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (!request || request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigationRequest(request));
    return;
  }

  event.respondWith(handleSameOriginAssetRequest(request));
});
