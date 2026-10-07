/**
 * 存量能耗台账迁移。
 *
 * 固化口径（见 config.mjs）：
 *  1) 按抄表日期升序迁移；同一天用台账原顺序兜底，保证「第一次」可复现。
 *  2) 既有点位沿用原计量编号；点位不在点位册的，另起一行（ENER-UNREG-）并说明。
 *  3) 计量编号冲突：最早抄表那份保留原编号；后到的另起 ENER-LEGACY- 编号，
 *     原编号与原读数留作对照，不覆盖、不删第一条。
 *  4) 早年只有用电量没用水量且抄表日早于该点装表日：用水量按 0 补录（保守口径），
 *     「装表后月均」只写入对照值 waterAlternative，不参与合计。
 *  5) 依赖缺失 / 编号冲突 / 统计周期与抄表日期矛盾：标 dataAbnormal，产生自检问题。
 */
import { PRIORITY_RULES, WATER_FILL_POLICY, ISSUE_TYPES } from './config.mjs'
import { compareDateAsc, isValidDate, isValidPeriod, periodMatchesDate } from './time.mjs'

function indexPoints(points) {
  return new Map(points.map((p) => [p.pointCode, p]))
}

/** 该读数的缺失用水量是否适用「早年补录」：点位在册、装表日晚于抄表日。 */
function qualifiesZeroBackfill(point, row) {
  if (!point || !point.waterMeterInstalledFrom) return false
  if (row.waterTon !== null && row.waterTon !== undefined) return false
  return compareDateAsc(row.readingDate, point.waterMeterInstalledFrom) < 0
}

/** 装表后月均用水量（对照口径）：取该点装表后、已抄水量的迁移记录均值。 */
export function computeWaterAlternative(pointCode, landed) {
  const candidate = landed
    .filter((r) => r.pointCode === pointCode && r.waterTon !== null && !r.waterBackfilled)
    .map((r) => ({ waterTon: r.waterTon, readingDate: r.readingDate }))
  if (candidate.length === 0) return null
  const avg = candidate.reduce((s, r) => s + Number(r.waterTon), 0) / candidate.length
  return Math.round(avg * 100) / 100
}

/**
 * @returns {{rows: Array, issues: Array, renumberSeq: number}}
 */
export function migrateLegacy({ rows: rawRows, points }) {
  const pointIndex = indexPoints(points)
  // 先记下原顺序，再按 (抄表日期, 原顺序) 稳定排序。
  const ordered = rawRows
    .map((row, originalIndex) => ({ row, originalIndex }))
    .sort((a, b) => {
      const cmp = compareDateAsc(a.row.readingDate, b.row.readingDate)
      return cmp !== 0 ? cmp : a.originalIndex - b.originalIndex
    })

  const usedCodes = new Map() // 已保留的原计量编号 -> 首次（最早抄表）记录
  const landed = []
  const issues = []
  let renumberSeq = 0
  let unregSeq = 0

  for (const { row, originalIndex } of ordered) {
    const point = pointIndex.get(row.pointCode) || null
    const validDate = isValidDate(row.readingDate)
    const validPeriod = isValidPeriod(row.period)
    const contradiction = validDate && validPeriod && !periodMatchesDate(row.period, row.readingDate)
    const missingDependency = !point
    const keeper = usedCodes.get(row.meterCode) || null
    const codeConflict = keeper !== null

    let meterCode = row.meterCode
    let codeNote = '沿用原台账编号'
    let conflictAlternative = null

    if (codeConflict) {
      renumberSeq += 1
      meterCode = `${PRIORITY_RULES.conflictRenumberPrefix}${String(renumberSeq).padStart(3, '0')}`
      codeNote = `原编号 ${row.meterCode} 与更早抄表记录冲突，另起新号；原编号/原读数留作对照`
      conflictAlternative = {
        originalMeterCode: row.meterCode,
        electricityKwh: row.electricityKwh,
        waterTon: row.waterTon,
      }
    } else {
      usedCodes.set(row.meterCode, { meterCode: row.meterCode, readingDate: row.readingDate })
    }

    if (missingDependency && !codeConflict) {
      unregSeq += 1
      meterCode = `${PRIORITY_RULES.unregisteredPrefix}${String(unregSeq).padStart(3, '0')}`
      codeNote = `点位 ${row.pointCode} 未在点位册登记，另起一行说明；原台账编号 ${row.meterCode} 留作对照`
      conflictAlternative = {
        originalMeterCode: row.meterCode,
        electricityKwh: row.electricityKwh,
        waterTon: row.waterTon,
      }
    }
    let waterTon = row.waterTon === undefined ? null : row.waterTon
    let waterBackfilled = false
    let waterNote = ''
    if (qualifiesZeroBackfill(point, row)) {
      waterTon = 0
      waterBackfilled = true
      waterNote = WATER_FILL_POLICY.effectiveLabel
    } else if (!point) {
      waterNote = '点位未登记，用水量沿用台账原值待核实'
    }

    const abnormal = Boolean(missingDependency || codeConflict || contradiction)
    const problems = []
    if (missingDependency) {
      problems.push({
        type: ISSUE_TYPES.MISSING_DEPENDENCY,
        reason: `计量点位 ${row.pointCode} 不在点位册，缺少点位依赖`,
      })
    }
    if (codeConflict) {
      problems.push({
        type: ISSUE_TYPES.CODE_CONFLICT,
        reason: `计量编号 ${row.meterCode} 与更早抄表记录（${keeper.readingDate}）冲突，最早那份保留原号，本条另起 ${meterCode}`,
      })
    }
    if (contradiction) {
      problems.push({
        type: ISSUE_TYPES.PERIOD_DATE_CONTRADICTION,
        reason: `统计周期 ${row.period} 与抄表日期 ${row.readingDate} 不在同一自然月`,
      })
    }
    if (problems.length) {
      problems.forEach((problem) =>
        issues.push({ ...problem, meterCode, pointCode: row.pointCode, source: 'legacy', readingDate: row.readingDate }),
      )
    }

    landed.push({
      id: landed.length + 1,
      meterCode,
      pointCode: row.pointCode,
      pointName: point ? point.pointName : '未登记点位',
      period: row.period,
      readingDate: row.readingDate,
      electricityKwh: row.electricityKwh,
      waterTon,
      waterBackfilled,
      waterAlternative: null, // 迁移全部落库后再统一回填对照值
      waterPolicy: waterBackfilled ? WATER_FILL_POLICY.effective : null,
      waterNote,
      reader: row.reader,
      ownerUnitCode: point ? point.ownerUnitCode : 'UNCLAIMED',
      ownerUnit: point ? point.ownerUnit : '待认领',
      responsiblePost: point ? point.responsiblePost : '待认领',
      status: abnormal ? '数据异常' : '已核对',
      pending: false,
      dataAbnormal: abnormal,
      origin: 'legacy',
      originalMeterCode: conflictAlternative ? conflictAlternative.originalMeterCode : null,
      alternativeReading: conflictAlternative
        ? { electricityKwh: conflictAlternative.electricityKwh, waterTon: conflictAlternative.waterTon, note: '原编号下的另一份读数，仅对照' }
        : null,
      codeNote,
      problems: problems.map((p) => p.type),
      originalIndex,
    })
  }

  // 回填「装表后月均」对照值（仅对做了补 0 的记录）。
  for (const rec of landed) {
    if (rec.waterBackfilled) {
      rec.waterAlternative = computeWaterAlternative(rec.pointCode, landed)
    }
  }

  return { rows: landed, issues, renumberSeq }
}
