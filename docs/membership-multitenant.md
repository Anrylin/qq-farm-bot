# 多租户与商业化模块

本仓库在上游单管理员架构之上，增加了多用户、卡密、公告、代理分销与账号隔离。
改造保持「增量」原则：不替换上游接口，新增能力以独立模块 + 少量 patch 实现。

## 数据文件（`core/data/`）

| 文件 | 说明 |
| --- | --- |
| `users.json` | 用户表：`username / role / accountLimit / password / passwordAlgo / createdAt / expiresAt / locked / isAgent / registrationQuota / quotaCardQuota` |
| `registration-cards.json` | 注册卡：`code / type(permanent|duration) / durationDays / createdAt / usedAt / usedBy / createdBy` |
| `quota-cards.json` | 配额卡：`code / quota / createdAt / usedAt / usedBy / createdBy` |
| `announcements.json` | 公告：`id / title / content / pinned / active / createdAt / updatedAt` |
| `registration-settings.json` | `{ requiresCardKey: boolean }` |
| `accounts.json` | 账号表，新增 `ownerUsername` 表示归属用户 |

## 密码算法兼容

上游用 `pbkdf2-sha512(password, salt, 100000, 64)`，历史版本用 `scrypt(password, salt, 64)`，
两者落盘格式都是 `salt:hash`，无法从字符串区分。因此：

- 迁移记录带 `passwordAlgo: "scrypt"`；
- 校验时按标记走 scrypt，成功后立即重哈希为 pbkdf2 并清除标记（登录时静默升级）；
- `admin.json` 支持 `scrypt$salt:hash` 前缀，用于从旧 `users.json` 继承管理员密码。

**直接搬运旧数据而不做这层兼容，会导致全部用户登录失败且没有任何报错。**

## 接口

### 公开

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/login` | 管理员/普通用户双通道登录 |
| POST | `/api/register` | 卡密注册 |
| POST | `/api/public/renew` | 未登录凭卡密续费 |
| GET | `/api/announcements` | 启用中的公告 |

### 登录用户

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/user/me` | 当前用户（角色/到期/配额） |
| POST | `/api/renew` | 自助续费 |
| POST | `/api/user/quota-card` | 核销配额卡 |
| GET/POST | `/api/qq-login/queue/*` | QQ 扫码排队 |

### 管理员

`/api/admin/users`、`/api/admin/cards`、`/api/admin/quota-cards`、
`/api/admin/announcements`、`/api/admin/registration-settings`、
`/api/admin/users/:username/{renew,lock,password,quota,agent-quota}`

### 代理

`/api/agent/overview`、`/api/agent/cards`、`/api/agent/quota-cards`（额度扣减，自有卡密隔离）

## 账号隔离

- 列表：`/api/accounts` 按 `ownerUsername` 过滤，管理员看全部
- 单账号访问：`getAccId` 解析后校验归属，越权返回空值
- 新增：校验 `accountLimit` 并写入 `ownerUsername`
- 删除：校验归属

## QQ 扫码排队

NapCat 同一时刻只允许一个登录工作流（`qq-miniapp-auth` 会返回 `WORKFLOW_BUSY`），
因此 `core/src/services/qq-login/queue.ts` 提供 FIFO 队列：

- 空位立即发二维码，占用中返回位次
- 取消 / 2 分钟超时 / 取码完成 → 自动叫号
- 同一用户重复请求复用原排队项

依赖外部服务 `qq-miniapp-auth`（面板 → :8787 → bridge → NapCat）。

## 数据迁移

`tools/migrate-commercial.js` 从旧版数据目录迁移用户/卡密/公告/账号归属：

```bash
node tools/migrate-commercial.js --src /path/to/old/data --dst /path/to/new/data --check
node tools/migrate-commercial.js --src /path/to/old/data --dst /path/to/new/data
```

输出迁移报告（用户/卡密/配额卡/公告/账号归属/超配额告警），默认不覆盖运行中实例的数据。
