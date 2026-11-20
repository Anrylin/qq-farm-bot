import type { Application, Request, Response } from 'express';
import type { AdminContext } from './context';
import { cancelLoginTask, createLoginTask, getMiniappCode, QQ_MINIAPP_APP_ID, queryLoginStatus } from '../../services/qq-login/service';

export {};

const { createAuthRequired } = require('./middleware');
const qqQueue = require('../../services/qq-login/queue');

function publicTask(task: any) {
    return {
        queued: false,
        task_id: task.taskId,
        status: task.status,
        qr_image: task.qrImage,
        expires_at: task.expiresAt,
    };
}

function queuedPayload(entry: any, position: number, total: number, message?: string) {
    return {
        queued: true,
        entry_id: entry.id,
        position,
        total,
        ahead: Math.max(0, position - 1),
        message: message || (position > 1 ? `前面还有 ${position - 1} 人，请稍候` : '正在为你排队'),
    };
}

function sendError(res: Response, error: any, fallback: string): void {
    res.json({
        ok: false,
        error: String(error?.message || '').trim() || fallback,
    });
}

function mountQqLoginRoutes(app: Application, ctx: AdminContext): void {
    app.use('/api/qq-login', createAuthRequired(ctx));

    // 创建任务：NapCat 同一时刻只允许一个工作流，这里排队发号
    app.post('/api/qq-login/tasks', async (req: Request & { currentUser?: any }, res: Response) => {
        const username = String((req as any).currentUser?.username || 'anonymous');
        const slot = qqQueue.requestSlot(username);
        if (slot.kind === 'queued') {
            return res.json({ ok: true, data: queuedPayload(slot.entry, slot.position, slot.total) });
        }
        try {
            const task = await createLoginTask();
            qqQueue.attachTask(slot.entry.id, task.taskId);
            return res.json({ ok: true, data: publicTask(task) });
        }
        catch (error: any) {
            const message = String(error?.message || '');
            // 上一轮工作流尚未释放：把人放回队首，让前端继续等
            if (message.includes('繁忙') || message.includes('BUSY')) {
                const requeued = qqQueue.requestSlot(username);
                return res.json({ ok: true, data: queuedPayload(requeued.entry, Math.max(1, requeued.position), requeued.total, '上一个扫码任务还在收尾，稍等几秒') });
            }
            qqQueue.release(slot.entry.id);
            return sendError(res, error, 'QQ 登录任务创建失败');
        }
    });

    // 查询排队状态：轮到自己时在这里直接发二维码
    app.get('/api/qq-login/queue/:entryId', async (req: Request, res: Response) => {
        const entry = qqQueue.getEntry(String(req.params.entryId || ''));
        if (!entry || entry.status === 'done')
            return res.json({ ok: false, error: '排队已失效，请重新发起 QQ 扫码' });

        if (entry.status === 'queued') {
            const promoted = qqQueue.promoteFor(entry.id);
            if (!promoted)
                return res.json({ ok: true, data: queuedPayload(entry, qqQueue.positionOf(entry), qqQueue.queueOrder().length) });
        }

        if (entry.taskId) {
            return res.json({ ok: true, data: { ...queuedPayload(entry, 0, 0), queued: false, task_id: entry.taskId } });
        }

        try {
            const task = await createLoginTask();
            qqQueue.attachTask(entry.id, task.taskId);
            return res.json({ ok: true, data: publicTask(task) });
        }
        catch (error: any) {
            const message = String(error?.message || '');
            if (message.includes('繁忙') || message.includes('BUSY'))
                return res.json({ ok: true, data: queuedPayload(entry, 1, 1, '上一个扫码任务还在收尾，稍等几秒') });
            qqQueue.release(entry.id);
            return sendError(res, error, 'QQ 登录二维码获取失败');
        }
    });

    // 放弃排队
    app.post('/api/qq-login/queue/:entryId/leave', (req: Request, res: Response) => {
        qqQueue.release(String(req.params.entryId || ''));
        res.json({ ok: true });
    });

    app.post('/api/qq-login/tasks/:taskId/status', async (req: Request, res: Response) => {
        try {
            const task = await queryLoginStatus(String(req.params.taskId || ''));
            res.json({ ok: true, data: publicTask(task) });
        }
        catch (error: any) {
            sendError(res, error, 'QQ 登录状态查询失败');
        }
    });

    app.post('/api/qq-login/tasks/:taskId/code', async (req: Request, res: Response) => {
        try {
            const result = await getMiniappCode(String(req.params.taskId || ''));
            res.json({ ok: true, data: { code: result.code, nickname: result.nickname || '', app_id: QQ_MINIAPP_APP_ID } });
        }
        catch (error: any) {
            sendError(res, error, 'QQ 小程序授权 Code 获取失败');
        }
    });

    app.post('/api/qq-login/tasks/:taskId/cancel', async (req: Request, res: Response) => {
        qqQueue.releaseByTaskId(String(req.params.taskId || ''));
        try {
            await cancelLoginTask(String(req.params.taskId || ''));
            res.json({ ok: true });
        }
        catch (error: any) {
            sendError(res, error, 'QQ 登录任务取消失败');
        }
    });
}

module.exports = { mountQqLoginRoutes };
