function expandApiAnchor() {
  const heading = document.getElementById(location.hash.slice(1))
  const section = heading?.closest('.api-docs-section')
  if (!section) return
  section.open = true
  heading.scrollIntoView()
}

expandApiAnchor()
window.addEventListener('hashchange', expandApiAnchor)
