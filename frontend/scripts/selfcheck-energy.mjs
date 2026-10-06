// 能耗计量自检脚本：与页面共用 src/data/energy.ts 同一份逻辑，
// 跑出来的条数必须和页面「自检结果」一致。用法：npm run selfcheck
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { build } from 'esbuild'

const outfile = join(mkdtempSync(join(tmpdir(), 'energy-selfcheck-')), 'bundle.mjs')

await build({
  stdin: {
    contents: `
      export { SEED_ROWS } from './src/data/seed'
      export { energySelfCheck, energyRecon, energyReconSummary } from './src/data/energy'
    `,
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile,
  logLevel: 'silent',
  define: { 'import.meta.env.VITE_APP_TZ': '"Asia/Shanghai"' },
})

const { SEED_ROWS, energySelfCheck, energyRecon, energyReconSummary } = await import(
  pathToFileURL(outfile).href
)

const rows = SEED_ROWS.energy
let failed = false
const fail = (message) => {
  failed = true
  console.error(`✗ ${message}`)
}
const pass = (message) => console.log(`✓ ${message}`)

console.log('== 能耗计量自检 ==')

// 1. 依赖缺失 / 计量编号冲突 / 周期矛盾，逐条列出并注明缘由。
const findings = energySelfCheck(rows)
console.log(`自检发现 ${findings.length} 条：`)
for (const item of findings) {
  console.log(`  - [${item.type}] ${item.code}：${item.reason}`)
}
if (findings.length === 0) fail('自检结果为空，迁移说明没有生成')
else pass(`自检结果 ${findings.length} 条（页面「自检结果」显示同一数字）`)

// 2. 计量编号不允许重复：重复录入只认第一次，后到的整条退回。
const codes = rows.map((row) => row.计量编号)
const dup = codes.filter((code, index) => codes.indexOf(code) !== index)
if (dup.length > 0) fail(`台账里仍有重复计量编号：${[...new Set(dup)].join('、')}`)
else pass(`计量编号无重复，共 ${codes.length} 条，条数不叠加`)

// 3. 列表状态与详情字段一致：计量状态字段必须等于当前状态。
const mirrorBad = rows.filter((row) => row.计量状态 !== row.status)
if (mirrorBad.length > 0) fail(`计量状态与当前状态不一致：${mirrorBad.map((row) => row.计量编号).join('、')}`)
else pass('列表状态与详情「计量状态」逐条一致')

// 4. 对账待办与值班台账对得上。
const recon = energyRecon(rows)
const duty = SEED_ROWS.duty.find((row) => row.交接编号 === 'DUTY-0001')
const summary = energyReconSummary(rows)
console.log(`对账待办 ${recon.todo} 项（待抄表 ${recon.pendingReading}、数据异常 ${recon.abnormal}）：${recon.codes.join('、')}`)
console.log(`值班台账 DUTY-0001 交接事项：${duty?.交接事项 ?? '(缺失)'}`)
const dutyCount = Number(duty?.交接事项?.match(/能耗对账待办 (\d+) 项/)?.[1])
if (!duty) fail('值班台账缺 DUTY-0001')
else if (duty.交接事项 !== summary || dutyCount !== recon.todo) fail('值班台账条数与对账待办对不上')
else pass('值班台账条数与对账待办一致')

// 5. 既有台账照原编号搬过来：去重后的 legacy 编号必须原样在册。
const legacyText = readFileSync('src/data/energy.ts', 'utf8')
const legacyCodes = [...legacyText.matchAll(/计量编号: '(LS-[^']+)'/g)].map((match) => match[1])
const uniqueLegacy = [...new Set(legacyCodes)]
const dupLegacy = uniqueLegacy.filter((code) => legacyCodes.indexOf(code) !== legacyCodes.lastIndexOf(code))
const missing = uniqueLegacy.filter((code) => !codes.includes(code))
if (missing.length > 0) fail(`既有台账编号丢失：${missing.join('、')}`)
else pass(`既有台账照原编号在册（重复编号 ${dupLegacy.join('、') || '无'} 只留第一次）`)

if (failed) {
  console.error('自检未通过')
  process.exit(1)
}
console.log('自检通过')
