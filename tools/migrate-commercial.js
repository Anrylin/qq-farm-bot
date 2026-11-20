#!/usr/bin/env node
/**
 * 商业数据迁移：qq-farm-bot 2.8.0（多租户 SaaS） → 上游 TS 版数据目录
 *
 * 迁移内容：
 *   users.json               77 个用户（含 1 admin + 30 个代理 + 59 个锁定）
 *   registration-cards.json  612 张注册卡
 *   quota-cards.json         32 张配额卡
 *   announcements.json       公告
 *   registration-settings    注册开关（requiresCardKey）
 *   accounts.json            账号 + 归属（account.username → users.username）
 *
 * 设计要点：
 * 1. 旧密码是 scrypt(password, salt, 64)，上游是 pbkdf2-sha512；两者盘上格式都是
 *    "salt:hash" 但算法不同 —— 所以给每条用户记录加 passwordAlgo: 'scrypt' 标记，
 *    新代码按标记校验，校验通过后再重哈希成 pbkdf2（登录时静默升级）。
 * 2. 账密、卡密原文一律原样搬运，不做任何清洗，避免用户无法登录/卡密失效。
 * 3. 默认写到暂存目录，不直接覆盖运行中实例的 data。
 *
 * 用法：
 *   node migrate-commercial.js --src /opt/data --dst /opt/upstream/migrated
 *   node migrate-commercial.js --src /opt/data --dst /opt/upstream/migrated --check
 */
const fs = require('node:fs')
const path = require('node:path')

const args = process.argv.slice(2)
function arg(name, fallback = '') {
    const index = args.indexOf(`--${name}`)
    return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}

const SRC = arg('src', '/opt/data')
const DST = arg('dst', '/opt/upstream/migrated')
const CHECK_ONLY = args.includes('--check')

const report = {
    users: { total: 0, admin: 0, agents: 0, locked: 0, expired: 0, unlimited: 0, orphanAccounts: 0 },
    cards: { total: 0, used: 0, available: 0, byType: {} },
    quotaCards: { total: 0, used: 0, available: 0 },
    announcements: { total: 0, active: 0 },
    accounts: { total: 0, withOwner: 0, orphan: 0, platforms: {} },
    warnings: [],
}

function readJson(file, fallback) {
    const full = path.join(SRC, file)
    if (!fs.existsSync(full)) {
        report.warnings.push(`缺少文件: ${file}（按空处理）`)
        return fallback
    }
    try {
        return JSON.parse(fs.readFileSync(full, 'utf8'))
    } catch (error) {
        report.warnings.push(`解析失败: ${file} - ${error.message}`)
        return fallback
    }
}

// ---------- 用户 ----------
const rawUsers = readJson('users.json', [])
const users = rawUsers.map((user) => {
    const record = {
        username: String(user.username || '').trim(),
        role: user.role === 'admin' ? 'admin' : 'user',
        accountLimit: Number(user.accountLimit) || 0,
        password: String(user.passwordHash || ''), // 保留 scrypt 原串
        passwordAlgo: 'scrypt',
        createdAt: Number(user.createdAt) || Date.now(),
        expiresAt: Number(user.expiresAt) || 0, // 0 = 永久
        locked: user.locked === true,
        isAgent: user.isAgent === true || Number(user.registrationQuota) > 0 || Number(user.quotaCardQuota) > 0,
        registrationQuota: Number(user.registrationQuota) || 0,
        quotaCardQuota: Number(user.quotaCardQuota) || 0,
    }
    if (!record.username) report.warnings.push('存在空用户名记录，已跳过')
    return record
}).filter(user => user.username)

report.users.total = users.length
report.users.admin = users.filter(user => user.role === 'admin').length
report.users.agents = users.filter(user => user.isAgent).length
report.users.locked = users.filter(user => user.locked).length
report.users.expired = users.filter(user => user.expiresAt > 0 && user.expiresAt < Date.now()).length
report.users.unlimited = users.filter(user => user.accountLimit > 1e12).length

// ---------- 注册卡 ----------
const rawCards = readJson('registration-cards.json', [])
const cards = rawCards.map((card) => {
    const type = card.type === 'permanent' ? 'permanent' : 'duration'
    return {
        code: String(card.code || '').trim().toUpperCase(),
        type,
        durationDays: Number(card.durationDays) || 0,
        createdAt: Number(card.createdAt) || 0,
        usedAt: Number(card.usedAt) || 0,
        usedBy: String(card.usedBy || '').trim(),
    }
}).filter(card => card.code)

report.cards.total = cards.length
report.cards.used = cards.filter(card => card.usedAt > 0).length
report.cards.available = cards.filter(card => !card.usedAt).length
for (const card of cards) {
    const key = `${card.type}${card.type === 'duration' ? `-${card.durationDays}d` : ''}`
    report.cards.byType[key] = (report.cards.byType[key] || 0) + 1
}

// ---------- 配额卡 ----------
const rawQuotaCards = readJson('quota-cards.json', [])
const quotaCards = rawQuotaCards.map((card) => ({
    code: String(card.code || '').trim().toUpperCase(),
    quota: Number(card.quota) || 0,
    createdAt: Number(card.createdAt) || 0,
    usedAt: Number(card.usedAt) || 0,
    usedBy: String(card.usedBy || '').trim(),
})).filter(card => card.code)

report.quotaCards.total = quotaCards.length
report.quotaCards.used = quotaCards.filter(card => card.usedAt > 0).length
report.quotaCards.available = quotaCards.filter(card => !card.usedAt).length

// ---------- 公告 ----------
const rawAnnouncements = readJson('announcements.json', [])
const announcements = rawAnnouncements.map(item => ({
    id: String(item.id || ''),
    title: String(item.title || ''),
    content: String(item.content || ''),
    pinned: item.pinned === true,
    active: item.active !== false,
    createdAt: Number(item.createdAt) || Date.now(),
    updatedAt: Number(item.updatedAt) || Number(item.createdAt) || Date.now(),
})).filter(item => item.title || item.content)

report.announcements.total = announcements.length
report.announcements.active = announcements.filter(item => item.active).length

// ---------- 注册设置 ----------
const settings = readJson('registration-settings.json', {})
const registrationSettings = { requiresCardKey: settings.requiresCardKey !== false }

// ---------- 账号 ----------
const rawAccountFile = readJson('accounts.json', { accounts: [] })
const rawAccounts = Array.isArray(rawAccountFile) ? rawAccountFile : (rawAccountFile.accounts || [])
const usernames = new Set(users.map(user => user.username))
const accounts = rawAccounts.map((account) => {
    const owner = String(account.username || '').trim()
    const record = {
        ...account,
        // 归属字段改名，避免和"账号自身的登录用户名"混淆
        ownerUsername: owner,
        username: account.username,
    }
    return record
})

report.accounts.total = accounts.length
report.accounts.withOwner = accounts.filter(account => usernames.has(account.ownerUsername)).length
report.accounts.orphan = accounts.filter(account => !usernames.has(account.ownerUsername)).length
for (const account of accounts) {
    const key = account.platform || 'unknown'
    report.accounts.platforms[key] = (report.accounts.platforms[key] || 0) + 1
}

// 配额校验：每个用户实际账号数 vs accountLimit
const perUser = new Map()
for (const account of accounts) {
    if (!account.ownerUsername) continue
    perUser.set(account.ownerUsername, (perUser.get(account.ownerUsername) || 0) + 1)
}
const overLimit = []
for (const user of users) {
    if (user.accountLimit > 1e12) continue
    const used = perUser.get(user.username) || 0
    if (used > user.accountLimit) overLimit.push(`${user.username}: ${used}/${user.accountLimit}`)
}
if (overLimit.length) report.warnings.push(`账号数超配额的用户: ${overLimit.join(', ')}`)

// ---------- 输出 ----------
const payload = {
    users,
    cards,
    quotaCards,
    announcements,
    registrationSettings,
    accounts,
}

console.log('===== 迁移报告 =====')
console.log(JSON.stringify(report, null, 2))

if (CHECK_ONLY) {
    console.log('\n(--check 模式，未写入文件)')
    process.exit(0)
}

fs.mkdirSync(DST, { recursive: true })
const outputs = {
    'users.json': users,
    'registration-cards.json': cards,
    'quota-cards.json': quotaCards,
    'announcements.json': announcements,
    'registration-settings.json': registrationSettings,
    'accounts.json': { accounts },
    'migration-meta.json': {
        migratedAt: new Date().toISOString(),
        from: SRC,
        sourceVersion: '2.8.0',
        passwordAlgo: 'scrypt',
        report,
    },
}
for (const [file, data] of Object.entries(outputs)) {
    fs.writeFileSync(path.join(DST, file), JSON.stringify(data, null, 2), 'utf8')
}
console.log(`\n已写入 ${DST}:`, Object.keys(outputs).join(', '))
