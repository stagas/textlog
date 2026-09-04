const ansiPattern = /\x1b\[[0-?]*[ -/]*[@-~]/g

export function httpLogPath(value: string) {
  const fields = value.replace(ansiPattern, '').split(/\s{2,}/)
  if (fields[0] !== 'http' || !/^[A-Z]+$/.test(fields[1] || '')) return null
  const path = fields[6]
  return path?.startsWith('/') && !path.startsWith('//') ? path : null
}
