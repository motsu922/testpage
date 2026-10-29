// ============================================================
// firebase-messaging-sw.js
// GitHub Pages リポジトリのルート（/ 直下）に置いてください
// ============================================================

importScripts('https://www.gstatic.com/firebasejs/10.12.4/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.4/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            "AIzaSyA0YUIpIDh4WB4p1ewiNB0XfwHve0ByljU",
  authDomain:        "abnreport-fd733.firebaseapp.com",
  projectId:         "abnreport-fd733",
  storageBucket:     "abnreport-fd733.firebasestorage.app",
  messagingSenderId: "349748947315",
  appId:             "1:349748947315:web:010cb671d2a95bcf1f7d06"
});

const messaging = firebase.messaging();

// バックグラウンド（画面を閉じていても）通知を受け取る
messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || '品質呼び出し';
  const body  = payload.notification?.body  || '対応をお願いします';

  self.registration.showNotification(title, {
    body,
    tag:      'andon-call', // 同じタグは上書き（通知が積まれない）
    renotify: true,
    data: {
      url: '/testpage/andon-monitor.html'
    }
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || '/testpage/andon-monitor.html', self.location.origin).href;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const existing = windows.find((client) => client.url.startsWith(targetUrl));
      if (existing) return existing.focus();
      return clients.openWindow(targetUrl);
    })
  );
});
