/**
 * 跨单位只读权限。
 * - 本岗位单位的记录：可执行抄表/核对动作。
 * - 外单位记录：只读。越权提交/改动一律拒绝，记录仍归原岗位（ownerUnitCode 不随操作改写）。
 */
export function canWrite(record, runtime) {
  if (!record) return false
  return record.ownerUnitCode === runtime.operatorUnitCode
}

export function guardAction(record, runtime, actionLabel = '该操作') {
  if (canWrite(record, runtime)) {
    return { ok: true, message: '' }
  }
  return {
    ok: false,
    message: `已拒绝${actionLabel}：点位 ${record.pointCode} 归属${record.ownerUnit}，当前${runtime.operatorUnit}为跨单位只读，记录仍归${record.responsiblePost}`,
  }
}

/** 页面视角：当前单位可写；外单位只读展示；待认领点位异常待处置，不允许随手改。 */
export function viewTag(record, runtime) {
  if (record.ownerUnitCode === 'UNCLAIMED') return { key: 'unclaimed', text: '待认领（不可改）', readonly: true }
  if (record.ownerUnitCode === runtime.operatorUnitCode) return { key: 'self', text: `${runtime.operatorUnit}·可操作`, readonly: false }
  return { key: 'cross', text: `${record.ownerUnit}·只读`, readonly: true }
}
