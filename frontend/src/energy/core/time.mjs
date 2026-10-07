/**
 * 时区安全的日期 / 统计周期工具。
 * 全链路只认 YYYY-MM-DD 与 YYYY-MM 字符串，并统一按上海时区 (+08:00) 归账，
 * 不依赖容器本地时区，也不使用会随环境漂移的 Date 解析。
 */
import { TZ_OFFSET_MINUTES, PERIOD_REGEX } from './config.mjs'

const DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/

/** 严格解析 YYYY-MM-DD，非法返回 null（不交给 new Date 做环境相关解析）。 */
export function parseDate(input) {
  if (typeof input !== 'string') return null
  const m = input.match(DATE_REGEX)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  // 用 UTC 构造再校验回填，避免 2/30 之类的非法日期漏网。
  const utc = new Date(Date.UTC(year, month - 1, day))
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) {
    return null
  }
  return { year, month, day, utc }
}

export function isValidDate(input) {
  return parseDate(input) !== null
}

export function isValidPeriod(input) {
  return typeof input === 'string' && PERIOD_REGEX.test(input)
}

/** 取某个 UTC 时刻在上海时区下对应的账期 YYYY-MM。 */
export function periodFromInstant(instantMs) {
  const shifted = new Date(instantMs + TZ_OFFSET_MINUTES * 60 * 1000)
  const y = shifted.getUTCFullYear()
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

/** 取某个上海时区日期对应的账期 YYYY-MM。 */
export function periodOfDate(dateStr) {
  const d = parseDate(dateStr)
  if (!d) return null
  return `${d.year}-${String(d.month).padStart(2, '0')}`
}

/**
 * 账期与抄表日期是否一致。
 * 规则：抄表日期落在统计周期所在自然月内才算一致（月末抄表、次月归账不允许错位）。
 */
export function periodMatchesDate(period, dateStr) {
  if (!isValidPeriod(period)) return false
  return periodOfDate(dateStr) === period
}

/** 日期先后比较：a<b 返回 -1，相等 0，非法日期排到最后。 */
export function compareDateAsc(a, b) {
  const da = parseDate(a)
  const db = parseDate(b)
  if (!da && !db) return 0
  if (!da) return 1
  if (!db) return -1
  return da.utc.getTime() - db.utc.getTime()
}

/** 把读数格式化为两位小数的数值，空值返回 null（不用 NaN 落库）。 */
export function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}
