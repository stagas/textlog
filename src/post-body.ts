export const POST_MAX = 280
export const POST_MAX_LINES = 10

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

export function postBodyValidationMessage(body: string, subject = 'Posts') {
  return postBodyLineCount(body) > POST_MAX_LINES
    ? `${subject} can contain up to ${POST_MAX_LINES} lines. Please reduce the number of lines.`
    : `${subject} must contain between 1 and ${POST_MAX} characters.`
}
