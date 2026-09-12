import emojiKeywords from 'emojilib'

;(() => {
  if (document.documentElement.dataset.composeEnhanced) return
  document.documentElement.dataset.composeEnhanced = 'true'
  const textareaSelector = ':is(.write-compose, .reply-compose) textarea[name="body"][data-character-limit]'
  const autocomplete = document.createElement('div')
  autocomplete.className = 'compose-autocomplete'
  autocomplete.hidden = true
  autocomplete.setAttribute('role', 'listbox')
  autocomplete.id = 'compose-autocomplete'
  document.body.append(autocomplete)
  let autocompleteTextarea
  let autocompleteMatch
  let autocompleteIndex = 0
  let autocompleteRequest
  let autocompleteTimer
  const emojiEntries = Object.entries(emojiKeywords).map(([emoji, keywords], order) => ({
    emoji,
    order,
    keywords: keywords.map(keyword => ({ keyword, normalized: keyword.toLocaleLowerCase().replaceAll('_', ' ') })),
  }))

  const formattingPatterns = [
    { className: 'compose-format-strike', pattern: /~~[^\n~](?:[^\n]*?[^\n~])?~~/gu },
    { className: 'compose-format-strike', pattern: /(?<!~)~[^\n~](?:[^\n]*?[^\n~])?~(?!~)/gu },
    { className: 'compose-format-bold', pattern: /\*\*[^\n*](?:[^\n]*?[^\n*])?\*\*/gu },
    { className: 'compose-format-bold', pattern: /(?<!\*)\*[^\n*](?:[^\n]*?[^\n*])?\*(?!\*)/gu },
    { className: 'compose-format-underline', pattern: /__[^\n_](?:[^\n]*?[^\n_])?__/gu },
    { className: 'compose-format-underline', pattern: /(?<!_)_[^\n_](?:[^\n]*?[^\n_])?_(?!_)/gu },
    { className: 'compose-format-italic', pattern: /(?<!\S)\/[^\/\s](?:[^\/\n]*?[^\/\s])?\/(?!\/)/gu },
  ]
  const emojiPattern = /(?:\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*)/gu
  const emojiMeasureCanvas = document.createElement('canvas')
  const emojiMeasureContext = emojiMeasureCanvas.getContext('2d')
  const emojiWidthCache = new Map()

  const emojiAdvance = (textarea, emoji) => {
    if (!emojiMeasureContext) return '1ch'
    const styles = getComputedStyle(textarea)
    const font = `${styles.fontStyle} ${styles.fontVariant} ${styles.fontWeight} ${styles.fontStretch} ${styles.fontSize} ${styles.fontFamily}`
    const letterSpacing = Number.parseFloat(styles.letterSpacing) || 0
    const cacheKey = `${font}\n${letterSpacing}\n${emoji}`
    let width = emojiWidthCache.get(cacheKey)
    if (width === undefined) {
      emojiMeasureContext.font = font
      width = emojiMeasureContext.measureText(emoji).width + letterSpacing
      emojiWidthCache.set(cacheKey, width)
    }
    return `${width}px`
  }

  const highlightRanges = value => {
    const classes = Array.from({ length: value.length }, () => new Set())
    formattingPatterns.forEach(({ className, pattern }) => {
      pattern.lastIndex = 0
      for (const match of value.matchAll(pattern)) {
        for (let index = match.index; index < match.index + match[0].length; index++) classes[index].add(className)
      }
    })
    const referencePattern = /(?<![\p{L}\p{M}\p{N}_])([@#])[\p{L}\p{M}\p{N}_]+/gu
    for (const match of value.matchAll(referencePattern)) {
      const className = match[1] === '@' ? 'compose-mention' : 'compose-hashtag'
      for (let index = match.index; index < match.index + match[0].length; index++) classes[index].add(className)
    }
    const postReferencePattern = /(?<![\p{L}\p{M}\p{N}_&])&[0-9]+/gu
    for (const match of value.matchAll(postReferencePattern)) {
      for (let index = match.index; index < match.index + match[0].length; index++) {
        classes[index].add('compose-post-reference')
      }
    }
    for (const match of value.matchAll(emojiPattern)) {
      for (let index = match.index; index < match.index + match[0].length; index++) classes[index].add('compose-emoji')
    }
    return classes
  }

  const updateHighlight = textarea => {
    let mirror = textarea.parentElement?.querySelector(':scope > .compose-highlight')
    if (!(mirror instanceof HTMLElement)) {
      const wrapper = document.createElement('div')
      wrapper.className = 'compose-highlight-wrap'
      mirror = document.createElement('pre')
      mirror.className = 'compose-highlight'
      mirror.setAttribute('aria-hidden', 'true')
      textarea.before(wrapper)
      wrapper.append(mirror, textarea)
      textarea.classList.add('compose-highlight-textarea')
    }

    const value = textarea.value
    const classes = highlightRanges(value)
    const fragment = document.createDocumentFragment()
    let start = 0
    while (start < value.length) {
      const className = [...classes[start]].sort().join(' ')
      let end = start + 1
      while (end < value.length && [...classes[end]].sort().join(' ') === className) end++
      const text = value.slice(start, end)
      if (classes[start].has('compose-emoji')) {
        const surroundingClasses = [...classes[start]].filter(name => name !== 'compose-emoji').join(' ')
        for (const match of text.matchAll(emojiPattern)) {
          const slot = document.createElement('span')
          slot.className = `compose-emoji-slot${surroundingClasses ? ` ${surroundingClasses}` : ''}`
          slot.style.width = emojiAdvance(textarea, match[0])
          const glyph = document.createElement('span')
          glyph.className = 'emoji'
          glyph.textContent = match[0]
          slot.append(glyph)
          fragment.append(slot)
        }
      }
      else {
        const node = className ? document.createElement('span') : document.createTextNode(text)
        if (node instanceof HTMLElement) {
          node.className = className
          node.textContent = text
        }
        fragment.append(node)
      }
      start = end
    }
    // A final newline needs a glyph so the mirror retains the textarea's last visual line.
    if (value.endsWith('\n')) fragment.append('\u200b')
    mirror.replaceChildren(fragment)
    mirror.scrollTop = textarea.scrollTop
    mirror.scrollLeft = textarea.scrollLeft
  }

  const currentReference = textarea => {
    if (textarea.selectionStart !== textarea.selectionEnd) return null
    const beforeCaret = textarea.value.slice(0, textarea.selectionStart)
    const match = beforeCaret.match(/(?<![\p{L}\p{M}\p{N}_])([@#])([\p{L}\p{M}\p{N}_]+)$/u)
    if (match) {
      return {
        start: textarea.selectionStart - match[1].length - match[2].length,
        end: textarea.selectionStart,
        prefix: match[1],
        query: match[2],
        kind: match[1] === '@' ? 'mentions' : 'hashtags',
      }
    }
    const emoji = beforeCaret.match(/(?<![\p{L}\p{M}\p{N}_]):([\p{L}\p{M}\p{N}_]+)$/u)
    if (emoji) {
      return { start: textarea.selectionStart - emoji[0].length, end: textarea.selectionStart, prefix: ':',
        replacementPrefix: '', query: emoji[1], kind: 'emoji' }
    }
    const post = beforeCaret.match(/(?<![\p{L}\p{M}\p{N}_&])&([0-9]+)$/u)
    if (!post) return null
    return { start: textarea.selectionStart - post[0].length, end: textarea.selectionStart, prefix: '&',
      query: post[1], kind: 'posts' }
  }

  const sameReference = (left, right) => left && right && left.start === right.start && left.end === right.end
    && left.prefix === right.prefix && left.query === right.query && left.kind === right.kind

  const emojiMatches = query => {
    const needle = query.toLocaleLowerCase().replaceAll('_', ' ')
    return emojiEntries.flatMap(({ emoji, keywords, order }) => {
      let best
      let label
      for (const { keyword, normalized } of keywords) {
        const rank = normalized === needle ? 0 : normalized.startsWith(needle) ? 1 : undefined
        if (rank === undefined) continue
        const score = rank * 100 + normalized.length - needle.length
        if (best === undefined || score < best) {
          best = score
          label = keyword.replaceAll('_', ' ')
        }
      }
      return best === undefined ? [] : [{ value: emoji, label, emoji, score: best, order }]
    }).sort((left, right) => left.score - right.score || left.order - right.order).slice(0, 5)
  }

  const caretPosition = (textarea, index) => {
    const mirror = document.createElement('div')
    const styles = getComputedStyle(textarea)
    const copied = [
      'boxSizing', 'width', 'height', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'fontFamily', 'fontSize',
      'fontStyle', 'fontWeight', 'letterSpacing', 'lineHeight', 'textAlign', 'textIndent', 'textTransform',
      'whiteSpace', 'wordBreak', 'overflowWrap', 'tabSize',
    ]
    copied.forEach(property => { mirror.style[property] = styles[property] })
    Object.assign(mirror.style, {
      position: 'fixed', visibility: 'hidden', overflow: 'hidden', whiteSpace: 'pre-wrap', wordWrap: 'break-word',
      top: `${textarea.getBoundingClientRect().top}px`, left: `${textarea.getBoundingClientRect().left}px`,
    })
    mirror.textContent = textarea.value.slice(0, index)
    const marker = document.createElement('span')
    marker.textContent = textarea.value.slice(index, index + 1) || '\u200b'
    mirror.append(marker)
    document.body.append(mirror)
    const markerRect = marker.getBoundingClientRect()
    const textareaRect = textarea.getBoundingClientRect()
    const position = {
      left: markerRect.left,
      top: markerRect.top - textarea.scrollTop,
      bottom: markerRect.bottom - textarea.scrollTop,
      textareaRect,
    }
    mirror.remove()
    return position
  }

  const hideAutocomplete = () => {
    clearTimeout(autocompleteTimer)
    autocompleteRequest?.abort()
    autocomplete.hidden = true
    autocomplete.removeAttribute('aria-busy')
    autocomplete.replaceChildren()
    autocompleteTextarea?.removeAttribute('aria-activedescendant')
    autocompleteTextarea?.setAttribute('aria-expanded', 'false')
    autocompleteTextarea = undefined
    autocompleteMatch = undefined
  }

  const selectAutocomplete = index => {
    const option = autocomplete.querySelectorAll(':scope > .compose-autocomplete-option')[index]
    if (!(option instanceof HTMLButtonElement) || !autocompleteTextarea || !autocompleteMatch) return
    const textarea = autocompleteTextarea
    const replacement = (autocompleteMatch.replacementPrefix ?? autocompleteMatch.prefix) + option.dataset.value
    textarea.setRangeText(replacement, autocompleteMatch.start, autocompleteMatch.end, 'end')
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: replacement }))
    hideAutocomplete()
    textarea.focus()
  }

  const setAutocompleteIndex = index => {
    const options = [...autocomplete.querySelectorAll(':scope > .compose-autocomplete-option')]
    if (!options.length) return
    autocompleteIndex = (index + options.length) % options.length
    options.forEach((option, optionIndex) => option.setAttribute('aria-selected', String(optionIndex === autocompleteIndex)))
    const selected = options[autocompleteIndex]
    autocompleteTextarea?.setAttribute('aria-activedescendant', selected.id)
    selected.scrollIntoView({ block: 'nearest' })
  }

  const positionAutocomplete = () => {
    if (!autocompleteTextarea || !autocompleteMatch || autocomplete.hidden) return
    const caret = caretPosition(autocompleteTextarea, autocompleteMatch.end)
    const gap = 4
    const width = autocomplete.offsetWidth
    const height = autocomplete.offsetHeight
    const left = Math.max(8, Math.min(caret.left, innerWidth - width - 8))
    const below = caret.bottom + gap
    const top = below + height <= innerHeight - 8 ? below : Math.max(8, caret.top - height - gap)
    autocomplete.style.left = `${left}px`
    autocomplete.style.top = `${top}px`
  }

  const showAutocomplete = (textarea, match, results) => {
    if (!results.length || !sameReference(currentReference(textarea), match)) return hideAutocomplete()
    autocompleteTextarea = textarea
    autocompleteMatch = match
    autocomplete.removeAttribute('aria-busy')
    const options = results.slice(0, 5).map((result, index) => {
      const option = document.createElement('button')
      option.type = 'button'
      option.className = 'compose-autocomplete-option'
      option.id = `compose-autocomplete-option-${index}`
      option.dataset.value = typeof result === 'string' ? result : result.value
      option.setAttribute('role', 'option')
      if (typeof result === 'string') option.textContent = match.prefix + result
      else if (result.emoji) {
        const emoji = document.createElement('span')
        emoji.className = 'emoji'
        emoji.textContent = result.emoji
        option.append(emoji, ` ${result.label}`)
      }
      else option.textContent = result.label
      option.addEventListener('mousedown', event => event.preventDefault())
      option.addEventListener('click', () => selectAutocomplete(index))
      return option
    })
    const cardResult = results.find(result => typeof result !== 'string' && result.html)
    const card = cardResult && document.createElement('div')
    if (card) {
      card.className = 'compose-post-suggestion-card internal-post-popover'
      card.innerHTML = cardResult.html
    }
    autocomplete.replaceChildren(...options, ...(card ? [card] : []))
    autocomplete.hidden = false
    textarea.setAttribute('role', 'combobox')
    textarea.setAttribute('aria-autocomplete', 'list')
    textarea.setAttribute('aria-controls', autocomplete.id)
    textarea.setAttribute('aria-expanded', 'true')
    setAutocompleteIndex(0)
    positionAutocomplete()
  }

  const updateAutocomplete = textarea => {
    const match = currentReference(textarea)
    if (!match) return hideAutocomplete()
    clearTimeout(autocompleteTimer)
    autocompleteRequest?.abort()
    if (match.kind === 'emoji') {
      const results = emojiMatches(match.query)
      return results.length ? showAutocomplete(textarea, match, results) : hideAutocomplete()
    }
    if (!autocomplete.hidden && textarea === autocompleteTextarea) {
      autocompleteMatch = match
      autocomplete.setAttribute('aria-busy', 'true')
      positionAutocomplete()
    }
    autocompleteTimer = setTimeout(async () => {
      const request = new AbortController()
      autocompleteRequest = request
      try {
        const response = await fetch(`/post/suggestions?kind=${match.kind}&q=${encodeURIComponent(match.query)}`, {
          headers: { accept: 'application/json' }, signal: request.signal,
        })
        if (!response.ok) return hideAutocomplete()
        const payload = await response.json()
        if (request === autocompleteRequest) showAutocomplete(textarea, match, payload.results || [])
      }
      catch (error) {
        if (error.name !== 'AbortError') hideAutocomplete()
      }
    }, 120)
  }

  const update = textarea => {
    updateHighlight(textarea)
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
    }
    catch {
      return null
    }
  }
  const storeValue = textarea => {
    const key = textarea.dataset.composeStorageKey
    if (!key) return
    try {
      if (textarea.value) localStorage.setItem(key, textarea.value)
      else localStorage.removeItem(key)
    }
    catch {
      // Storage can be unavailable in private or restricted browser contexts.
    }
  }
  const clearStoredValue = textarea => {
    const key = textarea.dataset.composeStorageKey
    if (!key) return
    try {
      localStorage.removeItem(key)
    }
    catch {
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
    }
    catch {
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

  document.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return

    const writeAction = event.target.closest('.feed-tabs-top, .mobile-write-action a')
    if (!writeAction) return

    const textarea = document.querySelector('.embedded-write-compose textarea[name="body"]')
    if (!(textarea instanceof HTMLTextAreaElement)) return

    event.preventDefault()
    window.scrollTo({ top: 0, behavior: 'smooth' })
    const mobileTopAction = writeAction.matches('.feed-tabs-top')
      && window.matchMedia('(max-width: 600px)').matches
    if (!mobileTopAction) textarea.focus({ preventScroll: true })
  })

  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(entries => entries.forEach(entry => update(entry.target)))
    textareas.forEach(textarea => observer.observe(textarea))
  }

  document.addEventListener('input', event => {
    if (event.target instanceof HTMLTextAreaElement && event.target.matches(textareaSelector)) {
      event.target.setCustomValidity('')
      storeValue(event.target)
      update(event.target)
      updateAutocomplete(event.target)
    }
  })

  document.addEventListener('keydown', event => {
    if (!(event.target instanceof HTMLTextAreaElement) || !event.target.matches(textareaSelector)) return
    if (autocomplete.hidden || event.target !== autocompleteTextarea) {
      if (event.key === 'Escape') hideAutocomplete()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setAutocompleteIndex(autocompleteIndex + (event.key === 'ArrowDown' ? 1 : -1))
    }
    else if (event.key === 'Enter') {
      event.preventDefault()
      selectAutocomplete(autocompleteIndex)
    }
    else if (event.key === 'Escape') {
      event.preventDefault()
      hideAutocomplete()
    }
  })

  document.addEventListener('click', event => {
    if (event.target === autocompleteTextarea) {
      updateAutocomplete(event.target)
      return
    }
    if (!(event.target instanceof Element) || !event.target.closest('.compose-autocomplete')) hideAutocomplete()
  })
  document.addEventListener('selectionchange', () => {
    if (document.activeElement === autocompleteTextarea
      && !sameReference(currentReference(autocompleteTextarea), autocompleteMatch)) hideAutocomplete()
  })
  window.addEventListener('resize', positionAutocomplete)
  document.addEventListener('scroll', positionAutocomplete, true)
  document.addEventListener('scroll', event => {
    if (event.target instanceof HTMLTextAreaElement && event.target.matches(textareaSelector)) {
      const mirror = event.target.parentElement?.querySelector(':scope > .compose-highlight')
      if (mirror) {
        mirror.scrollTop = event.target.scrollTop
        mirror.scrollLeft = event.target.scrollLeft
      }
    }
  }, true)

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
