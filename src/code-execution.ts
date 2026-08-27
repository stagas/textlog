import vm from 'node:vm'

export type ExecutableCode = { language: string; code: string }

const EXEC_TIMEOUT_MS = 10_000
const MAX_OUTPUT_LENGTH = 20_000

export function executableCode(body: string): ExecutableCode | null {
  if (!body.split(/\r?\n/).some(line => /^\s*#exec\s*$/.test(line))) return null
  const match = /(?:^|\n)[ \t]*```([A-Za-z0-9_+.#-]+)[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```(?:\r?\n|$)/.exec(body)
  if (!match) return null
  return { language: match[1].toLowerCase(), code: match[2] }
}

function limitedOutput(value: string) {
  return value.length <= MAX_OUTPUT_LENGTH ? value : `${value.slice(0, MAX_OUTPUT_LENGTH)}\n… output truncated`
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
  return limitedOutput(output.join('\n'))
}

async function executePiston(code: ExecutableCode, pistonUrl: string) {
  const response = await fetch(new URL('/api/v2/execute', pistonUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ language: code.language, version: '*', files: [{ content: code.code }] }),
    signal: AbortSignal.timeout(EXEC_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`Piston returned HTTP ${response.status}`)
  const result = await response.json() as {
    message?: string
    compile?: { output?: string }
    run?: { output?: string }
  }
  return limitedOutput(result.compile?.output || result.run?.output || result.message || '')
}

export async function executePostCode(body: string, environment = Bun.env.NODE_ENV,
  pistonUrl = Bun.env.PISTON_URL): Promise<string | null>
{
  const code = executableCode(body)
  if (!code) return null
  try {
    return environment === 'production'
      ? await executePiston(code, pistonUrl?.trim() || (() => { throw new Error('PISTON_URL is not configured') })())
      : await executeDevelopment(code)
  }
  catch (error) {
    return limitedOutput(`Execution error: ${error instanceof Error ? error.message : String(error)}`)
  }
}
