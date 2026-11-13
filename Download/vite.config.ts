import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // 改版后主页是导航页，下载站独占 /download/ 子目录。
  // base 决定了 JS/CSS 从 /download/assets/ 加载，不会污染站点根。
  base: '/download/',
  server: {
    port: 3000,
    host: '0.0.0.0',
  },
  build: {
    // 直接产出到仓库根 dist/download/，与 copy-static.mjs 生成的
    // dist/index.html（导航页）、dist/data/ 等拼成完整站点。
    outDir: '../dist/download',
    emptyOutDir: true,
  },
});
