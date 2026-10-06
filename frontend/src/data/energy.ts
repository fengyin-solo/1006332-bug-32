import {
  isDateStr,
  isPeriodStr,
  readingMatchesPeriod,
  todayStr,
  READING_GRACE_DAYS,
} from './time'
import type { EntryRow } from './types'

// ============================================================================
// 廊内能耗计量：既有台账迁移、落库前校验、自检、对账，全部收口在这一个文件。
// 口径决策（改动前先读这里）：
//   1. 既有台账照原编号搬过来，按抄表日期升序落位，不重新编号。
//   2. 早年只有用电量、没有用水量的，用水量按 0 m³ 补录，自检另起一行说明；
//      原值（空）不丢，缘由写进自检报告留作对照。
//   3. 重复录入只认第一次（抄表日期最早的那份），后到的整条退回、不叠加条数，
//      退回那份的取值只留在自检报告里作对照。
//   4. 统计周期与抄表日期互相矛盾的记录保留在台账里，状态置「数据异常」，
//      自检列明缘由；抄表窗口定为周期当月加次月前 5 天（见 time.ts）。
//   5. 早年整段未登记的点位没有存量可迁，自检另起一行说明，不虚构记录。
// ============================================================================

export type EnergyFinding = {
  type: '数据依赖缺失' | '计量编号冲突' | '周期矛盾'
  code: string
  reason: string
}

/** 既有台账原始行：字段可缺，缺项就是迁移时要补、要说明的。 */
export type LegacyEnergyRow = {
  计量编号: string
  计量点位: string
  用电量?: number
  用水量?: number
  统计周期: string
  抄表人员?: string
  抄表日期?: string
  权属单位?: string
  责任岗位?: string
}

const OWNER_UNIT = '管廊运营中心'
const OWNER_POST = '能耗计量岗'

// ---------------------------------------------------------------------------
// 既有台账（2023—2024 年手工登记），原样固化进仓库，迁移脚本只读不改。
// ---------------------------------------------------------------------------
export const LEGACY_ENERGY_ROWS: LegacyEnergyRow[] = [
  {
    计量编号: 'LS-2023-001',
    计量点位: '综合舱配电室电表',
    用电量: 986.4,
    统计周期: '2023-06',
    抄表人员: '赵工',
    抄表日期: '2023-06-30',
  },
  {
    计量编号: 'LS-2023-002',
    计量点位: '综合舱给排水泵房',
    用电量: 1542.1,
    统计周期: '2023-06',
    抄表人员: '赵工',
    抄表日期: '2023-06-30',
  },
  {
    计量编号: 'LS-2024-003',
    计量点位: '综合舱配电室电表',
    用电量: 1120.8,
    用水量: 30.6,
    统计周期: '2024-06',
    抄表人员: '赵工',
    抄表日期: '2024-06-30',
  },
  {
    计量编号: 'LS-2024-004',
    计量点位: '燃气舱照明配电箱',
    用电量: 745.9,
    用水量: 11.2,
    统计周期: '2024-06',
    抄表日期: '2024-06-30',
  },
  {
    计量编号: 'LS-2024-005',
    计量点位: '电力舱通风机房',
    用电量: 1320.0,
    用水量: 18.4,
    统计周期: '2024-07',
    抄表人员: '钱工',
    抄表日期: '2024-06-29',
  },
  {
    // 同一编号后到的一份：整条退回，不进台账，取值只留在自检报告作对照。
    计量编号: 'LS-2024-005',
    计量点位: '电力舱通风机房',
    用电量: 1328.6,
    用水量: 18.4,
    统计周期: '2024-07',
    抄表人员: '钱工',
    抄表日期: '2024-07-02',
  },
]

// 早年整段未登记的点位：没有存量可迁，自检另起一行说明。
const LEGACY_GAPS: { code: string; reason: string }[] = [
  { code: '天然气舱调压站', reason: '2023 年度未登记计量记录，无存量可迁，自 2026-10 周期起新立户' },
]

// ---------------------------------------------------------------------------
// 迁移：既有台账 -> 正式台账 + 迁移自检报告
// ---------------------------------------------------------------------------
function normalizeLegacyRow(row: LegacyEnergyRow, findings: EnergyFinding[]): EntryRow {
  const findingsFor = (type: EnergyFinding['type'], reason: string) =>
    findings.push({ type, code: row.计量编号, reason })

  const 用电量 = row.用电量 ?? 0
  if (row.用电量 === undefined) {
    findingsFor('数据依赖缺失', '早年未登记用电量，按 0 kWh 补录，原值（空）留此说明作对照')
  }

  let 用水量 = row.用水量 ?? 0
  if (row.用水量 === undefined) {
    用水量 = 0
    findingsFor('数据依赖缺失', '早年只有用电量、没有用水量，用水量按 0 m³ 补录，原值（空）留此说明作对照')
  }

  const 抄表人员 = row.抄表人员 ?? '未登记'
  if (row.抄表人员 === undefined) {
    findingsFor('数据依赖缺失', '抄表人员未登记，补录为「未登记」')
  }

  const 抄表日期 = row.抄表日期 ?? ''
  if (!row.抄表日期) {
    findingsFor('数据依赖缺失', '抄表日期缺失，无法按抄表日期落位，该条需人工补登')
  }

  let status = '已核对'
  if (抄表日期 && isPeriodStr(row.统计周期) && !readingMatchesPeriod(row.统计周期, 抄表日期)) {
    status = '数据异常'
    findingsFor(
      '周期矛盾',
      `统计周期 ${row.统计周期} 与抄表日期 ${抄表日期} 互相矛盾（抄表日期须落在周期当月或次月前 ${READING_GRACE_DAYS} 天内），状态置为数据异常`,
    )
  }

  return {
    id: 0, // 落位时统一编
    status,
    pending: status !== '已核对',
    abnormal: status === '数据异常',
    计量编号: row.计量编号,
    计量点位: row.计量点位,
    用电量,
    用水量,
    统计周期: row.统计周期,
    抄表人员,
    抄表日期,
    责任岗位: row.责任岗位 ?? OWNER_POST,
    权属单位: row.权属单位 ?? OWNER_UNIT,
    计量状态: status,
  }
}

export function migrateLegacyEnergy(): { rows: EntryRow[]; findings: EnergyFinding[] } {
  const findings: EnergyFinding[] = []

  // 重复录入只认第一次：按抄表日期（缺失排最后）升序，同编号取第一份，后到整条退回。
  const groups = new Map<string, { row: LegacyEnergyRow; seq: number }[]>()
  LEGACY_ENERGY_ROWS.forEach((row, seq) => {
    const list = groups.get(row.计量编号) ?? []
    list.push({ row, seq })
    groups.set(row.计量编号, list)
  })
  const kept: LegacyEnergyRow[] = []
  for (const [code, list] of groups) {
    const sorted = [...list].sort((a, b) => {
      const da = a.row.抄表日期 ?? '9999-12-31'
      const db = b.row.抄表日期 ?? '9999-12-31'
      return da === db ? a.seq - b.seq : da < db ? -1 : 1
    })
    kept.push(sorted[0].row)
    for (const dup of sorted.slice(1)) {
      findings.push({
        type: '计量编号冲突',
        code,
        reason:
          `重复录入两份，只认第一次（抄表日期 ${sorted[0].row.抄表日期 ?? '未登记'}，` +
          `用电量 ${sorted[0].row.用电量 ?? 0} kWh），后到的一份（抄表日期 ${dup.row.抄表日期 ?? '未登记'}，` +
          `用电量 ${dup.row.用电量 ?? 0} kWh）整条退回，条数不叠加，对照值留此说明`,
      })
    }
  }

  // 按抄表日期升序落位，原编号不动。
  const migrated = kept
    .map((row) => normalizeLegacyRow(row, findings))
    .sort((a, b) => String(a.抄表日期).localeCompare(String(b.抄表日期)))

  for (const gap of LEGACY_GAPS) {
    findings.push({ type: '数据依赖缺失', code: gap.code, reason: gap.reason })
  }

  return { rows: migrated, findings }
}

// ---------------------------------------------------------------------------
// 新口径登记的记录（2026 年起），与迁移结果一起构成示例数据。
// ---------------------------------------------------------------------------
type NewEnergyRow = {
  计量编号: string
  计量点位: string
  用电量: number | ''
  用水量: number | ''
  统计周期: string
  抄表人员: string
  抄表日期: string
  status: string
  权属单位?: string
  责任岗位?: string
}

const NEW_ENERGY_ROWS: NewEnergyRow[] = [
  { 计量编号: 'ENER-0001', 计量点位: '综合舱配电室电表', 用电量: 1280.5, 用水量: 36.2, 统计周期: '2026-08', 抄表人员: '李工', 抄表日期: '2026-08-31', status: '已核对' },
  { 计量编号: 'ENER-0002', 计量点位: '燃气舱照明配电箱', 用电量: 856.3, 用水量: 12.5, 统计周期: '2026-08', 抄表人员: '王工', 抄表日期: '2026-08-31', status: '已核对' },
  { 计量编号: 'ENER-0003', 计量点位: '综合舱给排水泵房', 用电量: 2104.7, 用水量: 58.9, 统计周期: '2026-09', 抄表人员: '李工', 抄表日期: '2026-09-30', status: '已抄表', 权属单位: '自来水公司', 责任岗位: '供水计量岗' },
  { 计量编号: 'ENER-0004', 计量点位: '电力舱通风机房', 用电量: 1689.2, 用水量: 22.4, 统计周期: '2026-09', 抄表人员: '王工', 抄表日期: '2026-09-30', status: '已抄表' },
  { 计量编号: 'ENER-0005', 计量点位: '天然气舱调压站', 用电量: '', 用水量: '', 统计周期: '2026-10', 抄表人员: '', 抄表日期: '', status: '待抄表' },
  { 计量编号: 'ENER-0006', 计量点位: '综合舱应急照明', 用电量: '', 用水量: '', 统计周期: '2026-10', 抄表人员: '', 抄表日期: '', status: '待抄表' },
]

function toEntryRow(row: NewEnergyRow): EntryRow {
  return {
    id: 0,
    status: row.status,
    pending: row.status !== '已核对',
    abnormal: row.status === '数据异常',
    计量编号: row.计量编号,
    计量点位: row.计量点位,
    用电量: row.用电量,
    用水量: row.用水量,
    统计周期: row.统计周期,
    抄表人员: row.抄表人员,
    抄表日期: row.抄表日期,
    责任岗位: row.责任岗位 ?? OWNER_POST,
    权属单位: row.权属单位 ?? OWNER_UNIT,
    计量状态: row.status,
  }
}

/** 示例数据 = 迁移后的既有台账 + 新口径登记记录，id 按落位顺序统一编。 */
export function buildEnergySeedRows(): EntryRow[] {
  const { rows } = migrateLegacyEnergy()
  const all = [...rows, ...NEW_ENERGY_ROWS.map(toEntryRow)]
  return all.map((row, index) => ({ ...row, id: index + 1 }))
}

// ---------------------------------------------------------------------------
// 落库前校验：登记、自检共用这一套规则，页面不另写。
// ---------------------------------------------------------------------------
export function validateEnergyReading(values: Record<string, unknown>): string[] {
  const problems: string[] = []
  const text = (field: string) => String(values[field] ?? '').trim()

  if (!text('计量编号')) problems.push('计量编号缺失')
  if (!text('计量点位')) problems.push('计量点位缺失')
  if (!isPeriodStr(text('统计周期'))) problems.push('统计周期缺失或格式不对（应为 YYYY-MM）')
  if (!text('抄表人员')) problems.push('抄表人员缺失')

  const 用电量 = Number(values.用电量)
  if (text('用电量') === '' || Number.isNaN(用电量) || 用电量 < 0) {
    problems.push('用电量缺失或不是非负数值')
  }
  const 用水量 = Number(values.用水量)
  if (text('用水量') === '' || Number.isNaN(用水量) || 用水量 < 0) {
    problems.push('用水量缺失或不是非负数值')
  }

  const 抄表日期 = text('抄表日期')
  if (!isDateStr(抄表日期)) {
    problems.push('抄表日期缺失或格式不对（应为 YYYY-MM-DD）')
  } else {
    if (抄表日期 > todayStr()) {
      problems.push(`抄表日期 ${抄表日期} 晚于应用时区下的今天 ${todayStr()}`)
    }
    if (isPeriodStr(text('统计周期')) && !readingMatchesPeriod(text('统计周期'), 抄表日期)) {
      problems.push(
        `统计周期 ${text('统计周期')} 与抄表日期 ${抄表日期} 互相矛盾（抄表日期须落在周期当月或次月前 ${READING_GRACE_DAYS} 天内）`,
      )
    }
  }
  return problems
}

// ---------------------------------------------------------------------------
// 自检：迁移报告（每次重算，结果确定）+ 当前台账逐条复核。
// 页面上的条数必须等于这里返回的条数，两边用的是同一份列表。
// ---------------------------------------------------------------------------
export function energySelfCheck(rows: EntryRow[]): EnergyFinding[] {
  const { findings } = migrateLegacyEnergy()
  const seen = new Set(findings.map((item) => `${item.type}|${item.code}`))
  const push = (finding: EnergyFinding) => {
    const key = `${finding.type}|${finding.code}`
    if (!seen.has(key)) {
      seen.add(key)
      findings.push(finding)
    }
  }

  // 计量编号冲突：当前台账内部再查一遍（localStorage 里可能有旧数据）。
  const codeCount = new Map<string, number>()
  for (const row of rows) {
    const code = String(row.计量编号 ?? '')
    codeCount.set(code, (codeCount.get(code) ?? 0) + 1)
  }
  for (const [code, count] of codeCount) {
    if (code && count > 1) {
      push({ type: '计量编号冲突', code, reason: `当前台账里出现 ${count} 份同编号记录，只认第一次录入，其余整条退回` })
    }
  }

  for (const row of rows) {
    const code = String(row.计量编号 ?? '')
    if (row.status === '待抄表') {
      // 待抄表只要求编号、点位、周期齐全，读数允许为空。
      for (const field of ['计量编号', '计量点位', '统计周期']) {
        if (String(row[field] ?? '').trim() === '') {
          push({ type: '数据依赖缺失', code: code || '(未编号)', reason: `待抄表记录缺 ${field}` })
        }
      }
      continue
    }
    for (const problem of validateEnergyReading(row)) {
      const type = problem.includes('互相矛盾') ? '周期矛盾' : '数据依赖缺失'
      push({ type, code: code || '(未编号)', reason: problem })
    }
  }
  return findings
}

// ---------------------------------------------------------------------------
// 对账：待办 = 待抄表 + 数据异常，结论要登记进值班台账，两边条数必须对得上。
// ---------------------------------------------------------------------------
export type EnergyRecon = {
  pendingReading: number
  abnormal: number
  todo: number
  codes: string[]
}

export function energyRecon(rows: EntryRow[]): EnergyRecon {
  const pending = rows.filter((row) => row.status === '待抄表')
  const abnormal = rows.filter((row) => row.status === '数据异常')
  return {
    pendingReading: pending.length,
    abnormal: abnormal.length,
    todo: pending.length + abnormal.length,
    codes: [...pending, ...abnormal].map((row) => String(row.计量编号)),
  }
}

/** 值班台账交接事项的对账表述，台账与对账面板共用这一段文字，避免两处各写各的。 */
export function energyReconSummary(rows: EntryRow[]): string {
  const recon = energyRecon(rows)
  return `能耗对账待办 ${recon.todo} 项（待抄表 ${recon.pendingReading}、数据异常 ${recon.abnormal}）：${recon.codes.join('、')}`
}
