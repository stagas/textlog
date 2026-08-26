;(() => {
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
  const forYou = preferenceInputs.find(input => input.name === 'forYou')
  const onlyToMe = preferenceInputs.find(input => input.name === 'onlyToMe')
  const forYouDependents = preferenceInputs.filter(input =>
    ['onlyToMe', 'peopleFollowActivity', 'hashtagFollowActivity'].includes(input.name))
  const handle = script.dataset.handle

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
  const preferenceValues = () => {
    return { ...Object.fromEntries(preferenceInputs
      .filter(input => input.name !== 'onlyToMe' && input.name !== 'forYou')
      .map(input => [input.name, input.checked])), followingNotes: forYou.checked, replies: forYou.checked,
      mentions: forYou.checked, follows: forYou.checked, followActivity: forYou.checked && !onlyToMe.checked,
      peopleFollowActivity: forYou.checked && !onlyToMe.checked
        && preferenceInputs.find(input => input.name === 'peopleFollowActivity').checked,
      hashtagFollowActivity: forYou.checked && !onlyToMe.checked
        && preferenceInputs.find(input => input.name === 'hashtagFollowActivity').checked,
      followingOnlyToMe: onlyToMe.checked }
  }
  const syncForYou = () => {
    for (const input of forYouDependents) input.disabled = !forYou.checked
  }
  const save = (subscription, includePreferences = true) =>
    fetch('/account/push-subscription', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...subscription.toJSON(),
        ...(includePreferences ? { preferences: preferenceValues() } : {}) }),
    })
  const loadPreferences = async subscription => {
    const response = await fetch('/account/push-subscription?endpoint=' + encodeURIComponent(subscription.endpoint))
    if (!response.ok) throw new Error('Could not load preferences')
    const result = await response.json()
    const saved = result.preferences
    for (const input of preferenceInputs) {
      input.checked = input.name === 'forYou'
        ? saved.followingNotes !== 0 || saved.replies !== 0 || saved.mentions !== 0
          || saved.follows !== 0 || saved.followActivity !== 0
        : input.name === 'onlyToMe'
        ? saved.followingOnlyToMe !== 0
        : saved[input.name] !== 0
    }
    syncForYou()
    return result.enabled === true
  }

  forYou.addEventListener('change', syncForYou)

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

  navigator.serviceWorker.getRegistration('/').then(async registration => {
    if (!registration) return undefined
    await registration.update()
    return registration.pushManager.getSubscription()
  })
    .then(async subscription => {
      if (subscription) {
        const enabled = await loadPreferences(subscription)
        if (enabled) {
          const response = await save(subscription, false)
          if (!response.ok) throw new Error('Could not save subscription')
          setState(`Notifications enabled for @${handle} on this browser.`, true)
        }
        else setActions(false)
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
      await navigator.serviceWorker.register('/sw.js', { scope: '/' })
      // register() resolves once the worker has been registered, which may be
      // before its first install has activated. Push subscription requires an
      // active worker, so wait for the registration controlling this page.
      const registration = await navigator.serviceWorker.ready
      const existing = await registration.pushManager.getSubscription()
      const subscription = existing || await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey(publicKey),
      })
      const response = await save(subscription)
      if (!response.ok) throw new Error('Could not save subscription')
      setState(`Notifications enabled for @${handle} on this browser.`, true)
    }
    catch (error) {
      console.error('Could not enable notifications', error)
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
      status.textContent = `Notification preferences saved for @${handle}.`
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
        const result = await response.json()
        if (!result.active) await subscription.unsubscribe()
      }
      disable.removeAttribute('aria-disabled')
      setState(`Notifications disabled for @${handle} on this browser.`, false)
      enable.disabled = false
    }
    catch {
      setState('Notifications could not be disabled. Please try again.', true)
      disable.removeAttribute('aria-disabled')
    }
  })
})()
