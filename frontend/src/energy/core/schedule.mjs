/**
 * 生成「待抄表」点位：当前账期内、归属当前岗位单位、且没有一条已核对读数的在册点位。
 * 跨单位点位只读，不替外单位生成待抄表占位。
 */
export function buildPending({ points, landed, period, operatorUnitCode }) {
  const hasOk = new Set(
    landed
      .filter((r) => r.period === period && !r.dataAbnormal && r.ownerUnitCode === operatorUnitCode)
      .map((r) => r.pointCode),
  )

  const pending = []
  let nextId = Math.max(0, ...landed.map((r) => r.id)) + 1
  for (const point of points) {
    if (point.ownerUnitCode !== operatorUnitCode) continue
    if (hasOk.has(point.pointCode)) continue
    pending.push({
      id: nextId++,
      meterCode: null, // 尚未抄表，没有计量编号
      pointCode: point.pointCode,
      pointName: point.pointName,
      period,
      readingDate: null,
      electricityKwh: null,
      waterTon: null,
      waterBackfilled: false,
      waterAlternative: null,
      waterPolicy: null,
      waterNote: '',
      reader: null,
      ownerUnitCode: point.ownerUnitCode,
      ownerUnit: point.ownerUnit,
      responsiblePost: point.responsiblePost,
      status: '待抄表',
      pending: true,
      dataAbnormal: false,
      origin: 'schedule',
      originalMeterCode: null,
      alternativeReading: null,
      codeNote: '在册点位，本账期待抄表',
      problems: [],
    })
  }
  return pending
}
