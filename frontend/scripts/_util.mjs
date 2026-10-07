// 共享工具：定位前端根目录、固化输出目录、统一报告写入。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const FRONTEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const REPORTS_DIR = path.join(FRONTEND_ROOT, 'reports')

export function ensureReportsDir() {
  fs.mkdirSync(REPORTS_DIR, { recursive: true })
}

export function writeReport(name, data) {
  ensureReportsDir()
  const target = path.join(REPORTS_DIR, name)
  fs.writeFileSync(target, typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n')
  return target
}

export function line(text = '') {
  process.stdout.write(`${text}\n`)
}

export function fail(text) {
  process.stderr.write(`✗ ${text}\n`)
  process.exitCode = 1
}
