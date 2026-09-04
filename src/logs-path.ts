const ansiPattern = /\x1b\[[0-?]*[ -/]*[@-~]/g

function httpFields(value: string) {
  const fields = value.replace(ansiPattern, '').split(/\s{2,}/)
  const httpIndex = fields.findIndex(field => /(?:^|\s)http$/.test(field))
  return httpIndex !== -1 && /^[A-Z]+$/.test(fields[httpIndex + 1] || '') ? { fields, httpIndex } : null
}

export function httpLogPath(value: string) {
  const parsed = httpFields(value)
  if (!parsed) return null
  const { fields, httpIndex } = parsed
  const path = fields[httpIndex + 6]
  return path?.startsWith('/') && !path.startsWith('//') ? path : null
}

export function httpLogUsername(value: string) {
  const parsed = httpFields(value)
  if (!parsed) return null
  const username = parsed.fields[parsed.httpIndex + 5]
  return username?.startsWith('@') && username.length > 1 ? username.slice(1) : null
}
