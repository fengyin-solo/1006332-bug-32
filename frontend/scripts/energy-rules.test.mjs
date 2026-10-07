#!/usr/bin/env node
/**
 * 廊内能耗计量 · 口径回归（零三方依赖，node:test）。
 * 固化拍板口径：首次优先、补 0 口径、跨单位只读、周期时区、条数不叠加、列表=详情、对账=台账。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { runPipeline } from '../src/energy/core/pipeline.mjs'
import { loadRuntimeConfig } from '../src/energy/core/config.mjs'
import { periodOfDate, periodFromInstant } from '../src/energy/core/time.mjs'

const runtime = loadRuntimeConfig({})
const result = runPipeline(runtime)

test('账期按上海时区归账，UTC 月末次日不跨月', () => {
  assert.equal(periodOfDate('2026-10-31'), '2026-10')
  // 2026-10-31 23:00 UTC = 2026-11-01 07:00 上海，应归到 11 月（证明不跟容器 UTC）
  const instant = Date.UTC(2026, 9, 31, 23, 0, 0)
  assert.equal(periodFromInstant(instant), '2026-11')
})

test('三态卡片之和 = 列表总数', () => {
  const { pendingMeter, verified, abnormal, total } = result.stats
  assert.equal(pendingMeter + verified + abnormal, total)
  assert.deepEqual({ pendingMeter, verified, abnormal }, { pendingMeter: 1, verified: 15, abnormal: 5 })
})

test('自检条数 = 数据异常条数，分类相加 = 总数', () => {
  assert.equal(result.selfCheck.total, 5)
  assert.equal(result.selfCheck.total, result.stats.abnormal)
  assert.equal(result.selfCheck.counts['依赖缺失'], 2)
  assert.equal(result.selfCheck.counts['计量编号冲突'], 1)
  assert.equal(result.selfCheck.counts['统计周期与抄表日期矛盾'], 2)
})

test('重复录入只认第一次、整条退回、条数不叠加', () => {
  const dupReject = result.rejected.filter((r) => r.rule === 'duplicate')
  assert.equal(dupReject.length, 1)
  assert.equal(dupReject[0].meterCode, 'ENER-0101')
  const first = result.rows.find((r) => r.meterCode === 'ENER-0101')
  assert.equal(first.electricityKwh, 2110) // 第一次的值，不被 2130 覆盖
  assert.ok(first.alternativeReading, '后到读数只作对照')
  assert.equal(first.alternativeReading.electricityKwh, 2130)
  const codes = result.rows.filter((r) => r.meterCode).map((r) => r.meterCode)
  assert.equal(new Set(codes).size, codes.length) // 无重复编号
})

test('越权提交被拒绝，外单位记录只读且仍归原岗位', () => {
  const cross = result.rejected.filter((r) => r.rule === 'cross-unit')
  assert.equal(cross.length, 1)
  assert.equal(cross[0].meterCode, 'ENER-0109')
  const unitB = result.rows.filter((r) => r.ownerUnitCode === 'UNIT-B')
  assert.ok(unitB.length >= 2) // 存量里的二处记录照常只读展示
  assert.ok(unitB.every((r) => r.origin === 'legacy'))
})

test('存量按抄表日期升序迁移', () => {
  const legacy = result.rows.filter((r) => r.origin === 'legacy').map((r) => r.readingDate)
  const sorted = [...legacy].sort()
  assert.deepEqual(legacy, sorted)
})

test('编号冲突：最早那份保留原号，后到另起 LEGACY 且留对照', () => {
  const keeper = result.rows.find((r) => r.meterCode === 'ENER-0002')
  assert.equal(keeper.pointCode, 'P-02')
  assert.equal(keeper.readingDate, '2022-08-31')
  const later = result.rows.find((r) => r.meterCode === 'ENER-LEGACY-001')
  assert.equal(later.pointCode, 'P-07')
  assert.equal(later.originalMeterCode, 'ENER-0002')
})

test('未登记点位另起 UNREG 一行说明', () => {
  const unreg = result.rows.find((r) => r.meterCode === 'ENER-UNREG-001')
  assert.ok(unreg)
  assert.equal(unreg.pointCode, 'P-10')
  assert.equal(unreg.ownerUnitCode, 'UNCLAIMED')
})

test('早年缺水量按补 0 落库，装表后月均仅对照', () => {
  const r = result.rows.find((r2) => r2.meterCode === 'ENER-0001')
  assert.equal(r.waterTon, 0)
  assert.equal(r.waterBackfilled, true)
  assert.equal(typeof r.waterAlternative, 'number')
  assert.notEqual(r.waterAlternative, 0)
})

test('周期与抄表日期矛盾被识别（跨月与次月录入）', () => {
  const contradictionPoints = result.issues
    .filter((i) => i.type === 'period-date-contradiction')
    .map((i) => `${i.meterCode}@${i.readingDate}`)
  assert.ok(contradictionPoints.includes('ENER-0005@2024-06-02'))
  assert.ok(contradictionPoints.includes('ENER-0108@2026-11-01'))
})

test('对账待办条数与编号 = 值班台账', async () => {
  const duty = (await import('../src/energy/fixtures/duty-ledger.json', { with: { type: 'json' } })).default
  const todos = result.reconciliation.todos
  assert.equal(todos.length, duty.openReconciliationTodos.length)
  todos.forEach((t, i) => {
    const d = duty.openReconciliationTodos[i]
    assert.equal(t.todoCode, d.todoCode)
    assert.equal(t.typeLabel, d.typeLabel)
    assert.equal(t.meterCode, d.refMeterCode)
    assert.equal(t.pointCode, d.refPointCode)
  })
})

test('列表取值即详情取值（同一对象、id 唯一）', () => {
  const ids = result.rows.map((r) => r.id)
  assert.equal(new Set(ids).size, ids.length)
  const sample = result.rows.find((r) => r.meterCode === 'ENER-0105')
  assert.deepEqual(
    { e: sample.electricityKwh, w: sample.waterTon, p: sample.period, d: sample.readingDate },
    { e: 568, w: 14.2, p: '2026-10', d: '2026-10-31' },
  )
})
