export {};
/**
 * 卡密存储：注册卡 + 配额卡
 *
 * 数据文件沿用 2.8.0 的结构，迁移脚本可直接灌入：
 *   registration-cards.json  [{ code, type: 'permanent'|'duration', durationDays, createdAt, usedAt, usedBy }]
 *   quota-cards.json         [{ code, quota, createdAt, usedAt, usedBy }]
 */
const fs = require('node:fs');
const crypto = require('node:crypto');
const { getDataFile, ensureDataDir } = require('../config/runtime-paths');

const REG_FILE: string = getDataFile('registration-cards.json');
const QUOTA_FILE: string = getDataFile('quota-cards.json');
const SETTINGS_FILE: string = getDataFile('registration-settings.json');

const CODE_ALPHABET = '0123456789ABCDEF';

interface RegistrationCard {
    code: string;
    type: 'permanent' | 'duration';
    durationDays: number;
    createdAt: number;
    usedAt: number;
    usedBy: string;
    /** 发行者：管理员为空，代理为代理用户名 */
    createdBy?: string;
}

interface QuotaCard {
    code: string;
    quota: number;
    createdAt: number;
    usedAt: number;
    usedBy: string;
    createdBy?: string;
}

let cards: RegistrationCard[] | null = null;
let quotaCards: QuotaCard[] | null = null;
let settings: { requiresCardKey: boolean } | null = null;

function readJson(file: string, fallback: any): any {
    ensureDataDir();
    try {
        if (!fs.existsSync(file)) return fallback;
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return fallback;
    }
}

function writeJson(file: string, data: any): void {
    ensureDataDir();
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function normalizeCard(raw: any): RegistrationCard | null {
    const code = String(raw?.code || '').trim().toUpperCase();
    if (!code) return null;
    return {
        code,
        type: raw?.type === 'permanent' ? 'permanent' : 'duration',
        durationDays: raw?.type === 'permanent' ? 0 : (Number(raw?.durationDays) || 0),
        createdAt: Number(raw?.createdAt) || 0,
        usedAt: Number(raw?.usedAt) || 0,
        usedBy: String(raw?.usedBy || '').trim(),
        createdBy: String(raw?.createdBy || '').trim() || undefined,
    };
}

function loadCards(): RegistrationCard[] {
    if (cards) return cards;
    const raw = readJson(REG_FILE, []);
    const list = Array.isArray(raw) ? raw : [];
    cards = list.map(normalizeCard).filter((item: RegistrationCard | null): item is RegistrationCard => item !== null);
    return cards;
}

function loadQuotaCards(): QuotaCard[] {
    if (quotaCards) return quotaCards;
    const raw = readJson(QUOTA_FILE, []);
    const list = Array.isArray(raw) ? raw : [];
    quotaCards = list
        .filter((item: any) => item && item.code)
        .map((item: any) => ({
            code: String(item.code).trim().toUpperCase(),
            quota: Number(item.quota) || 0,
            createdAt: Number(item.createdAt) || 0,
            usedAt: Number(item.usedAt) || 0,
            usedBy: String(item.usedBy || '').trim(),
            createdBy: String(item.createdBy || '').trim() || undefined,
        }));
    return quotaCards;
}

function loadSettings(): { requiresCardKey: boolean } {
    if (settings) return settings;
    const raw = readJson(SETTINGS_FILE, {});
    settings = { requiresCardKey: raw?.requiresCardKey !== false };
    return settings;
}

function saveSettings(next: any): { requiresCardKey: boolean } {
    settings = { requiresCardKey: next?.requiresCardKey !== false };
    writeJson(SETTINGS_FILE, settings);
    return settings;
}

function generateCode(prefix: string): string {
    const groups: string[] = [];
    for (let i = 0; i < 3; i += 1) {
        let part = '';
        for (let j = 0; j < 4; j += 1) part += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
        groups.push(part);
    }
    return `${prefix}-${groups.join('-')}`;
}

function createCards(input: any): { ok: boolean, error?: string, codes?: string[] } {
    const count = Math.max(1, Math.min(500, Math.floor(Number(input?.count) || 1)));
    const type = input?.type === 'permanent' ? 'permanent' : 'duration';
    const durationDays = type === 'permanent' ? 0 : Math.max(1, Math.floor(Number(input?.durationDays) || 30));

    const list = loadCards();
    const existing = new Set(list.map(item => item.code));
    const codes: string[] = [];
    for (let i = 0; i < count; i += 1) {
        let code = generateCode('QF');
        while (existing.has(code)) code = generateCode('QF');
        existing.add(code);
        codes.push(code);
        list.push({
            code,
            type,
            durationDays,
            createdAt: Date.now(),
            usedAt: 0,
            usedBy: '',
            createdBy: String(input?.createdBy || '').trim() || undefined,
        });
    }
    writeJson(REG_FILE, list);
    return { ok: true, codes };
}

/** 核销注册卡：返回有效期信息；已使用/不存在都返回错误 */
function consumeCard(code: string, username: string): { ok: boolean, error?: string, type?: string, durationDays?: number } {
    const target = String(code || '').trim().toUpperCase();
    if (!target) return { ok: false, error: '请输入卡密' };
    const list = loadCards();
    const card = list.find(item => item.code === target);
    if (!card) return { ok: false, error: '卡密不存在' };
    if (card.usedAt > 0) return { ok: false, error: '卡密已被使用' };
    card.usedAt = Date.now();
    card.usedBy = String(username || '');
    writeJson(REG_FILE, list);
    return { ok: true, type: card.type, durationDays: card.durationDays };
}

function createQuotaCards(input: any): { ok: boolean, error?: string, codes?: string[] } {
    const count = Math.max(1, Math.min(200, Math.floor(Number(input?.count) || 1)));
    const quota = Math.max(1, Math.floor(Number(input?.quota) || 1));
    const list = loadQuotaCards();
    const existing = new Set(list.map(item => item.code));
    const codes: string[] = [];
    for (let i = 0; i < count; i += 1) {
        let code = generateCode('QE');
        while (existing.has(code)) code = generateCode('QE');
        existing.add(code);
        codes.push(code);
        list.push({
            code,
            quota,
            createdAt: Date.now(),
            usedAt: 0,
            usedBy: '',
            createdBy: String(input?.createdBy || '').trim() || undefined,
        });
    }
    writeJson(QUOTA_FILE, list);
    return { ok: true, codes };
}

function consumeQuotaCard(code: string, username: string): { ok: boolean, error?: string, quota?: number } {
    const target = String(code || '').trim().toUpperCase();
    if (!target) return { ok: false, error: '请输入卡密' };
    const list = loadQuotaCards();
    const card = list.find(item => item.code === target);
    if (!card) return { ok: false, error: '配额卡不存在' };
    if (card.usedAt > 0) return { ok: false, error: '配额卡已被使用' };
    card.usedAt = Date.now();
    card.usedBy = String(username || '');
    writeJson(QUOTA_FILE, list);
    return { ok: true, quota: card.quota };
}

function listCards(options: any = {}): any {
    const list = loadCards();
    const used = options?.status === 'used';
    const available = options?.status === 'available';
    const filtered = list.filter(card => (used ? card.usedAt > 0 : available ? !card.usedAt : true));
    return {
        total: list.length,
        used: list.filter(card => card.usedAt > 0).length,
        available: list.filter(card => !card.usedAt).length,
        items: filtered.slice(0, 2000),
    };
}

/** 代理自有卡密（按 createdBy 过滤） */
function listCardsByCreator(username: string, options: any = {}): any {
    const name = String(username || '').trim();
    const list = loadCards().filter(card => String(card.createdBy || '') === name);
    const status = String(options?.status || '');
    const filtered = list.filter(card => (status === 'used' ? card.usedAt > 0 : status === 'available' ? !card.usedAt : true));
    return {
        total: list.length,
        used: list.filter(card => card.usedAt > 0).length,
        available: list.filter(card => !card.usedAt).length,
        items: filtered.slice(0, 1000),
    };
}

function listQuotaCardsByCreator(username: string): any {
    const name = String(username || '').trim();
    const list = loadQuotaCards().filter(card => String(card.createdBy || '') === name);
    return {
        total: list.length,
        used: list.filter(card => card.usedAt > 0).length,
        available: list.filter(card => !card.usedAt).length,
        items: list.slice(0, 1000),
    };
}

function listQuotaCards(): any {
    const list = loadQuotaCards();
    return {
        total: list.length,
        used: list.filter(card => card.usedAt > 0).length,
        available: list.filter(card => !card.usedAt).length,
        items: list.slice(0, 2000),
    };
}

function deleteCard(code: string): { ok: boolean, error?: string } {
    const target = String(code || '').trim().toUpperCase();
    const list = loadCards();
    const index = list.findIndex(item => item.code === target);
    if (index < 0) return { ok: false, error: '卡密不存在' };
    if (list[index].usedAt > 0) return { ok: false, error: '已使用的卡密不能删除' };
    list.splice(index, 1);
    writeJson(REG_FILE, list);
    return { ok: true };
}

module.exports = {
    loadCards,
    loadQuotaCards,
    loadSettings,
    saveSettings,
    createCards,
    consumeCard,
    createQuotaCards,
    consumeQuotaCard,
    listCards,
    listCardsByCreator,
    listQuotaCardsByCreator,
    listQuotaCards,
    deleteCard,
};
