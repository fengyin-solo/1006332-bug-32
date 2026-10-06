<template>
  <section class="page" data-module="energy">
    <header class="page-head">
      <div>
        <h2>廊内能耗计量管理</h2>
        <p class="page-desc">维护能耗计量记录，围绕计量编号、计量点位、用电量、用水量做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="showCreate = !showCreate">登记能耗计量记录</button>
        <button class="btn" type="button" @click="exportRows">导出廊内能耗计量清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form v-if="showCreate" class="create-bar" @submit.prevent="submitCreate">
      <label v-for="field in createFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="createForm[field]" :placeholder="createPlaceholder(field)" />
      </label>
      <button class="btn primary" type="submit">校验并落库</button>
      <button class="btn ghost" type="button" @click="showCreate = false">取消</button>
    </form>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] === '' ? '—' : (row[column] ?? '—') }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <template v-if="writable(row)">
              <button
                v-for="action in actions"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
            </template>
            <span v-else class="readonly-tag" :title="`归 ${row.权属单位}·${row.责任岗位}`">只读</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无廊内能耗计量数据，可先登记能耗计量记录</td>
        </tr>
      </tbody>
    </table>

    <section class="panel">
      <h3>对账结论</h3>
      <p>
        对账待办 <strong>{{ recon.todo }}</strong> 项（待抄表 {{ recon.pendingReading }}、数据异常 {{ recon.abnormal }}）：
        {{ recon.codes.join('、') || '无' }}
      </p>
      <p>
        值班台账 DUTY-0001 交接事项：{{ recon.dutyText || '（未找到值班台账记录）' }}
        <span :class="reconConsistent ? 'ok-text' : 'error-text'">
          {{ reconConsistent ? '台账条数与对账待办一致' : '台账条数与对账待办不一致，请核对' }}
        </span>
      </p>
    </section>

    <section class="panel">
      <h3>自检结果（共 {{ findings.length }} 条）</h3>
      <table v-if="findings.length" class="data-table">
        <thead>
          <tr><th>类型</th><th>计量编号 / 点位</th><th>缘由</th></tr>
        </thead>
        <tbody>
          <tr v-for="(item, index) in findings" :key="index">
            <td>{{ item.type }}</td>
            <td>{{ item.code }}</td>
            <td>{{ item.reason }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="ok-text">依赖缺失、计量编号冲突、周期矛盾均为 0 条</p>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条廊内能耗计量记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-if="okMessage" class="ok-text">{{ okMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  createEntry,
  downloadEntries,
  listEntries,
  loadEnergyRecon,
  moduleMeta,
  rowWritable,
  runAction as applyAction,
  runEnergySelfCheck,
} from '@/api/local-service'
import { periodOfDate, todayStr } from '@/data/time'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('energy')
const columns = ["计量编号", "计量点位", "用电量", "用水量", "统计周期", "抄表人员", "抄表日期", "责任岗位", "计量状态"]
const actions = ["提交抄表", "确认核对", "标记异常"]
const statuses = ["待抄表", "已抄表", "数据异常", "已核对"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const okMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const findings = ref(runEnergySelfCheck())
const recon = ref(loadEnergyRecon())
const showCreate = ref(false)

const createFields = ["计量编号", "计量点位", "用电量", "用水量", "统计周期", "抄表人员", "抄表日期"]
const createForm = reactive<Record<string, string>>({
  计量编号: '',
  计量点位: '',
  用电量: '',
  用水量: '',
  统计周期: periodOfDate(todayStr()),
  抄表人员: '',
  抄表日期: todayStr(),
})

function createPlaceholder(field: string) {
  if (field === '用电量') return '单位 kWh，非负数值'
  if (field === '用水量') return '单位 m³，非负数值'
  if (field === '统计周期') return 'YYYY-MM'
  if (field === '抄表日期') return 'YYYY-MM-DD'
  return `填写${field}`
}

// 统计卡、图例、表格同取当前列表这一份数据，列表上的数字与详情取值天然对得上。
const stats = computed(() => [
  { label: '待抄表点位', value: rows.value.filter((row) => row.status === '待抄表').length },
  { label: '已核对点位', value: rows.value.filter((row) => row.status === '已核对').length },
  { label: '数据异常点位', value: rows.value.filter((row) => row.status === '数据异常').length },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const reconConsistent = computed(() => {
  const matched = recon.value.dutyText.match(/能耗对账待办 (\d+) 项/)
  return matched !== null && Number(matched[1]) === recon.value.todo
})

function writable(row: EntryRow) {
  return rowWritable(row)
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function submitCreate() {
  errorMessage.value = ''
  okMessage.value = ''
  const result = createEntry(meta.key, { ...createForm })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  okMessage.value = result.message
  showCreate.value = false
  createForm.计量编号 = ''
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  okMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  okMessage.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    findings.value = runEnergySelfCheck()
    recon.value = loadEnergyRecon()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '廊内能耗计量列表读取失败'
  }
}

onMounted(reload)
</script>
