(() => {
  document.documentElement.classList.add('thread-scroll-enhanced')

  let frame
  const targetPositions = new WeakMap()
  const update = () => {
    frame = undefined
    const viewportCenter = window.innerHeight / 2

    for (const scroller of document.querySelectorAll('.post-page-thread > .reply-branch')) {
      const posts = [...scroller.querySelectorAll('.post')].filter(post => {
        const rect = post.getBoundingClientRect()
        return rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight
      })
      const post = posts.sort((a, b) => {
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
      const target = Math.max(0, contentLeft - (Math.min(level, levelCap) - 1) * indent)
      if (Math.abs(target - (targetPositions.get(scroller) ?? -1)) <= 1) continue

      targetPositions.set(scroller, target)
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
