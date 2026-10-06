// 统一时区口径：统计周期、抄表日期、对账截止日全部按同一个时区换算，
// 本地、容器、线上读到的才是同一份数。时区只从配置读（VITE_APP_TZ），代码里不写死偏移。
export const APP_TIME_ZONE = import.meta.env.VITE_APP_TZ || 'Asia/Shanghai'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/

/** 应用时区下的「今天」，格式 YYYY-MM-DD。 */
export function todayStr(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function isDateStr(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) {
    return false
  }
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  )
}

/** 统计周期格式 YYYY-MM。 */
export function isPeriodStr(value: unknown): value is string {
  return typeof value === 'string' && PERIOD_RE.test(value)
}

/** 抄表日期所属的统计周期：直接按字符串取前 7 位，不经过 Date，避免时区漂移。 */
export function periodOfDate(dateStr: string): string {
  return dateStr.slice(0, 7)
}

/** 周期起始日，如 2026-09 -> 2026-09-01。 */
export function periodStart(period: string): string {
  return `${period}-01`
}

/** 周期次月起始日，如 2026-09 -> 2026-10-01；跨年 2026-12 -> 2027-01-01。 */
export function periodEndExclusive(period: string): string {
  const year = Number(period.slice(0, 4))
  const month = Number(period.slice(5, 7))
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`
}

/** 日期加 N 天（纯字符串日期运算，走 UTC 正午避免任何时区取舍）。 */
export function addDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day, 12))
  date.setUTCDate(date.getUTCDate() + days)
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * 抄表日期与统计周期是否对得上：抄表日期落在周期当月，或周期结束后 5 天抄表窗口内。
 * 窗口天数是定死的口径，两个环境用同一份代码同一个配置，不会再各算各的。
 */
export const READING_GRACE_DAYS = 5

export function readingMatchesPeriod(period: string, dateStr: string): boolean {
  if (!isPeriodStr(period) || !isDateStr(dateStr)) {
    return false
  }
  const start = periodStart(period)
  const windowEnd = addDays(periodEndExclusive(period), READING_GRACE_DAYS - 1)
  return dateStr >= start && dateStr <= windowEnd
}
