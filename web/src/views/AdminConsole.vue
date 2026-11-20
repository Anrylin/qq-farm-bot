<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'

type Tab = 'users' | 'cards' | 'announcements'

const tab = ref<Tab>('users')
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const notice = ref('')

const tabs: { key: Tab, label: string, icon: string }[] = [
  { key: 'users', label: '用户', icon: 'i-carbon-user-multiple' },
  { key: 'cards', label: '卡密', icon: 'i-carbon-ticket' },
  { key: 'announcements', label: '公告', icon: 'i-carbon-megaphone' },
]

// ---------- 用户 ----------
const users = ref<any[]>([])
const stats = ref<any>({})
const keyword = ref('')
const filteredUsers = computed(() => {
  const key = keyword.value.trim().toLowerCase()
  if (!key)
    return users.value
  return users.value.filter(u => String(u.username).toLowerCase().includes(key))
})

const newUser = reactive({ username: '', password: '', days: 30, accountLimit: 1 })
const editUser = ref<any | null>(null)
const editForm = reactive({ days: 30, accountLimit: 1, isAgent: false, registrationQuota: 0, quotaCardQuota: 0, password: '' })

// ---------- 卡密 ----------
const cardStatus = ref<'all' | 'available' | 'used'>('all')
const cards = ref<any>({ total: 0, used: 0, available: 0, items: [] })
const quotaCards = ref<any>({ total: 0, used: 0, available: 0, items: [] })
const cardForm = reactive({ count: 10, type: 'duration', durationDays: 30 })
const quotaForm = reactive({ count: 5, quota: 1 })
const settings = ref<{ requiresCardKey: boolean }>({ requiresCardKey: true })
const issued = ref<string[]>([])

// ---------- 公告 ----------
const announcements = ref<any[]>([])
const annForm = reactive({ id: '', title: '', content: '', pinned: false, active: true })

function expireText(user: any) {
  if (user.locked)
    return '已锁定'
  const at = Number(user.expiresAt) || 0
  if (!at)
    return '永久'
  const days = Math.ceil((at - Date.now()) / 86400000)
  if (days <= 0)
    return '已过期'
  return `${days} 天后到期`
}

async function loadUsers() {
  const { data } = await api.get('/api/admin/users')
  if (data?.ok) {
    users.value = data.data.users || []
    stats.value = data.data.stats || {}
  }
}

async function loadCards() {
  const [list, quota, setting] = await Promise.all([
    api.get('/api/admin/cards', { params: { status: cardStatus.value === 'all' ? '' : cardStatus.value } }),
    api.get('/api/admin/quota-cards'),
    api.get('/api/admin/registration-settings'),
  ])
  if (list.data?.ok)
    cards.value = list.data.data
  if (quota.data?.ok)
    quotaCards.value = quota.data.data
  if (setting.data?.ok)
    settings.value = setting.data.data
}

async function loadAnnouncements() {
  const { data } = await api.get('/api/admin/announcements')
  if (data?.ok)
    announcements.value = data.data || []
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    if (tab.value === 'users')
      await loadUsers()
    else if (tab.value === 'cards')
      await loadCards()
    else
      await loadAnnouncements()
  }
  catch (err: any) {
    error.value = err?.response?.data?.error || err?.message || '加载失败'
  }
  finally {
    loading.value = false
  }
}

function flash(message: string) {
  notice.value = message
  setTimeout(() => { notice.value = '' }, 3000)
}

async function call(fn: () => Promise<any>, successText: string) {
  busy.value = true
  error.value = ''
  try {
    await fn()
    flash(successText)
    await load()
  }
  catch (err: any) {
    error.value = err?.response?.data?.error || err?.message || '操作失败'
  }
  finally {
    busy.value = false
  }
}

// ---------- 用户操作 ----------
function createUser() {
  call(
    () => api.post('/api/admin/users', {
      username: newUser.username.trim(),
      password: newUser.password,
      days: Number(newUser.days) || 0,
      accountLimit: Number(newUser.accountLimit) || 1,
    }),
    '用户已创建',
  ).then(() => {
    newUser.username = ''
    newUser.password = ''
  })
}

function openEdit(user: any) {
  editUser.value = user
  editForm.days = 30
  editForm.accountLimit = Number(user.accountLimit) || 1
  editForm.isAgent = user.isAgent === true
  editForm.registrationQuota = 0
  editForm.quotaCardQuota = 0
  editForm.password = ''
}

function saveEdit() {
  const user = editUser.value
  if (!user)
    return
  call(async () => {
    if (Number(editForm.days) !== 0)
      await api.post(`/api/admin/users/${user.username}/renew`, { days: Number(editForm.days) })
    await api.post(`/api/admin/users/${user.username}/quota`, {
      accountLimit: Number(editForm.accountLimit) || 1,
      isAgent: editForm.isAgent,
      registrationQuota: Number(user.registrationQuota) || 0,
      quotaCardQuota: Number(user.quotaCardQuota) || 0,
    })
    if (Number(editForm.registrationQuota) !== 0 || Number(editForm.quotaCardQuota) !== 0) {
      await api.post(`/api/admin/users/${user.username}/agent-quota`, {
        registrationQuota: Number(editForm.registrationQuota) || 0,
        quotaCardQuota: Number(editForm.quotaCardQuota) || 0,
        isAgent: editForm.isAgent,
      })
    }
    if (editForm.password.trim())
      await api.post(`/api/admin/users/${user.username}/password`, { password: editForm.password.trim() })
  }, '用户已更新').then(() => { editUser.value = null })
}

function toggleLock(user: any) {
  call(() => api.post(`/api/admin/users/${user.username}/lock`, { locked: !user.locked }), user.locked ? '已解锁' : '已锁定')
}

function removeUser(user: any) {
  if (!window.confirm(`确定删除用户 ${user.username}？其名下账号不会自动删除。`))
    return
  call(() => api.delete(`/api/admin/users/${user.username}`), '用户已删除')
}

// ---------- 卡密操作 ----------
function issueCards() {
  call(async () => {
    const { data } = await api.post('/api/admin/cards', {
      count: Number(cardForm.count) || 1,
      type: cardForm.type,
      durationDays: Number(cardForm.durationDays) || 30,
    })
    issued.value = data?.data?.codes || []
  }, '卡密已生成')
}

function issueQuotaCards() {
  call(async () => {
    const { data } = await api.post('/api/admin/quota-cards', {
      count: Number(quotaForm.count) || 1,
      quota: Number(quotaForm.quota) || 1,
    })
    issued.value = data?.data?.codes || []
  }, '配额卡已生成')
}

function deleteCard(code: string) {
  if (!window.confirm(`删除卡密 ${code}？`))
    return
  call(() => api.delete(`/api/admin/cards/${code}`), '卡密已删除')
}

function toggleRequiresCard() {
  call(() => api.post('/api/admin/registration-settings', { requiresCardKey: !settings.value.requiresCardKey }), '注册设置已更新')
}

async function copyAll() {
  if (!issued.value.length)
    return
  try {
    await navigator.clipboard.writeText(issued.value.join('\n'))
    flash('已复制到剪贴板')
  }
  catch { /* 忽略 */ }
}

// ---------- 公告操作 ----------
function saveAnnouncement() {
  const payload = {
    title: annForm.title.trim(),
    content: annForm.content.trim(),
    pinned: annForm.pinned,
    active: annForm.active,
  }
  call(async () => {
    if (annForm.id)
      await api.put(`/api/admin/announcements/${annForm.id}`, payload)
    else
      await api.post('/api/admin/announcements', payload)
  }, annForm.id ? '公告已更新' : '公告已发布').then(() => {
    annForm.id = ''
    annForm.title = ''
    annForm.content = ''
    annForm.pinned = false
    annForm.active = true
  })
}

function editAnnouncement(item: any) {
  annForm.id = item.id
  annForm.title = item.title
  annForm.content = item.content
  annForm.pinned = item.pinned
  annForm.active = item.active
}

function toggleAnnouncement(item: any) {
  call(() => api.put(`/api/admin/announcements/${item.id}`, { active: !item.active }), item.active ? '已下线' : '已上线')
}

function removeAnnouncement(item: any) {
  if (!window.confirm('确定删除这条公告？'))
    return
  call(() => api.delete(`/api/admin/announcements/${item.id}`), '公告已删除')
}

onMounted(load)
</script>

<template>
  <div class="page">
    <header class="head">
      <div class="flex items-center gap-2">
        <span class="i-carbon-settings-admin h-5 w-5 text-[var(--ui-primary)]" />
        <h1 class="title">
          管理台
        </h1>
        <span v-if="tab === 'users'" class="dim">
          共 {{ stats.total ?? 0 }} 人 · 过期 {{ stats.expired ?? 0 }} · 代理 {{ stats.agents ?? 0 }} · 锁定 {{ stats.locked ?? 0 }}
        </span>
      </div>
      <BaseButton size="sm" :loading="loading" @click="load">
        刷新
      </BaseButton>
    </header>

    <div class="tabs">
      <button
        v-for="item in tabs"
        :key="item.key"
        class="tab"
        :class="{ active: tab === item.key }"
        @click="tab = item.key; load()"
      >
        <span :class="item.icon" class="h-4 w-4" />
        {{ item.label }}
      </button>
    </div>

    <p v-if="error" class="banner danger">
      <span class="i-carbon-warning-alt" />{{ error }}
    </p>
    <p v-if="notice" class="banner ok">
      <span class="i-carbon-checkmark-filled" />{{ notice }}
    </p>

    <!-- ================= 用户 ================= -->
    <template v-if="tab === 'users'">
      <section class="card">
        <h2 class="card-title">
          新建用户
        </h2>
        <div class="row">
          <label class="field">
            <span class="label">用户名</span>
            <BaseInput v-model="newUser.username" placeholder="3-32 位" />
          </label>
          <label class="field">
            <span class="label">密码</span>
            <BaseInput v-model="newUser.password" type="password" placeholder="至少 8 位" />
          </label>
          <label class="field narrow">
            <span class="label">有效期(天)</span>
            <BaseInput v-model="newUser.days" type="number" />
          </label>
          <label class="field narrow">
            <span class="label">账号配额</span>
            <BaseInput v-model="newUser.accountLimit" type="number" />
          </label>
          <BaseButton variant="primary" :loading="busy" @click="createUser">
            创建
          </BaseButton>
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <h2 class="card-title">
            用户列表
          </h2>
          <BaseInput v-model="keyword" placeholder="搜索用户名" class="search" />
        </div>
        <div class="table">
          <div class="tr th">
            <span>用户名</span><span>有效期</span><span>配额</span><span>代理</span><span>操作</span>
          </div>
          <div v-for="user in filteredUsers" :key="user.username" class="tr">
            <span class="mono">
              {{ user.username }}
              <span v-if="user.role === 'admin'" class="tag admin">管理员</span>
            </span>
            <span :class="user.expired ? 'danger-text' : ''">{{ expireText(user) }}</span>
            <span>{{ user.accountLimit > 1e12 ? '不限' : user.accountLimit }}</span>
            <span>{{ user.isAgent ? `卡 ${user.registrationQuota} / 配 ${user.quotaCardQuota}` : '—' }}</span>
            <span class="ops">
              <button class="op" @click="openEdit(user)">
                编辑
              </button>
              <button class="op" @click="toggleLock(user)">
                {{ user.locked ? '解锁' : '锁定' }}
              </button>
              <button v-if="user.role !== 'admin'" class="op danger" @click="removeUser(user)">
                删除
              </button>
            </span>
          </div>
          <p v-if="!filteredUsers.length" class="dim">
            没有匹配的用户
          </p>
        </div>
      </section>
    </template>

    <!-- ================= 卡密 ================= -->
    <template v-else-if="tab === 'cards'">
      <section class="grid two">
        <div class="card">
          <h2 class="card-title">
            生成注册卡
          </h2>
          <div class="row">
            <label class="field narrow">
              <span class="label">数量</span>
              <BaseInput v-model="cardForm.count" type="number" />
            </label>
            <label class="field">
              <span class="label">类型</span>
              <select v-model="cardForm.type" class="select">
                <option value="duration">
                  按期
                </option>
                <option value="permanent">
                  永久
                </option>
              </select>
            </label>
            <label v-if="cardForm.type === 'duration'" class="field narrow">
              <span class="label">天数</span>
              <BaseInput v-model="cardForm.durationDays" type="number" />
            </label>
          </div>
          <BaseButton variant="primary" block class="mt-3" :loading="busy" @click="issueCards">
            生成
          </BaseButton>
        </div>

        <div class="card">
          <h2 class="card-title">
            生成配额卡
          </h2>
          <div class="row">
            <label class="field narrow">
              <span class="label">数量</span>
              <BaseInput v-model="quotaForm.count" type="number" />
            </label>
            <label class="field narrow">
              <span class="label">每张配额</span>
              <BaseInput v-model="quotaForm.quota" type="number" />
            </label>
          </div>
          <BaseButton variant="primary" block class="mt-3" :loading="busy" @click="issueQuotaCards">
            生成
          </BaseButton>
        </div>
      </section>

      <section v-if="issued.length" class="card">
        <div class="card-head">
          <h2 class="card-title">
            本次生成 {{ issued.length }} 张
          </h2>
          <BaseButton size="sm" @click="copyAll">
            全部复制
          </BaseButton>
        </div>
        <div class="codes">
          <span v-for="code in issued" :key="code" class="code">{{ code }}</span>
        </div>
      </section>

      <section class="card">
        <div class="card-head">
          <h2 class="card-title">
            注册卡（{{ cards.total }} 张，可用 {{ cards.available }}）
          </h2>
          <select v-model="cardStatus" class="select" @change="loadCards">
            <option value="all">
              全部
            </option>
            <option value="available">
              未使用
            </option>
            <option value="used">
              已使用
            </option>
          </select>
        </div>
        <div class="table">
          <div class="tr cards th">
            <span>卡密</span><span>类型</span><span>状态</span><span>使用人</span><span />
          </div>
          <div v-for="card in cards.items.slice(0, 200)" :key="card.code" class="tr cards">
            <span class="mono">{{ card.code }}</span>
            <span>{{ card.type === 'permanent' ? '永久' : `${card.durationDays} 天` }}</span>
            <span :class="card.usedAt ? 'dim' : 'ok-text'">{{ card.usedAt ? '已使用' : '未使用' }}</span>
            <span class="dim">{{ card.usedBy || '—' }}</span>
            <span class="ops">
              <button v-if="!card.usedAt" class="op danger" @click="deleteCard(card.code)">
                删除
              </button>
            </span>
          </div>
        </div>
        <p class="dim">
          仅显示前 200 条；配额卡 {{ quotaCards.total }} 张（可用 {{ quotaCards.available }}）
        </p>
      </section>

      <section class="card">
        <div class="card-head">
          <h2 class="card-title">
            注册开关
          </h2>
          <BaseButton size="sm" @click="toggleRequiresCard">
            {{ settings.requiresCardKey ? '关闭卡密校验' : '开启卡密校验' }}
          </BaseButton>
        </div>
        <p class="dim">
          当前：{{ settings.requiresCardKey ? '注册必须使用卡密' : '开放注册，无需卡密' }}
        </p>
      </section>
    </template>

    <!-- ================= 公告 ================= -->
    <template v-else>
      <section class="card">
        <h2 class="card-title">
          {{ annForm.id ? '编辑公告' : '发布公告' }}
        </h2>
        <div class="col">
          <label class="field">
            <span class="label">标题</span>
            <BaseInput v-model="annForm.title" placeholder="例如：售后群 / 维护通知" />
          </label>
          <label class="field">
            <span class="label">内容</span>
            <textarea v-model="annForm.content" class="textarea" rows="4" />
          </label>
          <div class="row">
            <label class="check"><input v-model="annForm.pinned" type="checkbox"> 置顶</label>
            <label class="check"><input v-model="annForm.active" type="checkbox"> 启用</label>
            <BaseButton variant="primary" :loading="busy" @click="saveAnnouncement">
              {{ annForm.id ? '保存' : '发布' }}
            </BaseButton>
            <BaseButton v-if="annForm.id" @click="annForm.id = ''; annForm.title = ''; annForm.content = ''">
              取消
            </BaseButton>
          </div>
        </div>
      </section>

      <section class="card">
        <h2 class="card-title">
          公告列表（{{ announcements.length }}）
        </h2>
        <div class="table">
          <div v-for="item in announcements" :key="item.id" class="ann-row">
            <div>
              <p class="ann-title">
                <span v-if="item.pinned" class="i-carbon-pin" />
                {{ item.title || '(无标题)' }}
                <span class="tag" :class="item.active ? 'ok' : ''">{{ item.active ? '启用' : '停用' }}</span>
              </p>
              <p class="ann-body">
                {{ item.content }}
              </p>
            </div>
            <span class="ops">
              <button class="op" @click="editAnnouncement(item)">
                编辑
              </button>
              <button class="op" @click="toggleAnnouncement(item)">
                {{ item.active ? '下线' : '上线' }}
              </button>
              <button class="op danger" @click="removeAnnouncement(item)">
                删除
              </button>
            </span>
          </div>
          <p v-if="!announcements.length" class="dim">
            还没有公告
          </p>
        </div>
      </section>
    </template>

    <!-- 编辑用户弹窗 -->
    <div v-if="editUser" class="mask" @click.self="editUser = null">
      <div class="modal">
        <h3 class="modal-title">
          编辑 {{ editUser.username }}
        </h3>
        <div class="col">
          <label class="field">
            <span class="label">续期天数（0 = 不改）</span>
            <BaseInput v-model="editForm.days" type="number" />
          </label>
          <label class="field">
            <span class="label">账号配额</span>
            <BaseInput v-model="editForm.accountLimit" type="number" />
          </label>
          <label class="check"><input v-model="editForm.isAgent" type="checkbox"> 设为代理</label>
          <div class="row">
            <label class="field">
              <span class="label">追加发卡额度</span>
              <BaseInput v-model="editForm.registrationQuota" type="number" />
            </label>
            <label class="field">
              <span class="label">追加配额卡额度</span>
              <BaseInput v-model="editForm.quotaCardQuota" type="number" />
            </label>
          </div>
          <label class="field">
            <span class="label">重置密码（留空不改）</span>
            <BaseInput v-model="editForm.password" type="password" placeholder="至少 8 位" />
          </label>
        </div>
        <div class="modal-foot">
          <BaseButton @click="editUser = null">
            取消
          </BaseButton>
          <BaseButton variant="primary" :loading="busy" @click="saveEdit">
            保存
          </BaseButton>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
}
.head,
.card-head {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
}
.title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  color: var(--ui-text);
}
.dim {
  margin: 0;
  font-size: 12px;
  color: var(--ui-subtle);
}
.tabs {
  display: flex;
  gap: 4px;
  padding: 4px;
  border-radius: 12px;
  background: var(--ui-muted-soft, rgb(0 0 0 / 4%));
  width: fit-content;
}
.tab {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  padding: 6px 12px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  font-size: 13px;
  color: var(--ui-muted);
  cursor: pointer;
}
.tab.active {
  background: var(--ui-surface);
  color: var(--ui-text);
  box-shadow: 0 1px 3px rgb(0 0 0 / 8%);
}
.card {
  padding: 16px;
  border: 1px solid var(--ui-border);
  border-radius: 14px;
  background: var(--ui-surface);
}
.card-title {
  margin: 0 0 10px;
  font-size: 14px;
  font-weight: 600;
  color: var(--ui-text);
}
.grid {
  display: grid;
  gap: 12px;
}
.grid.two {
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: flex-end;
}
.col {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.field {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 4px;
  min-width: 120px;
}
.field.narrow {
  flex: 0 0 auto;
  min-width: 90px;
  width: 110px;
}
.label {
  font-size: 12px;
  color: var(--ui-muted);
}
.select,
.textarea {
  border: 1px solid var(--ui-border);
  border-radius: 8px;
  background: var(--ui-surface);
  color: var(--ui-text);
}
.select {
  height: 34px;
  padding: 0 8px;
}
.textarea {
  padding: 8px;
  font-size: 13px;
  resize: vertical;
}
.check {
  display: inline-flex;
  gap: 6px;
  align-items: center;
  font-size: 12px;
  color: var(--ui-muted);
}
.search {
  width: 200px;
}
.table {
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-x: auto;
}
.tr {
  display: grid;
  align-items: center;
  gap: 8px;
  grid-template-columns: minmax(140px, 1.4fr) 110px 70px 150px 150px;
  padding: 7px 0;
  border-bottom: 1px dashed var(--ui-border);
  font-size: 12px;
}
.tr.cards {
  grid-template-columns: minmax(160px, 1.2fr) 70px 70px 120px 60px;
}
.tr.th {
  border-bottom: 1px solid var(--ui-border);
  font-weight: 600;
  color: var(--ui-subtle);
}
.mono {
  font-family: ui-monospace, monospace;
  color: var(--ui-text);
}
.ops {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.op {
  padding: 2px 8px;
  border: 1px solid var(--ui-border);
  border-radius: 7px;
  background: var(--ui-surface);
  font-size: 11px;
  color: var(--ui-muted);
  cursor: pointer;
}
.op:hover {
  border-color: var(--ui-primary);
  color: var(--ui-primary);
}
.op.danger:hover {
  border-color: var(--ui-danger);
  color: var(--ui-danger);
}
.tag {
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 6px;
  font-size: 10px;
  background: var(--ui-muted-soft, rgb(0 0 0 / 6%));
  color: var(--ui-subtle);
}
.tag.admin,
.tag.ok {
  background: var(--ui-primary-soft);
  color: var(--ui-primary);
}
.danger-text {
  color: var(--ui-danger);
}
.ok-text {
  color: var(--ui-primary);
}
.codes {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
  max-height: 180px;
  overflow: auto;
}
.code {
  padding: 4px 8px;
  border-radius: 7px;
  background: var(--ui-primary-soft);
  font-family: ui-monospace, monospace;
  font-size: 11px;
  color: var(--ui-primary);
}
.ann-row {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  justify-content: space-between;
  padding: 8px 0;
  border-bottom: 1px dashed var(--ui-border);
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
.mask {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgb(0 0 0 / 30%);
  z-index: 50;
}
.modal {
  width: 100%;
  max-width: 420px;
  padding: 20px;
  border-radius: 14px;
  background: var(--ui-surface);
}
.modal-title {
  margin: 0 0 14px;
  font-size: 15px;
  font-weight: 600;
  color: var(--ui-text);
}
.modal-foot {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 16px;
}
</style>
