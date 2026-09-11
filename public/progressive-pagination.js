;(() => {
  const rootSelector = '[data-progressive-pagination-root]'
  const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  let controller = null
  let spinnerTimer = null
  let spinner = null
  let restoreSpinner = null

  const stopSpinner = () => {
    clearInterval(spinnerTimer)
    spinnerTimer = null
    restoreSpinner?.()
    restoreSpinner = null
    spinner = null
  }

  const startSpinner = (owner, href) => {
    stopSpinner()
    const pagination = owner?.closest('.pagination')
    const label = pagination?.getAttribute('aria-label')?.replace(/ pagination$/i, '')
    const current = pagination?.querySelector('.pagination-current-form .current')
    const pageParam = current?.name || 'page'
    const requestedPage = new URL(href, location.href).searchParams.get(pageParam)
    const numberedPage = [...pagination?.querySelectorAll('.pagination-pages a[href]') || []]
      .find(link => new URL(link.href).searchParams.get(pageParam) === requestedPage)
    spinner = owner?.matches('.pagination-current-form')
      ? owner.querySelector('.current')
      : numberedPage || owner?.matches('.pagination a[href]') && owner || null
    if (!spinner) return
    const original = 'value' in spinner ? spinner.value : spinner.textContent
    const disabled = 'disabled' in spinner ? spinner.disabled : null
    const role = spinner.getAttribute('role')
    const ariaLabel = spinner.getAttribute('aria-label')
    restoreSpinner = () => {
      if ('value' in spinner) spinner.value = original
      else spinner.textContent = original
      if (disabled !== null) spinner.disabled = disabled
      if (role === null) spinner.removeAttribute('role')
      else spinner.setAttribute('role', role)
      if (ariaLabel === null) spinner.removeAttribute('aria-label')
      else spinner.setAttribute('aria-label', ariaLabel)
    }
    if ('value' in spinner) spinner.disabled = true
    spinner.setAttribute('role', 'status')
    spinner.setAttribute('aria-label', `Loading ${label?.toLowerCase() || 'page'}`)
    let frame = 0
    const render = () => {
      if ('value' in spinner) spinner.value = spinnerFrames[frame]
      else spinner.textContent = spinnerFrames[frame]
      frame = (frame + 1) % spinnerFrames.length
    }
    render()
    spinnerTimer = setInterval(render, 80)
  }

  const navigate = async (href, push, owner = null) => {
    const currentRoot = document.querySelector(rootSelector)
    if (!currentRoot) {
      location.href = href
      return
    }
    controller?.abort()
    const requestController = new AbortController()
    controller = requestController
    currentRoot.setAttribute('aria-busy', 'true')
    startSpinner(owner, href)
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
        || incomingRoot.dataset.progressivePaginationRoot !== currentRoot.dataset.progressivePaginationRoot)
      {
        throw new Error('Pagination response did not contain the expected content')
      }
      const remaining = 240 - (performance.now() - spinnerStartedAt)
      if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining))
      if (requestController.signal.aborted) return
      currentRoot.replaceWith(incomingRoot)
      document.title = parsed.title
      const resolved = new URL(response.url)
      resolved.hash = ''
      if (push) history.pushState({ pagination: true }, '', resolved.pathname + resolved.search + resolved.hash)
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
    url.searchParams.delete('_scroll')
    url.hash = ''
    event.preventDefault()
    void navigate(url.href, true, link)
  })

  document.addEventListener('submit', event => {
    const form = event.target.closest(`${rootSelector} .pagination-current-form`)
    if (!form || event.defaultPrevented) return
    event.preventDefault()
    const url = new URL(form.action, location.href)
    new FormData(form).forEach((value, name) => url.searchParams.set(name, String(value)))
    url.searchParams.delete('_scroll')
    url.hash = ''
    void navigate(url.href, true, form)
  })

  addEventListener('popstate', () => void navigate(location.href, false))
})()
