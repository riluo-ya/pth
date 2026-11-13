// 本地预览「整个站点」而不是只预览 Vite 产物。
// 下载站在 /download/，导航页在 /，数据统一在 /data/，
// 用 vite preview 会因为 base=/download/ 看不到根目录的导航页，故用这个零依赖小服务。
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', 'dist');
const port = Number(process.env.PORT || 4173);

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ogg': 'audio/ogg',
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.data': 'application/octet-stream',
    '.txt': 'text/plain; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
};

createServer(async (req, res) => {
    try {
        let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
        if (pathname.endsWith('/')) pathname += 'index.html';
        const target = resolve(root, '.' + pathname);
        // 防目录穿越
        if (target !== root && !target.startsWith(root + sep)) {
            res.writeHead(403).end('Forbidden');
            return;
        }
        const info = await stat(target);
        if (info.isDirectory()) {
            res.writeHead(302, { Location: pathname + '/' }).end();
            return;
        }
        const body = await readFile(target);
        res.writeHead(200, {
            'Content-Type': MIME[extname(target).toLowerCase()] || 'application/octet-stream',
            'Cache-Control': 'no-store',
        });
        res.end(body);
    } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 Not Found');
    }
}).listen(port, '0.0.0.0', () => {
    console.log(`整站预览：http://localhost:${port}/  （导航页）`);
    console.log(`           http://localhost:${port}/download/  （下载站）`);
    console.log(`服务目录：${root}`);
});
