export function maskEmail(email: string) {
  const at = email.lastIndexOf('@')
  if (at <= 0 || at === email.length - 1) return email
  return `${email[0]}•••${email.slice(at)}`
}
