/**
 * 廊内能耗计量 · 单一事实流水线（single source of truth）。
 *
 * 同一份代码、同一份固化样例，在本地与容器跑出完全相同的结果：
 *   点位册 + 存量台账 + 2026-10 抄表批次
 *     -> 迁移(按抄表日期) -> 录入校验 -> 待抄表占位
 *     -> landed 全量记录 + 自检问题 + 对账待办
 *
 * 页面列表、详情、统计卡片、自检清单、对账报告、值班台账条数全部取自这里，
 * 因此「列表数字 = 详情取值」「自检条数 = 页面异常条数」「对账待办 = 值班台账」天然一致。
 */
import pointsFixture from '../fixtures/points.json' with { type: 'json' }
import legacyFixture from '../fixtures/legacy-ledger.json' with { type: 'json' }
import intakeFixture from '../fixtures/intake-batch.json' with { type: 'json' }
import { runtime as defaultRuntime } from './config.mjs'
import { migrateLegacy } from './migration.mjs'
import { processIntake } from './intake.mjs'
import { buildPending } from './schedule.mjs'
import { reconcile, summarizeIssues } from './reconcile.mjs'

export const CURRENT_PERIOD = intakeFixture.period

/** 运行整条流水线。runtime 可注入（测试/换岗视角），默认用固化配置。 */
export function runPipeline(runtime = defaultRuntime) {
  const points = pointsFixture.points
  const legacy = migrateLegacy({ rows: legacyFixture.rows, points })
  const intake = processIntake({
    batch: intakeFixture,
    points,
    runtime,
    startId: legacy.rows.length + 1,
  })

  const landedBase = [...legacy.rows, ...intake.rows]
  const pending = buildPending({
    points,
    landed: landedBase,
    period: CURRENT_PERIOD,
    operatorUnitCode: runtime.operatorUnitCode,
  })

  // 重新连续编号，保证 id 与列表顺序稳定（迁移 -> 录入 -> 待抄表）。
  const rows = [...landedBase, ...pending].map((r, i) => ({ ...r, id: i + 1 }))

  const issues = [...legacy.issues, ...intake.issues]
  const selfCheck = summarizeIssues(issues)
  const reconciliation = reconcile(issues, { period: CURRENT_PERIOD, operatorUnitCode: runtime.operatorUnitCode })

  return {
    period: CURRENT_PERIOD,
    runtime: {
      operatorName: runtime.operatorName,
      operatorPost: runtime.operatorPost,
      operatorUnit: runtime.operatorUnit,
      operatorUnitCode: runtime.operatorUnitCode,
      readOnlyCrossUnit: runtime.readOnlyCrossUnit,
      timezone: runtime.timezone,
    },
    points,
    rows,
    rejected: intake.rejected,
    issues,
    selfCheck,
    reconciliation,
    stats: computeStats(rows),
  }
}

export function computeStats(rows) {
  const pendingMeter = rows.filter((r) => r.status === '待抄表').length
  const verified = rows.filter((r) => r.status === '已核对').length
  const abnormal = rows.filter((r) => r.status === '数据异常').length
  return {
    total: rows.length,
    pendingMeter,
    verified,
    abnormal,
    byStatus: { 待抄表: pendingMeter, 已核对: verified, 数据异常: abnormal },
  }
}

let cached = null
/** 页面用：惰性单例，保证整页各处读到同一份结果。 */
export function getPipeline(runtime = defaultRuntime) {
  if (!cached || cached.runtime.operatorUnitCode !== runtime.operatorUnitCode) {
    cached = runPipeline(runtime)
  }
  return cached
}

export function resetPipelineCache() {
  cached = null
}

export { pointsFixture, legacyFixture, intakeFixture }
