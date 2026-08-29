import vm from 'node:vm'
import { logError, logInfo } from './log'

export type ExecutableCode = { language: string; code: string }

const EXEC_TIMEOUT_MS = 10_000
const MAX_OUTPUT_LENGTH = 20_000
const MAX_OUTPUT_LINES = 10
const MAX_OUTPUT_LINE_LENGTH = 200
const SANDBOX_FATAL_SIGNAL = 'Sandbox keeper received fatal signal 6'
const PISTON_LANGUAGE_ALIASES: Record<string, string> = {
  js: 'javascript',
  py: 'python',
  rb: 'ruby',
  sh: 'bash',
  shell: 'bash',
  ts: 'typescript',
}

function executionMarkerEnd(body: string) {
  let offset = 0
  let fenced = false
  for (const rawLine of body.split('\n')) {
    const line = rawLine.replace(/\r$/, '')
    if (/^\s*```/.test(line)) fenced = !fenced
    else if (!fenced && /(?:^|\s)#exec\s*$/.test(line)) return offset + rawLine.length
    offset += rawLine.length + 1
  }
  return null
}

export function executableCode(body: string): ExecutableCode | null {
  const markerEnd = executionMarkerEnd(body)
  if (markerEnd === null) return null
  const afterMarker = body.slice(markerEnd)
  const match = /(?:^|\n)[ \t]*```([A-Za-z0-9_+.#-]+)[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```(?:\r?\n|$)/.exec(afterMarker)
  if (!match) return null
  return { language: match[1].toLowerCase(), code: match[2] }
}

function boundedExecutionOutput(value: string) {
  return value.length <= MAX_OUTPUT_LENGTH ? value : `${value.slice(0, MAX_OUTPUT_LENGTH - 1)}…`
}

export function displayedExecutionOutput(value: string) {
  const normalized = value.replace(/\r\n?/g, '\n').split('\n')
    .filter(line => !line.includes(SANDBOX_FATAL_SIGNAL)).join('\n').trimEnd()
  const lines = normalized.split('\n')
  const lineLimited = lines.length > MAX_OUTPUT_LINES
    ? [...lines.slice(0, MAX_OUTPUT_LINES - 2), '…', lines.at(-1)!]
    : lines
  return lineLimited.map(line => line.length <= MAX_OUTPUT_LINE_LENGTH
    ? line
    : `${line.slice(0, MAX_OUTPUT_LINE_LENGTH - 1)}…`).join('\n')
}

async function executeDevelopment(code: ExecutableCode) {
  if (!['js', 'javascript'].includes(code.language)) {
    return `Execution error: development mode only supports JavaScript (received ${code.language}).`
  }
  const output: string[] = []
  const write = (...values: unknown[]) => output.push(values.map(value =>
    typeof value === 'string' ? value : Bun.inspect(value)).join(' '))
  const context = vm.createContext({
    console: { log: write, info: write, warn: write, error: write },
  }, { codeGeneration: { strings: false, wasm: false } })
  try {
    const result = new vm.Script(`(async () => {\n${code.code}\n})()`, { filename: `note.${code.language}` })
      .runInContext(context, { timeout: EXEC_TIMEOUT_MS })
    await Promise.race([
      result,
      new Promise((_, reject) => setTimeout(() => reject(new Error('execution timed out')), EXEC_TIMEOUT_MS)),
    ])
  }
  catch (error) {
    output.push(`Execution error: ${error instanceof Error ? error.message : String(error)}`)
  }
  return boundedExecutionOutput(output.join('\n'))
}

async function executePiston(code: ExecutableCode, pistonUrl: string) {
  const response = await fetch(new URL('/api/v2/execute', pistonUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      language: PISTON_LANGUAGE_ALIASES[code.language] || code.language,
      version: '*',
      files: [{ content: code.code }],
    }),
    signal: AbortSignal.timeout(EXEC_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`Piston returned HTTP ${response.status}`)
  const result = await response.json() as {
    message?: string
    compile?: { output?: string; stderr?: string; message?: string }
    run?: { output?: string; stderr?: string; message?: string }
  }
  const outputs = [result.compile?.output, result.run?.output]
  const output = outputs.find(value => value && displayedExecutionOutput(value).trim())
  const errors = [result.compile?.stderr, result.run?.stderr, result.compile?.message, result.run?.message,
    result.message]
  const error = errors.find(value => value && displayedExecutionOutput(value).trim())
  return boundedExecutionOutput(output || error || outputs.find(value => value) || '')
}

export async function executePostCode(body: string, environment = Bun.env.NODE_ENV,
  pistonUrl = Bun.env.PISTON_URL): Promise<string | null>
{
  const code = executableCode(body)
  if (!code) {
    if (executionMarkerEnd(body) !== null) {
      logInfo('code execution status=skipped reason=missing_language_fence')
    }
    return null
  }
  const startedAt = performance.now()
  try {
    const output = environment === 'production'
      ? await executePiston(code, pistonUrl?.trim() || (() => { throw new Error('PISTON_URL is not configured') })())
      : await executeDevelopment(code)
    logInfo(`code execution language=${code.language} status=succeeded output_bytes=${Buffer.byteLength(output)} `
      + `duration_ms=${Math.round(performance.now() - startedAt)}`)
    return output
  }
  catch (error) {
    logError(`code execution language=${code.language} status=failed `
      + `duration_ms=${Math.round(performance.now() - startedAt)}`, error)
    return boundedExecutionOutput(`Execution error: ${error instanceof Error ? error.message : String(error)}`)
  }
}
