self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {}
  event.waitUntil(self.registration.showNotification(data.title || 'textlog', {
    body: data.body || '',
    data: { url: data.url || '/' },
  }))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  event.waitUntil(self.clients.openWindow(event.notification.data?.url || '/'))
})
