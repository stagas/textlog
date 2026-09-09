(() => {
  const textareaSelector = ':is(.write-compose, .reply-compose) textarea[name="body"][data-character-limit]'

  const update = textarea => {
    const counter = textarea.closest('.compose-editor-row')?.querySelector('.compose-character-count')
    const characterLimit = Number(textarea.dataset.characterLimit)
    const lineLimit = Number(textarea.dataset.lineLimit)
    if (!counter || !Number.isFinite(characterLimit) || !Number.isFinite(lineLimit)) return

    const characters = textarea.value.length
    const styles = getComputedStyle(textarea)
    const lineHeight = Number.parseFloat(styles.lineHeight)
    const padding = Number.parseFloat(styles.paddingTop) + Number.parseFloat(styles.paddingBottom)
    const logicalLines = textarea.value.split('\n').length
    const renderedLines = Number.isFinite(lineHeight) && lineHeight > 0
      ? Math.ceil((textarea.scrollHeight - padding - 0.5) / lineHeight)
      : logicalLines
    const lines = Math.max(logicalLines, renderedLines)
    const showCharacters = characters >= characterLimit - 10
    const showLines = lines >= lineLimit - 1
    const signals = []
    if (showCharacters) signals.push(String(characters))
    if (showLines) signals.push(`${lines} lines`)

    counter.hidden = signals.length === 0
    counter.textContent = signals.join(' · ')
    const overLimit = characters > characterLimit || lines > lineLimit
    counter.classList.toggle('compose-character-count-over-limit', overLimit)
    textarea.dataset.composeOverLimit = overLimit ? 'true' : 'false'
    textarea.dataset.composeRenderedLines = String(lines)
    return overLimit
  }

  const textareas = document.querySelectorAll(textareaSelector)
  const storedValue = textarea => {
    const key = textarea.dataset.composeStorageKey
    if (!key) return null
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  }
  const storeValue = textarea => {
    const key = textarea.dataset.composeStorageKey
    if (!key) return
    try {
      if (textarea.value) localStorage.setItem(key, textarea.value)
      else localStorage.removeItem(key)
    } catch {
      // Storage can be unavailable in private or restricted browser contexts.
    }
  }
  const clearStoredValue = textarea => {
    const key = textarea.dataset.composeStorageKey
    if (!key) return
    try {
      localStorage.removeItem(key)
    } catch {
      // Storage can be unavailable in private or restricted browser contexts.
    }
  }

  const startPlaceholderTypewriter = textarea => {
    const encodedPlaceholders = document.querySelector('script[data-typewriter-placeholders]')
      ?.dataset.typewriterPlaceholders
    if (!encodedPlaceholders || textarea.value
      || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

    let placeholders
    try {
      placeholders = JSON.parse(encodedPlaceholders)
    } catch {
      return
    }
    if (!Array.isArray(placeholders) || !placeholders.length) return

    const typingDelay = 85
    const backspaceDelay = 28
    const displayDelay = 10000
    let current = placeholders.indexOf(textarea.placeholder)
    let timer

    const schedule = (callback, delay) => {
      clearTimeout(timer)
      timer = setTimeout(callback, delay)
    }
    const chooseNext = () => {
      if (placeholders.length === 1) return 0
      let next = current
      while (next === current) next = Math.floor(Math.random() * placeholders.length)
      return next
    }
    const type = (text, index = 0) => {
      if (textarea.value) return
      textarea.placeholder = text.slice(0, index)
      if (index < text.length) schedule(() => type(text, index + 1), typingDelay)
      else schedule(backspace, displayDelay)
    }
    const backspace = () => {
      if (textarea.value) return
      if (textarea.placeholder.length) {
        textarea.placeholder = textarea.placeholder.slice(0, -1)
        schedule(backspace, backspaceDelay)
        return
      }
      current = chooseNext()
      schedule(() => type(placeholders[current]), typingDelay)
    }
    const restart = () => {
      if (textarea.value || timer) return
      current = chooseNext()
      type(placeholders[current])
    }

    textarea.placeholder = ''
    current = chooseNext()
    type(placeholders[current])
    textarea.addEventListener('input', () => {
      clearTimeout(timer)
      timer = undefined
      if (!textarea.value) restart()
    })
  }

  textareas.forEach(textarea => {
    const saved = storedValue(textarea)
    if (!textarea.value && saved) textarea.value = saved
    update(textarea)
    startPlaceholderTypewriter(textarea)
  })
  document.querySelector(`${textareaSelector}[data-auto-focus]`)?.focus({ preventScroll: true })

  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(entries => entries.forEach(entry => update(entry.target)))
    textareas.forEach(textarea => observer.observe(textarea))
  }

  document.addEventListener('input', event => {
    if (event.target instanceof HTMLTextAreaElement && event.target.matches(textareaSelector)) {
      event.target.setCustomValidity('')
      storeValue(event.target)
      update(event.target)
    }
  })

  document.addEventListener('submit', event => {
    if (!(event.target instanceof HTMLFormElement)) return
    const textarea = event.target.querySelector(textareaSelector)
    if (!textarea || event.submitter?.getAttribute('name') === 'action') return

    if (!update(textarea)) {
      clearStoredValue(textarea)
      return
    }

    event.preventDefault()
    const characters = textarea.value.length
    const lines = textarea.dataset.composeRenderedLines
    textarea.setCustomValidity(
      characters > Number(textarea.dataset.characterLimit)
        ? `Keep the note within ${textarea.dataset.characterLimit} characters.`
        : `Keep the note within ${textarea.dataset.lineLimit} visible lines (currently ${lines}).`,
    )
    textarea.reportValidity()
  })
})()
