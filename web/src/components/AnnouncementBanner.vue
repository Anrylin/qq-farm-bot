<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useIntervalFn, useStorage } from '@vueuse/core'
import { useRoute } from 'vue-router'
import api from '@/api'

interface Announcement {
  id: string
  title: string
  content: string
  pinned: boolean
  updatedAt: number
}

const items = ref<Announcement[]>([])
// 按天记录已关闭的公告，避免每次刷新都弹
const dismissed = useStorage<{ date: string, ids: string[] }>('ann_dismissed', { date: '', ids: [] })

const today = new Date().toISOString().slice(0, 10)
if (dismissed.value.date !== today)
  dismissed.value = { date: today, ids: [] }

const visible = computed(() => items.value
  .filter(item => !dismissed.value.ids.includes(item.id))
  .slice(0, 3))

function dismiss(id: string) {
  dismissed.value = { date: today, ids: [...dismissed.value.ids, id] }
}

async function load() {
  try {
    const { data } = await api.get('/api/announcements', { timeout: 8000 })
    if (data?.ok)
      items.value = Array.isArray(data.data) ? data.data : []
  }
  catch {
    // 公告失败不影响主流程
  }
}

// 布局只在首屏挂载一次，路由切换不会重新拉；这里补上切页与定时刷新，
// 让管理员新发的公告不用手动刷新页面就能出现。
const route = useRoute()
watch(() => route.fullPath, load)
useIntervalFn(load, 5 * 60 * 1000)

onMounted(load)
</script>

<template>
  <div v-if="visible.length" class="ann-wrap">
    <article
      v-for="item in visible"
      :key="item.id"
      class="ann"
      :class="{ pinned: item.pinned }"
    >
      <span class="icon" :class="item.pinned ? 'i-carbon-pin' : 'i-carbon-megaphone'" />
      <div class="body">
        <span v-if="item.title" class="title">{{ item.title }}</span>
        <span class="content">{{ item.content }}</span>
      </div>
      <button class="close" title="今天不再提示" @click="dismiss(item.id)">
        <span class="i-carbon-close" />
      </button>
    </article>
  </div>
</template>

<style scoped>
.ann-wrap {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 16px 0;
}
.ann {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 9px 12px;
  border: 1px solid var(--ui-border);
  border-radius: 10px;
  background: var(--ui-surface);
  font-size: 12px;
  color: var(--ui-muted);
}
.ann.pinned {
  border-color: var(--ui-primary);
  background: var(--ui-primary-soft);
  color: var(--ui-primary);
}
.icon {
  flex: 0 0 auto;
  margin-top: 1px;
  font-size: 14px;
}
.body {
  flex: 1;
  min-width: 0;
  line-height: 1.6;
}
.title {
  margin-right: 8px;
  font-weight: 600;
}
.content {
  white-space: pre-wrap;
  word-break: break-word;
}
.close {
  flex: 0 0 auto;
  padding: 0 2px;
  border: 0;
  background: transparent;
  color: inherit;
  opacity: 0.6;
  cursor: pointer;
}
.close:hover {
  opacity: 1;
}
</style>
