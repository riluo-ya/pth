# SIGNAL — 站点集成说明

本目录是**第三方项目的二次开发版本**，不是 PTH 原创。

## 来源

| 项 | 内容 |
|---|---|
| 原项目 | [Lylighte/signal-replica](https://github.com/Lylighte/signal-replica) |
| 原作者 | Lylighte（贡献者：chujiamo、ZENG Alexandre Qizhi） |
| 原许可证 | MIT（见 `LICENSE-SIGNAL.md`） |
| 同步版本 | 上游 `main` 分支，最新提交 `8d2fd6d`（2026-10-29） |
| 同步范围 | 原仓库 `dist/` 目录全部内容（40 个文件） |
| 原 README | 见 `README-SIGNAL.md`（原仓库 README 副本） |

## PTH 做了哪些改动

PTH **只做站点接入，不改动演出功能本身**。上游 `dist/` 下的 JS / CSS / 素材
均为原样文件，改动只集中在 `index.html`：

1. **答题验证闸门**：`<head>` 内同步校验 `access_token`
   （时间戳 + djb2 签名，12 小时有效，算法与导航页 / 答题页 / 蓝奏云 /
   谱面工坊 / 下载站完全一致）。未通过时显示「访问受限」遮罩，提供
   「前往答题」（带 `?return_to=` 原路返回）与「返回导航中心」两个出口。

2. **闸门未通过时不加载演出引擎**：把原本的
   `<script type="module" src="studio.js">` 改为条件动态 `import()`。
   这样未验证时连 26 个依赖模块、`audio.wav` 预载和 Canvas 渲染都不会启动。

3. **顶栏「返回导航」按钮**：`header .identity` 左侧新增返回按钮，
   窄屏只显示箭头图标，样式沿用页面自身的深色描边风格。

4. **页面底部署名**：右下角固定显示原项目仓库链接 + MIT 标识。
   原先指向原仓库的 GitHub 链接保留未动。

5. **更新日志弹窗**：引入 `../data/changelog-widget.js`，
   以 `data-scope="signal"` 只显示 SIGNAL 栏的更新记录。

6. **页面标题**：改为 `SIGNAL · Phigros Tool Hub`。

## 上游同步方法

上游更新时，用原仓库 `dist/` 覆盖本目录同名文件，然后重新在 `index.html`
补上上述 6 处注入即可。JS / CSS / 素材本身不需要差异合并。

## 第三方依赖与许可证

| 组件 / 资源 | 许可证 | 位置 |
|---|---|---|
| SIGNAL Replica 项目代码 | MIT | `LICENSE-SIGNAL.md` |
| Saira 字体 | SIL Open Font License 1.1 | `assets/OFL.txt` |
| Mediabunny 1.62.0 | Mozilla Public License 2.0 | `vendor/mediabunny.js`、`vendor/MPL-2.0.txt` |
| @mediabunny/aac-encoder 1.62.0 | Mozilla Public License 2.0 | 同上 bundle |
| `assets/audio.wav` | **未提供单独授权说明** | `assets/audio.wav` |

`vendor/` 里的浏览器端封装由 `npm run build:vendor` 生成，内含 FFmpeg AAC
编码器的 WebAssembly 构建，详见 `vendor/README.md`。

⚠️ MIT 不代表自动获得仓库中所有第三方音乐、字体、图片的使用许可。
尤其是 `assets/audio.wav` 未附单独授权说明，在复制、再分发或用于公开及
商业作品前请自行确认来源与授权范围。用户自行导入的素材仍受其原有版权约束。

## 归属与免责

- 本目录代码的著作权归原作者 Lylighte 所有，依 MIT 许可证使用。
- MIT 要求保留版权声明与许可声明，上方「来源」表与 `LICENSE-SIGNAL.md`
  即为履行该义务，请勿删除。
- PTH 与 signal-replica 原作者不存在授权、合作或运营关系。
