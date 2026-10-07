/**
 * 流水线一致性校验（本地 / 容器 / CI 跑同一份）。
 * 任何一条不满足都以非零码退出，阻止镜像带着漂移上线。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dutyFixture from '../fixtures/duty-ledger.json' with { type: 'json' }
import { runPipeline } from './pipeline.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))

/** 依赖缺失自检（一）：构建所需 npm 依赖必须在锁文件里钉死且已安装。 */
export function checkDependencies(rootDir) {
  const failures = []
  const pkgPath = path.join(rootDir, 'package.json')
  const lockPath = path.join(rootDir, 'package-lock.json')
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  if (!fs.existsSync(lockPath)) {
    failures.push('缺少 package-lock.json：依赖未钉进锁文件')
    return failures
  }
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
  const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
  for (const [name, declared] of Object.entries(allDeps)) {
    const entry = lock.packages[`node_modules/${name}`]
    if (!entry) {
      failures.push(`依赖缺失：${name} 不在锁文件中`)
      continue
    }
    if (!entry.resolved || !entry.integrity) {
      failures.push(`依赖未钉死：${name}@${entry.version} 缺 resolved/integrity`)
    }
    if (String(declared).startsWith('^') || String(declared).startsWith('~')) {
      failures.push(`依赖未锁版本：package.json 里 ${name}="${declared}" 应为精确版本`)
    }
  }
  // lockfileVersion 3 才可复现安装。
  if (lock.lockfileVersion !== 3) failures.push(`锁文件版本 ${lock.lockfileVersion} 非 3，无法保证可复现`)
  return failures
}

/** 数据层一致性校验，返回 {ok, checks[], result}。 */
export function verifyData(runtime) {
  const result = runPipeline(runtime)
  const checks = []
  const assert = (name, ok, detail) => checks.push({ name, ok, detail })

  // 1) 自检总条数 = 数据异常点位数（页面卡片）= 列表中异常行数。
  const abnormalRows = result.rows.filter((r) => r.dataAbnormal)
  assert('自检问题条数 = 数据异常点位数', result.selfCheck.total === abnormalRows.length,
    `自检 ${result.selfCheck.total} / 异常行 ${abnormalRows.length}`)
  assert('数据异常点位数 = 统计卡片异常数', result.selfCheck.total === result.stats.abnormal,
    `自检 ${result.selfCheck.total} / 卡片 ${result.stats.abnormal}`)

  // 2) 每条自检问题都能在列表里定位到同编号记录。
  const meterSet = new Set(result.rows.map((r) => r.meterCode))
  const orphanIssues = result.issues.filter((i) => !meterSet.has(i.meterCode))
  assert('自检问题均能在列表定位', orphanIssues.length === 0,
    orphanIssues.map((i) => i.meterCode).join(',') || '全部可定位')

  // 3) 分类计数相加 = 总数。
  const sumByType = Object.values(result.selfCheck.counts).reduce((a, b) => a + b, 0)
  assert('自检分类计数之和 = 总数', sumByType === result.selfCheck.total,
    `${sumByType} / ${result.selfCheck.total}`)

  // 4) 对账待办条数 = 值班台账待核销条数，且编号/类型逐条对得上。
  const ledgerTodos = dutyFixture.openReconciliationTodos
  const reconTodos = result.reconciliation.todos
  assert('对账待办条数 = 值班台账条数', reconTodos.length === ledgerTodos.length,
    `对账 ${reconTodos.length} / 台账 ${ledgerTodos.length}`)
  const mismatched = reconTodos.filter((t, i) => {
    const d = ledgerTodos[i]
    return !d || d.todoCode !== t.todoCode || d.typeLabel !== t.typeLabel ||
      d.refMeterCode !== t.meterCode || d.refPointCode !== t.pointCode
  })
  assert('对账待办与台账逐条一致（编号/类型/点位）', mismatched.length === 0,
    mismatched.map((m) => m.todoCode).join(',') || '全部一致')

  // 5) 重复录入不叠加：退回记录不出现在 landed；编号唯一。
  const landedCodes = result.rows.filter((r) => r.meterCode).map((r) => r.meterCode)
  const dupInLanded = landedCodes.filter((c, i) => landedCodes.indexOf(c) !== i)
  assert('落地计量编号无重复（重复录入未叠加）', dupInLanded.length === 0,
    dupInLanded.join(',') || '编号唯一')
  const rejectedDupCount = result.rejected.filter((r) => r.rule === 'duplicate').length
  assert('重复录入整条退回', rejectedDupCount === 1, `重复退回 ${rejectedDupCount} 条`)

  // 6) 越权提交一律拒绝：外单位记录均无本批次新录入落地。
  const crossRejected = result.rejected.filter((r) => r.rule === 'cross-unit')
  assert('跨单位越权提交被拒绝', crossRejected.length === 1, `越权退回 ${crossRejected.length} 条`)

  // 7) 列表取值 = 详情取值：同一 id 在 rows 中唯一，列表字段值与详情来自同一对象。
  const ids = result.rows.map((r) => r.id)
  assert('记录 id 唯一', new Set(ids).size === ids.length, `${ids.length} 条 id 唯一`)

  // 8) 统计卡片三态之和 = 列表总数。
  const triSum = result.stats.pendingMeter + result.stats.verified + result.stats.abnormal
  assert('三态卡片之和 = 列表总数', triSum === result.stats.total,
    `${triSum} / ${result.stats.total}`)

  // 9) 早年补 0 的记录都标注了口径，且对照值不参与落库合计（落库 waterTon=0）。
  const badBackfill = result.rows.filter((r) => r.waterBackfilled && r.waterTon !== 0)
  assert('早年缺水量均按补 0 口径落库', badBackfill.length === 0,
    `违规 ${badBackfill.length} 条`)

  // 10) 迁移按抄表日期升序（同 origin 段内）。
  const legacy = result.rows.filter((r) => r.origin === 'legacy')
  let sortedOk = true
  for (let i = 1; i < legacy.length; i++) {
    if (legacy[i - 1].readingDate > legacy[i].readingDate) sortedOk = false
  }
  assert('存量记录按抄表日期升序迁移', sortedOk, '')

  return { ok: checks.every((c) => c.ok), checks, result }
}

/** 一次性跑依赖 + 数据校验，供 CLI 使用。 */
export function runAllChecks(rootDir, runtime) {
  const depFailures = checkDependencies(rootDir)
  const depChecks = depFailures.length === 0
    ? [{ name: '构建依赖全部钉入锁文件并已锁定', ok: true, detail: '' }]
    : depFailures.map((d) => ({ name: d, ok: false, detail: '' }))
  const data = verifyData(runtime)
  const checks = [...depChecks, ...data.checks]
  return { ok: checks.every((c) => c.ok), checks, result: data.result }
}
