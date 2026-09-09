(() => {
  const rootSelector = '[data-progressive-pagination-root]'
  const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  let controller = null
  let spinnerTimer = null
  let spinner = null

  const stopSpinner = () => {
    clearInterval(spinnerTimer)
    spinnerTimer = null
    spinner?.remove()
    spinner = null
  }

  const startSpinner = pagination => {
    stopSpinner()
    const label = pagination?.getAttribute('aria-label')?.replace(/ pagination$/i, '')
    const headings = [...pagination.closest(rootSelector)?.querySelectorAll('h2') || []]
    const heading = headings.find(item => label && item.textContent.trim().toLowerCase().startsWith(label.toLowerCase()))
      || pagination.closest('section')?.querySelector('h2')
    if (!heading) return
    spinner = document.createElement('span')
    spinner.className = 'feed-tab-loading'
    spinner.setAttribute('role', 'status')
    spinner.setAttribute('aria-label', `Loading ${label?.toLowerCase() || 'page'}`)
    heading.append(spinner)
    let frame = 0
    const render = () => {
      spinner.textContent = spinnerFrames[frame]
      frame = (frame + 1) % spinnerFrames.length
    }
    render()
    spinnerTimer = setInterval(render, 80)
  }

  const navigate = async (href, push, pagination = null) => {
    const currentRoot = document.querySelector(rootSelector)
    if (!currentRoot) {
      location.href = href
      return
    }
    controller?.abort()
    const requestController = new AbortController()
    controller = requestController
    currentRoot.setAttribute('aria-busy', 'true')
    startSpinner(pagination)
    const spinnerStartedAt = performance.now()
    try {
      const response = await fetch(href, {
        headers: { Accept: 'text/html', 'X-Textlog-Pagination': '1' },
        credentials: 'same-origin',
        signal: requestController.signal,
      })
      if (!response.ok) throw new Error(`Pagination request failed: ${response.status}`)
      const parsed = new DOMParser().parseFromString(await response.text(), 'text/html')
      const incomingRoot = parsed.querySelector(rootSelector)
      if (!incomingRoot
        || incomingRoot.dataset.progressivePaginationRoot !== currentRoot.dataset.progressivePaginationRoot) {
        throw new Error('Pagination response did not contain the expected content')
      }
      const remaining = 240 - (performance.now() - spinnerStartedAt)
      if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining))
      if (requestController.signal.aborted) return
      currentRoot.replaceWith(incomingRoot)
      document.title = parsed.title
      const resolved = new URL(response.url)
      if (push) history.pushState({ pagination: true }, '', resolved.pathname + resolved.search + resolved.hash)
      const anchor = resolved.hash && document.getElementById(decodeURIComponent(resolved.hash.slice(1)))
      if (anchor) anchor.scrollIntoView({ behavior: 'instant', block: 'start' })
    }
    catch (error) {
      if (error.name !== 'AbortError') location.href = href
    }
    finally {
      if (controller === requestController) {
        controller = null
        stopSpinner()
      }
    }
  }

  document.addEventListener('click', event => {
    const link = event.target.closest(`${rootSelector} .pagination a[href]`)
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey
      || event.altKey || link.target || link.download) return
    const url = new URL(link.href)
    if (url.origin !== location.origin) return
    event.preventDefault()
    void navigate(url.href, true, link.closest('.pagination'))
  })

  document.addEventListener('submit', event => {
    const form = event.target.closest(`${rootSelector} .pagination-current-form`)
    if (!form || event.defaultPrevented) return
    event.preventDefault()
    const url = new URL(form.action, location.href)
    new FormData(form).forEach((value, name) => url.searchParams.set(name, String(value)))
    void navigate(url.href, true, form.closest('.pagination'))
  })

  addEventListener('popstate', () => void navigate(location.href, false))
})()
