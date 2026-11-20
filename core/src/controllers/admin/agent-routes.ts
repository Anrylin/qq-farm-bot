import type { Application, Request, Response } from 'express';
import type { AdminContext } from './context';
export {};

/**
 * 代理分销接口
 * 代理（isAgent）在自身额度内自助发卡：
 *   registrationQuota —— 可发注册卡张数
 *   quotaCardQuota    —— 可发配额卡张数
 * 管理员也能用（走 /api/admin/*），这里只处理普通代理。
 */
const userStore = require('../../models/user-store');
const cardStore = require('../../models/card-store');

type AuthedRequest = Request & { currentUser?: { username: string, role: string } };

function mountAgentRoutes(app: Application, ctx: AdminContext): void {
    const currentUser = (req: any) => req.currentUser || { username: '', role: 'user' };

    function requireAgent(req: any, res: Response): any | null {
        const current = currentUser(req);
        const user = current.username ? userStore.findUser(current.username) : null;
        if (!user) {
            res.status(401).json({ ok: false, error: '用户不存在' });
            return null;
        }
        if (user.role !== 'admin' && !user.isAgent) {
            res.status(403).json({ ok: false, error: '当前账号不是代理' });
            return null;
        }
        return user;
    }

    app.get('/api/agent/overview', (req: AuthedRequest, res: Response) => {
        const user = requireAgent(req, res);
        if (!user) return;
        const cards = cardStore.listCardsByCreator(user.username);
        const quotaCards = cardStore.listQuotaCardsByCreator(user.username);
        res.json({
            ok: true,
            data: {
                username: user.username,
                isAgent: user.isAgent,
                registrationQuota: user.registrationQuota,
                quotaCardQuota: user.quotaCardQuota,
                cards: { total: cards.total, available: cards.available, used: cards.used },
                quotaCards: { total: quotaCards.total, available: quotaCards.available, used: quotaCards.used },
            },
        });
    });

    app.get('/api/agent/cards', (req: AuthedRequest, res: Response) => {
        const user = requireAgent(req, res);
        if (!user) return;
        const status = String((req.query as any).status || '');
        res.json({ ok: true, data: cardStore.listCardsByCreator(user.username, { status }) });
    });

    app.post('/api/agent/cards', (req: AuthedRequest, res: Response) => {
        const user = requireAgent(req, res);
        if (!user) return;
        const body = (req.body || {}) as any;
        const count = Math.max(1, Math.floor(Number(body.count) || 1));
        if (user.role !== 'admin') {
            if (Number(user.registrationQuota) < count) {
                return res.status(400).json({ ok: false, error: `注册卡额度不足（剩余 ${user.registrationQuota}）` });
            }
        }
        const result = cardStore.createCards({ ...body, count, createdBy: user.username });
        if (!result.ok) return res.status(400).json({ ok: false, error: result.error });
        if (user.role !== 'admin') userStore.adjustQuota(user.username, 'registrationQuota', -count);
        const updated = userStore.findUser(user.username);
        return res.json({
            ok: true,
            data: { codes: result.codes, registrationQuota: updated ? updated.registrationQuota : null },
        });
    });

    app.get('/api/agent/quota-cards', (req: AuthedRequest, res: Response) => {
        const user = requireAgent(req, res);
        if (!user) return;
        res.json({ ok: true, data: cardStore.listQuotaCardsByCreator(user.username) });
    });

    app.post('/api/agent/quota-cards', (req: AuthedRequest, res: Response) => {
        const user = requireAgent(req, res);
        if (!user) return;
        const body = (req.body || {}) as any;
        const count = Math.max(1, Math.floor(Number(body.count) || 1));
        if (user.role !== 'admin') {
            if (Number(user.quotaCardQuota) < count) {
                return res.status(400).json({ ok: false, error: `配额卡额度不足（剩余 ${user.quotaCardQuota}）` });
            }
        }
        const result = cardStore.createQuotaCards({ ...body, count, createdBy: user.username });
        if (!result.ok) return res.status(400).json({ ok: false, error: result.error });
        if (user.role !== 'admin') userStore.adjustQuota(user.username, 'quotaCardQuota', -count);
        const updated = userStore.findUser(user.username);
        return res.json({
            ok: true,
            data: { codes: result.codes, quotaCardQuota: updated ? updated.quotaCardQuota : null },
        });
    });

    // 管理员给代理发放额度
    app.post('/api/admin/users/:username/agent-quota', (req: Request, res: Response) => {
        const current = (req as any).currentUser || {};
        if (current.role !== 'admin') {
            return res.status(403).json({ ok: false, error: '需要超级管理员权限' });
        }
        const body = (req.body || {}) as any;
        const registrationQuota = Number(body.registrationQuota) || 0;
        const quotaCardQuota = Number(body.quotaCardQuota) || 0;
        const isAgent = body.isAgent === undefined ? true : body.isAgent === true;
        const result = userStore.updateUser(req.params.username, {
            isAgent,
            registrationQuota: Math.max(0, (userStore.findUser(req.params.username)?.registrationQuota || 0) + registrationQuota),
            quotaCardQuota: Math.max(0, (userStore.findUser(req.params.username)?.quotaCardQuota || 0) + quotaCardQuota),
        });
        if (!result.ok) return res.status(400).json({ ok: false, error: result.error });
        return res.json({ ok: true, data: result.user });
    });
}

module.exports = { mountAgentRoutes };
