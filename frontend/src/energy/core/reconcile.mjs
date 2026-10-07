/**
 * 对账：把每条「数据异常」记录翻译成一条对账待办。
 * 一条异常 ↔ 一条待办（同一份 landed 数据，问题原因一一带出），
 * 因此对账结论的待办条数 = 数据异常点位数 = 值班台账里待核销的对账条数。
 */
export const ISSUE_LABELS = {
  'missing-dependency': '依赖缺失',
  'code-conflict': '计量编号冲突',
  'period-date-contradiction': '统计周期与抄表日期矛盾',
}

/**
 * @param {Array} issues  migration + intake 汇总的问题
 * @param {object} meta   {period, operatorUnitCode}
 */
export function reconcile(issues, meta = {}) {
  const todos = issues.map((issue, index) => ({
    todoCode: `RECON-${String(index + 1).padStart(3, '0')}`,
    type: issue.type,
    typeLabel: ISSUE_LABELS[issue.type] || issue.type,
    meterCode: issue.meterCode,
    pointCode: issue.pointCode,
    readingDate: issue.readingDate,
    source: issue.source === 'legacy' ? '存量迁移' : '抄表录入',
    reason: issue.reason,
    status: '待核销',
    period: meta.period || null,
  }))
  return {
    period: meta.period || null,
    todos,
    counts: {
      total: todos.length,
      byType: todos.reduce((acc, t) => {
        acc[t.typeLabel] = (acc[t.typeLabel] || 0) + 1
        return acc
      }, {}),
    },
  }
}

/** 自检：和对账共用同一份 issues，返回分类清单，供页面与 CLI 同时引用。 */
export function summarizeIssues(issues) {
  const groups = {
    'missing-dependency': [],
    'code-conflict': [],
    'period-date-contradiction': [],
  }
  for (const issue of issues) {
    ;(groups[issue.type] || (groups[issue.type] = [])).push(issue)
  }
  return {
    total: issues.length,
    counts: {
      '依赖缺失': groups['missing-dependency'].length,
      '计量编号冲突': groups['code-conflict'].length,
      '统计周期与抄表日期矛盾': groups['period-date-contradiction'].length,
    },
    groups,
  }
}
