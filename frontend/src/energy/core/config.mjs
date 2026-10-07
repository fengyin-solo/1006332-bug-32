/**
 * 廊内能耗计量 —— 运行配置。
 *
 * 流水线固化原则：
 *  - 计量口径（时区、统计周期规则、早年只用电补水量口径、优先级）属于「规则」，
 *    全部在本文件冻结，本地与容器读到的是同一份，不许被环境变量改写。
 *  - 只有「运行环境差异」（当前岗位/单位、是否只读）允许从环境变量注入，
 *    且都带固化默认值，保证本地与线上无注入时表现一致。
 */

// 统计周期与抄表日期一律按上海时区归账，杜绝容器默认 UTC 导致跨月错位。
export const BILLING_TIMEZONE = 'Asia/Shanghai'
export const TZ_OFFSET_MINUTES = 8 * 60

// 计量周期：自然月，格式 YYYY-MM。
export const PERIOD_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/

/**
 * 早年只有用电量、没有用水量的补录口径（由本方案拍板，全环境唯一）：
 *  - 采用：用水量补 0（保守口径，不虚构用水），并打 waterBackfilled=true 说明。
 *  - 另一种取值「按该点位装表后月均用水量回填」只留作对照，写入 waterAlternative，
 *    永远不参与落库合计。
 */
export const WATER_FILL_POLICY = Object.freeze({
  effective: 'zero', // 生效口径：补 0
  effectiveLabel: '早年无水量表，用水量按 0 补录（保守口径，不虚构）',
  alternative: 'postInstallMonthlyAverage', // 对照口径：装表后月均，仅对照
  alternativeLabel: '装表后月均用水量（仅对照，不计入合计）',
})

/**
 * 冲突 / 重复优先级（由本方案拍板）：
 *  - 同一计量编号重复录入：只认最早抄表日期的第一次那份；后到的整条退回，不叠加条数。
 *  - 跨单位：外单位记录只读，越权提交一律拒绝；被改动记录仍归原岗位。
 *  - 既有台账沿用原编号；早年没登记（点位不在点位册）的项另起一行说明，新编号前缀 ENER-UNREG-。
 */
export const PRIORITY_RULES = Object.freeze({
  duplicate: 'firstReadingWins',
  duplicateLabel: '同编号重复录入只认最早抄表日期的第一次，后到整条退回，条数不叠加',
  conflictRenumberPrefix: 'ENER-LEGACY-',
  unregisteredPrefix: 'ENER-UNREG-',
  crossUnit: 'readOnly',
  crossUnitLabel: '跨单位只读：外单位记录可见但不可改，越权提交拒绝，记录仍归原岗位',
})

// 校验：落库前拦截 / 归账后待办的问题类型。
export const ISSUE_TYPES = Object.freeze({
  MISSING_DEPENDENCY: 'missing-dependency',
  CODE_CONFLICT: 'code-conflict',
  PERIOD_DATE_CONTRADICTION: 'period-date-contradiction',
})

const DEFAULTS = Object.freeze({
  operatorName: '值班管理员',
  operatorPost: '能耗计量岗',
  operatorUnit: '运维一处',
  operatorUnitCode: 'UNIT-A',
  // 只读跨单位视角切换：默认关闭（本岗位可写、外单位只读）。
  readOnlyCrossUnit: true,
})

function pick(env, key, fallback) {
  const v = env && env[key]
  return v === undefined || v === '' ? fallback : v
}

/**
 * @param {Record<string,string|undefined>} [env]
 * @returns {Readonly<{
 *   operatorName:string, operatorPost:string, operatorUnit:string,
 *   operatorUnitCode:string, readOnlyCrossUnit:boolean,
 *   timezone:string, tzOffsetMinutes:number
 * }>}
 */
export function loadRuntimeConfig(env = {}) {
  return Object.freeze({
    operatorName: pick(env, 'VITE_OPERATOR_NAME', DEFAULTS.operatorName),
    operatorPost: pick(env, 'VITE_OPERATOR_POST', DEFAULTS.operatorPost),
    operatorUnit: pick(env, 'VITE_OPERATOR_UNIT', DEFAULTS.operatorUnit),
    operatorUnitCode: pick(env, 'VITE_OPERATOR_UNIT_CODE', DEFAULTS.operatorUnitCode),
    readOnlyCrossUnit: String(pick(env, 'VITE_READONLY_CROSS_UNIT', 'true')) !== 'false',
    timezone: BILLING_TIMEZONE,
    tzOffsetMinutes: TZ_OFFSET_MINUTES,
  })
}

// 环境变量来源：Node CLI/构建期读 process.env；浏览器运行期读 Vite 注入的 import.meta.env。
// 两处都拿不到时使用 DEFAULTS，保证无注入时本地与容器行为一致。
const nodeProcess = typeof globalThis !== 'undefined' ? globalThis.process : undefined
const rawEnv = nodeProcess && nodeProcess.versions && nodeProcess.versions.node
  ? nodeProcess.env
  : // @ts-ignore Vite 在浏览器构建期注入 import.meta.env
    (typeof import.meta !== 'undefined' && import.meta.env) || {}

export const runtime = loadRuntimeConfig(rawEnv)
