#!/usr/bin/env node
/**
 * 廊内能耗计量 · 自检（本地 / CI / 镜像构建同一条命令：npm run energy:check）。
 * 列出：依赖缺失、计量编号冲突、统计周期与抄表日期矛盾，并注明缘由；
 * 断言自检条数 = 页面数据异常条数、对账待办 = 值班台账、列表=详情。
 */
import { runtime } from '../src/energy/core/config.mjs'
import { runAllChecks } from '../src/energy/core/verify.mjs'
import { FRONTEND_ROOT, writeReport, line, fail } from './_util.mjs'

const { ok, checks, result } = runAllChecks(FRONTEND_ROOT, runtime)

line('== 廊内能耗计量 · 流水线自检 ==')
line(`账期 ${result.period}｜岗位 ${runtime.operatorPost}｜单位 ${runtime.operatorUnit}｜时区 ${runtime.timezone}`)
line('')

line('-- 构建依赖 --')
for (const c of checks.filter((x) => x.name.includes('依赖') || x.name.includes('锁'))) {
  line(`${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? `（${c.detail}）` : ''}`)
}
line('')

const labelOf = {
  'missing-dependency': '依赖缺失（点位未登记）',
  'code-conflict': '计量编号冲突',
  'period-date-contradiction': '统计周期与抄表日期矛盾',
}
line('-- 数据问题清单（含缘由）--')
if (result.issues.length === 0) line('（无）')
result.issues.forEach((issue, i) => {
  line(`${String(i + 1).padStart(2, '0')} [${labelOf[issue.type]}] ${issue.meterCode} / ${issue.pointCode} / ${issue.readingDate}`)
  line(`     缘由：${issue.reason}`)
})
line('')
line(`自检问题合计：${result.selfCheck.total}（${Object.entries(result.selfCheck.counts).map(([k, v]) => `${k} ${v}`).join('，')}）`)
line(`页面列表：待抄表 ${result.stats.pendingMeter}｜已核对 ${result.stats.verified}｜数据异常 ${result.stats.abnormal}｜共 ${result.stats.total}`)
line(`对账待办：${result.reconciliation.counts.total} 条（应与值班台账一致）`)
line('退回（不落地、不叠加）：' + result.rejected.map((r) => `${r.rule}:${r.meterCode}`).join('，'))
line('')

line('-- 一致性断言 --')
for (const c of checks) {
  line(`${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? `（${c.detail}）` : ''}`)
}

writeReport('energy-selfcheck.json', {
  period: result.period,
  generatedBy: 'npm run energy:check',
  timezone: runtime.timezone,
  issues: result.issues,
  counts: result.selfCheck.counts,
  issueTotal: result.selfCheck.total,
  pageStats: result.stats.byStatus,
  pageTotal: result.stats.total,
  rejected: result.rejected.map((r) => ({ rule: r.rule, meterCode: r.meterCode, reason: r.reason })),
  checks,
  ok,
})

if (!ok) {
  fail('自检未通过：存在漂移或不一致，禁止以此镜像上线')
  process.exit(1)
}
line('\n自检通过，已写入 reports/energy-selfcheck.json')
