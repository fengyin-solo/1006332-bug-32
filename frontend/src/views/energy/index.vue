<template>
  <section class="page" data-module="energy">
    <header class="page-head">
      <div>
        <h2>廊内能耗计量管理</h2>
        <p class="page-desc">
          同一条流水线固化：存量按抄表日期迁移 → 落库前校验 → 待抄表占位。本地与容器共用样例、锁文件与构建链路；
          账期一律按 {{ state.runtime.timezone }} 归账。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="resetState">重置为固化结果</button>
      </div>
    </header>

    <p class="pipeline-meta">
      当前账期 <strong>{{ state.period }}</strong>｜岗位 {{ state.runtime.operatorPost }}｜单位
      {{ state.runtime.operatorUnit }}（跨单位只读，越权提交拒绝）｜早年缺水量按「补 0」落库，装表后月均仅对照
    </p>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">待抄表点位</span>
        <strong class="stat-value">{{ state.stats.pendingMeter }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">已核对点位</span>
        <strong class="stat-value">{{ state.stats.verified }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">数据异常点位</span>
        <strong class="stat-value">{{ state.stats.abnormal }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">记录总数（列表条数）</span>
        <strong class="stat-value">{{ state.stats.total }}</strong>
      </article>
    </div>

    <!-- 自检：条数与数据异常点位一致，分类相加=总数 -->
    <div class="panel">
      <h3>流水线自检（落库前校验问题，含缘由）</h3>
      <p class="sub">
        共 <strong>{{ state.issueTotal }}</strong> 条，与上方「数据异常点位 {{ state.stats.abnormal }}」一致：
        <span v-for="(count, label) in state.issueCounts" :key="label" class="legend-item">{{ label }} {{ count }}</span>
      </p>
      <table class="issue-table">
        <thead>
          <tr><th style="width:150px">问题类型</th><th style="width:150px">计量编号</th><th style="width:90px">点位</th><th style="width:110px">抄表日期</th><th>缘由</th></tr>
        </thead>
        <tbody>
          <tr v-for="(issue, i) in state.issues" :key="`${issue.meterCode}-${i}`">
            <td>{{ issueLabel(issue.type) }}</td>
            <td>{{ issue.meterCode }}</td>
            <td>{{ issue.pointCode }}</td>
            <td>{{ issue.readingDate }}</td>
            <td>{{ issue.reason }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <form class="filter-bar" @submit.prevent>
      <label class="filter-item">
        <span>计量编号 / 点位</span>
        <input v-model="keyword" placeholder="按编号或点位检索" />
      </label>
      <label class="filter-item">
        <span>状态</span>
        <select v-model="statusFilter">
          <option value="">全部</option>
          <option value="待抄表">待抄表</option>
          <option value="已核对">已核对</option>
          <option value="数据异常">数据异常</option>
        </select>
      </label>
      <button class="btn ghost" type="button" @click="keyword = ''; statusFilter = ''">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th>计量编号</th>
          <th>计量点位</th>
          <th class="num">用电量(kWh)</th>
          <th class="num">用水量(t)</th>
          <th>统计周期</th>
          <th>抄表日期</th>
          <th>归属/权限</th>
          <th>当前状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in filteredRows" :key="String(row.id)">
          <td><button class="link" type="button" @click="openDetail(row)">{{ row.meterCode ?? '—' }}</button></td>
          <td>{{ row.pointCode }} · {{ row.pointName }}</td>
          <td class="num">{{ fmt(row.electricityKwh) }}</td>
          <td class="num">
            {{ fmt(row.waterTon) }}
            <div v-if="row.waterBackfilled" class="alt">补0 · 对照{{ row.waterAlternative ?? '—' }}</div>
          </td>
          <td>{{ row.period }}</td>
          <td>{{ row.readingDate ?? '—' }}</td>
          <td><span class="tag" :class="accessTag(row).key">{{ accessTag(row).text }}</span></td>
          <td><span class="tag" :class="statusClass(row.status)">{{ row.status }}</span></td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(row)">详情</button>
            <button
              v-if="row.status === '待抄表'"
              class="link"
              :class="{ denied: !canWriteRow(row) }"
              type="button"
              @click="openSubmit(row)"
            >
              提交抄表
            </button>
          </td>
        </tr>
        <tr v-if="!filteredRows.length">
          <td colspan="9" class="empty-state">没有符合条件的能耗计量记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>列表共 {{ filteredRows.length }} / {{ state.stats.total }} 条；列表与详情取自同一条流水线结果，取值一致</span>
      <span v-if="message" :class="messageOk ? '' : 'error-text'">{{ message }}</span>
    </footer>

    <!-- 对账待办：条数与值班台账一致 -->
    <div class="panel" style="margin-top:12px">
      <h3>对账结论 · 待办（{{ state.todos.length }} 条，与运维值班台账待核销条数一致）</h3>
      <table class="plain-table">
        <thead><tr><th style="width:110px">待办编号</th><th style="width:150px">类型</th><th style="width:150px">计量编号/点位</th><th style="width:90px">来源</th><th>处置缘由</th></tr></thead>
        <tbody>
          <tr v-for="todo in state.todos" :key="todo.todoCode">
            <td>{{ todo.todoCode }}</td>
            <td>{{ todo.typeLabel }}</td>
            <td>{{ todo.meterCode }} / {{ todo.pointCode }}</td>
            <td>{{ todo.source }}</td>
            <td>{{ todo.reason }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 硬退回：重复整条退回不叠加；越权提交拒绝 -->
    <div class="panel">
      <h3>落库前拦截（整条退回，条数不叠加）</h3>
      <table class="plain-table">
        <thead><tr><th style="width:110px">规则</th><th style="width:150px">计量编号/点位</th><th>退回原因</th></tr></thead>
        <tbody>
          <tr v-for="(rej, i) in state.rejected" :key="`${rej.meterCode}-${i}`" class="reject-row">
            <td>{{ rej.rule === 'duplicate' ? '重复录入' : '越权提交' }}</td>
            <td>{{ rej.meterCode }} / {{ rej.pointCode }}</td>
            <td>{{ rej.reason }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 详情抽屉：取值与列表同一对象 -->
    <div v-if="detail" class="drawer-mask" @click.self="detail = null">
      <aside class="drawer">
        <h3>能耗计量详情</h3>
        <p class="sub">列表与详情共用同一条流水线数据，数字一致。</p>
        <dl>
          <dt>计量编号</dt><dd>{{ detail.meterCode ?? '—' }}</dd>
          <dt>计量点位</dt><dd>{{ detail.pointCode }} · {{ detail.pointName }}</dd>
          <dt>统计周期</dt><dd>{{ detail.period }}</dd>
          <dt>抄表日期</dt><dd>{{ detail.readingDate ?? '—' }}</dd>
          <dt>用电量(kWh)</dt><dd>{{ fmt(detail.electricityKwh) }}</dd>
          <dt>用水量(t)</dt><dd>
            {{ fmt(detail.waterTon) }}
            <div v-if="detail.waterBackfilled" class="alt">早年无水量表，按 0 补录；装表后月均对照值 {{ detail.waterAlternative ?? '—' }}（不计入合计）</div>
          </dd>
          <dt>抄表人员</dt><dd>{{ detail.reader ?? '—' }}</dd>
          <dt>归属单位</dt><dd>{{ detail.ownerUnit }}（{{ detail.responsiblePost }}）</dd>
          <dt>权限</dt><dd><span class="tag" :class="accessTag(detail).key">{{ accessTag(detail).text }}</span></dd>
          <dt>当前状态</dt><dd><span class="tag" :class="statusClass(detail.status)">{{ detail.status }}</span></dd>
          <dt>编号说明</dt><dd>{{ detail.codeNote }}</dd>
          <dt v-if="detail.originalMeterCode">原台账编号</dt><dd v-if="detail.originalMeterCode">{{ detail.originalMeterCode }}</dd>
          <dt v-if="detail.alternativeReading">对照读数</dt>
          <dd v-if="detail.alternativeReading">
            电 {{ fmt(detail.alternativeReading.electricityKwh) }} / 水 {{ fmt(detail.alternativeReading.waterTon) }}
            <div class="alt">{{ detail.alternativeReading.note }}</div>
          </dd>
          <dt v-if="detail.problems.length">数据问题</dt>
          <dd v-if="detail.problems.length">
            <div v-for="p in detail.problems" :key="p" class="error-text">· {{ issueLabel(p) }}</div>
          </dd>
        </dl>
        <button class="btn" type="button" @click="detail = null">关闭</button>
      </aside>
    </div>

    <!-- 提交抄表：仅本单位待抄表点位可用，落库前先校验 -->
    <div v-if="submitTarget" class="drawer-mask" @click.self="submitTarget = null">
      <aside class="drawer">
        <h3>提交抄表 · {{ submitTarget.pointCode }}</h3>
        <p v-if="!canWriteRow(submitTarget)" class="sub error-text">
          该点位归属{{ submitTarget.ownerUnit }}，当前单位跨单位只读，越权提交将被拒绝。
        </p>
        <dl>
          <dt>统计周期</dt><dd>{{ submitTarget.period }}</dd>
          <dt>用电量(kWh)</dt><dd><input v-model.number="form.electricityKwh" type="number" step="0.01" /></dd>
          <dt>用水量(t)</dt><dd><input v-model.number="form.waterTon" type="number" step="0.01" /></dd>
          <dt>抄表日期</dt><dd><input v-model="form.readingDate" type="date" /></dd>
          <dt>抄表人员</dt><dd><input v-model="form.reader" /></dd>
        </dl>
        <div class="kv-inline">
          <button class="btn primary" type="button" @click="confirmSubmit">校验并落库</button>
          <button class="btn" type="button" @click="submitTarget = null">取消</button>
        </div>
        <p v-if="formError" class="error-text">{{ formError }}</p>
      </aside>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import {
  canWriteRow,
  findRow,
  getEnergyState,
  resetEnergyState,
  submitMeterReading,
  type EnergyRow,
} from '@/energy/energy-service'

const state = ref(getEnergyState())
const keyword = ref('')
const statusFilter = ref('')
const message = ref('')
const messageOk = ref(true)

const detail = ref<EnergyRow | null>(null)
const submitTarget = ref<EnergyRow | null>(null)
const form = ref({ electricityKwh: null as number | null, waterTon: null as number | null, readingDate: '', reader: '' })
const formError = ref('')

const filteredRows = computed(() =>
  state.value.rows.filter((row) => {
    const kw = keyword.value.trim()
    const hitKw = !kw || `${row.meterCode ?? ''}${row.pointCode}${row.pointName}`.includes(kw)
    const hitStatus = !statusFilter.value || row.status === statusFilter.value
    return hitKw && hitStatus
  }),
)

function fmt(v: number | null): string {
  return v === null || v === undefined ? '—' : String(v)
}

function issueLabel(type: string): string {
  return (
    {
      'missing-dependency': '依赖缺失（点位未登记）',
      'code-conflict': '计量编号冲突',
      'period-date-contradiction': '统计周期与抄表日期矛盾',
    } as Record<string, string>
  )[type] || type
}

function statusClass(status: string): string {
  if (status === '待抄表') return 'pending'
  if (status === '已核对' || status === '已抄表') return 'verified'
  return 'abnormal'
}

function accessTag(row: EnergyRow): { key: string; text: string } {
  if (row.ownerUnitCode === 'UNCLAIMED') return { key: 'unclaimed', text: '待认领·不可改' }
  if (canWriteRow(row)) return { key: 'self', text: `${row.ownerUnit}·可操作` }
  return { key: 'cross', text: `${row.ownerUnit}·只读` }
}

function openDetail(row: EnergyRow) {
  detail.value = findRow(row.id) ?? row
}

function openSubmit(row: EnergyRow) {
  submitTarget.value = row
  form.value = {
    electricityKwh: row.electricityKwh,
    waterTon: row.waterTon,
    readingDate: `${row.period}-28`,
    reader: state.value.runtime.operatorPost,
  }
  formError.value = ''
}

function confirmSubmit() {
  if (!submitTarget.value) return
  const result = submitMeterReading(submitTarget.value.id, {
    electricityKwh: form.value.electricityKwh === null || Number.isNaN(form.value.electricityKwh) ? null : form.value.electricityKwh,
    waterTon: form.value.waterTon === null || Number.isNaN(form.value.waterTon) ? null : form.value.waterTon,
    reader: form.value.reader,
    readingDate: form.value.readingDate,
  })
  if (!result.ok) {
    formError.value = result.message
    flash(result.message, false)
    return
  }
  state.value = getEnergyState()
  submitTarget.value = null
  flash(result.message, true)
}

function flash(text: string, ok: boolean) {
  message.value = text
  messageOk.value = ok
}

function resetState() {
  state.value = resetEnergyState()
  detail.value = null
  submitTarget.value = null
  flash('已回到固化流水线结果', true)
}
</script>
