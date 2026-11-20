export {};

/**
 * 版本更新检测
 *
 * 只读：拉 GitHub 上的 master 最近提交，和本机记录的 commit 比对。
 * 仓库公开时不需要任何凭据；如果临时切回私有，可设环境变量 GH_UPDATE_TOKEN。
 */
const fs = require('node:fs');
const path = require('node:path');
const { getDataFile } = require('../config/runtime-paths');

const REPO = String(process.env.UPDATE_REPO || 'Anrylin/qq-farm-bot').trim();
const BRANCH = String(process.env.UPDATE_BRANCH || 'master').trim();
const TOKEN = String(process.env.GH_UPDATE_TOKEN || '').trim();
const CACHE_MS = 30 * 60 * 1000;
const FETCH_TIMEOUT_MS = 12000;

interface CheckResult {
    repo: string;
    branch: string;
    current: string;
    currentBuiltAt: number;
    latest: string;
    latestMessage: string;
    latestAt: string;
    behind: number;
    commits: { sha: string, message: string, date: string, author: string }[];
    checkedAt: number;
    cached: boolean;
    error?: string;
}

let cache: { at: number, data: CheckResult } | null = null;

function currentVersion(): { commit: string, builtAt: number } {
    const candidates = [
        process.env.FARM_BUILD_COMMIT,
        (() => {
            try {
                const file = getDataFile('version.json');
                if (!fs.existsSync(file)) return '';
                const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
                return String(raw?.commit || '');
            } catch {
                return '';
            }
        })(),
    ];
    const commit = candidates.map(item => String(item || '').trim()).find(Boolean) || '';
    let builtAt = 0;
    try {
        const file = getDataFile('version.json');
        if (fs.existsSync(file)) builtAt = Number(JSON.parse(fs.readFileSync(file, 'utf8'))?.builtAt) || 0;
    } catch {
        builtAt = 0;
    }
    return { commit, builtAt };
}

function headers(): Record<string, string> {
    const base: Record<string, string> = {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'qq-farm-bot-update-checker',
    };
    if (TOKEN) base.Authorization = `Bearer ${TOKEN}`;
    return base;
}

async function githubJson(url: string): Promise<any> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const response = await fetch(url, { headers: headers(), signal: controller.signal });
        if (!response.ok) throw new Error(`GitHub 返回 ${response.status}`);
        return await response.json();
    } finally {
        clearTimeout(timer);
    }
}

function normalizeCommits(items: any[]): CheckResult['commits'] {
    return (Array.isArray(items) ? items : []).map((item: any) => ({
        sha: String(item?.sha || '').slice(0, 10),
        message: String(item?.commit?.message || '').split('\n')[0].slice(0, 120),
        date: String(item?.commit?.author?.date || item?.commit?.committer?.date || ''),
        author: String(item?.commit?.author?.name || ''),
    }));
}

async function check(force = false): Promise<CheckResult> {
    const now = Date.now();
    if (!force && cache && now - cache.at < CACHE_MS) {
        return { ...cache.data, cached: true };
    }

    const { commit: current, builtAt } = currentVersion();
    const base: CheckResult = {
        repo: REPO,
        branch: BRANCH,
        current: current || 'unknown',
        currentBuiltAt: builtAt,
        latest: '',
        latestMessage: '',
        latestAt: '',
        behind: 0,
        commits: [],
        checkedAt: now,
        cached: false,
    };

    try {
        if (!current) {
            // 没有版本基准：只报最新提交，不计算落后多少
            const latestList = await githubJson(`https://api.github.com/repos/${REPO}/commits?sha=${BRANCH}&per_page=10`);
            const first = Array.isArray(latestList) ? latestList[0] : null;
            const result: CheckResult = {
                ...base,
                latest: String(first?.sha || '').slice(0, 10),
                latestMessage: String(first?.commit?.message || '').split('\n')[0].slice(0, 120),
                latestAt: String(first?.commit?.author?.date || ''),
                commits: normalizeCommits(latestList),
                error: '未记录本机版本，无法计算落后提交数',
            };
            cache = { at: now, data: result };
            return result;
        }

        const compare = await githubJson(`https://api.github.com/repos/${REPO}/compare/${current}...${BRANCH}`);
        const result: CheckResult = {
            ...base,
            latest: String(compare?.commits?.length ? compare.commits[compare.commits.length - 1].sha : compare?.merge_base_commit?.sha || '').slice(0, 10),
            latestMessage: String(compare?.commits?.length
                ? compare.commits[compare.commits.length - 1].commit.message
                : '').split('\n')[0].slice(0, 120),
            latestAt: String(compare?.commits?.length
                ? compare.commits[compare.commits.length - 1].commit.author?.date || ''
                : ''),
            behind: Number(compare?.ahead_by || 0),
            commits: normalizeCommits(compare?.commits || []),
        };
        cache = { at: now, data: result };
        return result;
    } catch (error: any) {
        const result: CheckResult = { ...base, error: String(error?.message || '检查更新失败') };
        cache = { at: now, data: result };
        return result;
    }
}

function invalidate(): void {
    cache = null;
}

module.exports = { check, invalidate, currentVersion, REPO, BRANCH };
