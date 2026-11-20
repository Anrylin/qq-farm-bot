import type { Application, Request, Response } from 'express';
import type { AdminContext } from './context';
export {};

/**
 * 版本更新检测接口（仅管理员）
 * 只读：不下载、不重启，只回答"有没有新提交"。
 */
const updateChecker = require('../../services/update-checker');
const { createAdminOnly } = require('./middleware');

function mountUpdateRoutes(app: Application, ctx: AdminContext): void {
    const adminOnly = createAdminOnly(ctx);

    app.get('/api/update/check', adminOnly, async (req: Request, res: Response) => {
        const force = String((req.query as any).force || '') === '1';
        const data = await updateChecker.check(force);
        res.json({ ok: !data.error, data });
    });

    app.get('/api/update/current', adminOnly, (_req: Request, res: Response) => {
        res.json({ ok: true, data: { ...updateChecker.currentVersion(), repo: updateChecker.REPO, branch: updateChecker.BRANCH } });
    });
}

module.exports = { mountUpdateRoutes };
