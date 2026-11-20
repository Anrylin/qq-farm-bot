export {};

/**
 * 多用户存储（在上游单管理员架构上新增）
 *
 * 兼容两种密码算法：
 *   - scrypt(password, salt, 64)            —— 旧 2.8.0 版本，迁移用户沿用
 *   - pbkdf2-sha512(password, salt, 1e5, 64) —— 上游 auth-security 默认
 * 盘上格式都是 "salt:hash"，无法从字符串区分，因此迁移记录带 passwordAlgo 标记；
 * 校验成功后自动重哈希成 pbkdf2 并清除标记（静默升级）。
 */
const fs = require('node:fs');
const crypto = require('node:crypto');
const { getDataFile, ensureDataDir } = require('../config/runtime-paths');
const security = require('./auth-security');

const USERS_FILE: string = getDataFile('users.json');
const DEFAULT_ACCOUNT_LIMIT = 1;

interface UserRecord {
    username: string;
    role: 'admin' | 'user';
    accountLimit: number;
    password: string;
    passwordAlgo?: 'scrypt';
    createdAt: number;
    expiresAt: number;
    locked: boolean;
    isAgent: boolean;
    registrationQuota: number;
    quotaCardQuota: number;
    lastLoginAt?: number;
}

interface LoginResult {
    ok?: boolean;
    username?: string;
    role?: 'admin' | 'user';
    user?: any;
    error?: string;
    message?: string;
    remainingMs?: number;
}

// 登录失败限流（进程内，够用；上游 admin 的持久化限流保持不动）
const attempts = new Map<string, { count: number, lockedUntil: number }>();
const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;

let users: UserRecord[] | null = null;

function normalizeUser(raw: any): UserRecord | null {
    const username = String(raw?.username || '').trim();
    if (!username) return null;
    const algo = raw?.passwordAlgo === 'scrypt' ? 'scrypt' : undefined;
    return {
        username,
        role: raw?.role === 'admin' ? 'admin' : 'user',
        accountLimit: Number(raw?.accountLimit) || DEFAULT_ACCOUNT_LIMIT,
        password: String(raw?.password ?? raw?.passwordHash ?? ''),
        passwordAlgo: algo,
        createdAt: Number(raw?.createdAt) || Date.now(),
        expiresAt: Number(raw?.expiresAt) || 0,
        locked: raw?.locked === true,
        isAgent: raw?.isAgent === true,
        registrationQuota: Number(raw?.registrationQuota) || 0,
        quotaCardQuota: Number(raw?.quotaCardQuota) || 0,
        lastLoginAt: Number(raw?.lastLoginAt) || 0,
    };
}

function loadUsers(): UserRecord[] {
    if (users) return users;
    ensureDataDir();
    try {
        if (fs.existsSync(USERS_FILE)) {
            const raw = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
            const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.users) ? raw.users : []);
            users = list.map(normalizeUser).filter((item: UserRecord | null): item is UserRecord => item !== null);
        } else {
            users = [];
        }
    } catch {
        users = [];
    }
    return users;
}

function saveUsers(): void {
    ensureDataDir();
    fs.writeFileSync(USERS_FILE, JSON.stringify(users || [], null, 2), 'utf8');
}

function findUser(username: string): UserRecord | null {
    const name = String(username || '').trim();
    if (!name) return null;
    return loadUsers().find(user => user.username === name) || null;
}

/** scrypt 旧格式校验 */
function verifyScrypt(password: string, stored: string): boolean {
    const [salt, hash] = String(stored || '').split(':');
    if (!salt || !hash || !/^[0-9a-f]{128}$/i.test(hash)) return false;
    const actual = crypto.scryptSync(String(password), salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(hash, 'hex'));
}

function verifyUserPassword(user: UserRecord, password: string): boolean {
    if (user.passwordAlgo === 'scrypt') return verifyScrypt(password, user.password);
    if (security.verifyPassword(password, user.password)) return true;
    // 兜底：老数据没有 algo 标记但实际是 scrypt
    if (verifyScrypt(password, user.password)) {
        user.passwordAlgo = 'scrypt';
        return true;
    }
    return false;
}

function isExpired(user: UserRecord): boolean {
    return user.expiresAt > 0 && user.expiresAt <= Date.now();
}

function publicUser(user: UserRecord): any {
    return {
        username: user.username,
        role: user.role,
        accountLimit: user.accountLimit,
        createdAt: user.createdAt,
        expiresAt: user.expiresAt,
        locked: user.locked,
        expired: isExpired(user),
        isAgent: user.isAgent,
        registrationQuota: user.registrationQuota,
        quotaCardQuota: user.quotaCardQuota,
        lastLoginAt: user.lastLoginAt || 0,
    };
}

function listUsers(): any[] {
    return loadUsers().map(publicUser).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function attemptKey(username: string, ip: string): string {
    return `${String(username).toLowerCase()}|${ip || 'unknown'}`;
}

function validateUser(username: string, password: string, ip: string = 'unknown'): LoginResult {
    const key = attemptKey(username, ip);
    const state = attempts.get(key);
    if (state && state.lockedUntil > Date.now()) {
        return { error: 'locked', message: '尝试次数过多，请稍后再试', remainingMs: state.lockedUntil - Date.now() };
    }

    const user = findUser(username);
    if (!user || !verifyUserPassword(user, password)) {
        const next = { count: (state?.count || 0) + 1, lockedUntil: 0 };
        if (next.count >= MAX_ATTEMPTS) next.lockedUntil = Date.now() + LOCK_MS;
        attempts.set(key, next);
        return {
            error: 'invalid_credentials',
            message: next.lockedUntil
                ? '尝试次数过多，请 15 分钟后再试'
                : `用户名或密码错误，剩余尝试次数: ${MAX_ATTEMPTS - next.count}`,
        };
    }

    if (user.locked) return { error: 'locked_account', message: '账号已被锁定，请联系管理员' };
    if (isExpired(user)) return { error: 'expired', message: '账号已到期，请续费后使用' };

    attempts.delete(key);
    // 静默升级：scrypt → pbkdf2
    if (user.passwordAlgo === 'scrypt') {
        user.password = security.hashPassword(password);
        delete user.passwordAlgo;
    }
    user.lastLoginAt = Date.now();
    saveUsers();

    return { ok: true, username: user.username, role: user.role, user: publicUser(user) };
}

function validatePassword(password: string): { valid: boolean, errors: string[] } {
    return security.validatePasswordStrength(String(password || ''));
}

function createUser(input: any): { ok: boolean, error?: string, user?: any } {
    const username = String(input?.username || '').trim();
    const password = String(input?.password || '');
    if (!/^[\w.@-]{3,32}$/.test(username)) return { ok: false, error: '用户名需 3-32 位，仅支持字母、数字、下划线、点、@ 和 -' };
    if (findUser(username)) return { ok: false, error: '用户名已存在' };
    const strength = validatePassword(password);
    if (!strength.valid) return { ok: false, error: strength.errors.join('；') };

    const expiresAt = Number(input?.expiresAt) || 0;
    const user: UserRecord = {
        username,
        role: input?.role === 'admin' ? 'admin' : 'user',
        accountLimit: Number(input?.accountLimit) || DEFAULT_ACCOUNT_LIMIT,
        password: security.hashPassword(password),
        createdAt: Date.now(),
        expiresAt,
        locked: false,
        isAgent: input?.isAgent === true,
        registrationQuota: Number(input?.registrationQuota) || 0,
        quotaCardQuota: Number(input?.quotaCardQuota) || 0,
    };
    loadUsers().push(user);
    saveUsers();
    return { ok: true, user: publicUser(user) };
}

function setPassword(username: string, password: string): { ok: boolean, error?: string } {
    const user = findUser(username);
    if (!user) return { ok: false, error: '用户不存在' };
    const strength = validatePassword(password);
    if (!strength.valid) return { ok: false, error: strength.errors.join('；') };
    user.password = security.hashPassword(password);
    delete user.passwordAlgo;
    saveUsers();
    return { ok: true };
}

/** 续期：days<=0 表示永久。到期时间已过则从当下开始算 */
function extendUser(username: string, days: number): { ok: boolean, error?: string, expiresAt?: number } {
    const user = findUser(username);
    if (!user) return { ok: false, error: '用户不存在' };
    const amount = Number(days) || 0;
    if (amount <= 0) {
        user.expiresAt = 0;
    } else {
        const base = user.expiresAt > Date.now() ? user.expiresAt : Date.now();
        user.expiresAt = base + amount * 24 * 60 * 60 * 1000;
    }
    user.locked = false;
    saveUsers();
    return { ok: true, expiresAt: user.expiresAt };
}

function setLocked(username: string, locked: boolean): { ok: boolean, error?: string } {
    const user = findUser(username);
    if (!user) return { ok: false, error: '用户不存在' };
    user.locked = locked === true;
    saveUsers();
    return { ok: true };
}

function updateUser(username: string, patch: any): { ok: boolean, error?: string, user?: any } {
    const user = findUser(username);
    if (!user) return { ok: false, error: '用户不存在' };
    if (patch && patch.accountLimit !== undefined) {
        const raw = Number(patch.accountLimit);
        user.accountLimit = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : user.accountLimit;
    }
    if (patch && patch.isAgent !== undefined) user.isAgent = patch.isAgent === true;
    if (patch && patch.registrationQuota !== undefined) user.registrationQuota = Math.max(0, Math.floor(Number(patch.registrationQuota) || 0));
    if (patch && patch.quotaCardQuota !== undefined) user.quotaCardQuota = Math.max(0, Math.floor(Number(patch.quotaCardQuota) || 0));
    if (patch && patch.role !== undefined) user.role = patch.role === 'admin' ? 'admin' : 'user';
    saveUsers();
    return { ok: true, user: publicUser(user) };
}

function deleteUser(username: string): { ok: boolean, error?: string } {
    const list = loadUsers();
    const index = list.findIndex(user => user.username === username);
    if (index < 0) return { ok: false, error: '用户不存在' };
    if (list[index].role === 'admin') return { ok: false, error: '不能删除管理员账号' };
    list.splice(index, 1);
    saveUsers();
    return { ok: true };
}

function adjustQuota(username: string, key: 'registrationQuota' | 'quotaCardQuota', delta: number): void {
    const user = findUser(username);
    if (!user) return;
    user[key] = Math.max(0, (Number(user[key]) || 0) + Number(delta || 0));
    saveUsers();
}

function countUsers(): { total: number, expired: number, agents: number, locked: number } {
    const list = loadUsers();
    return {
        total: list.length,
        expired: list.filter(isExpired).length,
        agents: list.filter(user => user.isAgent).length,
        locked: list.filter(user => user.locked).length,
    };
}

module.exports = {
    USERS_FILE,
    validatePassword,
    loadUsers,
    findUser,
    listUsers,
    publicUser,
    validateUser,
    createUser,
    setPassword,
    extendUser,
    setLocked,
    updateUser,
    deleteUser,
    adjustQuota,
    countUsers,
    isExpired,
    verifyScrypt,
};
