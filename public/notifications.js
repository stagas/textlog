(() => {
  const script = document.currentScript
  const publicKey = script.dataset.vapidPublicKey
  const status = document.getElementById('notification-status')
  const enable = document.getElementById('enable-notifications')
  const disable = document.getElementById('disable-notifications')
  const savePreferences = document.getElementById('save-notification-preferences')
  const preferences = document.getElementById('notification-preferences')
  const preferenceForm = document.getElementById('notification-preference-form')
  const preferenceHint = document.getElementById('notification-preference-hint')
  const preferenceInputs = [...preferences.querySelectorAll('input')]

  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  const setActions = enabled => {
    enable.hidden = enabled
    savePreferences.hidden = !enabled
    disable.hidden = !enabled
  }
  const setState = (message, enabled) => {
    status.textContent = message
    status.hidden = false
    setActions(enabled)
    preferences.disabled = !enabled
    preferences.hidden = !enabled
    preferenceHint.hidden = !enabled
  }
  const applicationServerKey = value => {
    const padding = '='.repeat((4 - value.length % 4) % 4)
    const bytes = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'))
    return Uint8Array.from(bytes, character => character.charCodeAt(0))
  }
  const preferenceValues = () => Object.fromEntries(preferenceInputs.map(input => [input.name, input.checked]))
  const save = (subscription, includePreferences = true) => fetch('/account/push-subscription', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...subscription.toJSON(), ...(includePreferences ? { preferences: preferenceValues() } : {}) }),
  })
  const loadPreferences = async subscription => {
    const response = await fetch('/account/push-subscription?endpoint=' + encodeURIComponent(subscription.endpoint))
    if (!response.ok) throw new Error('Could not load preferences')
    const saved = (await response.json()).preferences
    for (const input of preferenceInputs) input.checked = saved[input.name] !== 0
  }

  if (!supported) {
    enable.disabled = true
    setState('Notifications are unsupported in this browser.', false)
    enable.hidden = true
    return
  }
  if (Notification.permission === 'denied') {
    enable.disabled = true
    setState('Notification permission was denied. Change it in your browser settings to continue.', false)
    enable.hidden = true
    return
  }

  navigator.serviceWorker.getRegistration('/').then(registration => registration?.pushManager.getSubscription())
    .then(async subscription => {
      if (subscription) {
        await loadPreferences(subscription)
        const response = await save(subscription, false)
        if (!response.ok) throw new Error('Could not save subscription')
        setState('Notifications enabled on this browser.', true)
      }
      else setActions(false)
    }).catch(() => setActions(false))

  enable.addEventListener('click', async () => {
    enable.disabled = true
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setState('Notification permission was denied.', false)
        return
      }
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
      const existing = await registration.pushManager.getSubscription()
      const subscription = existing || await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey(publicKey),
      })
      const response = await save(subscription)
      if (!response.ok) throw new Error('Could not save subscription')
      setState('Notifications enabled on this browser.', true)
    }
    catch {
      setState('Notifications could not be enabled. Please try again.', false)
      enable.disabled = false
    }
  })

  preferenceForm.addEventListener('submit', async event => {
    event.preventDefault()
    savePreferences.disabled = true
    try {
      const registration = await navigator.serviceWorker.getRegistration('/')
      const subscription = await registration?.pushManager.getSubscription()
      if (!subscription || !(await save(subscription)).ok) throw new Error('Could not save preferences')
      status.textContent = 'Notification preferences saved.'
    }
    catch {
      status.textContent = 'Preferences could not be saved. Please try again.'
    }
    finally {
      savePreferences.disabled = false
    }
  })

  disable.addEventListener('click', async event => {
    event.preventDefault()
    disable.setAttribute('aria-disabled', 'true')
    try {
      const registration = await navigator.serviceWorker.getRegistration('/')
      const subscription = await registration?.pushManager.getSubscription()
      if (subscription) {
        const response = await fetch('/account/push-subscription', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        })
        if (!response.ok) throw new Error('Could not remove subscription')
        await subscription.unsubscribe()
      }
      disable.removeAttribute('aria-disabled')
      setState('Notifications disabled on this browser.', false)
      enable.disabled = false
    }
    catch {
      setState('Notifications could not be disabled. Please try again.', true)
      disable.removeAttribute('aria-disabled')
    }
  })
})()
