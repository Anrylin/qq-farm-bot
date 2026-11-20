export {};

/**
 * QQ 扫码排队
 *
 * 背景：NapCat 同一时刻只允许一个 QQ 登录工作流（auth 服务会返回
 * WORKFLOW_BUSY），多人同时点"QQ扫码"必然互相顶掉。这里做一层 FIFO 队列：
 *   - 空位时直接给二维码（active）
 *   - 有人占用时排队，返回自己的位置，并轮询是否轮到自己
 *   - 任务取消/超时/完成都释放位置，队首自动补位
 */
const crypto = require('node:crypto');

const TASK_TTL_MS = 120_000;
const QUEUE_TTL_MS = 10 * 60 * 1000;

interface Entry {
    id: string;
    username: string;
    createdAt: number;
    /** queued 排队中 / active 已拿到二维码 / done 已结束 */
    status: 'queued' | 'active' | 'done';
    taskId?: string;
    activatedAt?: number;
}

let entries: Entry[] = [];

function now(): number {
    return Date.now();
}

function prune(): void {
    entries = entries.filter((entry) => {
        if (entry.status === 'queued') return now() - entry.createdAt < QUEUE_TTL_MS;
        if (entry.status === 'active') return true;
        return now() - (entry.activatedAt || entry.createdAt) < QUEUE_TTL_MS;
    });
}

/** 活跃项超时（NapCat 侧任务 2 分钟过期）自动释放 */
function releaseIfExpired(): void {
    for (const entry of entries) {
        if (entry.status !== 'active') continue;
        if (now() - (entry.activatedAt || 0) > TASK_TTL_MS + 5000) {
            entry.status = 'done';
        }
    }
}

function activeEntry(): Entry | undefined {
    return entries.find(entry => entry.status === 'active');
}

/** 队列里的排队顺序（不含已结束） */
function queueOrder(): Entry[] {
    return entries
        .filter(entry => entry.status === 'queued')
        .sort((a, b) => a.createdAt - b.createdAt);
}

/** 队列中的位次：1 = 正在扫码的人，2 = 下一位 */
function positionOf(entry: Entry): number {
    if (entry.status === 'active') return 1;
    const order = queueOrder();
    const index = order.findIndex(item => item.id === entry.id);
    if (index < 0) return -1;
    return index + 1 + (activeEntry() ? 1 : 0);
}

interface SlotResult {
    kind: 'active' | 'queued';
    entry: Entry;
    position: number;
    total: number;
}

/**
 * 申请扫码位：
 *  - 同一用户重复申请直接复用原排队项（不会插队重复占位）
 *  - 无人占用则立即 active
 */
function requestSlot(username: string): SlotResult {
    releaseIfExpired();
    prune();
    const name = String(username || '').trim() || 'anonymous';

    const existing = entries.find(entry => entry.username === name && entry.status !== 'done');
    if (existing) {
        return { kind: existing.status === 'active' ? 'active' : 'queued', entry: existing, position: positionOf(existing), total: queueOrder().length };
    }

    const entry: Entry = {
        id: crypto.randomBytes(12).toString('hex'),
        username: name,
        createdAt: now(),
        status: activeEntry() ? 'queued' : 'active',
        activatedAt: activeEntry() ? undefined : now(),
    };
    entries.push(entry);
    return { kind: entry.status === 'active' ? 'active' : 'queued', entry, position: positionOf(entry), total: queueOrder().length };
}

/** 队首补位：给排队中的第一个人发位子 */
function promoteNext(): SlotResult | null {
    if (activeEntry()) return null;
    const next = queueOrder()[0];
    if (!next) return null;
    next.status = 'active';
    next.activatedAt = now();
    return { kind: 'active', entry: next, position: 0, total: queueOrder().length };
}

function attachTask(entryId: string, taskId: string): void {
    const entry = entries.find(item => item.id === entryId);
    if (!entry) return;
    entry.taskId = taskId;
    entry.activatedAt = now();
}

/** 释放位置（取消/完成/失败） */
function release(entryId: string): void {
    const entry = entries.find(item => item.id === entryId);
    if (!entry) return;
    entry.status = 'done';
    if (!activeEntry()) promoteNext();
}

/** 按 taskId 反查并释放 */
function releaseByTaskId(taskId: string): void {
    const entry = entries.find(item => item.taskId === taskId);
    if (entry) release(entry.id);
}

function getEntry(entryId: string): Entry | undefined {
    releaseIfExpired();
    const entry = entries.find(item => item.id === entryId);
    if (entry && entry.status === 'active' && now() - (entry.activatedAt || 0) > TASK_TTL_MS + 5000) {
        entry.status = 'done';
        promoteNext();
    }
    return entry;
}

function promoteFor(entryId: string): SlotResult | null {
    const entry = entries.find(item => item.id === entryId);
    if (!entry || entry.status !== 'queued') return null;
    const head = queueOrder()[0];
    if (!head || head.id !== entry.id) return null;
    if (activeEntry()) return null;
    entry.status = 'active';
    entry.activatedAt = now();
    return { kind: 'active', entry, position: 0, total: queueOrder().length };
}

function snapshot() {
    releaseIfExpired();
    prune();
    return entries.map(entry => ({
        id: entry.id,
        username: entry.username,
        status: entry.status,
        position: positionOf(entry),
        createdAt: entry.createdAt,
    }));
}

function reset(): void {
    entries = [];
}

module.exports = {
    TASK_TTL_MS,
    requestSlot,
    promoteNext,
    promoteFor,
    attachTask,
    release,
    releaseByTaskId,
    getEntry,
    positionOf,
    queueOrder,
    getActive: activeEntry,
    snapshot,
    reset,
};
