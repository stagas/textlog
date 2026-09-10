;(() => {
  document.documentElement.classList.add('feed-thread-expansion-enabled')
  const sentinelSelector = '[data-feed-next]'
  let loading = false
  let chunkController = null
  let navigationController = null
  let navigationSpinnerTimer = null
  let navigationSpinner = null
  let heldLiveTab = null
  let heldLiveCount = 0
  const liveCounts = { 'to-me': 0, 'for-you': 0, latest: 0, new: 0 }
  const serverCounts = { 'to-me': 0, 'for-you': 0, latest: 0, new: 0 }
  const pendingLiveTabs = new Set()
  const dingEnabled = document.querySelector('meta[name="textlog-new-message-sound"]')?.content !== 'off'
  const ding = dingEnabled ? new Audio('/ding.mp3') : null
  if (ding) ding.preload = 'auto'
  let dingUnlocked = false
  const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

  const unlockDing = () => {
    if (!ding || dingUnlocked) return
    const previousVolume = ding.volume
    ding.volume = 0
    const started = ding.play()
    if (!started) return
    void started.then(() => {
      ding.pause()
      ding.currentTime = 0
      ding.volume = previousVolume
      dingUnlocked = true
      removeEventListener('pointerdown', unlockDing)
      removeEventListener('keydown', unlockDing)
      removeEventListener('touchend', unlockDing)
    }).catch(() => {
      ding.volume = previousVolume
    })
  }

  addEventListener('pointerdown', unlockDing)
  addEventListener('keydown', unlockDing)
  addEventListener('touchend', unlockDing)

  const playBackgroundDing = () => {
    if (!ding || document.visibilityState === 'visible' && document.hasFocus()) return
    ding.currentTime = 0
    void ding.play().catch(() => {})
  }

  const startNavigationSpinner = tab => {
    clearInterval(navigationSpinnerTimer)
    navigationSpinner?.remove()
    const owner = tab || document.querySelector('.feed-tabs a.active')
    if (!owner) return
    const spinner = document.createElement('span')
    spinner.className = 'feed-tab-loading'
    spinner.setAttribute('role', 'status')
    spinner.setAttribute('aria-label', 'Loading feed')
    owner.append(spinner)
    navigationSpinner = spinner
    let frame = 0
    const render = () => {
      spinner.textContent = spinnerFrames[frame]
      frame = (frame + 1) % spinnerFrames.length
    }
    render()
    navigationSpinnerTimer = setInterval(render, 80)
  }

  const stopNavigationSpinner = () => {
    clearInterval(navigationSpinnerTimer)
    navigationSpinnerTimer = null
    navigationSpinner?.remove()
    navigationSpinner = null
  }

  const liveTabSelectors = { 'to-me': 'a[href="/@"]', 'for-you': 'a[href="/my-feed"]',
    latest: 'a[href="/all"]', new: 'a[href="/new"]' }
  const activeLiveTab = () =>
    Object.entries(liveTabSelectors)
      .find(([, selector]) => document.querySelector(`.feed-tabs ${selector}.active`))?.[0]
  const liveTabKind = tab =>
    Object.entries(liveTabSelectors).find(([, selector]) => tab?.matches(selector))?.[0]

  const syncLiveCountsFromDocument = () => {
    const values = document.querySelector('[data-feed-view] [data-live-counts]')?.dataset.liveCounts?.split(':')
      .map(Number)
    if (!values || values.length !== 4) return
    ;[liveCounts['to-me'], liveCounts['for-you'], liveCounts.latest, liveCounts.new] = values
    ;[serverCounts['to-me'], serverCounts['for-you'], serverCounts.latest, serverCounts.new] = values
  }

  const renderLiveCount = (kind, count) => {
    const tab = document.querySelector(`.feed-tabs ${liveTabSelectors[kind]}`)
    if (!tab) return
    const current = tab.querySelector('.to-me-count')
    if (count <= 0) {
      current?.remove()
      return
    }
    const badge = current || document.createElement('span')
    badge.className = 'to-me-count'
    badge.textContent = count >= 99 ? '99+' : String(count)
    if (!current) tab.append(badge)
  }

  const applyLiveCounts = counts => {
    const incoming = {
      'to-me': Number(counts.toMeCount) || 0,
      'for-you': Number(counts.forYouCount) || 0,
      latest: Number(counts.latestCount) || 0,
      new: Number(counts.newCount) || 0,
    }
    const authoritative = { ...incoming }
    if (heldLiveTab) {
      heldLiveCount += Math.max(0, incoming[heldLiveTab] - serverCounts[heldLiveTab])
      incoming[heldLiveTab] = heldLiveCount
    }
    Object.entries(incoming).forEach(([kind, count]) => {
      serverCounts[kind] = authoritative[kind]
      liveCounts[kind] = count
      if (count === 0) pendingLiveTabs.delete(kind)
      renderLiveCount(kind, count)
    })
    const baseTitle = document.title.replace(/^•\s*/, '')
    document.title = liveCounts['to-me'] > 0 || liveCounts['for-you'] > 0 ? `• ${baseTitle}` : baseTitle
  }

  const reconcileLiveCounts = async () => {
    try {
      const response = await fetch('/feed/counts', { credentials: 'same-origin', cache: 'no-store' })
      if (!response.ok) return
      applyLiveCounts(await response.json())
      renderNewPostsBanner()
    }
    catch {}
  }

  const renderNewPostsBanner = () => {
    document.querySelector('[data-new-posts-banner]')?.remove()
    const active = activeLiveTab()
    if (!active || !pendingLiveTabs.has(active)) return
    const tabs = document.querySelector('.feed-tabs')
    if (!tabs) return
    const banner = document.createElement('div')
    banner.className = 'feed-read-action'
    banner.dataset.newPostsBanner = ''
    const button = document.createElement('button')
    button.className = 'activity-side-link'
    button.type = 'button'
    button.textContent = 'show new notes'
    banner.addEventListener('click', () => {
      const active = activeLiveTab()
      if (active) {
        heldLiveTab = active
        heldLiveCount = liveCounts[active]
      }
      const target = new URL(location.href)
      target.hash = ''
      history.replaceState(history.state, '', target.pathname + target.search)
      void navigateFeed(target.href, false, tabs.querySelector('a.active'), true)
    })
    banner.append(button)
    tabs.after(banner)
  }

  const loadedThrough = () =>
    Math.max(0, ...[...document.querySelectorAll('[data-feed-chunk]')]
      .map(element => Number(element.dataset.feedChunk) || 0))

  const rememberLoadedChunks = () => {
    const url = new URL(location.href)
    url.searchParams.delete('_feed_chunk')
    const loaded = loadedThrough()
    if (loaded > 1) url.searchParams.set('chunk', String(loaded))
    else url.searchParams.delete('chunk')
    history.replaceState(history.state, '', url)
  }

  const appendNext = async sentinel => {
    if (!sentinel || loading) return null
    loading = true
    chunkController = new AbortController()
    observer.unobserve(sentinel)
    try {
      const url = new URL(location.href)
      url.searchParams.set('_feed_chunk', sentinel.dataset.feedNext)
      const response = await fetch(url, {
        headers: { Accept: 'text/html', 'X-Textlog-Feed-Chunk': '1' },
        credentials: 'same-origin',
        signal: chunkController.signal,
      })
      if (!response.ok) throw new Error(`Feed chunk request failed: ${response.status}`)
      const template = document.createElement('template')
      template.innerHTML = await response.text()
      const fragment = template.content
      const next = fragment.querySelector(sentinelSelector)
      sentinel.replaceWith(fragment)
      rememberLoadedChunks()
      return next
    }
    catch {
      return null
    }
    finally {
      loading = false
      chunkController = null
    }
  }

  const observer = new IntersectionObserver(async entries => {
    const sentinel = entries.find(entry => entry.isIntersecting)?.target
    const next = await appendNext(sentinel)
    if (next) observer.observe(next)
  }, { rootMargin: '1000px 0px' })

  const restore = async () => {
    const requested = Number(new URL(location.href).searchParams.get('chunk'))
    const target = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), 5) : 1
    let loaded = loadedThrough()
    let sentinel = document.querySelector(sentinelSelector)
    while (sentinel && loaded < target) {
      sentinel = await appendNext(sentinel)
      if (!sentinel && loadedThrough() < target) return
      loaded = loadedThrough()
    }
    if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView()
    if (sentinel) observer.observe(sentinel)
  }

  const syncComposerNavigation = parsed => {
    const current = document.querySelector('.embedded-write-compose')?.closest('form')
    const incoming = parsed.querySelector('.embedded-write-compose')?.closest('form')
    if (!current || !incoming) return
    current.action = incoming.action
    const currentFrom = current.querySelector('input[name="from"]')
    const incomingFrom = incoming.querySelector('input[name="from"]')
    if (currentFrom && incomingFrom) currentFrom.value = incomingFrom.value
    const currentActions = current.querySelectorAll('[formaction]')
    const incomingActions = incoming.querySelectorAll('[formaction]')
    currentActions.forEach((action, index) => {
      if (incomingActions[index]) action.setAttribute('formaction', incomingActions[index].getAttribute('formaction'))
    })
  }

  const navigateFeed = async (href, push, tab = null, markRead = true) => {
    const currentView = document.querySelector('[data-feed-view]')
    if (!currentView) {
      location.href = href
      return
    }
    navigationController?.abort()
    if (push) {
      heldLiveTab = tab?.classList.contains('active') ? null : liveTabKind(tab) || null
      heldLiveCount = heldLiveTab ? liveCounts[heldLiveTab] : 0
    }
    const controller = new AbortController()
    navigationController = controller
    currentView.setAttribute('aria-busy', 'true')
    startNavigationSpinner(tab)
    const spinnerStartedAt = performance.now()
    try {
      const response = await fetch(href, {
        headers: {
          Accept: 'text/html',
          'X-Textlog-Feed-Navigation': '1',
          ...(markRead ? { 'X-Textlog-Explicit-Read': '1' } : { 'X-Textlog-Live-Refresh': '1' }),
        },
        credentials: 'same-origin',
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`Feed navigation failed: ${response.status}`)
      const parsed = new DOMParser().parseFromString(await response.text(), 'text/html')
      const incomingView = parsed.querySelector('[data-feed-view]')
      if (!incomingView) throw new Error('Feed navigation response did not contain a feed')
      const spinnerRemaining = 240 - (performance.now() - spinnerStartedAt)
      if (spinnerRemaining > 0) await new Promise(resolve => setTimeout(resolve, spinnerRemaining))
      if (controller.signal.aborted) return
      chunkController?.abort()
      observer.disconnect()
      loading = false
      currentView.replaceWith(incomingView)
      pendingLiveTabs.delete(activeLiveTab())
      syncLiveCountsFromDocument()
      if (heldLiveTab && heldLiveTab === activeLiveTab()) {
        liveCounts[heldLiveTab] = heldLiveCount
        renderLiveCount(heldLiveTab, heldLiveCount)
      }
      if (markRead) await reconcileLiveCounts()
      syncComposerNavigation(parsed)
      document.title = parsed.title
      const resolved = new URL(response.url)
      if (push) history.pushState({ feed: true }, '', resolved.pathname + resolved.search + resolved.hash)
      scrollTo({ top: 0, behavior: 'instant' })
      void restore()
    }
    catch (error) {
      if (error.name === 'AbortError') return
      location.href = href
    }
    finally {
      if (navigationController === controller) stopNavigationSpinner()
    }
  }

  const expandCompleteThread = async link => {
    const thread = link.closest('.feed-thread')
    if (!thread || thread.getAttribute('aria-busy') === 'true') return
    thread.setAttribute('aria-busy', 'true')
    try {
      const response = await fetch(link.href, {
        headers: { Accept: 'text/html', 'X-Textlog-Feed-Expansion': '1' },
        credentials: 'same-origin',
      })
      if (!response.ok) throw new Error(`Thread expansion failed: ${response.status}`)
      const template = document.createElement('template')
      template.innerHTML = await response.text()
      const expanded = template.content.querySelector('.feed-thread')
      if (!expanded) throw new Error('Thread expansion response did not contain a conversation')
      const previousHeight = thread.getBoundingClientRect().height
      const existingPostIds = new Set([...thread.querySelectorAll('.post[id]')].map(post => post.id))
      expanded.querySelectorAll('.post[id]').forEach(post => {
        if (!existingPostIds.has(post.id)) post.classList.add('feed-thread-fetched-post')
      })
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
        thread.replaceWith(expanded)
        return
      }
      expanded.classList.add('feed-thread-expanding')
      thread.replaceWith(expanded)
      const expandedHeight = expanded.getBoundingClientRect().height
      const expansion = expanded.animate([
        { height: `${previousHeight}px` },
        { height: `${expandedHeight}px` },
      ], { duration: 200, easing: 'ease' })
      const finish = () => {
        expanded.classList.remove('feed-thread-expanding')
        expanded.querySelectorAll('.feed-thread-fetched-post')
          .forEach(post => post.classList.remove('feed-thread-fetched-post'))
      }
      expansion.addEventListener('finish', finish, { once: true })
      setTimeout(finish, 320)
    }
    catch {
      location.href = link.href
    }
    finally {
      thread.removeAttribute('aria-busy')
    }
  }

  document.addEventListener('click', event => {
    const continuation = event.target.closest('.feed-thread a.post-continuation-link[href]')
    if (continuation && !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey
      && !event.shiftKey && !event.altKey && !continuation.target && !continuation.download
      && new URL(continuation.href).origin === location.origin)
    {
      event.preventDefault()
      void expandCompleteThread(continuation)
      return
    }
    const link = event.target.closest('.feed-tabs a[href]')
    if (!link || link.classList.contains('feed-tabs-top') || event.defaultPrevented || event.button !== 0
      || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target || link.download) return
    const url = new URL(link.href)
    if (url.origin !== location.origin) return
    event.preventDefault()
    const kind = liveTabKind(link)
    if (link.classList.contains('active') && kind && pendingLiveTabs.has(kind)) {
      heldLiveTab = kind
      heldLiveCount = liveCounts[kind]
      void navigateFeed(url.href, false, link, true)
      return
    }
    void navigateFeed(url.href, true, link, true)
  })

  addEventListener('popstate', () => {
    heldLiveTab = null
    heldLiveCount = 0
    void navigateFeed(location.href, false, null, false)
  })
  syncLiveCountsFromDocument()
  if (performance.getEntriesByType('navigation')[0]?.type === 'reload') void reconcileLiveCounts()
  else {
    heldLiveTab = activeLiveTab() || null
    heldLiveCount = heldLiveTab ? liveCounts[heldLiveTab] : 0
  }
  if (document.querySelector('.feed-tabs a[href="/my-feed"]')) {
    const events = new EventSource('/feed/events')
    events.addEventListener('baseline', event => {
      let counts
      try {
        counts = JSON.parse(event.data)
      }
      catch {
        return
      }
      applyLiveCounts(counts)
    })
    events.addEventListener('feed', event => {
      let counts
      try {
        counts = JSON.parse(event.data)
      }
      catch {
        return
      }
      const incoming = {
        'to-me': Number(counts.toMeCount) || 0,
        'for-you': Number(counts.forYouCount) || 0,
        latest: Number(counts.latestCount) || 0,
        new: Number(counts.newCount) || 0,
      }
      const directedIncrease = incoming['to-me'] > serverCounts['to-me']
      Object.entries(incoming).forEach(([kind, count]) => {
        if (count > serverCounts[kind]) pendingLiveTabs.add(kind)
        if (count === 0) pendingLiveTabs.delete(kind)
      })
      applyLiveCounts(counts)
      if (directedIncrease) playBackgroundDing()
      renderNewPostsBanner()
    })
  }

  void restore()
})()
