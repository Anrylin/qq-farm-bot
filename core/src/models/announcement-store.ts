export {};
/**
 * 公告存储（迁移自 2.8.0 announcements.json）
 * 结构：[{ id, title, content, pinned, active, createdAt, updatedAt }]
 */
const fs = require('node:fs');
const crypto = require('node:crypto');
const { getDataFile, ensureDataDir } = require('../config/runtime-paths');

const FILE: string = getDataFile('announcements.json');

interface Announcement {
    id: string;
    title: string;
    content: string;
    pinned: boolean;
    active: boolean;
    createdAt: number;
    updatedAt: number;
}

let items: Announcement[] | null = null;

function load(): Announcement[] {
    if (items) return items;
    ensureDataDir();
    try {
        if (!fs.existsSync(FILE)) {
            items = [];
            return items;
        }
        const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
        const list = Array.isArray(raw) ? raw : [];
        items = list.map((item: any) => ({
            id: String(item.id || crypto.randomUUID()),
            title: String(item.title || ''),
            content: String(item.content || ''),
            pinned: item.pinned === true,
            active: item.active !== false,
            createdAt: Number(item.createdAt) || Date.now(),
            updatedAt: Number(item.updatedAt) || Number(item.createdAt) || Date.now(),
        }));
    } catch {
        items = [];
    }
    return items;
}

function save(): void {
    ensureDataDir();
    fs.writeFileSync(FILE, JSON.stringify(items || [], null, 2), 'utf8');
}

function sortAnnouncements(list: Announcement[]): Announcement[] {
    return [...list].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
}

function listAll(): Announcement[] {
    return sortAnnouncements(load());
}

/** 面板登录后展示：只看启用中的 */
function listActive(): Announcement[] {
    return sortAnnouncements(load().filter(item => item.active));
}

function create(input: any): { ok: boolean, error?: string, item?: Announcement } {
    const title = String(input?.title || '').trim();
    const content = String(input?.content || '').trim();
    if (!title && !content) return { ok: false, error: '标题和内容不能同时为空' };
    const item: Announcement = {
        id: crypto.randomUUID(),
        title,
        content,
        pinned: input?.pinned === true,
        active: input?.active !== false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
    load().push(item);
    save();
    return { ok: true, item };
}

function update(id: string, patch: any): { ok: boolean, error?: string, item?: Announcement } {
    const item = load().find(entry => entry.id === id);
    if (!item) return { ok: false, error: '公告不存在' };
    if (patch?.title !== undefined) item.title = String(patch.title).trim();
    if (patch?.content !== undefined) item.content = String(patch.content).trim();
    if (patch?.pinned !== undefined) item.pinned = patch.pinned === true;
    if (patch?.active !== undefined) item.active = patch.active !== false;
    item.updatedAt = Date.now();
    save();
    return { ok: true, item };
}

function remove(id: string): { ok: boolean, error?: string } {
    const list = load();
    const index = list.findIndex(entry => entry.id === id);
    if (index < 0) return { ok: false, error: '公告不存在' };
    list.splice(index, 1);
    save();
    return { ok: true };
}

module.exports = { listAll, listActive, create, update, remove };
