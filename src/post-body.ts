export const POST_MAX = 500
export const POST_MAX_LINES = 15

// Textareas expose line breaks as \n, but form submission may serialize them as
// \r\n. Store and validate the textarea value's canonical representation so a
// line break is consistently one character.
export function normalizePostBody(body: string) {
  return body.replace(/\r\n?/g, '\n')
}

export function validPostBody(body: string) {
  return body.trim().length >= 1 && body.length <= POST_MAX && postBodyLineCount(body) <= POST_MAX_LINES
}

export function postBodyLineCount(body: string) {
  return body.split('\n').length
}

export function postBodyValidationMessage(body: string) {
  const exceeded: string[] = []
  if (body.length > POST_MAX) exceeded.push(`${body.length}/${POST_MAX} characters`)

  const lines = postBodyLineCount(body)
  if (lines > POST_MAX_LINES) exceeded.push(`${lines}/${POST_MAX_LINES} lines`)

  return exceeded.length
    ? `The note exceeds the limit: ${exceeded.join(' and ')}.`
    : `The note must contain between 1 and ${POST_MAX} characters.`
}
