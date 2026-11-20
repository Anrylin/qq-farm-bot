<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { useUserStore } from '@/stores/user'

const userStore = useUserStore()
const me = ref<any>(null)
const announcements = ref<any[]>([])
const accountCount = ref(0)
const loading = ref(false)

const renewKey = ref('')
const quotaKey = ref('')
const message = ref('')
const error = ref('')
const busy = ref(false)

const expiresText = computed(() => {
  const at = Number(me.value?.expiresAt) || 0
  if (!at)
    return '永久'
  return new Date(at).toLocaleString()
})
const remainDays = computed(() => {
  const at = Number(me.value?.expiresAt) || 0
  if (!at)
    return null
  return Math.max(0, Math.ceil((at - Date.now()) / 86400000))
})
const quotaText = computed(() => {
  const limit = Number(me.value?.accountLimit) || 0
  return limit > 1e12 ? '不限' : `${accountCount.value} / ${limit}`
})

async function load() {
  loading.value = true
  try {
    const [meRes, annRes, accRes] = await Promise.all([
      api.get('/api/user/me'),
      api.get('/api/announcements'),
      api.get('/api/accounts'),
    ])
    if (meRes.data?.ok)
      me.value = meRes.data.data
    if (annRes.data?.ok)
      announcements.value = annRes.data.data || []
    if (accRes.data?.ok)
      accountCount.value = (accRes.data.data?.accounts || []).length
  }
  finally {
    loading.value = false
  }
}

async function renew() {
  error.value = ''
  message.value = ''
  if (!renewKey.value.trim()) {
    error.value = '请输入卡密'
    return
  }
  busy.value = true
  try {
    const { data } = await api.post('/api/renew', { cardKey: renewKey.value.trim() })
    if (!data?.ok)
      throw new Error(data?.error || '续费失败')
    message.value = '续费成功'
    renewKey.value = ''
    await load()
  }
  catch (err: any) {
    error.value = err?.response?.data?.error || err?.message || '续费失败'
  }
  finally {
    busy.value = false
  }
}

async function redeemQuota() {
  error.value = ''
  message.value = ''
  if (!quotaKey.value.trim()) {
    error.value = '请输入配额卡'
    return
  }
  busy.value = true
  try {
    const { data } = await api.post('/api/user/quota-card', { code: quotaKey.value.trim() })
    if (!data?.ok)
      throw new Error(data?.error || '核销失败')
    message.value = `配额卡核销成功，账号上限 +${data.data.quota}`
    quotaKey.value = ''
    await load()
  }
  catch (err: any) {
    error.value = err?.response?.data?.error || err?.message || '核销失败'
  }
  finally {
    busy.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="page">
    <header class="head">
      <div class="flex items-center gap-2">
        <span class="i-carbon-user-avatar h-5 w-5 text-[var(--ui-primary)]" />
        <h1 class="title">
          我的账号
        </h1>
      </div>
      <BaseButton size="sm" :loading="loading" @click="load">
        刷新
      </BaseButton>
    </header>

    <p v-if="me?.locked" class="banner danger">
      <span class="i-carbon-locked" />账号已被锁定，请联系管理员
    </p>
    <p v-else-if="me?.expired" class="banner danger">
      <span class="i-carbon-warning-alt" />账号已到期，登录后将无法使用，请先续费
    </p>

    <section class="grid">
      <div class="stat">
        <p class="stat-label">
          账号
        </p>
        <p class="stat-value">
          {{ me?.username || '-' }}
        </p>
        <p class="stat-hint">
          {{ me?.role === 'admin' ? '超级管理员' : me?.isAgent ? '代理账号' : '普通用户' }}
        </p>
      </div>
      <div class="stat">
        <p class="stat-label">
          到期时间
        </p>
        <p class="stat-value">
          {{ expiresText }}
        </p>
        <p class="stat-hint">
          <span v-if="remainDays === null">永久有效</span>
          <span v-else>剩余 {{ remainDays }} 天</span>
        </p>
      </div>
      <div class="stat">
        <p class="stat-label">
          账号配额
        </p>
        <p class="stat-value">
          {{ quotaText }}
        </p>
        <p class="stat-hint">
          用配额卡可增加
        </p>
      </div>
    </section>

    <p v-if="message" class="banner ok">
      <span class="i-carbon-checkmark-filled" />{{ message }}
    </p>
    <p v-if="error" class="banner danger">
      <span class="i-carbon-warning-alt" />{{ error }}
    </p>

    <section class="grid two">
      <div class="card">
        <h2 class="card-title">
          续费
        </h2>
        <p class="card-sub">
          输入注册卡密延长有效期
        </p>
        <div class="row">
          <BaseInput v-model="renewKey" placeholder="QF-XXXX-XXXX-XXXX" />
          <BaseButton variant="primary" :loading="busy" @click="renew">
            续费
          </BaseButton>
        </div>
      </div>

      <div class="card">
        <h2 class="card-title">
          配额卡
        </h2>
        <p class="card-sub">
          核销后增加可添加的账号数量
        </p>
        <div class="row">
          <BaseInput v-model="quotaKey" placeholder="QE-XXXX-XXXX-XXXX" />
          <BaseButton variant="primary" :loading="busy" @click="redeemQuota">
            核销
          </BaseButton>
        </div>
      </div>
    </section>

    <section v-if="announcements.length" class="card">
      <h2 class="card-title">
        公告
      </h2>
      <article v-for="item in announcements" :key="item.id" class="ann">
        <p class="ann-title">
          <span v-if="item.pinned" class="i-carbon-pin" />
          {{ item.title }}
        </p>
        <p class="ann-body">
          {{ item.content }}
        </p>
        <p class="ann-time">
          {{ new Date(item.updatedAt).toLocaleString() }}
        </p>
      </article>
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
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
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
.stat-label,
.card-sub {
  margin: 0;
  font-size: 12px;
  color: var(--ui-subtle);
}
.stat-value {
  margin: 6px 0 2px;
  font-size: 20px;
  font-weight: 600;
  color: var(--ui-text);
  word-break: break-all;
}
.stat-hint {
  margin: 0;
  font-size: 12px;
  color: var(--ui-muted);
}
.card-title {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 600;
  color: var(--ui-text);
}
.row {
  display: flex;
  gap: 8px;
  margin-top: 10px;
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
.banner.ok {
  color: var(--ui-primary);
  background: var(--ui-primary-soft);
}
.banner.danger {
  color: var(--ui-danger);
  background: var(--ui-danger-soft);
}
.ann + .ann {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed var(--ui-border);
}
.ann-title {
  display: flex;
  gap: 4px;
  align-items: center;
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--ui-text);
}
.ann-body {
  margin: 4px 0 0;
  font-size: 12px;
  white-space: pre-wrap;
  color: var(--ui-muted);
}
.ann-time {
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--ui-subtle);
}
</style>
