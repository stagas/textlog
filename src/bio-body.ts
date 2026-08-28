export const BIO_MAX = 160
export const BIO_MAX_LINES = 10

export function normalizeBioBody(body: string) {
  return body.replace(/\r\n?/g, '\n')
}

export function bioBodyLineCount(body: string) {
  return body.split('\n').length
}

export function validBioBody(body: string) {
  return body.length <= BIO_MAX && bioBodyLineCount(body) <= BIO_MAX_LINES
}

export function bioBodyValidationMessage(body: string) {
  const exceeded: string[] = []
  if (body.length > BIO_MAX) exceeded.push(`${body.length}/${BIO_MAX} characters`)

  const lines = bioBodyLineCount(body)
  if (lines > BIO_MAX_LINES) exceeded.push(`${lines}/${BIO_MAX_LINES} lines`)

  return `The bio exceeds the limit: ${exceeded.join(' and ')}.`
}
