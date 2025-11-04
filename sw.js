// sw.js
self.addEventListener('install', event => {
  console.log('🟢 Service Worker установлен');
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  console.log('✅ Service Worker активирован');
});

// 🔔 Обработка push (если потом добавишь серверные уведомления)
self.addEventListener('push', event => {
  const data = event.data?.json() || { title: "Напоминание 💊", body: "Время принять добавки" };
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png'
    })
  );
});
