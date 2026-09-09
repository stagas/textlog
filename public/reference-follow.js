const pendingActions = new Set()

document.addEventListener('pointerout', event => {
  const menu = event.target instanceof Element ? event.target.closest('.reference-menu') : null
  if (!menu || (event.relatedTarget instanceof Node && menu.contains(event.relatedTarget))) return

  const focused = document.activeElement
  if (focused instanceof HTMLButtonElement && focused.matches('.reference-menu-popover button[type="submit"]')
    && menu.contains(focused)) focused.blur()
})

document.addEventListener('submit', async event => {
  const form = event.target
  if (!(form instanceof HTMLFormElement)) return

  const submitter = event.submitter instanceof HTMLButtonElement ? event.submitter : null
  if (!submitter || (!form.hasAttribute('data-follow-enhance')
    && !submitter.closest('.reference-menu-popover'))) return

  const action = new URL(form.action, location.href)
  if (action.origin !== location.origin || !/^\/(?:follow|tag-follow)\//.test(action.pathname)) return

  event.preventDefault()
  if (pendingActions.has(action.href)) return
  pendingActions.add(action.href)
  const matchingButtons = [...document.querySelectorAll('button')]
    .filter(button =>
      button.form?.hasAttribute('data-follow-enhance')
      || button.closest('.reference-menu-popover')
    )
    .filter(button => {
      const owner = button.form
      return owner && new URL(owner.action, location.href).href === action.href
    })
  const buttonState = matchingButtons.map(button => ({
    button,
    content: button.innerHTML,
    followLabel: button.textContent?.trim().startsWith('follow back') ? 'follow back' : 'follow',
    suffix: button.textContent?.trim().match(/^(?:unfollow|follow back|follow)(.*)$/)?.[1] || '',
    width: button.style.width,
    ariaLabel: button.getAttribute('aria-label'),
  }))
  const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
  let spinnerFrame = 0
  const renderSpinner = () => {
    matchingButtons.forEach(button => {
      button.textContent = spinnerFrames[spinnerFrame]
    })
    spinnerFrame = (spinnerFrame + 1) % spinnerFrames.length
  }
  matchingButtons.forEach(button => {
    button.style.width = `${button.getBoundingClientRect().width}px`
    button.setAttribute('aria-busy', 'true')
    button.setAttribute('aria-label', 'Updating follow status')
  })
  renderSpinner()
  const spinnerTimer = setInterval(renderSpinner, 80)
  submitter.focus({ preventScroll: true })

  let updated = false
  try {
    const response = await fetch(action, {
      method: 'POST',
      body: new FormData(form),
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`Follow request failed (${response.status})`)
    const { following } = await response.json()
    updated = true
    matchingButtons.forEach(button => {
      const followsViewer = Boolean(button.form?.querySelector('.follows-you')
        || button.closest('.reference-popover-actions')?.querySelector('.follows-you'))
      const state = buttonState.find(item => item.button === button)
      if (button.classList.contains('explore-tag-chip')) {
        if (state) button.innerHTML = state.content
        button.setAttribute('aria-pressed', String(following))
        button.title = `${following ? 'Unfollow' : 'Follow'} ${button.textContent?.trim() || ''}`
      }
      else button.textContent = `${following ? 'unfollow' : followsViewer ? 'follow back' : state?.followLabel || 'follow'}${
        state?.suffix || ''
      }`
      button.classList.toggle('button-muted', following)
    })
  }
  catch (error) {
    console.error(error)
  }
  finally {
    clearInterval(spinnerTimer)
    pendingActions.delete(action.href)
    buttonState.forEach(({ button, content, width, ariaLabel }) => {
      if (!updated) button.innerHTML = content
      button.style.width = width
      button.removeAttribute('aria-busy')
      if (ariaLabel === null) button.removeAttribute('aria-label')
      else button.setAttribute('aria-label', ariaLabel)
    })
  }
})
