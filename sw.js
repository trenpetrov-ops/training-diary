// ============================================================
// 🟢 Service Worker: установка и активация
// ============================================================
self.addEventListener('install', event => {
  console.log('🟢 Service Worker установлен');
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  console.log('✅ Service Worker активирован');
});


// ============================================================
// 🔔 Обработка push (на будущее, если появится серверная отправка)
// ============================================================
self.addEventListener('push', event => {
  const data = event.data?.json() || { title: "Напоминание 💊", body: "Время принять добавки" };
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/training-diary/icons/icon-192.png' // ✅ путь исправлен
    })
  );
});


// ============================================================
// 👆 Обработка клика по уведомлению (важно для перехода в приложение)
// ============================================================
self.addEventListener('notificationclick', event => {
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientsArr => {
      const client = clientsArr.find(c =>
        c.url.includes('training-diary') && 'focus' in c
      );

      if (client) {
        // 🔹 Отправляем сообщение в клиент (PWA)
        client.postMessage({ type: 'OPEN_SUPPLEMENTS_MODAL' });
        return client.focus();
      }

      // 🔹 Если приложение не открыто — открыть его
      return clients.openWindow('/training-diary/?open=supplements'); // ✅ путь исправлен
    })
  );
});
