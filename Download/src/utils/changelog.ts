// ============================================================
// 更新日志：从外部 changelog.json 拉取并渲染
// 改完推送 changelog.json 就能更新，不用动代码重新构建
//
// 全站共用一个文件：/data/changelog.json
// {
//   "notice": "置顶公告，不需要就留空字符串或删掉",
//   "logs": [
//     {
//       "date": "2026-11-13",
//       "pages": {
//         "download": "下载站这次改了什么",
//         "pmth":     "谱面工坊这次改了什么",
//         "signal":   "",                // 没填 = 空的，SIGNAL 这天没有更新
//         "other":    "站点改版 / 域名更换等不属于某个子页面的更新"
//       }
//     }
//   ]
// }
// logs[] 里每个元素 = 一天，pages 里按页面分区填写，想填哪个填哪个。
// download/pmth/signal 对应三个子页面；other 是「其他 / 站点级」更新，
// 没有对应子页面，只在导航页 / 蓝奏云（scope=all）的全部视图里出现。
// 导航页 / 蓝奏云显示全部非空分区；其余各页只取自己那一区，
// 自己那区没填则这一整天不出现；所有天都没内容显示「暂无信息」。
// 每区正文用 \n 换行，一行 = 一个列表项；也可以直接写 HTML，会原样渲染。
// 兼容：早期平铺格式（date/scope/content）与 contentByScope 分段格式仍可读取。
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import { updateLogs as bundledLogs, UpdateLog } from '../aboutData';

export interface ChangelogSource {
    url: string;
    label: string;
}

/**
 * 数据源按优先级排列，前一个失败自动换下一个：
 * 1. 本站（GitHub Pages）—— 国内最快最稳
 * 2. jsDelivr CDN —— 备用
 * 3. GitHub Raw —— 备用（部分地区连不上）
 */
function localChangelogUrl(): string {
    try {
        // 下载站位于 /download/，上一级就是站点根，data/ 与它同级。
        // 用当前页面 URL 推导，站点挂在域名根或仓库子路径下都能命中。
        return new URL('../data/changelog.json', window.location.href).href;
    } catch {
        return '/data/changelog.json';
    }
}

export const DEFAULT_CHANGELOG_SOURCES: ChangelogSource[] = [
    { url: localChangelogUrl(), label: '本站' },
    { url: '/data/changelog.json', label: '本站（根路径）' },
    { url: 'https://cdn.jsdelivr.net/gh/riluo-ya/pth@main/data/changelog.json', label: 'CDN' },
    { url: 'https://raw.githubusercontent.com/riluo-ya/pth/main/data/changelog.json', label: 'GitHub' },
];

function escapeHtml(str: string): string {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** 允许的排版标签白名单，命中就按 HTML 原样渲染 */
const HTML_ALLOWED =
    /<\/?(ul|ol|li|p|br|b|strong|i|em|code|span|div|a|small|u)\b[^>]*>/i;

/** 危险特征：命中就一律当纯文本转义，避免注入 */
const HTML_DANGEROUS =
    /<\s*(script|iframe|style|object|embed|link|meta|form|svg)\b|javascript\s*:|on[a-z]+\s*=/i;

/** 判断是不是安全的排版 HTML */
function looksLikeHtml(str: string): boolean {
    if (HTML_DANGEROUS.test(str)) return false;
    return HTML_ALLOWED.test(str);
}

/** 纯文本按换行转成列表 */
function textToHtml(str: string): string {
    const lines = str
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

    if (lines.length === 0) return '';
    if (lines.length === 1) return `<p>${escapeHtml(lines[0])}</p>`;

    const lis = lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('');
    // 没有子项就保持原来的单层列表
    if (!lines.some((l) => l.startsWith('- '))) {
        return `<ul class="list-disc list-inside space-y-1">${lis}</ul>`;
    }

    /**
     * 支持二级结构：普通行是分组标题，紧随其后以「- 」开头的行是它的子项。
     * 这样日志只写纯文本也能排出层次，不用手写 HTML —— 多行日志往往
     * 塞了十几条改动，全平级会糊成一片，看不出哪些属于同一块。
     */
    let html = '';
    let inGroup = false;
    for (const line of lines) {
        if (line.startsWith('- ')) {
            if (!inGroup) {
                html += '<ul class="list-disc list-inside space-y-1 ml-5 mt-1 text-slate-400">';
                inGroup = true;
            }
            html += `<li>${escapeHtml(line.slice(2))}</li>`;
        } else {
            if (inGroup) {
                html += '</ul>';
                inGroup = false;
            }
            html += `<p class="font-semibold text-slate-200 mt-3 first:mt-0">${escapeHtml(line)}</p>`;
        }
    }
    if (inGroup) html += '</ul>';
    return html;
}

/** 把 JSON 里的 content 渲染成安全的 HTML */
function renderContent(content: unknown): string {
    if (typeof content !== 'string') return '';
    const trimmed = content.trim();
    if (!trimmed) return '';
    // 作者自己写的 HTML 直接信任；纯文本就按换行转列表
    return looksLikeHtml(trimmed) ? trimmed : textToHtml(trimmed);
}

interface RawLog {
    date?: string;
    /** 新格式：一天里按页面分栏，没填的键就是空的 */
    pages?: Record<string, string>;
    /** 旧格式兼容字段 */
    content?: string;
    scope?: string[] | string;
    contentByScope?: Record<string, string>;
}

interface DaySection {
    id: string;
    name: string;
    content: string;
}

const PAGES: { id: string; name: string }[] = [
    { id: 'download', name: '下载站' },
    { id: 'pmth', name: '谱面工坊' },
    { id: 'signal', name: 'SIGNAL' },
    { id: 'other', name: '其他' },
];

/** 把「一天」拆成非空分栏；兼容旧格式时自动归并 */
function sectionsOf(log: RawLog): DaySection[] {
    const out: DaySection[] = [];
    if (log.pages && typeof log.pages === 'object' && !Array.isArray(log.pages)) {
        for (const p of PAGES) {
            const c = log.pages[p.id];
            if (typeof c === 'string' && c.trim()) {
                out.push({ id: p.id, name: p.name, content: c });
            }
        }
        return out;
    }

    const own = Array.isArray(log.scope)
        ? log.scope.map(String)
        : (log.scope ? [String(log.scope)] : ['download']);
    const parts = log.contentByScope && typeof log.contentByScope === 'object'
        ? log.contentByScope : null;
    const anyPart = parts && PAGES.some(p => typeof parts[p.id] === 'string' && parts[p.id].trim());

    for (const p of PAGES) {
        if (own.indexOf(p.id) < 0) continue;
        const raw = anyPart
            ? ((typeof parts?.[p.id] === 'string' && parts[p.id].trim()) ? parts[p.id] : log.content)
            : log.content;
        if (typeof raw === 'string' && raw.trim()) out.push({ id: p.id, name: p.name, content: raw });
    }
    if (!out.length && typeof log.content === 'string' && log.content.trim()) {
        out.push({ id: 'download', name: '下载站', content: log.content });
    }
    return out;
}

/**
 * 按当前页面筛出「天」。
 * - all：把该天所有非空分栏拼在一起，每段带页面名小标题
 * - 单页：只取自己那一栏；没填则这一整天跳过
 */
export function normalizeLogs(data: unknown, scope = 'all'): UpdateLog[] {
    let arr: unknown;
    if (Array.isArray(data)) arr = data;
    else if (data && typeof data === 'object') arr = (data as Record<string, unknown>).logs;
    else return [];
    if (!Array.isArray(arr)) return [];

    const wanted = scope.split(',').map(s => s.trim()).filter(Boolean);
    const out: UpdateLog[] = [];
    for (const log of arr as RawLog[]) {
        if (!log || typeof log !== 'object') continue;
        const all = sectionsOf(log);
        const visible = scope === 'all' ? all : all.filter(s => wanted.indexOf(s.id) >= 0);
        if (!visible.length) continue;

        let content: string;
        if (visible.length === 1) {
            content = renderContent(visible[0].content);
        } else {
            content = visible.map(s =>
                `<p class="font-semibold text-brand-cyan mt-3 first:mt-0">` +
                `${escapeHtml(s.name)}</p>` +
                renderContent(s.content)
            ).join('');
        }
        if (!content) continue;
        out.push({ date: log.date ? String(log.date) : '', content });
    }
    return out;
}

/** 按日期归组（新结构下通常一组一条，保留以便同日多组时仍能合并） */
export interface LogGroup {
    date: string;
    items: UpdateLog[];
}

/** 按日期归组：同一日期的多条独立更新挂在同一个日期标题下 */
export function groupLogsByDate(logs: UpdateLog[]): LogGroup[] {
    const out: LogGroup[] = [];
    const map = new Map<string, LogGroup>();
    for (const log of logs) {
        const key = log.date || '(无日期)';
        let g = map.get(key);
        if (!g) { g = { date: key, items: [] }; map.set(key, g); out.push(g); }
        g.items.push(log);
    }
    return out;
}

export interface ChangelogResult {
    logs: UpdateLog[];
    notice: string;
    sourceLabel: string;
    loading: boolean;
    error: string;
    reload: () => void;
}

/**
 * 拉取并解析更新日志。
 * 所有数据源都失败时，回退到 aboutData.ts 里打包的旧日志 —— 保证「关于」永远不会空白。
 */
export function useChangelog(customSources?: ChangelogSource[], scope = 'all'): ChangelogResult {
    const sources = customSources ?? DEFAULT_CHANGELOG_SOURCES;

    const [logs, setLogs] = useState<UpdateLog[]>(bundledLogs);
    const [notice, setNotice] = useState('');
    const [sourceLabel, setSourceLabel] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [nonce, setNonce] = useState(0);

    const reload = useCallback(() => setNonce((n) => n + 1), []);

    useEffect(() => {
        let alive = true;

        const load = async () => {
            setLoading(true);
            setError('');

            for (const src of sources) {
                try {
                    // 加时间戳绕过浏览器 / CDN 缓存，改完立刻能看到
                    const url = new URL(src.url, window.location.href);
                    url.searchParams.set('_t', String(Date.now()));

                    const res = await fetch(url.toString(), { cache: 'no-store' });
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);

                    const data = await res.json();
                    // 格式错误才换下一个源；「筛完一条都没有」是合法结果，
                    // 要正常显示「暂无信息」，不能被当成加载失败而回退到内置旧数据。
                    const raw = data as Record<string, unknown> | unknown[];
                    const valid = Array.isArray(raw)
                        ? true
                        : (raw !== null && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).logs));
                    if (!valid) throw new Error('日志格式错误');
                    const parsed = normalizeLogs(data, scope);

                    if (!alive) return;

                    setLogs(parsed);
                    setNotice(
                        typeof (data as Record<string, unknown>)?.notice === 'string'
                            ? String((data as Record<string, unknown>).notice)
                            : ''
                    );
                    setSourceLabel(src.label);
                    setLoading(false);
                    return;
                } catch (e) {
                    if (!alive) return;
                    console.warn(`[changelog] 从「${src.label}」加载失败`, e);
                }
            }

            // 全部失败：用打包的兜底数据
            if (!alive) return;
            setLogs(bundledLogs);
            setSourceLabel('');
            setError('在线日志加载失败，当前显示的是内置版本');
            setLoading(false);
        };

        load();
        return () => {
            alive = false;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [nonce, scope]);

    return { logs, notice, sourceLabel, loading, error, reload };
}
