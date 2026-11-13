// 把仓库根的导航页、各子目录页面与统一数据目录复制进构建产物。
// Vite 已经把下载站产出到 dist/download/，本脚本补齐其余部分，
// 让本地 npm run build 得到的 dist/ 与 GitHub Pages 线上产物完全一致。
import { copyFileSync, cpSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)); // Download/
const root = resolve(here, '..');                     // 仓库根
const dist = join(root, 'dist');                      // 发布目录

mkdirSync(dist, { recursive: true });

// 站点根只有导航页与必要的元文件
const rootFiles = ['index.html', 'CNAME', 'README.md'];
for (const name of rootFiles) {
    const src = join(root, name);
    if (!existsSync(src)) {
        console.warn(`[copy-static] 跳过缺失文件：${name}`);
        continue;
    }
    copyFileSync(src, join(dist, name));
    console.log(`[copy-static] ${name}`);
}

// 每个工具一个同名子目录；data/ 集中放 changelog.json、faq.json 与三个 .data
const dirs = ['quiz', 'pmth', 'philzy', 'signal', 'jpg', 'data'];
for (const d of dirs) {
    const src = join(root, d);
    if (!existsSync(src)) {
        console.warn(`[copy-static] 跳过缺失目录：${d}/`);
        continue;
    }
    const target = join(dist, d);
    mkdirSync(target, { recursive: true });
    cpSync(src, target, { recursive: true });
    console.log(`[copy-static] ${d}/`);
}

console.log('[copy-static] 完成，产物位于仓库根 dist/');
