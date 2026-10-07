#!/usr/bin/env node
/**
 * 廊内能耗计量 · 存量迁移 + 落库前校验（npm run energy:migrate）。
 * 按抄表日期迁移既有台账；早年只用电、无水量按补 0 口径落库（装表后月均仅对照）；
 * 输出落库全量记录与硬退回清单，冻结到 reports/energy-landed.json。
 */
import { WATER_FILL_POLICY } from '../src/energy/core/config.mjs'
import { runPipeline } from '../src/energy/core/pipeline.mjs'
import { runtime } from '../src/energy/core/config.mjs'
import { writeReport, line } from './_util.mjs'

const result = runPipeline(runtime)

line('== 廊内能耗计量 · 存量迁移 + 录入校验 ==')
line(`账期 ${result.period}｜时区 ${result.runtime.timezone}`)
line(`补水量口径（生效）：${WATER_FILL_POLICY.effectiveLabel}`)
line(`补水量口径（对照，不计入合计）：${WATER_FILL_POLICY.alternativeLabel}`)
line('')
line('-- 落库记录（迁移按抄表日期升序）--')
for (const r of result.rows) {
  const flag = r.dataAbnormal ? '〔异常〕' : r.pending ? '〔待抄表〕' : ''
  const water = r.waterBackfilled ? `${r.waterTon}(补0,对照${r.waterAlternative ?? '—'})` : `${r.waterTon ?? '—'}`
  line(`${String(r.id).padStart(2, '0')} ${flag}${r.meterCode ?? '—'} | ${r.pointCode} | ${r.period} | ${r.readingDate ?? '—'} | 电${r.electricityKwh ?? '—'} 水${water} | ${r.ownerUnit}`)
}
line('')
line('-- 硬退回（整条不落地，条数不叠加）--')
result.rejected.forEach((r) => line(`✗ [${r.rule}] ${r.meterCode}/${r.pointCode}：${r.reason}`))
line(`\n落库 ${result.rows.length} 条；退回 ${result.rejected.length} 条；异常 ${result.stats.abnormal} 条；待抄表 ${result.stats.pendingMeter} 条`)

writeReport('energy-landed.json', {
  period: result.period,
  waterFillPolicy: WATER_FILL_POLICY,
  timezone: result.runtime.timezone,
  rows: result.rows,
  rejected: result.rejected,
  stats: result.stats,
})
line('已写入 reports/energy-landed.json')
