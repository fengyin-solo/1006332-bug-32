/**
 * 廊内能耗计量 · 页面服务（类型化封装）。
 * 页面不自己拼数据：列表、详情、统计、自检、对账全部取自 energy/core/pipeline 这一条流水线，
 * 所以列表数字与详情取值必然一致，自检条数与页面异常条数必然相等。
 */
// @ts-ignore core 为 .mjs 单一事实源（Node CLI 与浏览器共用），见 tsconfig allowJs
import { getPipeline, CURRENT_PERIOD } from './core/pipeline.mjs'
// @ts-ignore
import { runtime } from './core/config.mjs'
// @ts-ignore
import { guardAction } from './core/permission.mjs'

export type EnergyRow = {
  id: number
  meterCode: string | null
  pointCode: string
  pointName: string
  period: string
  readingDate: string | null
  electricityKwh: number | null
  waterTon: number | null
  waterBackfilled: boolean
  waterAlternative: number | null
  waterPolicy: string | null
  waterNote: string
  reader: string | null
  ownerUnitCode: string
  ownerUnit: string
  responsiblePost: string
  status: '待抄表' | '已抄表' | '已核对' | '数据异常'
  pending: boolean
  dataAbnormal: boolean
  origin: 'legacy' | 'intake' | 'schedule'
  originalMeterCode: string | null
  alternativeReading: { electricityKwh: number | null; waterTon: number | null; readingDate?: string; note: string } | null
  codeNote: string
  problems: string[]
}

export type Issue = {
  type: 'missing-dependency' | 'code-conflict' | 'period-date-contradiction'
  reason: string
  meterCode: string
  pointCode: string
  readingDate: string
  source: 'legacy' | 'intake'
}

export type ReconTodo = {
  todoCode: string
  type: string
  typeLabel: string
  meterCode: string
  pointCode: string
  source: string
  reason: string
  status: string
}

export type Rejected = {
  meterCode: string
  pointCode: string
  reason: string
  rule: 'duplicate' | 'cross-unit'
}

export type EnergyState = {
  period: string
  rows: EnergyRow[]
  issues: Issue[]
  todos: ReconTodo[]
  rejected: Rejected[]
  stats: {
    total: number
    pendingMeter: number
    verified: number
    abnormal: number
    byStatus: Record<string, number>
  }
  issueCounts: Record<string, number>
  issueTotal: number
  runtime: { operatorPost: string; operatorUnit: string; operatorUnitCode: string; timezone: string }
}

function snapshot(): EnergyState {
  const p = getPipeline(runtime)
  return {
    period: p.period,
    rows: p.rows as EnergyRow[],
    issues: p.issues as Issue[],
    todos: p.reconciliation.todos as ReconTodo[],
    rejected: p.rejected as Rejected[],
    stats: p.stats,
    issueCounts: p.selfCheck.counts,
    issueTotal: p.selfCheck.total,
    runtime: p.runtime,
  }
}

// 页面内可变状态只允许一个动作：把本单位「待抄表」点位录成一条已核对读数。
// 该动作不新增/删除条数（待抄表 1 条原地变已核对），因此自检/对账条数保持不变。
let live: EnergyState = snapshot()
let lastMeterSeq = 1000

export function getEnergyState(): EnergyState {
  return live
}

export function findRow(id: number): EnergyRow | undefined {
  return live.rows.find((r) => r.id === id)
}

/** 跨单位只读：外单位/待认领点位的任何提交都拒绝，记录仍归原岗位。 */
export function submitMeterReading(
  id: number,
  reading: { electricityKwh: number | null; waterTon: number | null; reader: string; readingDate: string },
): { ok: boolean; message: string } {
  const row = findRow(id)
  if (!row) return { ok: false, message: '没有找到该计量记录' }

  const guard = guardAction(row, runtime, '提交抄表')
  if (!guard.ok) return guard

  if (row.status !== '待抄表') {
    return { ok: false, message: `该记录当前为「${row.status}」，不在待抄表状态，不能重复提交` }
  }
  if (reading.electricityKwh === null && reading.waterTon === null) {
    return { ok: false, message: '计量数据落库前校验未通过：用电量、用水量不能同时为空' }
  }

  live = {
    ...live,
    rows: live.rows.map((r) =>
      r.id === id
        ? {
            ...r,
            status: '已核对',
            pending: false,
            dataAbnormal: false,
            meterCode: `ENER-NEW-${String(++lastMeterSeq)}`,
            readingDate: reading.readingDate,
            electricityKwh: reading.electricityKwh,
            waterTon: reading.waterTon,
            reader: reading.reader,
            codeNote: '待抄表点位本岗位录入，编号按本批次顺延',
          }
        : r,
    ),
  }
  recomputeStats()
  return { ok: true, message: '校验通过并已落库：待抄表点位更新为已核对（条数不变）' }
}

function recomputeStats() {
  const rows = live.rows
  live = {
    ...live,
    stats: {
      ...live.stats,
      total: rows.length,
      pendingMeter: rows.filter((r) => r.status === '待抄表').length,
      verified: rows.filter((r) => r.status === '已核对').length,
      abnormal: rows.filter((r) => r.status === '数据异常').length,
      byStatus: {
        待抄表: rows.filter((r) => r.status === '待抄表').length,
        已核对: rows.filter((r) => r.status === '已核对').length,
        数据异常: rows.filter((r) => r.status === '数据异常').length,
      },
    },
  }
}

export function resetEnergyState(): EnergyState {
  live = snapshot()
  return live
}

export function canWriteRow(row: EnergyRow): boolean {
  return row.ownerUnitCode === runtime.operatorUnitCode
}

export { CURRENT_PERIOD }
