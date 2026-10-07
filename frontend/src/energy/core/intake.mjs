/**
 * 抄表录入批次处理：计量数据落库前先做一次校验。
 *
 * 硬退回（整条不落地，条数不叠加）：
 *  - 重复录入：同一计量编号只认本批次里最早提交/最早抄表的第一次那份；后到整条退回，
 *    另一种取值仅写入第一条的对照字段 alternativeReading，不新增条数。
 *  - 越权提交：点位归属单位 ≠ 当前岗位单位，且开启跨单位只读时，整条拒绝；记录仍归原岗位。
 *
 * 落地但标异常（落为「数据异常」并产生自检问题/对账待办）：
 *  - 依赖缺失：点位不在点位册。
 *  - 统计周期与抄表日期互相矛盾。
 */
import { ISSUE_TYPES } from './config.mjs'
import { isValidDate, isValidPeriod, periodMatchesDate, toNumberOrNull } from './time.mjs'

function buildIssues(row, point) {
  const problems = []
  if (!point) {
    problems.push({
      type: ISSUE_TYPES.MISSING_DEPENDENCY,
      reason: `计量点位 ${row.pointCode} 不在点位册，缺少点位依赖`,
    })
  }
  const validDate = isValidDate(row.readingDate)
  const validPeriod = isValidPeriod(row.period)
  if (!(validDate && validPeriod && periodMatchesDate(row.period, row.readingDate))) {
    problems.push({
      type: ISSUE_TYPES.PERIOD_DATE_CONTRADICTION,
      reason: validDate && validPeriod
        ? `统计周期 ${row.period} 与抄表日期 ${row.readingDate} 不在同一自然月`
        : `统计周期 ${row.period} 或抄表日期 ${row.readingDate} 非法，无法归账`,
    })
  }
  return problems
}

/**
 * @param {object} batch
 * @param {Array} points
 * @param {object} runtime  当前岗位 {operatorUnitCode, readOnlyCrossUnit}
 * @param {number} startId  接续迁移结果的自增 id
 */
export function processIntake({ batch, points, runtime, startId }) {
  const pointIndex = new Map(points.map((p) => [p.pointCode, p]))
  // 先按 (submissionSeq) 排序，确保「第一次」是确定的；无 seq 时按数组顺序。
  const ordered = [...batch.rows].sort(
    (a, b) => (a.submissionSeq ?? 0) - (b.submissionSeq ?? 0),
  )

  const accepted = new Map() // meterCode -> 已落地记录
  const rejected = []
  const landed = []
  const issues = []
  let nextId = startId

  for (const row of ordered) {
    const point = pointIndex.get(row.pointCode) || null

    // 1) 越权提交：外单位点位，本岗位只读。
    if (runtime.readOnlyCrossUnit && point && point.ownerUnitCode !== runtime.operatorUnitCode) {
      rejected.push({
        meterCode: row.meterCode,
        pointCode: row.pointCode,
        reason: `越权提交：点位 ${row.pointCode} 归属${point.ownerUnit}（${point.ownerUnitCode}），当前${runtime.operatorUnitCode} 跨单位只读`,
        rule: 'cross-unit',
        row,
      })
      continue
    }

    // 2) 重复录入：只认第一次，后到整条退回（不叠加条数），另一种取值留作对照。
    if (accepted.has(row.meterCode)) {
      const first = accepted.get(row.meterCode)
      first.alternativeReading = {
        electricityKwh: toNumberOrNull(row.electricityKwh),
        waterTon: toNumberOrNull(row.waterTon),
        readingDate: row.readingDate,
        note: '后到的重复录入已整条退回；此处另一种取值仅作对照，不计入合计',
      }
      rejected.push({
        meterCode: row.meterCode,
        pointCode: row.pointCode,
        reason: `重复录入：计量编号 ${row.meterCode} 已在第 ${first.submissionSeq} 条首次录入，本条整条退回，条数不叠加`,
        rule: 'duplicate',
        row,
      })
      continue
    }

    const problems = buildIssues(row, point)
    if (problems.length) {
      problems.forEach((problem) =>
        issues.push({ ...problem, meterCode: row.meterCode, pointCode: row.pointCode, source: 'intake', readingDate: row.readingDate }),
      )
    }

    const electricityKwh = toNumberOrNull(row.electricityKwh)
    const waterTon = toNumberOrNull(row.waterTon)
    const abnormal = problems.length > 0
    const record = {
      id: nextId++,
      meterCode: row.meterCode,
      pointCode: row.pointCode,
      pointName: point ? point.pointName : '未登记点位',
      period: row.period,
      readingDate: row.readingDate,
      electricityKwh,
      waterTon,
      waterBackfilled: false,
      waterAlternative: null,
      waterPolicy: null,
      waterNote: point === null ? '点位未登记，用水量沿用录入原值待核实' : '',
      reader: row.reader,
      ownerUnitCode: point ? point.ownerUnitCode : 'UNCLAIMED',
      ownerUnit: point ? point.ownerUnit : '待认领',
      responsiblePost: point ? point.responsiblePost : '待认领',
      status: abnormal ? '数据异常' : '已核对',
      pending: false,
      dataAbnormal: abnormal,
      origin: 'intake',
      originalMeterCode: null,
      alternativeReading: null,
      codeNote: point ? '本批次首次录入编号' : '点位未登记，沿用录入编号待核实',
      problems: problems.map((p) => p.type),
      submissionSeq: row.submissionSeq,
    }
    accepted.set(row.meterCode, record)
    landed.push(record)
  }

  return { rows: landed, rejected, issues, nextId }
}
