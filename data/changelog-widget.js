/* ============================================================
 * PTH 统一更新日志组件
 * ------------------------------------------------------------
 * 数据只有一份：/data/changelog.json（13 条，含全部功能）
 * 每个页面引一行脚本，用 data-scope 决定显示哪些日志：
 *   all       全部（只有导航页与蓝奏云用这个）
 *   download  只看下载站
 *   pmth      只看谱面工坊
 *   signal    只看 SIGNAL 演出工具
 * 也支持逗号组合，如 data-scope="download,pmth"。
 *
 * 一条日志若同时涉及多个页面，可用 contentByScope 给每个页面
 * 指定自己那一段正文；all 页面始终显示完整 content。
 * 这样「谱面工坊」不会连带显示下载站 / 分享卡片 / 批量下载的段落。
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

    var wanted = scope.split(',').map(function (s) { return s.trim(); }).filter(Boolean);

    /** 一条日志属于本页吗（不含正文分段的判断交给 pickContent） */
    function matchScope(log) {
        if (scope === 'all') return true;
        var own = Array.isArray(log.scope) ? log.scope
            : (log.scope ? [log.scope] : ['download']); // 兼容没有 scope 的旧日志
        return wanted.some(function (w) { return own.indexOf(w) >= 0; });
    }

    /**
     * 取本页应该显示的正文：
     * - all 页面 → 完整 content（不裁切，看到全部功能）
     * - 有 contentByScope → 只取本页那一段；本页没有对应段落就返回 null（该条不显示）
     * - 无 contentByScope → 完整 content
     */
    function pickContent(log) {
        if (scope === 'all' || !log.contentByScope || typeof log.contentByScope !== 'object') {
            return log.content;
        }
        for (var i = 0; i < wanted.length; i++) {
            var part = log.contentByScope[wanted[i]];
            if (typeof part === 'string') return part;
        }
        return null;
    }

    /** 本页可见的日志（过滤 + 取好正文） */
    function visibleLogs(data) {
        if (!data || !Array.isArray(data.logs)) return [];
        var out = [];
        data.logs.forEach(function (log) {
            if (!log || !matchScope(log)) return;
            var content = pickContent(log);
            if (content == null || String(content).trim() === '') return;
            out.push({ date: log.date, content: content });
        });
        return out;
    }

    /** 生成日志条目列表 HTML（空则「暂无信息」） */
    function listHtml(data) {
        var logs = visibleLogs(data);
        if (!logs.length) {
            return '<div class="pth-cl-empty">' + EMPTY_TEXT + '</div>';
        }
        var html = '';
        if (data && data.notice) {
            html += '<div class="pth-cl-notice">' + esc(data.notice) + '</div>';
        }
        logs.forEach(function (log, i) {
            html += '<article class="pth-cl-item' + (i === 0 ? ' is-latest' : '') + '">' +
                '<div class="pth-cl-date"><span class="pth-cl-dot"></span>' + esc(log.date || '') +
                (i === 0 ? '<span class="pth-cl-latest">最新</span>' : '') + '</div>' +
                '<div class="pth-cl-body">' + bodyHtml(log.content) + '</div>' +
                '</article>';
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
        '.pth-cl-item{position:relative;padding:0 0 20px 18px;border-left:1px solid rgba(255,255,255,.1);margin-left:5px;}',
        '.pth-cl-item:last-child{border-left-color:transparent;padding-bottom:4px;}',
        '.pth-cl-dot{position:absolute;left:-5px;top:5px;width:9px;height:9px;border-radius:50%;',
        'background:#475569;box-shadow:0 0 0 3px rgba(12,16,24,1);}',
        '.pth-cl-item.is-latest .pth-cl-dot{background:var(--pth-cl-accent);box-shadow:0 0 0 3px rgba(12,16,24,1),0 0 10px var(--pth-cl-accent);}',
        '.pth-cl-date{display:flex;align-items:center;gap:8px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;',
        'font-size:11px;font-weight:700;letter-spacing:.05em;color:#94a3b8;margin-bottom:9px;}',
        '.pth-cl-latest{font-family:inherit;font-size:10px;padding:1px 6px;border-radius:4px;',
        'background:var(--pth-cl-accent);color:#06121a;font-weight:800;letter-spacing:0;}',
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
            var n = visibleLogs(err ? null : data).length;
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
