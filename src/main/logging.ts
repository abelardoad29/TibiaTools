import { appendFileSync, existsSync, readFileSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

export interface Logger {
  info(msg: string, extra?: unknown): void
  warn(msg: string, extra?: unknown): void
  error(msg: string, extra?: unknown): void
  tail(lines: number): string[]
}

const MAX_BYTES = 2 * 1024 * 1024

/** Log de texto rotado a 2 MB. No registra datos sensibles: solo mensajes y errores. */
export function createLogger(dir: string | null): Logger {
  const file = dir ? join(dir, 'app.log') : null
  const write = (level: string, msg: string, extra?: unknown) => {
    const detail = extra instanceof Error ? ` ${extra.message}` : extra !== undefined ? ` ${JSON.stringify(extra)}` : ''
    const line = `${new Date().toISOString()} ${level} ${msg}${detail}\n`
    if (level !== 'INFO' || !file) process.stderr.write(line)
    if (!file) return
    try {
      if (existsSync(file) && statSync(file).size > MAX_BYTES) renameSync(file, `${file}.1`)
      appendFileSync(file, line, 'utf8')
    } catch {
      // El log nunca debe tumbar la app.
    }
  }
  return {
    info: (m, e) => write('INFO', m, e),
    warn: (m, e) => write('WARN', m, e),
    error: (m, e) => write('ERROR', m, e),
    tail: (n) => (file && existsSync(file) ? readFileSync(file, 'utf8').trimEnd().split('\n').slice(-n) : []),
  }
}
