;(() => {
  document.documentElement.classList.add('feed-thread-expansion-enabled')

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
    if (!continuation || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey
      || event.shiftKey || event.altKey || continuation.target || continuation.download
      || new URL(continuation.href).origin !== location.origin) return
    event.preventDefault()
    void expandCompleteThread(continuation)
  })
})()
