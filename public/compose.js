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
  textareas.forEach(update)

  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(entries => entries.forEach(entry => update(entry.target)))
    textareas.forEach(textarea => observer.observe(textarea))
  }

  document.addEventListener('input', event => {
    if (event.target instanceof HTMLTextAreaElement && event.target.matches(textareaSelector)) {
      event.target.setCustomValidity('')
      update(event.target)
    }
  })

  document.addEventListener('submit', event => {
    if (!(event.target instanceof HTMLFormElement)) return
    const textarea = event.target.querySelector(textareaSelector)
    if (!textarea || event.submitter?.getAttribute('name') === 'action' || !update(textarea)) return

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
