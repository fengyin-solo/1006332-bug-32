#!/usr/bin/env node
/**
 * 廊内能耗计量 · 对账（npm run energy:reconcile）。
 * 生成对账待办并与运维值班台账逐条核对；不一致即以非零码退出。
 */
import fs from 'node:fs'
import path from 'node:path'
import { runtime } from '../src/energy/core/config.mjs'
import { runPipeline } from '../src/energy/core/pipeline.mjs'
import { FRONTEND_ROOT, writeReport, line, fail } from './_util.mjs'

const result = runPipeline(runtime)
const duty = JSON.parse(
  fs.readFileSync(path.join(FRONTEND_ROOT, 'src/energy/fixtures/duty-ledger.json'), 'utf8'),
)

const todos = result.reconciliation.todos
const ledger = duty.openReconciliationTodos
const matches = todos.length === ledger.length &&
  todos.every((t, i) =>
    ledger[i] &&
    ledger[i].todoCode === t.todoCode &&
    ledger[i].typeLabel === t.typeLabel &&
    ledger[i].refMeterCode === t.meterCode &&
    ledger[i].refPointCode === t.pointCode,
  )

line('== 廊内能耗计量 · 对账结论 ==')
line(`账期 ${result.period}`)
todos.forEach((t) => {
  line(`${t.todoCode} [${t.typeLabel}] ${t.meterCode}/${t.pointCode}（${t.source}）`)
  line(`     待办：${t.reason}`)
})
line('')
line(`对账待办：${todos.length} 条；值班台账待核销：${ledger.length} 条`)
line(matches ? '✓ 对账待办与值班台账条数及编号完全一致' : '✗ 对账待办与值班台账不一致')

writeReport('energy-reconciliation.json', {
  period: result.period,
  generatedBy: 'npm run energy:reconcile',
  todos,
  counts: result.reconciliation.counts,
  dutyLedger: ledger.map((d) => ({
    todoCode: d.todoCode,
    typeLabel: d.typeLabel,
    refMeterCode: d.refMeterCode,
    refPointCode: d.refPointCode,
  })),
  matches,
})

if (!matches) {
  fail('对账待办与值班台账对不上')
  process.exit(1)
}
line('已写入 reports/energy-reconciliation.json')
