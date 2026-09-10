(() => {
  const canHover = matchMedia('(hover: hover) and (pointer: fine)')
  const manualScrollTimeout = 50
  const suspendedUntil = new WeakMap()

  const replyScroller = element => {
    const thread = element.closest?.('.post-page-thread')
    return [...(thread?.children || [])].find(child =>
      child.classList.contains('reply-branch') && child.contains(element))
  }

  const suspend = event => {
    const scroller = replyScroller(event.target)
    if (scroller) suspendedUntil.set(scroller, performance.now() + manualScrollTimeout)
  }

  document.addEventListener('wheel', suspend, { passive: true, capture: true })
  document.addEventListener('pointerdown', suspend, { capture: true })
  document.addEventListener('keydown', event => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) suspend(event)
  }, { capture: true })

  document.addEventListener('mouseover', event => {
    if (!canHover.matches) return

    const post = event.target.closest?.('.post-page-thread .post')
    if (!post || post.contains(event.relatedTarget)) return

    const scroller = replyScroller(post)
    if (!scroller || (suspendedUntil.get(scroller) || 0) > performance.now()) return

    const postRect = post.getBoundingClientRect()
    const scrollerRect = scroller.getBoundingClientRect()
    const left = postRect.right - scrollerRect.right

    if (Math.abs(left) > 1) scroller.scrollBy({ left, behavior: 'smooth' })
  })
})()
