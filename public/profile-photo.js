;(() => {
  const input = document.querySelector('.profile-photo-field input[type="file"]')
  if (!input) return
  const picker = input.closest('.profile-photo-field').querySelector('.profile-photo-upload')
  if (!picker) return
  picker.append(input)
  const original = picker.querySelector('img, svg')
  let preview
  let selection = 0

  const clearPreview = () => {
    preview?.remove()
    preview = undefined
    if (original) original.style.removeProperty('display')
  }

  input.addEventListener('change', () => {
    const file = input.files?.[0]
    if (!file) return
    const currentSelection = ++selection
    const reader = new FileReader()
    reader.addEventListener('load', () => {
      if (currentSelection !== selection) return
      clearPreview()
      preview = document.createElement('img')
      preview.alt = 'Selected profile photo'
      preview.addEventListener('error', clearPreview, { once: true })
      preview.src = reader.result
      if (original) original.style.display = 'none'
      picker.insertBefore(preview, input)
      const remove = input.form?.querySelector('input[name="removePhoto"]')
      if (remove) remove.checked = false
    })
    reader.readAsDataURL(file)
  })

  input.form?.addEventListener('reset', () => {
    selection++
    clearPreview()
  })
})()
