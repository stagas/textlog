;(() => {
  const removeComposer = wrapper => {
    wrapper?._layoutCleanup?.()
    const targetId = wrapper?.dataset.replyPostId
    if (targetId) document.getElementById(`post-${targetId}`)?.classList.remove('reply-composer-target')
    document.querySelector('.feed-inline-reply-placeholder')?.remove()
    wrapper?.remove()
  }

  const mountComposer = (wrapper, post) => {
    wrapper.dataset.replyPostId = post.id.replace('post-', '')
    post.classList.add('reply-composer-target')
    const thread = post.closest('.post-page-thread')
    const shouldHoist = matchMedia('(max-width: 600px)').matches
    if (!shouldHoist) {
      post.after(wrapper)
      return
    }

    const placeholder = document.createElement('div')
    placeholder.className = 'feed-inline-reply-placeholder'
    post.after(placeholder)
    wrapper.classList.add('thread-hoisted-inline-reply-compose')
    thread.append(wrapper)

    let frame
    const layout = () => {
      frame = null
      if (!wrapper.isConnected || !placeholder.isConnected) return
      placeholder.style.height = `${wrapper.offsetHeight}px`
      wrapper.style.top = `${placeholder.getBoundingClientRect().top - thread.getBoundingClientRect().top}px`
    }
    const scheduleLayout = () => {
      if (!frame) frame = requestAnimationFrame(layout)
    }
    const observer = new ResizeObserver(scheduleLayout)
    observer.observe(wrapper)
    addEventListener('resize', scheduleLayout, { passive: true })
    wrapper._layoutCleanup = () => {
      observer.disconnect()
      removeEventListener('resize', scheduleLayout)
      if (frame) cancelAnimationFrame(frame)
    }
    layout()
  }

  const replyBoxFor = (post, href) => {
    const template = document.getElementById('inline-reply-template')
    if (!(template instanceof HTMLTemplateElement)) return null
    const composer = template.content.querySelector('.reply-compose')?.cloneNode(true)
    if (!(composer instanceof HTMLElement)) return null

    const url = new URL(href, location.href)
    const targetId = post.id.replace('post-', '')
    const pageId = url.pathname.match(/^\/post\/(\d+)/)?.[1]
    const form = composer.querySelector('form')
    const textarea = composer.querySelector('textarea[name="body"]')
    const replyPageInput = composer.querySelector('input[name="reply_page_id"]')
    if (!pageId || !(form instanceof HTMLFormElement) || !(textarea instanceof HTMLTextAreaElement)
      || !(replyPageInput instanceof HTMLInputElement)) return null

    form.action = `/post/${targetId}/reply#post-${targetId}`
    replyPageInput.value = pageId
    composer.querySelector('input[name="from"]')?.remove()
    const returnPath = url.searchParams.get('from')
    if (returnPath) {
      const input = document.createElement('input')
      input.type = 'hidden'
      input.name = 'from'
      input.value = returnPath
      form.prepend(input)
    }
    textarea.placeholder = post.hasAttribute('data-reply-own')
      ? 'Continue writing…'
      : `Reply to @${post.dataset.replyHandle}…`
    textarea.dataset.composeStorageKey = `textlog:compose:${template.dataset.viewerId}:reply:${targetId}`
    return composer
  }

  const initializeTextarea = composer => {
    const textarea = composer.querySelector('textarea[data-compose-storage-key]')
    if (!textarea) return
    try {
      const saved = localStorage.getItem(textarea.dataset.composeStorageKey)
      if (!textarea.value && saved) textarea.value = saved
    }
    catch {}
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    textarea.focus({ preventScroll: true })
  }

  const revealComposer = wrapper => {
    const rect = wrapper.getBoundingClientRect()
    const viewportTop = window.visualViewport?.offsetTop || 0
    const viewportBottom = viewportTop + (window.visualViewport?.height || innerHeight)
    const margin = 16
    if (rect.bottom > viewportBottom - margin) {
      scrollBy({ top: rect.bottom - viewportBottom + margin, behavior: 'smooth' })
    }
    else if (rect.top < viewportTop + margin) {
      scrollBy({ top: rect.top - viewportTop - margin, behavior: 'smooth' })
    }
  }

  const showReplyBox = (post, href) => {
    const current = document.querySelector('.feed-inline-reply-compose')
    if (current?.dataset.replyPostId === post.id.replace('post-', '')) {
      removeComposer(current)
      return
    }

    post.classList.add('feed-reply-loading')
    post.setAttribute('aria-busy', 'true')
    try {
      const composer = replyBoxFor(post, href)
      if (!composer) {
        location.href = href
        return
      }

      removeComposer(current)
      document.querySelector('.post-page-thread:not(.feed-thread) > .root-reply-compose')?.remove()
      composer.classList.remove('root-reply-compose')
      composer.querySelectorAll('script').forEach(script => script.remove())
      const wrapper = document.createElement('div')
      wrapper.className = 'inline-reply-compose feed-inline-reply-compose'
      let depth = 0
      for (let parent = post.parentElement; parent && !parent.classList.contains('feed-thread');
        parent = parent.parentElement) {
        if (parent.classList.contains('reply-branch')) depth++
      }
      depth = Math.max(1, depth)
      const levelCap = matchMedia('(max-width: 600px)').matches ? 3 : 5
      const outdent = Math.max(0, depth - levelCap)
      wrapper.style.setProperty('--reply-offset',
        outdent ? `calc(${Array(outdent).fill('clamp(18px, 3vw, 28px)').join(' + ')})` : '0px')
      wrapper.append(composer)
      mountComposer(wrapper, post)
      initializeTextarea(composer)
      requestAnimationFrame(() => revealComposer(wrapper))
    }
    catch (error) {
      location.href = href
    }
    finally {
      post.classList.remove('feed-reply-loading')
      post.removeAttribute('aria-busy')
    }
  }

  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return
    const replyLink = event.target.closest?.('.post-page-thread .post-reply-link')
    const hitArea = event.target.closest?.('.post-page-thread .post-hit-area')
    const post = replyLink?.closest('.post') || hitArea?.closest('.post[data-reply-href]')
    if (!post) return
    const current = document.querySelector('.feed-inline-reply-compose')
    if (current?.dataset.replyPostId === post.id.replace('post-', '')) return
    event.preventDefault()
    showReplyBox(post, replyLink?.href || post.dataset.replyHref)
  })
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return
    const wrapper = event.target.closest?.('.feed-inline-reply-compose')
    if (!wrapper) return
    const post = document.getElementById(`post-${wrapper.dataset.replyPostId}`)
    event.preventDefault()
    event.stopPropagation()
    removeComposer(wrapper)
    post?.querySelector('.post-hit-area')?.focus({ preventScroll: true })
  })

  const initialComposer = document.querySelector(
    '.post-page-thread:not(.feed-thread) .feed-inline-reply-compose[data-reply-post-id]',
  )
  const initialPost = initialComposer
    ? document.getElementById(`post-${initialComposer.dataset.replyPostId}`)
    : null
  if (initialComposer && initialPost) mountComposer(initialComposer, initialPost)
})()
