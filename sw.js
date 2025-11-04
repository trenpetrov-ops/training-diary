// ================================================================
// 🔥 Service Worker для Firebase Messaging + локальные уведомления
// ================================================================

// Импорт Firebase (для Android, Chrome, ПК)
importScripts('https://www.gstatic.com/firebasejs/11.6.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.6.1/firebase-messaging-compat.js');

// Инициализация Firebase
firebase.initializeApp({
  apiKey: "AIzaSyBRh4hOexYttvkts5AcOxi4bg3Yp7-2d90",
  authDomain: "training-diary-51f0f.firebaseapp.com",
  projectId: "training-diary-51f0f",
  storageBucket: "training-diary-51f0f.firebasestorage.app",
  messagingSenderId: "332026731208",
  appId: "1:332026731208:web:3fa953b94700d00349e3fd"
});

const messaging = firebase.messaging();

// ================================================================
// 📦 PUSH из Firebase (для Android / ПК)
// ================================================================
messaging.onBackgroundMessage(payload => {
  console.log('📩 Получено фоновое сообщение:', payload);
  const title = payload.notification?.title || '💊 Напоминание';
  const options = {
    body: payload.notification?.body || 'Пора принять добавки!',
    icon: '/training-diary/icons/icon-192.png'
  };
  self.registration.showNotification(title, options);
});

// ================================================================
// 🔔 ЛОКАЛЬНОЕ уведомление (для iPhone PWA)
// ================================================================
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'LOCAL_NOTIFICATION') {
    const title = '💊 Напоминание';
    const options = {
      body: event.data.body || 'Пора принять добавки!',
      icon: '/training-diary/icons/icon-192.png'
    };
    self.registration.showNotification(title, options);
  }
});
