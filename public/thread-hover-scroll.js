(() => {
  document.documentElement.classList.add('thread-scroll-enhanced')

  let frame
  const update = () => {
    frame = undefined
    const viewportCenter = window.innerHeight / 2

    for (const scroller of document.querySelectorAll('.post-page-thread > .reply-branch')) {
      const mobileComposer = scroller.closest('.feed-thread')
        ?.querySelector(':scope > .feed-mobile-inline-reply-compose')
      const mobileComposerRect = mobileComposer?.getBoundingClientRect()
      const mobileComposerVisible = mobileComposerRect && mobileComposerRect.height > 0
        && mobileComposerRect.bottom > 0 && mobileComposerRect.top < window.innerHeight
      const replyTarget = mobileComposerVisible
        ? document.getElementById(`post-${mobileComposer.dataset.replyPostId}`)
        : null
      const posts = [...scroller.querySelectorAll('.post')].filter(post => {
        const rect = post.getBoundingClientRect()
        return rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight
      })
      const post = replyTarget?.closest('.post-page-thread > .reply-branch') === scroller
        ? replyTarget
        : posts.sort((a, b) => {
          const aRect = a.getBoundingClientRect()
          const bRect = b.getBoundingClientRect()
          return Math.abs((aRect.top + aRect.bottom) / 2 - viewportCenter)
            - Math.abs((bRect.top + bRect.bottom) / 2 - viewportCenter)
        })[0]
      if (!post) continue

      const postRect = post.getBoundingClientRect()
      const scrollerRect = scroller.getBoundingClientRect()
      const levelCap = matchMedia('(max-width: 600px)').matches ? 3 : 5
      const indent = parseFloat(getComputedStyle(scroller).marginLeft) || 0
      let level = 1
      let branch = post.closest('.reply-branch')
      while (branch && branch !== scroller) {
        level++
        branch = branch.parentElement?.closest('.reply-branch')
      }
      const contentLeft = scroller.scrollLeft + postRect.left - scrollerRect.left
      const postTarget = Math.max(0, contentLeft - (Math.min(level, levelCap) - 1) * indent)
      const composer = scroller.querySelector('.feed-inline-reply-compose')
      const composerRect = composer?.getBoundingClientRect()
      const composerVisible = composerRect && composerRect.height > 0
        && composerRect.bottom > 0 && composerRect.top < window.innerHeight
      const composerEdge = composer?.querySelector('.form-actions')?.getBoundingClientRect() || composerRect
      const composerTarget = composerVisible && !matchMedia('(max-width: 600px)').matches
        ? scroller.scrollLeft + Math.max(0, composerEdge.right - scrollerRect.right + 16)
        : 0
      const target = Math.min(scroller.scrollWidth - scroller.clientWidth, Math.max(postTarget, composerTarget))
      if (Math.abs(target - scroller.scrollLeft) <= 1) continue

      scroller.scrollTo({ left: target, behavior: 'smooth' })
    }
  }
  const scheduleUpdate = () => {
    if (!frame) frame = requestAnimationFrame(update)
  }

  addEventListener('scroll', scheduleUpdate, { passive: true })
  addEventListener('resize', scheduleUpdate, { passive: true })
  new MutationObserver(scheduleUpdate).observe(document.body, { childList: true, subtree: true })
  scheduleUpdate()
})()
