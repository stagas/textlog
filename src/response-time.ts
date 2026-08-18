export const RESPONSE_TIME_PLACEHOLDER = '__TEXTLOG_RESPONSE_TIME__'

export function updateResponseTime(html: string, elapsedMs: number) {
  return html.replaceAll(RESPONSE_TIME_PLACEHOLDER, `${Math.max(0, Math.round(elapsedMs))}ms`)
}
