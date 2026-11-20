<script setup lang="ts">
import { ref } from 'vue'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'

const username = ref('')
const cardKey = ref('')
const loading = ref(false)
const error = ref('')
const done = ref('')

async function submit() {
  error.value = ''
  done.value = ''
  if (!username.value.trim() || !cardKey.value.trim()) {
    error.value = '请填写用户名和卡密'
    return
  }
  loading.value = true
  try {
    const { data } = await api.post('/api/public/renew', {
      username: username.value.trim(),
      cardKey: cardKey.value.trim(),
    })
    if (!data?.ok)
      throw new Error(data?.error || '续费失败')
    const expiresAt = Number(data.data.expiresAt) || 0
    done.value = expiresAt > 0
      ? `续费成功，到期时间：${new Date(expiresAt).toLocaleString()}`
      : '续费成功，已升级为永久'
    cardKey.value = ''
  }
  catch (err: any) {
    error.value = err?.response?.data?.error || err?.message || '续费失败'
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <main class="page">
    <section class="card">
      <header class="head">
        <span class="i-carbon-renew h-6 w-6 text-[var(--ui-primary)]" />
        <div>
          <h1 class="title">
            账号续费
          </h1>
          <p class="sub">
            无需登录，凭卡密即可续期
          </p>
        </div>
      </header>

      <form class="form" @submit.prevent="submit">
        <label class="field">
          <span class="label">用户名</span>
          <BaseInput v-model="username" placeholder="要续费的账号" autocomplete="username" />
        </label>
        <label class="field">
          <span class="label">续费卡密</span>
          <BaseInput v-model="cardKey" placeholder="QF-XXXX-XXXX-XXXX" />
        </label>

        <p v-if="error" class="msg error">
          <span class="i-carbon-warning-alt" />{{ error }}
        </p>
        <p v-if="done" class="msg ok">
          <span class="i-carbon-checkmark-filled" />{{ done }}
        </p>

        <BaseButton type="submit" variant="primary" block :loading="loading">
          <span class="inline-flex items-center gap-2">
            <span class="i-carbon-renew" />立即续费
          </span>
        </BaseButton>
      </form>

      <footer class="foot">
        <router-link to="/login" class="link">
          返回登录
        </router-link>
        <router-link to="/register" class="link">
          注册新账号
        </router-link>
      </footer>
    </section>
  </main>
</template>

<style scoped>
.page {
  display: grid;
  min-height: 100vh;
  place-items: center;
  padding: 24px 16px;
  background: var(--ui-bg);
}
.card {
  width: 100%;
  max-width: 380px;
  padding: 26px 24px;
  border: 1px solid var(--ui-border);
  border-radius: 16px;
  background: var(--ui-surface);
  box-shadow: 0 12px 32px rgb(0 0 0 / 6%);
}
.head {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 20px;
}
.title {
  margin: 0;
  font-size: 19px;
  font-weight: 600;
  color: var(--ui-text);
}
.sub {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--ui-subtle);
}
.form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.label {
  font-size: 12px;
  color: var(--ui-muted);
}
.msg {
  display: flex;
  gap: 6px;
  align-items: center;
  margin: 0;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 12px;
}
.msg.error {
  color: var(--ui-danger);
  background: var(--ui-danger-soft);
}
.msg.ok {
  color: var(--ui-primary);
  background: var(--ui-primary-soft);
}
.foot {
  display: flex;
  justify-content: space-between;
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--ui-border);
  font-size: 12px;
}
.link {
  color: var(--ui-primary);
  text-decoration: none;
}
.link:hover {
  text-decoration: underline;
}
</style>
