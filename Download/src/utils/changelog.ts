// ============================================================
// 更新日志：从外部 changelog.json 拉取并渲染
// 改完推送 changelog.json 就能更新，不用动代码重新构建
//
// 全站共用一个文件：/data/changelog.json
// {
//   "notice": "置顶公告，不需要就留空字符串或删掉",
//   "logs": [
//     {
//       "date": "2026-09-27",
//       "scope": ["download"],
//       "content": "完整正文（all 页面显示）",
//       "contentByScope": { "download": "下载站那一段", "pmth": "谱面工坊那一段" }
//     }
//   ]
// }
// scope 决定这条日志出现在哪些页面：download=下载站，pmth=谱面工坊，signal=SIGNAL。
// 导航页 / 蓝奏云读全部完整正文，其余各页只取自己那一段；
// 筛完一条都没有时页面显示「暂无信息」。没有 scope 的旧日志默认归到 download。
// content 里用 \n 换行，一行 = 一个列表项；也可以直接写 HTML，会原样渲染。
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import { updateLogs as bundledLogs, UpdateLog } from '../aboutData';

/** 部署基础路径（Vite 的 base，默认 '/'） */
function getBaseUrl(): string {
    try {
        const env = (import.meta as unknown as { env?: Record<string, string> }).env;
        if (env && typeof env.BASE_URL === 'string' && env.BASE_URL) return env.BASE_URL;
    } catch (e) {
        /* 忽略 */
    }
    return '/';
}

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
export const DEFAULT_CHANGELOG_SOURCES: ChangelogSource[] = [
    { url: `/data/changelog.json`, label: '本站' },
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
    content?: string;
    scope?: string[] | string;
    /** 一条日志涉及多个页面时，各页面只显示自己那一段 */
    contentByScope?: Record<string, string>;
}

/** 这条日志是否属于当前页面；scope='all' 时不过滤 */
function matchScope(log: RawLog, scope: string): boolean {
    if (scope === 'all') return true;
    const own = Array.isArray(log.scope)
        ? log.scope
        : (log.scope ? [log.scope] : ['download']);
    return scope.split(',').map(s => s.trim()).some(w => own.indexOf(w) >= 0);
}

/** 取本页正文：all 看全文；有分段时只取本页那一段，没有对应段落则该条不显示 */
function pickContent(log: RawLog, scope: string): string | null {
    if (scope === 'all' || !log.contentByScope || typeof log.contentByScope !== 'object') {
        return typeof log.content === 'string' ? log.content : null;
    }
    for (const w of scope.split(',').map(s => s.trim())) {
        const part = log.contentByScope[w];
        if (typeof part === 'string') return part;
    }
    return null;
}

/** 兼容写法：{ logs: [...] } 或直接是数组 [...]，并按当前页面筛选 */
export function normalizeLogs(data: unknown, scope = 'all'): UpdateLog[] {
    if (!data) return [];

    let arr: unknown;
    if (Array.isArray(data)) {
        arr = data;
    } else if (typeof data === 'object') {
        arr = (data as Record<string, unknown>).logs;
    } else {
        return [];
    }

    if (!Array.isArray(arr)) return [];

    return (arr as RawLog[])
        .filter(log => log && typeof log === 'object' && matchScope(log, scope))
        .map((log): UpdateLog | null => {
            const raw = pickContent(log, scope);
            if (raw == null) return null;
            const content = renderContent(raw);
            if (!content) return null;
            return { date: log.date ? String(log.date) : '', content };
        })
        .filter((x): x is UpdateLog => x !== null);
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
