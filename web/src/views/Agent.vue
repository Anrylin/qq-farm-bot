<script setup lang="ts">
import { onMounted, ref } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'

const overview = ref<any>(null)
const cards = ref<any[]>([])
const quotaCards = ref<any[]>([])
const loading = ref(false)

const form = ref({ count: 1, type: 'duration', durationDays: 30 })
const quotaForm = ref({ count: 1, quota: 1 })
const issued = ref<string[]>([])
const issuedQuota = ref<string[]>([])
const error = ref('')
const busy = ref(false)

async function load() {
  loading.value = true
  try {
    const [ov, cs, qs] = await Promise.all([
      api.get('/api/agent/overview'),
      api.get('/api/agent/cards'),
      api.get('/api/agent/quota-cards'),
    ])
    if (ov.data?.ok)
      overview.value = ov.data.data
    if (cs.data?.ok)
      cards.value = cs.data.data.items || []
    if (qs.data?.ok)
      quotaCards.value = qs.data.data.items || []
  }
  catch (err: any) {
    error.value = err?.response?.data?.error || '加载失败'
  }
  finally {
    loading.value = false
  }
}

async function issue() {
  error.value = ''
  issued.value = []
  busy.value = true
  try {
    const { data } = await api.post('/api/agent/cards', {
      count: Number(form.value.count) || 1,
      type: form.value.type,
      durationDays: Number(form.value.durationDays) || 30,
    })
    if (!data?.ok)
      throw new Error(data?.error || '发卡失败')
    issued.value = data.data.codes || []
    await load()
  }
  catch (err: any) {
    error.value = err?.response?.data?.error || err?.message || '发卡失败'
  }
  finally {
    busy.value = false
  }
}

async function issueQuota() {
  error.value = ''
  issuedQuota.value = []
  busy.value = true
  try {
    const { data } = await api.post('/api/agent/quota-cards', {
      count: Number(quotaForm.value.count) || 1,
      quota: Number(quotaForm.value.quota) || 1,
    })
    if (!data?.ok)
      throw new Error(data?.error || '发卡失败')
    issuedQuota.value = data.data.codes || []
    await load()
  }
  catch (err: any) {
    error.value = err?.response?.data?.error || err?.message || '发卡失败'
  }
  finally {
    busy.value = false
  }
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  }
  catch { /* 忽略 */ }
}

onMounted(load)
</script>

<template>
  <div class="page">
    <header class="head">
      <div class="flex items-center gap-2">
        <span class="i-carbon-user-multiple h-5 w-5 text-[var(--ui-primary)]" />
        <h1 class="title">
          代理中心
        </h1>
      </div>
      <BaseButton size="sm" :loading="loading" @click="load">
        刷新
      </BaseButton>
    </header>

    <section class="grid">
      <div class="stat">
        <p class="stat-label">
          剩余注册卡额度
        </p>
        <p class="stat-value">
          {{ overview?.registrationQuota ?? '-' }}
        </p>
        <p class="stat-hint">
          已发 {{ overview?.cards?.total ?? 0 }} 张，未用 {{ overview?.cards?.available ?? 0 }} 张
        </p>
      </div>
      <div class="stat">
        <p class="stat-label">
          剩余配额卡额度
        </p>
        <p class="stat-value">
          {{ overview?.quotaCardQuota ?? '-' }}
        </p>
        <p class="stat-hint">
          已发 {{ overview?.quotaCards?.total ?? 0 }} 张
        </p>
      </div>
    </section>

    <p v-if="error" class="banner danger">
      <span class="i-carbon-warning-alt" />{{ error }}
    </p>

    <section class="grid two">
      <div class="card">
        <h2 class="card-title">
          生成注册卡
        </h2>
        <div class="row">
          <label class="field">
            <span class="label">数量</span>
            <BaseInput v-model="form.count" type="number" />
          </label>
          <label class="field">
            <span class="label">类型</span>
            <select v-model="form.type" class="select">
              <option value="duration">
                按期
              </option>
              <option value="permanent">
                永久
              </option>
            </select>
          </label>
          <label v-if="form.type === 'duration'" class="field">
            <span class="label">天数</span>
            <BaseInput v-model="form.durationDays" type="number" />
          </label>
        </div>
        <BaseButton variant="primary" block :loading="busy" class="mt-3" @click="issue">
          生成
        </BaseButton>
        <ul v-if="issued.length" class="codes">
          <li v-for="code in issued" :key="code" class="code" @click="copy(code)">
            {{ code }}
          </li>
        </ul>
      </div>

      <div class="card">
        <h2 class="card-title">
          生成配额卡
        </h2>
        <div class="row">
          <label class="field">
            <span class="label">数量</span>
            <BaseInput v-model="quotaForm.count" type="number" />
          </label>
          <label class="field">
            <span class="label">每张配额</span>
            <BaseInput v-model="quotaForm.quota" type="number" />
          </label>
        </div>
        <BaseButton variant="primary" block :loading="busy" class="mt-3" @click="issueQuota">
          生成
        </BaseButton>
        <ul v-if="issuedQuota.length" class="codes">
          <li v-for="code in issuedQuota" :key="code" class="code" @click="copy(code)">
            {{ code }}
          </li>
        </ul>
      </div>
    </section>

    <section class="card">
      <h2 class="card-title">
        我发行的注册卡（{{ cards.length }}）
      </h2>
      <div class="table">
        <div v-for="card in cards" :key="card.code" class="tr">
          <span class="mono" @click="copy(card.code)">{{ card.code }}</span>
          <span class="dim">
            {{ card.type === 'permanent' ? '永久' : `${card.durationDays} 天` }}
          </span>
          <span :class="card.usedAt ? 'used' : 'free'">
            {{ card.usedAt ? '已使用' : '未使用' }}
          </span>
        </div>
        <p v-if="!cards.length" class="dim">
          还没有发行过卡密
        </p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  color: var(--ui-text);
}
.grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
}
.grid.two {
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
}
.stat,
.card {
  padding: 16px;
  border: 1px solid var(--ui-border);
  border-radius: 14px;
  background: var(--ui-surface);
}
.stat-label {
  margin: 0;
  font-size: 12px;
  color: var(--ui-subtle);
}
.stat-value {
  margin: 6px 0 2px;
  font-size: 22px;
  font-weight: 600;
  color: var(--ui-text);
}
.stat-hint,
.dim {
  margin: 0;
  font-size: 12px;
  color: var(--ui-muted);
}
.card-title {
  margin: 0 0 10px;
  font-size: 14px;
  font-weight: 600;
  color: var(--ui-text);
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 90px;
  flex: 1;
}
.label {
  font-size: 12px;
  color: var(--ui-muted);
}
.select {
  height: 34px;
  padding: 0 8px;
  border: 1px solid var(--ui-border);
  border-radius: 8px;
  background: var(--ui-surface);
  color: var(--ui-text);
}
.codes {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 12px 0 0;
  padding: 0;
  list-style: none;
}
.code {
  padding: 6px 8px;
  border-radius: 8px;
  background: var(--ui-primary-soft);
  font-family: ui-monospace, monospace;
  font-size: 12px;
  color: var(--ui-primary);
  cursor: copy;
}
.table {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tr {
  display: grid;
  align-items: center;
  gap: 8px;
  grid-template-columns: 1fr 90px 70px;
  padding: 6px 0;
  border-bottom: 1px dashed var(--ui-border);
  font-size: 12px;
}
.mono {
  font-family: ui-monospace, monospace;
  color: var(--ui-text);
  cursor: copy;
}
.used {
  color: var(--ui-subtle);
}
.free {
  color: var(--ui-primary);
}
.banner {
  display: flex;
  gap: 6px;
  align-items: center;
  margin: 0;
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 12px;
}
.banner.danger {
  color: var(--ui-danger);
  background: var(--ui-danger-soft);
}
</style>
