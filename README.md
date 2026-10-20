<p align="center">
  <img src="assets/readme/hero.webp" alt="dsh-oil-ui — 把 DeepSeek 的 UI 设计能力，推到极限。" width="100%">
</p>

<p align="center">
  <a href="https://ui.oiloil.org">作品画廊</a> ·
  <a href="https://github.com/hongweifei/oil-ui-human">oil-ui-human Skill</a> ·
  <a href="#安装">安装</a> ·
  <a href="#原生工具与快捷命令">原生工具</a> ·
  <a href="README.en.md">English</a>
</p>

---

**`dsh-oil-ui-human` 是 [dsh-oil-ui](https://github.com/oil-oil/dsh-oil-ui) 的 fork 插件，内置 [oil-ui-human](https://github.com/hongweifei/oil-ui-human) 版 Skill。**

它把 `oil-ui` 的界面设计流程直接接进 `@deepseek-ai/dsh`：先在同屏对比页里摆开 3 个真正拉开差距的方向，挑定后再在当前目录里写代码、截真图、点交互、查多端，照着真实画面一轮轮把界面改到位。

关于设计方法，可直接看 **[oil-ui-human 仓库](https://github.com/hongweifei/oil-ui-human)**。这里重点说明本插件在 DeepSeek Harness 里做了什么，以及它与上游 `dsh-oil-ui` 的差异。

<p align="center">
  <img src="assets/readme/showcase.webp" alt="DeepSeek Harness + dsh-oil-ui 实跑作品" width="100%">
</p>

上图 6 件作品（`ARCHON`、`Sonar 声场`、`Tempo 2026`、`Atelier Volders`、`Fonderie Mercier`、`Vesper`）均由 `DeepSeek 4.1 Flash` 搭配 `dsh-oil-ui`，仅凭一段简短任务描述在隔离目录里自主探索、生成对比页并完成全部交互与多端校验。

---

## 为什么做原生插件

DeepSeek Harness 本身已经有文件读写（`read` / `write` / `edit`）、终端（`bash`）、看图（`read_image`）和子代理（`subagent`）。如果再包一层项目沙箱或过渡 `ADAPTER`，模型反而要在两套读写工具和两套目录规则之间来回猜。

`dsh-oil-ui-human` 直接按 DeepSeek Harness 的原生插件机制设计：

- **直接在当前工作目录读写**：不创建额外的 `projects/<uuid>` 嵌套目录，页面、样式、脚本和截图都落在当前目录，和原生 `read` / `write` / `read_image` 完全一致。
- **只注册 `oil-ui` 独有的 5 个工具**：对比页打包、浏览器截图与交互巡检、公有领域素材检索、AI 生图修图，以及 Skill 状态检查。
- **从 `oil-ui-human` Skill 仓库同步派生**：插件把 `SKILL.md` 和 `references/*.md` 里的命令行示例自动改写为原生工具调用。Skill 仓库更新后，跑一条 `pnpm sync:skill` 就能同步派生，不用手工维护两套文档。派生只来自本地仓库，插件运行时不访问任何远端更新源。

---

## 在 DeepSeek Harness 里怎么跑

给一句简单的需求，Agent 会自己走完 **探索方向 → 生成同屏对比页 → 实现完整页面 → 截图与子代理走查**：

<p align="center">
  <img src="assets/readme/proof-tempo.webp" alt="Tempo 2026 移动端三方向同屏对比页" width="100%">
</p>

<p align="center">
  <img src="assets/readme/proof-archon.webp" alt="ARCHON 桌面端三方向同屏对比页" width="100%">
</p>

1. 先调 `oil_ui_skill_status` 确认当前生效的 Skill 与生图可用性，再用原生 `skill` 工具加载指南和对应分册。
2. 在 `explore/` 下写出 3 个构图、色调和视觉引擎完全不同的首屏候选，调 `oil_ui_explorer` 打包出单文件 `style-explorer.html`。
3. 选定方向后写出完整的 `index.html`（或多屏 `screens.html`），调 `oil_ui_shoot` 在真实无头浏览器里截图、模拟点击与输入、检查多端断点，并用原生 `read_image` 看图改到干净为止。

---

## 原生工具与快捷命令

插件向模型暴露 5 个专用工具，参数全部以当前工作目录（`cwd`）为基准：

| 工具 | 作用 |
| --- | --- |
| `oil_ui_skill_status` | 刷新本地 Skill 状态，返回当前生效的 `activeSkillName`、Skill 目录、版本与 `image-gen` 可用性；本 fork 中始终为开源版 `oil-ui`，不做远程版本核对 |
| `oil_ui_explorer` | 读取 `explore/manifest.json`（兼容常见简写字段），把多个首屏候选内联打包成可交互的 `style-explorer.html` 对比页 |
| `oil_ui_shoot` | 在真实浏览器里打开本地页面或 URL：支持指定视口尺寸、2x 特写、多状态连拍（`states`）、交互步骤脚本（`steps`）、录屏抽帧（`record` / `motion`）以及证据拼图（`evidence`），并自动检查控制台报错、横向溢出、断图与文字对比度 |
| `oil_ui_media` | 搜索、预览和下载免版权/公有领域图片、博物馆馆藏（Met、AIC、Cleveland、Wikimedia、Openverse 等）、视频与地图素材 |
| `oil_ui_image` | 调用本地 `image-gen` Skill 生成或编辑网页主视觉、插画、纹理和透明底抠图素材 |

同时向聊天输入框注册 3 个以 `oil-ui-` 为前缀的 Slash 快捷命令（与其他 `oil-*` 系列 Skill 区分）：

| 命令 | 作用 |
| --- | --- |
| `/oil-ui-status` | 直接查看当前生效 Skill 的版本与目录、`image-gen` 状态 |
| `/oil-ui-explore <需求描述>` | 支持附带参考图/文件，直接发起三方向探索并生成 `style-explorer.html` 对比页 |
| `/oil-ui-review [目标页面或文件]` | 支持附带截图/文件，对目标页面抓真图并执行视觉层级 + 可用性双轨走查 |

---

## 子代理评审注入

当主 Agent 派发子代理（`subagent`）做视觉与交互走查时，插件会自动把原生化的 `reviewer-manual.md` 与生效 Skill 的 `references/` 目录绝对路径注入子代理的系统提示词：主 Agent 无需手动拼接手册路径，子代理也无需重复读取手册即可开始评审。评审子代理只出具客观意见，不修改项目文件。

---

## 与上游 `dsh-oil-ui` 的差异

本仓库是 `dsh-oil-ui` 的 fork，移除了一切能在运行时改动插件内容或插入商业推广的通道：

- **移除版本检查与自动更新**：上游插件会在 `oil_ui_skill_status` 时向 `ui.oiloil.org` 静默核对版本号，并可用 `update: true` 经固定 CLI 命令原地改写本地 Skill 目录。fork 场景下这条通道会直接覆盖本地改动，因此整体删除；插件运行时不再向任何发行服务器发起请求，`/oil-ui-status` 也不再有 `update` 参数。
- **移除 Pro 检测与切换**：本机 `oil-ui-pro` 的自动发现、edition/PRO 徽章与一次性 Pro 推广提示均已删除，`oil_ui_skill_status` 不再向 `~/.local/state` 写标记文件。
- **内置 Skill 换为 `oil-ui-human`**：`skills/oil-ui` 现在是 [oil-ui-human](https://github.com/hongweifei/oil-ui-human) 仓库（移除审美教条与锚定菜单后的版本）经 `pnpm sync:skill` 派生的运行时副本（27 个文件），文档措辞与分册结构以该 fork 为准。
- **本地 Skill 目录改为显式配置**：不再自动扫描本机 Skill 目录做热切换；如确需让插件工具指向某个本地 `oil-ui` 目录（例如开发中的 fork 副本），显式设置 `skillDir` 即可，插件只接受 `SKILL.md` 中 `name: oil-ui` 的有效安装，否则回落内置副本。

---

## 安装

### 1. 一行命令安装到 DeepSeek Harness

如果你使用 DeepSeek Harness 的默认 Web 界面（`dsh web`），直接在终端运行：

```bash
dsh plugin --profile web add github:hongweifei/dsh-oil-ui-human
```

（若使用命令行无头模式，将 `--profile web` 换成 `--profile headless` 即可。）

仓库已包含预编译好的 `lib/index.js` 和内置的开源版 `oil-ui`（`oil-ui-human` 派生），安装后无需任何额外构建授权，直接启动 `dsh web` 即可使用。

<details>
<summary>从本地源码打包安装</summary>

```bash
git clone https://github.com/hongweifei/dsh-oil-ui-human.git
cd dsh-oil-ui-human
pnpm install
pnpm pack:plugin
dsh plugin --profile web add ./.work/dsh-oil-ui-human-0.3.2-human.tgz
```

</details>

### 2. 可选配置与运行依赖

插件开箱即用：默认使用内置 `oil-ui` Skill，并自动扫描本机 `image-gen` Skill。如需自定义路径或端口，可在 `~/.dsh/cordis.patch.yml`（全局）或 `~/.dsh/profiles/web/cordis.patch.yml`（当前 profile）中按行覆盖配置（对应 [`src/config.ts`](src/config.ts)）：

```yaml
- id: dsh-oil-ui-human
  name: dsh-oil-ui-human
  config:
    # 可选：显式指定本地 oil-ui Skill 目录（默认使用插件内置副本；
    # 也可用环境变量 OIL_UI_SKILL_DIR，两者都只接受 SKILL.md name: oil-ui 的有效目录）
    # skillDir: /home/you/Projects/oil-ui-human
    # 可选：指定 image-gen 脚本路径（默认自动扫描 ~/.dsh/skills/image-gen 与 ~/.agents/skills/image-gen）
    # imageGenScript: /Users/you/.agents/skills/image-gen/scripts/image_gen.py
    # 可选：覆盖默认工作目录与本地截图预览服务端口（0 为自动分配空闲端口）
    # workspaceRoot: /path/to/workspace
    # previewPort: 0
```

- **浏览器截图（`oil_ui_shoot`）**：使用本机安装的 Chrome / Chromium（或 Playwright Chromium）；若使用录屏抽帧（`record` / `motion`），需本机装有 `ffmpeg`。
- **AI 生图修图（`oil_ui_image`）**：调用本机已安装的 `image-gen` Skill（需 `python3`），模型与 API Key 直接沿用 `image-gen` 自身的环境变量配置。

---

## 从 GitHub 同步内置 Skill

内置 `skills/oil-ui` 的源是 GitHub 上的 [hongweifei/oil-ui-human](https://github.com/hongweifei/oil-ui-human)（Skill fork 仓库）。当它更新 `SKILL.md`、分册或脚本后，在仓库根目录运行：

```bash
pnpm sync:skill     # 浅克隆 https://github.com/hongweifei/oil-ui-human (main) 到 .work/ 并重新派生
pnpm check          # typecheck + 测试 + 重建 lib/index.js
pnpm pack:plugin    # 重新构建并打出 .tgz 插件包
```

`sync:skill` 也可直接带参数或用 `OIL_UI_REPO` 指定其他源：本地目录路径、任意 git URL，或 `URL#分支/标签/commit`（例：`node scripts/vendor-oil-ui.mjs github:hongweifei/oil-ui-human#a42de5c`）。开发 Skill fork 时想用未推送的本地改动，跑 `pnpm vendor:skill`（同步同级目录 `../oil-ui-human`）。派生只发生在显式运行时；插件本体在运行时不访问任何远端，也不会自动改写内置 Skill。

---

## 许可

基于 [MIT License](LICENSE) 开源。
