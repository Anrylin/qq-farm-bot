import type { NextFunction, Request, Response } from 'express';
import type { AdminContext } from './context';
export {};

const crypto = require('node:crypto');
const store = require('../../models/store');
const { normalizeAccountRef, resolveAccountId } = require('../../services/account-resolver');

interface AuthenticatedRequest extends Request {
    adminToken?: string;
    currentUser?: { username: string, role: 'admin' | 'user' };
}

function getClientIp(req: Request): string {
    const cfIp = req.headers['cf-connecting-ip'];
    if (cfIp) return String(cfIp).trim();
    const realIp = req.headers['x-real-ip'];
    if (realIp) return String(realIp).trim();
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        const first = String(forwarded).split(',').map(item => item.trim()).find(Boolean);
        if (first) return first;
    }
    const address = req.ip || (req as any).connection?.remoteAddress || req.socket?.remoteAddress;
    return String(address || 'unknown').replace(/^::ffff:/, '');
}

const issueToken = (): string => crypto.randomBytes(24).toString('hex');

function createAuthRequired(ctx: AdminContext) {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
        const token = String(req.headers['x-admin-token'] || '');
        if (!token || !ctx.tokens.has(token)) {
            res.status(401).json({ ok: false, error: 'Unauthorized' });
            return;
        }
        req.adminToken = token;
        // 老 token（升级前签发）没有会话记录，按上游原行为视为超级管理员
        req.currentUser = ctx.sessions.get(token) || { username: 'admin', role: 'admin' };
        next();
    };
}

/** 仅超级管理员可访问（多用户接入后，普通用户不能进后台管理接口） */
function createAdminOnly(ctx: AdminContext) {
    const authRequired = createAuthRequired(ctx);
    return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
        authRequired(req, res, () => {
            if (req.currentUser?.role !== 'admin') {
                res.status(403).json({ ok: false, error: '需要超级管理员权限' });
                return;
            }
            next();
        });
    };
}

function getAccountList(ctx: AdminContext): any[] {
    try {
        if (ctx.provider && typeof ctx.provider.getAccounts === 'function') {
            const data = ctx.provider.getAccounts();
            if (Array.isArray(data?.accounts)) return data.accounts;
        }
    } catch {
        // Fall back to persistent storage.
    }
    const data = store.getAccounts ? store.getAccounts() : { accounts: [] };
    return Array.isArray(data.accounts) ? data.accounts : [];
}

/** 账号归属：迁移数据用 ownerUsername，上游新增账号用 ownerUsername/username 兜底 */
function getAccountOwner(account: any): string {
    return String(account?.ownerUsername || account?.owner || account?.username || '').trim();
}

/** 当前用户可见的账号（管理员看全部） */
function getVisibleAccounts(ctx: AdminContext, req: Request): any[] {
    const list = getAccountList(ctx);
    const current = (req as any).currentUser;
    if (!current || current.role === 'admin') return list;
    return list.filter((account: any) => getAccountOwner(account) === current.username);
}

/** 是否允许访问该账号 */
function canAccessAccount(ctx: AdminContext, req: Request, accountId: any): boolean {
    const current = (req as any).currentUser;
    if (!current || current.role === 'admin') return true;
    const id = String(accountId || '');
    if (!id) return false;
    const account = getAccountList(ctx).find((item: any) => String(item.id || '') === id);
    return !!account && getAccountOwner(account) === current.username;
}

function getAccountIds(ctx: AdminContext): string[] {
    return getAccountList(ctx).map((account: any) => String(account.id || '')).filter(Boolean);
}

const isSoftRuntimeError = (err: any): boolean => {
    const message = String(typeof err === 'string' ? err : err?.message || '');
    return message === '账号未运行' || message === 'API Timeout';
};

function isGatewayProtocolError(err: any): boolean {
    const message = String(typeof err === 'string' ? err : err?.message || '').trim();
    return String(err?.name || '') === 'GatewayError'
        || typeof err?.errorMessage === 'string'
        || typeof err?.error_message === 'string'
        || /^(?:[\w-]+\.)+[\w-]+(?:\s+.*?)?\bcode=\d+(?:\s|$)/.test(message);
}

function getProtocolErrorMessage(err: any): string {
    const direct = String(err?.errorMessage || err?.error_message || '').trim();
    if (direct) return direct;

    const message = String(typeof err === 'string' ? err : err?.message || '').trim();
    if (!isGatewayProtocolError(err)) return '';
    return message.match(/\bcode=\d+\b\s*(.*)$/)?.[1]?.trim() || '';
}

function handleApiError(res: Response, err: any): void {
    const protocolMessage = getProtocolErrorMessage(err);
    const payload: any = {
        ok: false,
        error: protocolMessage || (typeof err === 'string' ? err : err?.message) || 'Unknown error',
    };
    if (protocolMessage) payload.errorMessage = protocolMessage;
    const errorCode = Number(err?.code);
    if (Number.isFinite(errorCode) && errorCode !== 0) payload.errorCode = errorCode;
    if (isSoftRuntimeError(err) || isGatewayProtocolError(err)) {
        res.json(payload);
        return;
    }
    res.status(500).json(payload);
}

function resolveAccId(ctx: AdminContext, rawRef: any): string {
    const input = normalizeAccountRef(rawRef);
    if (!input) return '';
    if (ctx.provider && typeof ctx.provider.resolveAccountId === 'function') {
        const resolvedByProvider = normalizeAccountRef(ctx.provider.resolveAccountId(input));
        if (resolvedByProvider) return resolvedByProvider;
    }
    return resolveAccountId(getAccountList(ctx), input) || input;
}

function getAccId(ctx: AdminContext, req: Request): string {
    const id = resolveAccId(ctx, req.headers['x-account-id']);
    // 越权访问直接返回空，由各路由按"缺少账号标识"处理，不泄露账号存在性
    if (id && !canAccessAccount(ctx, req, id)) return '';
    return id;
}

function buildKnownFriendGidSettings(accountId: string): {
    knownFriendGids: any[];
    knownFriendGidSyncCooldownSec: number;
    friendsListCacheTtlSec: number;
} {
    return {
        knownFriendGids: store.getKnownFriendGids ? store.getKnownFriendGids(accountId) : [],
        knownFriendGidSyncCooldownSec: store.getKnownFriendGidSyncCooldownSec
            ? store.getKnownFriendGidSyncCooldownSec(accountId)
            : 600,
        friendsListCacheTtlSec: store.getFriendsListCacheTtlSec
            ? store.getFriendsListCacheTtlSec(accountId)
            : 60,
    };
}

module.exports = {
    getClientIp,
    issueToken,
    createAuthRequired,
    createAdminOnly,
    getAccountList,
    getVisibleAccounts,
    getAccountOwner,
    canAccessAccount,
    getAccountIds,
    isSoftRuntimeError,
    isGatewayProtocolError,
    getProtocolErrorMessage,
    handleApiError,
    resolveAccId,
    getAccId,
    buildKnownFriendGidSettings,
};
