export const POST_MAX = 280

// Textareas expose line breaks as \n, but form submission may serialize them as
// \r\n. Store and validate the textarea value's canonical representation so a
// line break is consistently one character.
export function normalizePostBody(body: string) {
  return body.replace(/\r\n?/g, '\n')
}

export function validPostBody(body: string) {
  return body.trim().length >= 1 && body.length <= POST_MAX
}
