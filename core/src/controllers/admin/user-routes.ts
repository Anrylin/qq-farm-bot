import type { Application, Request, Response } from 'express';
import type { AdminContext } from './context';
export {};

/**
 * 用户 / 卡密 / 公告管理接口（仅超级管理员）
 * 迁移自 2.8.0 的 admin-user-routes / admin-registration-card-routes /
 * admin-quota-card-routes / admin-announcement-routes，按上游 TS 结构重写。
 */
const userStore = require('../../models/user-store');
const cardStore = require('../../models/card-store');
const announcementStore = require('../../models/announcement-store');
const { createAdminOnly } = require('./middleware');

type AuthedRequest = Request & { currentUser?: { username: string, role: string } };

function mountUserRoutes(app: Application, ctx: AdminContext): void {
    const adminOnly = createAdminOnly(ctx);

    // ===== 用户 =====
    app.get('/api/admin/users', adminOnly, (_req: Request, res: Response) => {
        res.json({ ok: true, data: { users: userStore.listUsers(), stats: userStore.countUsers() } });
    });

    app.post('/api/admin/users', adminOnly, (req: Request, res: Response) => {
        const body = req.body || {};
        const result = userStore.createUser({
            username: body.username,
            password: body.password,
            expiresAt: Number(body.expiresAt) || (Number(body.days) > 0 ? Date.now() + Number(body.days) * 86400000 : 0),
            accountLimit: Number(body.accountLimit) || 1,
            isAgent: body.isAgent === true,
            registrationQuota: Number(body.registrationQuota) || 0,
            quotaCardQuota: Number(body.quotaCardQuota) || 0,
        });
        if (!result.ok) return res.status(400).json({ ok: false, error: result.error });
        return res.json({ ok: true, data: result.user });
    });

    app.post('/api/admin/users/:username/renew', adminOnly, (req: Request, res: Response) => {
        const days = Number((req.body || {}).days);
        const result = userStore.extendUser(req.params.username, Number.isFinite(days) ? days : 30);
        if (!result.ok) return res.status(400).json({ ok: false, error: result.error });
        return res.json({ ok: true, data: { expiresAt: result.expiresAt } });
    });

    app.post('/api/admin/users/:username/lock', adminOnly, (req: Request, res: Response) => {
        const result = userStore.setLocked(req.params.username, (req.body || {}).locked === true);
        if (!result.ok) return res.status(400).json({ ok: false, error: result.error });
        return res.json({ ok: true });
    });

    app.post('/api/admin/users/:username/password', adminOnly, (req: Request, res: Response) => {
        const result = userStore.setPassword(req.params.username, String((req.body || {}).password || ''));
        if (!result.ok) return res.status(400).json({ ok: false, error: result.error });
        return res.json({ ok: true });
    });

    app.post('/api/admin/users/:username/quota', adminOnly, (req: Request, res: Response) => {
        const body = req.body || {};
        const result = userStore.updateUser(req.params.username, {
            accountLimit: body.accountLimit,
            isAgent: body.isAgent,
            registrationQuota: body.registrationQuota,
            quotaCardQuota: body.quotaCardQuota,
        });
        if (!result.ok) return res.status(400).json({ ok: false, error: result.error });
        return res.json({ ok: true, data: result.user });
    });

    app.delete('/api/admin/users/:username', adminOnly, (req: Request, res: Response) => {
        const result = userStore.deleteUser(req.params.username);
        if (!result.ok) return res.status(400).json({ ok: false, error: result.error });
        return res.json({ ok: true });
    });

    // 用户自助核销配额卡（登录用户可用，不需要管理员）
    app.post('/api/user/quota-card', (req: Request & { currentUser?: any }, res: Response) => {
        const current = (req as any).currentUser;
        if (!current || current.role === 'admin') {
            return res.status(400).json({ ok: false, error: '请使用普通用户账号核销配额卡' });
        }
        const consumed = cardStore.consumeQuotaCard(String((req.body || {}).code || ''), current.username);
        if (!consumed.ok) return res.status(400).json({ ok: false, error: consumed.error });
        userStore.updateUser(current.username, { accountLimit: (userStore.findUser(current.username)?.accountLimit || 0) + (consumed.quota || 0) });
        return res.json({ ok: true, data: { quota: consumed.quota } });
    });

    // ===== 卡密 =====
    app.get('/api/admin/cards', adminOnly, (req: Request, res: Response) => {
        res.json({ ok: true, data: cardStore.listCards({ status: String(req.query.status || '') }) });
    });

    app.post('/api/admin/cards', adminOnly, (req: Request, res: Response) => {
        const result = cardStore.createCards(req.body || {});
        if (!result.ok) return res.status(400).json({ ok: false, error: result.error });
        return res.json({ ok: true, data: { codes: result.codes } });
    });

    app.delete('/api/admin/cards/:code', adminOnly, (req: Request, res: Response) => {
        const result = cardStore.deleteCard(req.params.code);
        if (!result.ok) return res.status(400).json({ ok: false, error: result.error });
        return res.json({ ok: true });
    });

    app.get('/api/admin/quota-cards', adminOnly, (_req: Request, res: Response) => {
        res.json({ ok: true, data: cardStore.listQuotaCards() });
    });

    app.post('/api/admin/quota-cards', adminOnly, (req: Request, res: Response) => {
        const result = cardStore.createQuotaCards(req.body || {});
        if (!result.ok) return res.status(400).json({ ok: false, error: result.error });
        return res.json({ ok: true, data: { codes: result.codes } });
    });

    app.get('/api/admin/registration-settings', adminOnly, (_req: Request, res: Response) => {
        res.json({ ok: true, data: cardStore.loadSettings() });
    });

    app.post('/api/admin/registration-settings', adminOnly, (req: Request, res: Response) => {
        res.json({ ok: true, data: cardStore.saveSettings(req.body || {}) });
    });

    // ===== 公告 =====
    app.get('/api/admin/announcements', adminOnly, (_req: Request, res: Response) => {
        res.json({ ok: true, data: announcementStore.listAll() });
    });

    app.post('/api/admin/announcements', adminOnly, (req: Request, res: Response) => {
        const result = announcementStore.create(req.body || {});
        if (!result.ok) return res.status(400).json({ ok: false, error: result.error });
        return res.json({ ok: true, data: result.item });
    });

    app.put('/api/admin/announcements/:id', adminOnly, (req: Request, res: Response) => {
        const result = announcementStore.update(req.params.id, req.body || {});
        if (!result.ok) return res.status(400).json({ ok: false, error: result.error });
        return res.json({ ok: true, data: result.item });
    });

    app.delete('/api/admin/announcements/:id', adminOnly, (req: Request, res: Response) => {
        const result = announcementStore.remove(req.params.id);
        if (!result.ok) return res.status(400).json({ ok: false, error: result.error });
        return res.json({ ok: true });
    });

    // 当前登录用户（普通用户看自己的配额/到期时间）
    app.get('/api/user/quota', (req: AuthedRequest, res: Response) => {
        const current = (req as any).currentUser;
        const user = current ? userStore.findUser(current.username) : null;
        if (!user) return res.status(401).json({ ok: false, error: '用户不存在' });
        return res.json({ ok: true, data: userStore.publicUser(user) });
    });
}

module.exports = { mountUserRoutes };
