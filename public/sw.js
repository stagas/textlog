self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {}
  event.waitUntil(self.registration.showNotification(data.title || '__APP_NAME__', {
    body: data.body || '',
    icon: '/android-chrome-192x192.png',
    badge: '/notification-badge-96x96.png',
    data: { url: data.url || '/' },
  }))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil(self.clients.openWindow(event.notification.data?.url || '/'))
})
