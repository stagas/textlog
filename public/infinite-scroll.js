(() => {
  const sentinelSelector = '[data-feed-next]'
  let loading = false
  let chunkController = null
  let navigationController = null

  const loadedThrough = () => Math.max(0, ...[...document.querySelectorAll('[data-feed-chunk]')]
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

  const navigateFeed = async (href, push) => {
    const currentView = document.querySelector('[data-feed-view]')
    if (!currentView) {
      location.href = href
      return
    }
    navigationController?.abort()
    navigationController = new AbortController()
    currentView.setAttribute('aria-busy', 'true')
    try {
      const response = await fetch(href, {
        headers: { Accept: 'text/html', 'X-Textlog-Feed-Navigation': '1' },
        credentials: 'same-origin',
        signal: navigationController.signal,
      })
      if (!response.ok) throw new Error(`Feed navigation failed: ${response.status}`)
      const parsed = new DOMParser().parseFromString(await response.text(), 'text/html')
      const incomingView = parsed.querySelector('[data-feed-view]')
      if (!incomingView) throw new Error('Feed navigation response did not contain a feed')
      chunkController?.abort()
      observer.disconnect()
      loading = false
      currentView.replaceWith(incomingView)
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
  }

  document.addEventListener('click', event => {
    const link = event.target.closest('.feed-tabs a[href]')
    if (!link || link.classList.contains('feed-tabs-top') || event.defaultPrevented || event.button !== 0
      || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || link.target || link.download) return
    const url = new URL(link.href)
    if (url.origin !== location.origin) return
    event.preventDefault()
    void navigateFeed(url.href, true)
  })

  addEventListener('popstate', () => void navigateFeed(location.href, false))

  void restore()
})()
