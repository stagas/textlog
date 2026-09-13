;(() => {
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.repeat) return
    setTimeout(() => {
      if (!event.defaultPrevented) document.activeElement?.blur?.()
    }, 0)
  })
})()
