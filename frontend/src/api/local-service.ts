import { getActor } from '@/data/actor'
import { energyRecon, energySelfCheck, validateEnergyReading } from '@/data/energy'
import type { EnergyFinding, EnergyRecon } from '@/data/energy'
import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, CreateResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚', '标记']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

// ---------------------------------------------------------------------------
// 权限：跨单位只读、越权提交一律拒绝。记录上登记了权属单位/责任岗位的，
// 只有同单位同岗位能改；改动的记录仍归原岗位，权属字段谁也不许动。
// ---------------------------------------------------------------------------
function rowOwner(row: EntryRow): { unit: string; post: string } | null {
  const post = String(row.责任岗位 ?? '').trim()
  const unit = String(row.权属单位 ?? '').trim()
  if (!post && !unit) {
    return null
  }
  return { unit, post }
}

function canWriteRow(row: EntryRow): boolean {
  const owner = rowOwner(row)
  if (!owner) {
    return true
  }
  const actor = getActor()
  return actor.unit === owner.unit && actor.post === owner.post
}

/** 页面展示用：这条记录对当前身份是否只读。判断口径与服务层一致。 */
export function rowWritable(row: EntryRow): boolean {
  return canWriteRow(row)
}

function denyMessage(meta: ModuleMeta, row: EntryRow): string {
  const owner = rowOwner(row)
  const actor = getActor()
  return (
    `${meta.entity}归「${owner?.unit}·${owner?.post}」，当前身份是「${actor.unit}·${actor.post}」，` +
    `跨单位/跨岗位只读，越权提交已拒绝`
  )
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  if (!canWriteRow(rows[index])) {
    return { ok: false, message: denyMessage(meta, rows[index]) }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  // 状态镜像字段（每个模块最后一个「X状态」字段）跟着状态走，列表上的数字与详情取值才对得上。
  const mirror = meta.fields.find((field) => field.endsWith('状态'))
  if (mirror) {
    updated[mirror] = target
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

// ---------------------------------------------------------------------------
// 登记：计量数据落库前先过一次校验；重复录入只认第一次，后到的整条退回。
// 目前只有能耗计量开放了登记入口，其他模块仍走审批流占位。
// ---------------------------------------------------------------------------
export function createEntry(key: string, values: Record<string, unknown>): CreateResult {
  const meta = moduleMeta(key)
  if (key !== 'energy') {
    return { ok: false, message: `${meta.entity}登记入口尚未接入审批流` }
  }
  const actor = getActor()
  if (actor.unit !== '管廊运营中心' || actor.post !== '能耗计量岗') {
    return {
      ok: false,
      message: `能耗计量记录归「管廊运营中心·能耗计量岗」登记，当前身份是「${actor.unit}·${actor.post}」，越权提交已拒绝`,
    }
  }

  const problems = validateEnergyReading(values)
  if (problems.length > 0) {
    return { ok: false, message: `落库前校验未通过：${problems.join('；')}` }
  }

  const rows = listRows(key)
  const code = String(values.计量编号).trim()
  if (rows.some((row) => String(row.计量编号) === code)) {
    return {
      ok: false,
      message: `计量编号 ${code} 已登记，重复录入只认第一次的那份，本条整条退回，条数不叠加`,
    }
  }

  const id = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const record: EntryRow = {
    id,
    status: '已抄表',
    pending: true,
    abnormal: false,
    计量编号: code,
    计量点位: String(values.计量点位).trim(),
    用电量: Number(values.用电量),
    用水量: Number(values.用水量),
    统计周期: String(values.统计周期).trim(),
    抄表人员: String(values.抄表人员).trim(),
    抄表日期: String(values.抄表日期).trim(),
    责任岗位: actor.post,
    权属单位: actor.unit,
    计量状态: '已抄表',
  }
  saveRows(key, [...rows, record])
  return { ok: true, id, message: `能耗计量记录 ${code} 已落库（已抄表），权属 ${actor.unit}·${actor.post}` }
}

// ---------------------------------------------------------------------------
// 能耗自检与对账：条数由 data/energy.ts 同一份逻辑算出，页面只负责展示。
// ---------------------------------------------------------------------------
export function runEnergySelfCheck(): EnergyFinding[] {
  return energySelfCheck(listRows('energy'))
}

export function loadEnergyRecon(): EnergyRecon & { dutyText: string } {
  const rows = listRows('energy')
  const recon = energyRecon(rows)
  const duty = listRows('duty').find((row) => String(row.交接编号) === 'DUTY-0001')
  return { ...recon, dutyText: String(duty?.交接事项 ?? '') }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
