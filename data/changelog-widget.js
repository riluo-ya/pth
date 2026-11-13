/* ============================================================
 * PTH 统一更新日志组件
 * ------------------------------------------------------------
 * 数据只有一份：/data/changelog.json
 * 数据结构：logs[] 里每个元素 = 一天，字段 date + pages。
 *   pages 里按栏目分栏：{ download, pmth, signal, other }
 *   download/pmth/signal 对应三个子页面；other 是「其他 / 站点级」更新
 *   （导航页改版、域名更替、目录调整等不属于某个子页面的内容）。
 *   想填哪个就填哪个，没填的就是空的。
 *   all 页面（导航页 / 蓝奏云）显示一天里所有非空分栏并各自标注栏目名；
 *   其余页面只取自己那一栏（other 没有对应子页，只在全部视图出现）。
 *
 * 引一行脚本的页面用 data-scope 决定显示哪些日志：
 *   all       全部（导航页与蓝奏云）
 *   pmth      只看谱面工坊
 *   signal    只看 SIGNAL 演出工具
 * 也支持逗号组合，如 data-scope="download,pmth"。
 *
 * 下载站（/download/）不引本组件：它顶栏的「关于」弹窗里已内置
 * download 分类的更新日志（Download/src/utils/changelog.ts）。
 * 答题页同样不引。
 *
 * 兼容：早期平铺格式（date/scope/content）与 contentByScope 分段格式仍可读取，
 * 会自动归并成「一天 + 分栏」，避免线上还缓存着旧 JSON 时显示异常。
 *
 * data-variant:
 *   dock    右下角浮动按钮 + 居中弹窗（默认）
 *   inline  直接渲染进 #pth-changelog-inline（导航页底部常驻区块）
 *
 * 筛完之后一条都没有、或数据加载失败 → 显示「暂无信息」。
 * ============================================================ */
(function () {
    'use strict';

    var tag = document.currentScript;
    if (!tag) return;

    var scope = (tag.getAttribute('data-scope') || 'all').toLowerCase();
    var variant = tag.getAttribute('data-variant') || 'dock';
    var accent = tag.getAttribute('data-accent') || '#22d3ee';
    // 线上走本站 /data/；本地 dev server 或 CDN 缓存异常时依次回退。
    var DATA_SOURCES = [
        '/data/changelog.json',
        'https://cdn.jsdelivr.net/gh/riluo-ya/pth@main/data/changelog.json',
        'https://gcore.jsdelivr.net/gh/riluo-ya/pth@main/data/changelog.json',
        'https://raw.githubusercontent.com/riluo-ya/pth/main/data/changelog.json'
    ];
    var EMPTY_TEXT = '暂无信息';

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    /** 日志正文：换行分段，「- 」开头的行合并成列表 */
    function bodyHtml(text) {
        var lines = String(text || '').split(/\r?\n/)
            .map(function (l) { return l.trim(); })
            .filter(function (l) { return l.length > 0; });
        if (!lines.length) return '';
        var html = '', inList = false;
        lines.forEach(function (line) {
            if (line.indexOf('- ') === 0) {
                if (!inList) { html += '<ul class="pth-cl-ul">'; inList = true; }
                html += '<li>' + esc(line.slice(2)) + '</li>';
            } else {
                if (inList) { html += '</ul>'; inList = false; }
                html += '<p class="pth-cl-p">' + esc(line) + '</p>';
            }
        });
        if (inList) html += '</ul>';
        return html;
    }

    var PAGES = [
        { id: 'download', name: '下载站' },
        { id: 'pmth',     name: '谱面工坊' },
        { id: 'signal',   name: 'SIGNAL' },
        { id: 'other',    name: '其他' }
    ];
    var wanted = scope.split(',').map(function (s) { return s.trim(); }).filter(Boolean);

    /**
     * 把「一天」归一成 { date, sections: [{ id, name, content }] }。
     * 新格式看 pages；没填的键（缺失或空串）就是空的，不生成 section。
     * 旧格式（平铺 content+scope / contentByScope）也能读，自动归并进分栏。
     */
    function normalizeDay(log) {
        if (!log || typeof log !== 'object') return null;
        var date = log.date ? String(log.date) : '';
        var sections = [];

        var pages = (log.pages && typeof log.pages === 'object' && !Array.isArray(log.pages))
            ? log.pages : null;
        if (pages) {
            PAGES.forEach(function (p) {
                var c = pages[p.id];
                if (typeof c === 'string' && c.trim()) {
                    sections.push({ id: p.id, name: p.name, content: c });
                }
            });
            return { date: date, sections: sections };
        }

        // —— 兼容旧格式 ——
        var own = Array.isArray(log.scope) ? log.scope
            : (log.scope ? [log.scope] : ['download']);
        var parts = (log.contentByScope && typeof log.contentByScope === 'object')
            ? log.contentByScope : null;
        var anyPart = parts && PAGES.some(function (p) {
            return typeof parts[p.id] === 'string' && parts[p.id].trim();
        });
        PAGES.forEach(function (p) {
            if (own.indexOf(p.id) < 0) return;
            var c;
            if (anyPart) {
                c = (typeof parts[p.id] === 'string' && parts[p.id].trim())
                    ? parts[p.id] : log.content;
            } else {
                c = log.content;
            }
            if (typeof c === 'string' && c.trim()) {
                sections.push({ id: p.id, name: p.name, content: c });
            }
        });
        // 旧格式若完全没写 scope，兜底归到 download
        if (!sections.length && typeof log.content === 'string' && log.content.trim()) {
            sections.push({ id: 'download', name: '下载站', content: log.content });
        }
        return { date: date, sections: sections };
    }

    /** 本页可见的「天」；自己那栏没填 → 这一整天不出现 */
    function visibleDays(data) {
        if (!data || !Array.isArray(data.logs)) return [];
        var out = [];
        data.logs.forEach(function (log) {
            var day = normalizeDay(log);
            if (!day) return;
            var sections = (scope === 'all')
                ? day.sections
                : day.sections.filter(function (s) { return wanted.indexOf(s.id) >= 0; });
            if (!sections.length) return;
            out.push({ date: day.date, sections: sections });
        });
        return out;
    }

    /** 生成日志列表 HTML（空则「暂无信息」） */
    function listHtml(data) {
        var days = visibleDays(data);
        if (!days.length) {
            return '<div class="pth-cl-empty">' + EMPTY_TEXT + '</div>';
        }
        var html = '';
        if (data && data.notice) {
            html += '<div class="pth-cl-notice">' + esc(data.notice) + '</div>';
        }
        days.forEach(function (day, gi) {
            html += '<section class="pth-cl-group' + (gi === 0 ? ' is-latest' : '') + '">' +
                '<div class="pth-cl-date"><span class="pth-cl-dot"></span>' + esc(day.date) +
                (gi === 0 ? '<span class="pth-cl-latest">最新</span>' : '') +
                (day.sections.length > 1
                    ? '<span class="pth-cl-count">' + day.sections.length + ' 个页面</span>' : '') +
                '</div>';
            day.sections.forEach(function (s) {
                html += '<article class="pth-cl-entry">' +
                    '<div class="pth-cl-tags"><span class="pth-cl-tag' +
                    (s.id === 'other' ? ' is-other' : '') + '">' + esc(s.name) + '</span></div>' +
                    '<div class="pth-cl-body">' + bodyHtml(s.content) + '</div>' +
                    '</article>';
            });
            html += '</section>';
        });
        return html;
    }

    var css = [
        '.pth-cl-root{--pth-cl-accent:', accent, ';font-family:system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;}',
        /* 浮动按钮 */
        '.pth-cl-btn{position:fixed;right:20px;bottom:20px;z-index:10000;display:inline-flex;align-items:center;gap:8px;',
        'padding:10px 15px;border-radius:999px;border:1px solid rgba(255,255,255,.14);',
        'background:rgba(15,20,30,.92);color:#e2e8f0;font-size:13px;font-weight:600;cursor:pointer;',
        'box-shadow:0 8px 28px rgba(0,0,0,.38);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);',
        'transition:transform .18s ease,border-color .18s ease;}',
        '.pth-cl-btn:hover{transform:translateY(-2px);border-color:var(--pth-cl-accent);}',
        '.pth-cl-btn svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;}',
        '.pth-cl-badge{min-width:19px;height:19px;padding:0 5px;border-radius:999px;display:inline-flex;align-items:center;',
        'justify-content:center;background:var(--pth-cl-accent);color:#06121a;font-size:11px;font-weight:800;}',
        /* 居中弹窗：遮罩层负责铺满并居中，卡片定宽定高 */
        '.pth-cl-overlay{position:fixed;inset:0;z-index:10001;display:flex;align-items:center;justify-content:center;',
        'padding:20px;background:rgba(2,5,10,.72);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);',
        'opacity:0;visibility:hidden;pointer-events:none;transition:opacity .2s ease,visibility .2s ease;}',
        '.pth-cl-overlay.is-open{opacity:1;visibility:visible;pointer-events:auto;}',
        '.pth-cl-modal{width:min(560px,100%);max-height:min(78vh,760px);display:flex;flex-direction:column;',
        'border-radius:16px;overflow:hidden;background:rgba(12,16,24,.98);',
        'border:1px solid rgba(255,255,255,.12);box-shadow:0 28px 80px rgba(0,0,0,.65),0 0 0 1px rgba(255,255,255,.03) inset;',
        'transform:translateY(12px) scale(.97);opacity:0;transition:transform .24s cubic-bezier(.22,1,.36,1),opacity .2s ease;}',
        '.pth-cl-overlay.is-open .pth-cl-modal{transform:translateY(0) scale(1);opacity:1;}',
        '.pth-cl-head{flex:none;display:flex;align-items:center;justify-content:space-between;gap:12px;',
        'padding:18px 22px;border-bottom:1px solid rgba(255,255,255,.08);',
        'background:linear-gradient(180deg,rgba(255,255,255,.035),transparent);}',
        '.pth-cl-title{font-size:15px;font-weight:700;color:#f1f5f9;letter-spacing:.02em;}',
        '.pth-cl-sub{font-size:11px;color:#64748b;margin-top:3px;}',
        '.pth-cl-close{flex:none;width:30px;height:30px;border-radius:8px;border:1px solid rgba(255,255,255,.12);',
        'background:transparent;color:#94a3b8;cursor:pointer;font-size:17px;line-height:1;}',
        '.pth-cl-close:hover{color:#fff;border-color:var(--pth-cl-accent);}',
        '.pth-cl-scroll{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;',
        'padding:20px 22px calc(24px + env(safe-area-inset-bottom,0px));}',
        '.pth-cl-notice{margin-bottom:18px;padding:11px 13px;border-radius:9px;font-size:12px;line-height:1.6;',
        'color:#cbd5e1;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.09);}',
        /* 日期分组：一个日期标题下可挂多条独立更新 */
        '.pth-cl-group{position:relative;padding:0 0 22px 18px;border-left:1px solid rgba(255,255,255,.1);margin-left:5px;}',
        '.pth-cl-group:last-child{border-left-color:transparent;padding-bottom:4px;}',
        '.pth-cl-dot{position:absolute;left:-5px;top:5px;width:9px;height:9px;border-radius:50%;',
        'background:#475569;box-shadow:0 0 0 3px rgba(12,16,24,1);}',
        '.pth-cl-group.is-latest .pth-cl-dot{background:var(--pth-cl-accent);box-shadow:0 0 0 3px rgba(12,16,24,1),0 0 10px var(--pth-cl-accent);}',
        '.pth-cl-date{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;',
        'font-size:11px;font-weight:700;letter-spacing:.05em;color:#94a3b8;margin-bottom:10px;}',
        '.pth-cl-latest{font-family:inherit;font-size:10px;padding:1px 6px;border-radius:4px;',
        'background:var(--pth-cl-accent);color:#06121a;font-weight:800;letter-spacing:0;}',
        '.pth-cl-count{font-family:inherit;font-size:10px;padding:1px 7px;border-radius:99px;',
        'color:#94a3b8;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);}',
        '.pth-cl-entry{background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.07);',
        'border-radius:9px;padding:10px 12px;margin-bottom:8px;}',
        '.pth-cl-entry:last-child{margin-bottom:0;}',
        '.pth-cl-tags{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:7px;}',
        '.pth-cl-tag{font-size:10px;font-weight:700;padding:1px 7px;border-radius:99px;line-height:1.5;',
        'color:var(--pth-cl-accent);background:rgba(34,211,238,.10);border:1px solid rgba(34,211,238,.28);}',
        '.pth-cl-tag.is-all{color:#fbbf24;background:rgba(251,191,36,.10);border-color:rgba(251,191,36,.30);}',
        '.pth-cl-tag.is-other{color:#c4b5fd;background:rgba(167,139,250,.12);border-color:rgba(167,139,250,.32);}',
        '.pth-cl-body{font-size:12.5px;line-height:1.75;color:#cbd5e1;}',
        '.pth-cl-p{margin:0 0 4px;}',
        '.pth-cl-p:first-child{color:#f1f5f9;font-weight:600;}',
        '.pth-cl-ul{margin:3px 0 10px;padding-left:17px;list-style:disc;}',
        '.pth-cl-ul li{margin:2px 0;color:#94a3b8;}',
        '.pth-cl-empty{padding:48px 12px;text-align:center;color:#64748b;font-size:13px;}',
        '.pth-cl-err{padding:10px 0;color:#fbbf24;font-size:11px;}',
        /* inline 变体：导航页底部的常驻区块 */
        '.pth-cl-inline{max-width:960px;margin:36px auto 0;padding:24px 22px;border-radius:14px;',
        'background:rgba(15,20,30,.55);border:1px solid rgba(255,255,255,.08);}',
        '.pth-cl-inline .pth-cl-head{padding:0 0 14px;border-bottom:none;background:none;}',
        '.pth-cl-inline .pth-cl-inline-list{max-height:340px;overflow-y:auto;padding:2px 4px 4px;}',
        '@media(max-width:640px){',
        '.pth-cl-btn{right:14px;bottom:14px;padding:9px 13px;font-size:12px;}',
        '.pth-cl-overlay{padding:12px;}',
        '.pth-cl-modal{max-height:82vh;border-radius:14px;}',
        '.pth-cl-head{padding:15px 17px;}',
        '.pth-cl-scroll{padding:16px 17px calc(20px + env(safe-area-inset-bottom,0px));}',
        '.pth-cl-inline{margin:24px 14px 0;padding:18px 15px;}}'
    ].join('');

    // 兼容旧调用名（返回天数视图）
    function visibleLogs(data) { return visibleDays(data); }

    function injectStyle() {
        if (document.getElementById('pth-cl-style')) return;
        var s = document.createElement('style');
        s.id = 'pth-cl-style';
        // data-bottom 让带底部操作栏的页面把按钮抬高，避免遮挡
        var bottom = tag.getAttribute('data-bottom');
        var extra = bottom ? '.pth-cl-btn{bottom:' + bottom + '!important;}' : '';
        s.textContent = css + extra;
        document.head.appendChild(s);
    }

    var ICON = '<svg viewBox="0 0 24 24"><path d="M12 8v4l3 2"/><circle cx="12" cy="12" r="9"/></svg>';
    var scopeLabel = {
        all: '全站更新',
        download: '下载站更新',
        pmth: '谱面工坊更新',
        signal: 'SIGNAL 更新',
        philzy: '蓝奏云更新'
    };

    function buildDock() {
        var root = document.createElement('div');
        root.className = 'pth-cl-root';
        root.innerHTML =
            '<button class="pth-cl-btn" type="button" aria-label="查看更新日志">' + ICON +
            '<span>更新日志</span><span class="pth-cl-badge" data-count>…</span></button>' +
            '<div class="pth-cl-overlay">' +
            '<div class="pth-cl-modal" role="dialog" aria-modal="true" aria-label="更新日志">' +
            '<div class="pth-cl-head"><div><div class="pth-cl-title">更新日志</div>' +
            '<div class="pth-cl-sub">' + esc(scopeLabel[scope] || '本页更新') + ' · 数据来源 changelog.json</div></div>' +
            '<button class="pth-cl-close" type="button" aria-label="关闭">×</button></div>' +
            '<div class="pth-cl-scroll"><div class="pth-cl-empty">加载中…</div></div>' +
            '</div></div>';
        document.body.appendChild(root);

        var btn = root.querySelector('.pth-cl-btn');
        var overlay = root.querySelector('.pth-cl-overlay');
        var close = root.querySelector('.pth-cl-close');
        var scroll = root.querySelector('.pth-cl-scroll');
        var badge = root.querySelector('[data-count]');
        var savedOverflow = '';

        function open() {
            savedOverflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
            overlay.classList.add('is-open');
            btn.setAttribute('aria-expanded', 'true');
            close.focus();
        }
        function shut() {
            overlay.classList.remove('is-open');
            document.body.style.overflow = savedOverflow;
            btn.setAttribute('aria-expanded', 'false');
        }
        btn.addEventListener('click', open);
        // 点遮罩空白处关闭，点卡片内部不关
        overlay.addEventListener('click', function (e) { if (e.target === overlay) shut(); });
        close.addEventListener('click', shut);
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && overlay.classList.contains('is-open')) shut();
        });

        return function render(data, err) {
            var n = visibleDays(err ? null : data).length;
            badge.textContent = String(n);
            scroll.innerHTML = listHtml(err ? null : data) +
                (err ? '<div class="pth-cl-err">在线数据暂不可用，可稍后刷新重试。</div>' : '');
        };
    }

    function buildInline() {
        var host = document.getElementById('pth-changelog-inline');
        if (!host) return buildDock(); // 容器不存在时退化为浮动按钮，保证不会完全不显示
        host.className = 'pth-cl-root pth-cl-inline';
        host.innerHTML =
            '<div class="pth-cl-head"><div><div class="pth-cl-title">站点更新日志</div>' +
            '<div class="pth-cl-sub">全站记录 · 数据来源 changelog.json</div></div></div>' +
            '<div class="pth-cl-inline-list"><div class="pth-cl-empty">加载中…</div></div>';
        var box = host.querySelector('.pth-cl-inline-list');
        return function render(data, err) {
            box.innerHTML = listHtml(err ? null : data) +
                (err ? '<div class="pth-cl-err">在线数据暂不可用，可稍后刷新重试。</div>' : '');
        };
    }

    injectStyle();
    var render = variant === 'inline' ? buildInline() : buildDock();

    function loadNext(i) {
        if (i >= DATA_SOURCES.length) {
            console.warn('[changelog] 全部数据源均不可用');
            render(null, true);   // 空态统一显示「暂无信息」
            return;
        }
        fetch(DATA_SOURCES[i] + '?_t=' + Date.now(), { cache: 'no-store' })
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (data) {
                if (!data || !Array.isArray(data.logs)) throw new Error('日志格式错误');
                render(data, false);
            })
            .catch(function () { loadNext(i + 1); });
    }
    loadNext(0);
})();
