// ============================================================
// 🌐 Чистый Service Worker для PWA без уведомлений
// ============================================================

const CACHE_NAME = 'training-diary-v1';
const CACHE_URLS = [
  '/training-diary/',
  '/training-diary/index.html',
  '/training-diary/manifest.json',
  '/training-diary/styles.css',
  '/training-diary/script.js',
  '/training-diary/icons/icon-192.png',
  '/training-diary/icons/icon-512.png'
];

// Установка и кэширование файлов
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(CACHE_URLS))
  );
  console.log('✅ Service Worker установлен и ресурсы закэшированы');
});

// Активация и очистка старого кеша
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(key => key !== CACHE_NAME && caches.delete(key)))
    )
  );
  console.log('🧹 Старые кеши удалены');
});

// Обработка запросов: сначала сеть, потом кеш
self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
