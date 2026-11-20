import type { Application, Request, Response } from 'express';
import type { AdminContext } from './context';
export {};

const { version } = require('../../../package.json');
const { getRuntimeConfig } = require('../../config/config');
const { getSchedulerRegistrySnapshot } = require('../../services/scheduler');
const { createModuleLogger } = require('../../services/logger');
const adminStore = require('../../models/admin-store');
const userStore = require('../../models/user-store');
const cardStore = require('../../models/card-store');
const announcementStore = require('../../models/announcement-store');

const {
    getClientIp,
    issueToken,
    createAuthRequired,
    getAccId,
    handleApiError,
} = require('./middleware');

const adminLogger = createModuleLogger('admin');

function mountAuthRoutes(app: Application, ctx: AdminContext): void {
    const authRequired = createAuthRequired(ctx);

    app.post('/api/login', (req: Request, res: Response) => {
        const { username, password } = req.body || {};
        if (!username || !password) {
            return res.status(401).json({ ok: false, error: '请输入用户名和密码' });
        }

        const clientIp = getClientIp(req);
        const name = String(username).trim();
        const adminName = String(adminStore.getAdminInfo().username || 'admin');

        // 1) 超级管理员：只在用户名匹配时才走 admin 校验，
        //    否则普通用户的失败登录会污染管理员的失败计数
        if (name === adminName) {
            const result = adminStore.validateAdmin(name, String(password), clientIp);
            if (result?.error) {
                const statusCode = result.error === 'rate_limit' ? 429 : result.error === 'locked' ? 423 : 401;
                adminLogger.warn('登录失败', { username: name, error: result.error, ip: clientIp });
                return res.status(statusCode).json({
                    ok: false,
                    error: result.message,
                    errorType: result.error,
                    remainingMs: result.remainingMs,
                });
            }
            const token = issueToken();
            ctx.tokens.add(token);
            ctx.sessions.set(token, { username: result.username, role: 'admin', issuedAt: Date.now() });
            adminLogger.info('超级管理员登录成功', { username: result.username, ip: clientIp });
            return res.json({
                ok: true,
                data: {
                    token,
                    role: 'admin',
                    user: { username: result.username },
                    mustChangePassword: result.mustChangePassword === true,
                },
            });
        }

        // 2) 普通用户
        const userResult = userStore.validateUser(name, String(password), clientIp);
        if (userResult.ok) {
            const token = issueToken();
            ctx.tokens.add(token);
            ctx.sessions.set(token, {
                username: userResult.username,
                role: userResult.role || 'user',
                issuedAt: Date.now(),
            });
            adminLogger.info('用户登录成功', { username: userResult.username, ip: clientIp });
            return res.json({
                ok: true,
                data: {
                    token,
                    role: userResult.role || 'user',
                    user: userResult.user,
                    mustChangePassword: false,
                },
            });
        }
        adminLogger.warn('登录失败', { username: name, error: userResult.error, ip: clientIp });
        return res.status(401).json({ ok: false, error: userResult.message, errorType: userResult.error });
    });

    // ===== 注册（卡密核销）=====
    app.post('/api/register', (req: Request, res: Response) => {
        const { username, password, cardKey } = req.body || {};
        const name = String(username || '').trim();
        const settings = cardStore.loadSettings();

        if (userStore.findUser(name)) {
            return res.status(400).json({ ok: false, error: '用户名已存在' });
        }
        const strength = userStore.validatePassword(String(password || ''));
        if (!strength.valid) {
            return res.status(400).json({ ok: false, error: strength.errors.join('；') });
        }

        let expiresAt = 0;
        if (settings.requiresCardKey) {
            const consumed = cardStore.consumeCard(String(cardKey || ''), name);
            if (!consumed.ok) return res.status(400).json({ ok: false, error: consumed.error });
            if (consumed.type === 'duration') {
                expiresAt = Date.now() + (consumed.durationDays || 0) * 24 * 60 * 60 * 1000;
            }
        }

        const created = userStore.createUser({ username: name, password: String(password), expiresAt });
        if (!created.ok) return res.status(400).json({ ok: false, error: created.error });

        const token = issueToken();
        ctx.tokens.add(token);
        ctx.sessions.set(token, { username: name, role: 'user', issuedAt: Date.now() });
        adminLogger.info('用户注册成功', { username: name, ip: getClientIp(req) });
        return res.json({ ok: true, data: { token, role: 'user', user: created.user } });
    });

    // ===== 续费（自助核销注册卡）=====
    app.post('/api/renew', authRequired, (req: Request & { currentUser?: any }, res: Response) => {
        const current = (req as any).currentUser;
        if (!current || current.role !== 'user') {
            return res.status(400).json({ ok: false, error: '请使用普通用户账号续费' });
        }
        const consumed = cardStore.consumeCard(String((req.body || {}).cardKey || ''), current.username);
        if (!consumed.ok) return res.status(400).json({ ok: false, error: consumed.error });
        const days = consumed.type === 'permanent' ? 0 : (consumed.durationDays || 0);
        const result = userStore.extendUser(current.username, days);
        if (!result.ok) return res.status(400).json({ ok: false, error: result.error });
        return res.json({ ok: true, data: { expiresAt: result.expiresAt, type: consumed.type, durationDays: consumed.durationDays } });
    });

    app.post('/api/user/change-password', authRequired, (req: Request, res: Response) => {
        const { oldPassword, newPassword } = req.body || {};
        if (!oldPassword || !newPassword) {
            return res.status(400).json({ ok: false, error: '请提供原密码和新密码' });
        }
        const result = adminStore.changePassword(String(oldPassword), String(newPassword));
        if (result.ok) ctx.tokens.clear();
        return res.json(result);
    });

    // ===== 公开续费（未登录，凭卡密续费已有账号）=====
    app.post('/api/public/renew', (req: Request, res: Response) => {
        const { username, cardKey } = req.body || {};
        const name = String(username || '').trim();
        const user = userStore.findUser(name);
        if (!user) return res.status(400).json({ ok: false, error: '用户不存在' });
        const consumed = cardStore.consumeCard(String(cardKey || ''), name);
        if (!consumed.ok) return res.status(400).json({ ok: false, error: consumed.error });
        const days = consumed.type === 'permanent' ? 0 : (consumed.durationDays || 0);
        const result = userStore.extendUser(name, days);
        if (!result.ok) return res.status(400).json({ ok: false, error: result.error });
        adminLogger.info('账号续费成功', { username: name, ip: getClientIp(req), days });
        return res.json({ ok: true, data: { username: name, expiresAt: result.expiresAt, type: consumed.type, durationDays: consumed.durationDays } });
    });

    // 公开公告（未登录也能看）
    app.get('/api/announcements', (_req: Request, res: Response) => {
        res.json({ ok: true, data: announcementStore.listActive() });
    });

    app.use('/api', (req: Request, res: Response, next: any) => {
        if (req.path === '/login' || req.path === '/game-version' || req.path === '/register' || req.path === '/public/renew') return next();
        return authRequired(req, res, next);
    });

    app.get('/api/ping', (_req: Request, res: Response) => {
        res.json({ ok: true, data: { ok: true, uptime: process.uptime(), version } });
    });

    app.get('/api/game-version', (_req: Request, res: Response) => {
        const { clientVersion, wxClientVersion } = getRuntimeConfig();
        res.json({ ok: true, clientVersion, wxClientVersion, botVersion: version });
    });

    app.get('/api/auth/validate', (_req: Request, res: Response) => {
        res.json({ ok: true, data: { valid: true } });
    });

    app.get('/api/scheduler', async (req: Request, res: Response) => {
        try {
            const id = getAccId(ctx, req);
            if (ctx.provider && typeof ctx.provider.getSchedulerStatus === 'function') {
                const data = await ctx.provider.getSchedulerStatus(id);
                return res.json({ ok: true, data });
            }
            return res.json({
                ok: true,
                data: {
                    runtime: getSchedulerRegistrySnapshot(),
                    worker: null,
                    workerError: 'DataProvider does not support scheduler status',
                },
            });
        } catch (e: any) {
            return handleApiError(res, e);
        }
    });

    app.post('/api/logout', (req: Request, res: Response) => {
        const token = (req as any).adminToken;
        if (token) ctx.tokens.delete(token);
        if (ctx.io && token) {
            for (const socket of ctx.io.sockets.sockets.values()) {
                if (String((socket.data as any).adminToken || '') === String(token)) socket.disconnect(true);
            }
        }
        res.json({ ok: true });
    });

    app.get('/api/user/me', (req: Request & { currentUser?: any }, res: Response) => {
        const current = (req as any).currentUser || { username: 'admin', role: 'admin' };
        if (current.role === 'admin') {
            const info = adminStore.getAdminInfo();
            return res.json({ ok: true, data: { ...info, role: 'admin', expired: false } });
        }
        const user = userStore.findUser(current.username);
        if (!user) return res.status(401).json({ ok: false, error: '用户不存在' });
        return res.json({ ok: true, data: { ...userStore.publicUser(user), role: user.role } });
    });
}

module.exports = { mountAuthRoutes };
