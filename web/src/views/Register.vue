<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import api from '@/api'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import { useUserStore } from '@/stores/user'

const router = useRouter()
const userStore = useUserStore()

const username = ref('')
const password = ref('')
const confirm = ref('')
const cardKey = ref('')
const loading = ref(false)
const error = ref('')

function validate(): string {
  if (!/^[\w.@-]{3,32}$/.test(username.value.trim()))
    return '用户名需 3-32 位，仅支持字母、数字、下划线、点、@ 和 -'
  if (password.value.length < 8)
    return '密码至少 8 位'
  if (password.value !== confirm.value)
    return '两次输入的密码不一致'
  if (!cardKey.value.trim())
    return '请填写卡密'
  return ''
}

async function submit() {
  error.value = validate()
  if (error.value)
    return
  loading.value = true
  try {
    const { data } = await api.post('/api/register', {
      username: username.value.trim(),
      password: password.value,
      cardKey: cardKey.value.trim(),
    })
    if (!data?.ok)
      throw new Error(data?.error || '注册失败')
    userStore.token = data.data.token
    userStore.userInfo = { ...data.data.user, role: 'user' }
    await router.push('/')
  }
  catch (err: any) {
    error.value = err?.response?.data?.error || err?.message || '注册失败'
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
        <span class="i-carbon-user-follow h-6 w-6 text-[var(--ui-primary)]" />
        <div>
          <h1 class="title">
            注册账号
          </h1>
          <p class="sub">
            需要一张有效注册卡密
          </p>
        </div>
      </header>

      <form class="form" @submit.prevent="submit">
        <label class="field">
          <span class="label">用户名</span>
          <BaseInput v-model="username" placeholder="3-32 位" autocomplete="username" />
        </label>
        <label class="field">
          <span class="label">密码</span>
          <BaseInput v-model="password" type="password" placeholder="至少 8 位" autocomplete="new-password" />
        </label>
        <label class="field">
          <span class="label">确认密码</span>
          <BaseInput v-model="confirm" type="password" placeholder="再输入一次" autocomplete="new-password" />
        </label>
        <label class="field">
          <span class="label">注册卡密</span>
          <BaseInput v-model="cardKey" placeholder="QF-XXXX-XXXX-XXXX" />
        </label>

        <p v-if="error" class="msg error">
          <span class="i-carbon-warning-alt" />{{ error }}
        </p>

        <BaseButton type="submit" variant="primary" block :loading="loading">
          <span class="inline-flex items-center gap-2">
            <span class="i-carbon-checkmark" />注册并登录
          </span>
        </BaseButton>
      </form>

      <footer class="foot">
        <router-link to="/login" class="link">
          已有账号，去登录
        </router-link>
        <router-link to="/renew" class="link">
          账号续费
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
