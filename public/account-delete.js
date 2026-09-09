for (const select of document.querySelectorAll('[data-account-delete-reason]')) {
  const other = select.form?.querySelector('.account-delete-other')
  if (!other) continue
  const sync = () => {
    other.hidden = select.value !== 'other'
  }
  select.addEventListener('change', sync)
  sync()
}
