(() => {
  const sentinelSelector = '[data-feed-next]'
  let loading = false

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
    observer.unobserve(sentinel)
    try {
      const url = new URL(location.href)
      url.searchParams.set('_feed_chunk', sentinel.dataset.feedNext)
      const response = await fetch(url, {
        headers: { Accept: 'text/html', 'X-Textlog-Feed-Chunk': '1' },
        credentials: 'same-origin',
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

  void restore()
})()
