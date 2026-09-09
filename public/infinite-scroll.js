(() => {
  document.documentElement.classList.add('feed-thread-expansion-enabled')
  const sentinelSelector = '[data-feed-next]'
  let loading = false
  let chunkController = null
  let navigationController = null
  let navigationSpinnerTimer = null
  let navigationSpinner = null
  const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

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

  const navigateFeed = async (href, push, tab = null) => {
    const currentView = document.querySelector('[data-feed-view]')
    if (!currentView) {
      location.href = href
      return
    }
    navigationController?.abort()
    const controller = new AbortController()
    navigationController = controller
    currentView.setAttribute('aria-busy', 'true')
    startNavigationSpinner(tab)
    const spinnerStartedAt = performance.now()
    try {
      const response = await fetch(href, {
        headers: { Accept: 'text/html', 'X-Textlog-Feed-Navigation': '1' },
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
      && new URL(continuation.href).origin === location.origin) {
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
    void navigateFeed(url.href, true, link)
  })

  addEventListener('popstate', () => void navigateFeed(location.href, false))

  void restore()
})()
