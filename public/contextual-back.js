(() => {
  const url = new URL(location.href)
  const from = url.searchParams.get('from')

  if (from) {
    const fromUrl = new URL(from, location.origin)
    const referrerUrl = document.referrer ? new URL(document.referrer) : null
    const canUseHistoryBack = !fromUrl.hash && referrerUrl?.origin === location.origin
      && referrerUrl.pathname + referrerUrl.search === fromUrl.pathname + fromUrl.search
    url.searchParams.delete('from')
    history.replaceState({
      ...history.state,
      textlogContextualBack: canUseHistoryBack,
      textlogFrom: from,
    }, '', url.pathname + url.search + url.hash)
  }

  document.addEventListener('click', event => {
    const link = event.target.closest('a[href]')
    if (!link || event.defaultPrevented || event.button !== 0
      || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

    const contextualFrom = history.state?.textlogFrom
    const linkUrl = new URL(link.href, location.href)
    const linkPath = linkUrl.pathname + linkUrl.search + linkUrl.hash
    if (history.state?.textlogContextualBack && history.length > 1
      && link.textContent.trim().toLowerCase() === 'back' && linkPath === contextualFrom) {
      event.preventDefault()
      history.back()
    }
  })
})()
