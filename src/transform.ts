import { chmod, copyFile, lstat, mkdir, readFile, readdir, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';

export const TRANSFORM_VERSION = '4';

const EXCLUDED_NAMES = new Set(['.git', '.DS_Store', '__pycache__']);
const DOC_ONLY_PATHS = new Set(['assets/readme', 'README.en.md']);

const NATIVE_TOOL_COMMANDS_SECTION = `### 常用调用方式（\`oil_ui_shoot\`）

\`oil_ui_shoot\` 对工作目录内的本地 HTML 文件（包括子目录如 \`explore/a.html\`）会自动通过工作区根目录的本地 HTTP 服务打开，\`assets/...\`、\`../assets/...\` 与 \`?state=...\` 地址参数都能直接解析，无需自己起静态服务器。

| 要什么 | \`oil_ui_shoot\` 参数 |
| --- | --- |
| 看一眼桌面效果 | \`{ "target": "index.html", "size": "desktop", "out": "shots/desktop.png" }\`（不传 \`size\` 默认 \`1440x900\`；支持 \`desktop\`、\`mobile\`、\`1440x900,390x844\`；只看整体版式可加 \`"thumb": true\`） |
| 一次截完多个候选并出并排图 | \`{ "target": "explore", "size": "desktop", "thumb": true, "out": "shots/explore" }\`（也可传 \`["explore/a.html", "explore/b.html", "explore/c.html"]\`，同一次浏览器会话截完并自动出 \`sheet.png\`） |
| 只看改过的局部组件或区域 | \`{ "target": "index.html", "size": "desktop", "selector": ".card", "out": "shots/card.png" }\`（自动滚入视口并只截该元素区域） |
| 操作几步再截 | \`{ "target": "index.html", "size": "desktop", "steps": "click .open; wait 300", "out": "shots/open.png" }\` |
| 按地址参数切多状态连拍 | \`{ "target": "index.html", "size": "desktop", "states": ["idle", "done"], "out": "shots" }\`（状态参数名默认 \`state\`，可用 \`param\` 修改；额外查询串用 \`query: "a=1&b=2"\`） |
| 送评审或交付前取证 | \`{ "target": "index.html", "size": "desktop", "evidence": true, "states": ["idle", "done"], "steps": ["send: click .send"], "out": "evidence" }\` |
| 2 倍高清截图（@2x） | \`{ "target": "index.html", "size": "desktop", "zoom": 2, "out": "shots/desktop-2x.png" }\`（或 \`zoom: "1,2"\`） |
| 落地页录一段从头滚到底 | \`{ "target": "index.html", "size": "desktop", "record": true, "steps": "scroll 600; scroll 600; scroll 600", "out": "evidence" }\` |
| 截图还原：和参考图比对 | \`{ "target": "index.html", "size": "1440x900", "compare": "refs/target.png", "out": "shots/compare.png" }\` |
| 给元素画框、标编号 | \`{ "target": "index.html", "size": "desktop", "mark": "1=.page-head .btn; 2=.toggle-row", "fullPage": true, "out": "shots/marked.png" }\` |
| 看清一段过渡序列帧 | \`{ "target": "index.html", "size": "desktop", "record": true, "frames": 8, "steps": "click .open", "out": "evidence" }\` |
| 把几张图拼成一张对比图 | \`{ "stitch": [{ "path": "shots/a.png", "label": "修改前" }, { "path": "shots/b.png", "label": "修改后" }], "out": "shots/stitch.png" }\` |

状态靠地址参数进入，所以页面要能用 \`?state=<名字>\` 直接打开每个状态。\`steps\` 动作写法（分号分隔）：\`click <选择器>\`、\`hover <选择器>\`、\`dblclick <选择器>\`、\`waitfor <选择器>\`、\`drag <选择器> <dx> <dy>\`、\`type <选择器> <文字>\`、\`fill <选择器> <文字>\`、\`select <选择器> <值>\`、\`key <按键>\`、\`scroll <dy>\`、\`wait <毫秒>\`。

### 检索和下载真实素材

需要真实材质贴图、设计器物、历史摄影、工程测绘图、古地图、科学版画或 NASA 视频时，调用 \`oil_ui_media\`：

- **一步检索并下载（默认）**：
  \`oil_ui_media({ "query": "oak planks | belgian oak", "kind": "photo", "limit": 6, "use": "page", "dir": "assets/media", "sheet": true })\`
- **分步检索 / 预览 / 按编号拉取**：
  1. 搜索并生成候选联系表：\`oil_ui_media({ "action": "search", "query": "wood", "kind": "texture", "limit": 6, "sheet": true, "dir": "candidates" })\`
  2. 用 \`read_image\` 查看返回的联系表 PNG，挑选编号后拉取：\`oil_ui_media({ "action": "fetch", "refs": ["C1", "T2"], "dir": "assets", "sheet": true })\`
  3. 拉取完整 PBR 贴图（Diffuse / Roughness / Normal）：\`oil_ui_media({ "action": "fetch", "refs": ["T2"], "maps": "all", "resolution": "1k", "dir": "assets" })\`

\`kind\` 支持 \`all|texture|design|photo|blueprint|map|plate|science|video\`。每项 \`use\` 说明用途：\`page\` 可放进页面（CC BY/BY-SA 要署名），\`reference\` 只可下载到不上线的目录作为生图参考。单个 URL 下载可用 \`oil_ui_media({ "action": "fetch", "refs": "https://example.org/image.jpg", "out": "assets/image.jpg" })\`；单文件下载不传 \`dir\`，输出路径不可覆盖已有文件。所有成功下载自动记入 \`SOURCES.md\`。

### 生图与改图（\`oil_ui_image\`）

当 \`oil_ui_skill_status\` 显示 \`imageGenAvailable: true\` 时，调用 \`oil_ui_image\` 生成或编辑图片：

- **文生图（\`mode: "generate"\`）**：\`oil_ui_image({ "prompt": "...", "out": "assets/hero.png", "size": "1536x1024", "quality": "high" })\`
- **透明底抠图（\`background: "transparent"\`）**：\`oil_ui_image({ "prompt": "...", "background": "transparent", "out": "assets/cutout.png" })\`
- **基于参考图的图生图 / 同模多材质变体（\`mode: "edit"\`）**：传入 1–16 张本地参考图（如先生成原色器物，再派生烟熏、绿锈等表面，保持角度与光影一致）：\`oil_ui_image({ "mode": "edit", "images": ["assets/raw.png"], "prompt": "...", "out": "assets/variant.png" })\`

### 组装风格对比页（\`oil_ui_explorer\`）

写好三个候选首屏（如 \`explore/a.html\`、\`explore/b.html\`、\`explore/c.html\`）后，调用 \`oil_ui_explorer({ "manifest": "explore/manifest.json", "out": "style-explorer.html" })\` 即可生成内嵌全部本地资源的独立对比页。`;

const COMPATIBILITY_LINE =
  'compatibility: "通过 oil_ui_shoot、oil_ui_media、oil_ui_image、oil_ui_explorer、oil_ui_skill_status 与 read_image、subagent 完成截图取证、真实素材检索、AI 生图修图、对比页组装和独立视觉评审。"';

const METHOD_SECTION = `## 方法体系

相关工作方法与评审协议均位于本目录之下；截图、素材、生图与对比页能力由插件工具 \`oil_ui_shoot\`、\`oil_ui_media\`、\`oil_ui_image\`、\`oil_ui_explorer\` 与 \`oil_ui_skill_status\` 提供，工具用法详见 [工具指南](references/tools.md)，无需为此单独加载其他 Skill，也不需要执行本目录内的脚本。先调用 \`oil_ui_skill_status\` 确认生图工具可用状态（\`imageGenAvailable\`）与 Skill 目录。前端实现方案应遵循项目既有的技术规范与约定，若宿主环境或项目规范明确要求加载特定 Skill，则按规范要求执行。相对路径引用均从本文件所在目录开始计算。`;

const TOOLS_INTRO = '# 工具指南\n\n所有路径相对于当前工作目录解析。查看图片用 `read_image`，派发独立视觉评审用 `subagent`。截图、素材检索、生图与对比页组装均通过插件提供的 `oil_ui_shoot`、`oil_ui_media`、`oil_ui_image`、`oil_ui_explorer` 工具完成，不需要执行本目录内的脚本。';

const EXPLORER_GENERATE = `## 生成与打开\n\n调用 \`oil_ui_explorer\` 生成对比页：\n\n\`\`\`json\n{\n  "manifest": "explore/manifest.json",\n  "out": "style-explorer.html"\n}\n\`\`\`\n\n\`manifest\` 可传 \`manifest.json\` 的相对路径，也可直接传 JSON 对象；不传时工具会自动查找工作目录下的 \`manifest.json\` 或 \`explore/a.html\`、\`b.html\`、\`c.html\`。对比页默认生成在工作目录根部的 \`style-explorer.html\`，并返回预览地址 \`explorerUrl\`。输入有误时，工具会一次性列出全部需要修正之处，按提示修改后重新调用。组装失败时，将 manifest 和候选留给用户直接查看，说明对比页尚未组装完成，不临时另写一套工具。`;

export interface MarkdownRule {
  id: string;
  file: string;
  match: RegExp;
  replacement: string;
  /**
   * Rewrites that must apply to the fork's own documentation. An unmatched required
   * rule means the source wording drifted and the derived tree would keep CLI text,
   * so vendoring must fail instead of shipping a half-transformed Skill.
   */
  required: boolean;
  optionalReason?: string;
  /** Deletions/replacements cannot be detected by searching for the replacement text. */
  alreadyApplied?: (markdown: string) => boolean;
}

// Rules run in declaration order. Only compatibility fallbacks may be optional;
// upstream wording changes must be fixed in the rule, not silenced by making it optional.
export const MARKDOWN_RULES: readonly MarkdownRule[] = [
  {
    id: 'skill.remove-allowed-tools', file: 'SKILL.md', required: false,
    optionalReason: 'The fork frontmatter no longer carries allowed-tools; kept for custom or minimal sources.',
    match: /\r?\nallowed-tools:\r?\n(?:\s+-\s+[^\r\n]+\r?\n)+/,
    replacement: '\n',
    alreadyApplied: markdown => !/^allowed-tools:/m.test(markdown),
  },
  {
    id: 'skill.compatibility', file: 'SKILL.md', required: true,
    match: /compatibility:\s*"[^"]*"/,
    replacement: COMPATIBILITY_LINE,
  },
  {
    id: 'skill.method', file: 'SKILL.md', required: true,
    match: /## 方法体系\r?\n\r?\n[\s\S]*?(?=\r?\n## 范围界定)/,
    replacement: METHOD_SECTION,
  },
  {
    id: 'skill.compare', file: 'SKILL.md', required: true,
    match: /使用截图工具的 `--compare` 参数/g,
    replacement: '使用 `oil_ui_shoot` 的 `compare` 参数',
  },
  {
    id: 'skill.compare-short', file: 'SKILL.md', required: false,
    optionalReason: 'Consumed by skill.compare when the longer "使用截图工具的" phrasing is present.',
    match: /截图工具的 `--compare` 参数/g,
    replacement: '`oil_ui_shoot` 的 `compare` 参数',
  },
  {
    id: 'skill.evidence', file: 'SKILL.md', required: true,
    match: /一条 `--evidence` 命令即可输出/g,
    replacement: '一次 `oil_ui_shoot`（`evidence: true`）调用即可输出',
  },
  {
    id: 'skill.evidence-alt', file: 'SKILL.md', required: false,
    optionalReason: 'Compatibility with trees that still carry the older “就能出齐” phrasing.',
    match: /一条 `--evidence` 命令就能出齐/g,
    replacement: '调用 `oil_ui_shoot`（`evidence: true`）就能出齐',
  },
  {
    id: 'skill.fallback-shoot', file: 'SKILL.md', required: false,
    optionalReason: 'Fallback for standalone script mentions in custom or minimal SKILL.md files.',
    match: /`scripts\/shoot\.mjs`/g,
    replacement: '`oil_ui_shoot`',
  },
  {
    id: 'skill.fallback-media', file: 'SKILL.md', required: false,
    optionalReason: 'Fallback for standalone script mentions in custom or minimal SKILL.md files.',
    match: /`scripts\/curate-media\.mjs`/g,
    replacement: '`oil_ui_media`',
  },
  {
    id: 'skill.fallback-explorer', file: 'SKILL.md', required: false,
    optionalReason: 'Fallback for standalone script mentions in custom or minimal SKILL.md files.',
    match: /`scripts\/build_explorer\.py`/g,
    replacement: '`oil_ui_explorer`',
  },
  {
    id: 'tools.intro', file: 'references/tools.md', required: true,
    match: /^# 工具指南\r?\n\r?\n[\s\S]*?(?=\r?\n## 截图和录屏)/,
    replacement: TOOLS_INTRO,
  },
  {
    id: 'tools.native-commands', file: 'references/tools.md', required: true,
    match: /### (?:常用命令|常用调用方式（`oil_ui_shoot`）)\r?\n\r?\n[\s\S]*?(?=\r?\n### 查看结果)/,
    replacement: NATIVE_TOOL_COMMANDS_SECTION,
  },
  {
    id: 'tools.evidence', file: 'references/tools.md', required: true,
    match: /使用 `--evidence` 一次取齐/g,
    replacement: '用 `oil_ui_shoot`（`evidence: true`）一次取齐',
  },
  {
    id: 'tools.evidence-alt', file: 'references/tools.md', required: false,
    optionalReason: 'Compatibility with trees that still use the “用 --evidence” phrasing.',
    match: /用 `--evidence` 一次取齐/g,
    replacement: '用 `oil_ui_shoot`（`evidence: true`）一次取齐',
  },
  {
    id: 'tools.single-shot', file: 'references/tools.md', required: true,
    match: /一条命令/g,
    replacement: '一次 `oil_ui_shoot` 调用',
  },
  {
    id: 'tools.dom-hints', file: 'references/tools.md', required: true,
    match: /命令输出中以"可读性提示"列出/g,
    replacement: '以 `oil_ui_shoot` 返回的 `domHints` 与输出中的"可读性提示"列出',
  },
  {
    id: 'tools.fallback-shoot', file: 'references/tools.md', required: false,
    optionalReason: 'Fallback for inline CLI mentions outside the commands section.',
    match: /`node\s+[^\r\n`]*shoot\.mjs[^\r\n`]*`/g,
    replacement: '`oil_ui_shoot`',
  },
  {
    id: 'tools.fallback-media', file: 'references/tools.md', required: false,
    optionalReason: 'Fallback for inline CLI mentions outside the commands section.',
    match: /`node\s+[^\r\n`]*curate-media\.mjs[^\r\n`]*`/g,
    replacement: '`oil_ui_media`',
  },
  {
    id: 'explorer.parameter-help', file: 'references/style-explorer.md', required: true,
    match: /每个字段的写法与限制见生成器的 `--help`。/g,
    replacement: '字段与限制以 `oil_ui_explorer` 的参数说明及本页 manifest 示例为准。',
  },
  {
    id: 'explorer.generate', file: 'references/style-explorer.md', required: true,
    match: /## 生成与打开\r?\n\r?\n```text\r?\npython3 <skill>\/scripts\/build_explorer\.py <manifest 所在目录>\/manifest\.json\r?\n```\r?\n\r?\n[^\r\n]+/,
    replacement: EXPLORER_GENERATE,
  },
  {
    id: 'explorer.shoot', file: 'references/style-explorer.md', required: true,
    match: /`node <skill>\/scripts\/shoot\.mjs <manifest 所在目录> --size desktop --thumb --out shots\/explore`/g,
    replacement: '`oil_ui_shoot({ "target": "explore", "size": "desktop", "thumb": true, "out": "shots/explore" })`',
  },
  {
    id: 'media.sheet', file: 'references/media.md', required: true,
    match: /`--sheet`/g,
    replacement: '`oil_ui_media` 的 `sheet: true`',
  },
  {
    id: 'media.curate', file: 'references/media.md', required: true,
    match: /`curate-media\.mjs` 从 Poly Haven/g,
    replacement: '`oil_ui_media` 从 Poly Haven',
  },
  {
    id: 'media.image', file: 'references/media.md', required: true,
    match: /遵循宿主生成工具自身的输入与编辑规则。/g,
    replacement: '需要生成或编辑图片时用 `oil_ui_image`（支持 `mode: "generate"` 文生图、`mode: "edit"` 传入 1–16 张本地参考图做同模多材质变体、以及 `background: "transparent"` 透明底抠图）。',
  },
  {
    id: 'layout.compare', file: 'references/layout-and-viewport.md', required: true,
    match: /使用截图工具的 `--compare` 参数/g,
    replacement: '使用 `oil_ui_shoot` 的 `compare` 参数',
  },
  {
    id: 'layout.compare-short', file: 'references/layout-and-viewport.md', required: false,
    optionalReason: 'Consumed by layout.compare when the longer "使用截图工具的" phrasing is present.',
    match: /截图工具的 `--compare` 参数/g,
    replacement: '`oil_ui_shoot` 的 `compare` 参数',
  },
  {
    id: 'review.new-interface', file: 'references/visual-review.md', required: true,
    match: /请读取 references\/reviewer-manual\.md，按照【全新界面与改版评审】标准/g,
    replacement: '按照你系统提示词中已内置的《视觉与交互评审手册》【全新界面与改版评审】标准',
  },
  {
    id: 'review.existing-interface', file: 'references/visual-review.md', required: true,
    match: /请读取 references\/reviewer-manual\.md，按照【存量已有界面润色评审】标准/g,
    replacement: '按照你系统提示词中已内置的《视觉与交互评审手册》【存量已有界面润色评审】标准',
  },
  {
    id: 'review.dispatch', file: 'references/visual-review.md', required: true,
    match: /模板中的路径应替换为本 Skill 目录下的绝对路径：子代理的工作目录不是本目录。/g,
    replacement: '子代理启动时已由插件自动将《视觉与交互评审手册》（`references/reviewer-manual.md`）注入其系统提示词，主 Agent 只需调用 `subagent` 传入下方交接清单与对应模式指令，无需附带手册路径，也无需让子代理再次读取手册。',
  },
  {
    id: 'reviewer.thumbnail', file: 'references/reviewer-manual.md', required: true,
    match: /可以使用截图工具生成缩略图与遮字图辅助判断。/g,
    replacement: '能用 `oil_ui_shoot` 时，用它出缩略图（保持原始桌面或手机视口截图，再按原比例缩放到 480px 或 180px 宽，不能改成窄视口重新截图）和遮字图（`mask: true`），并用 `read_image` 查看截图。',
  },
  {
    id: 'reviewer.legacy-thumbnail', file: 'references/reviewer-manual.md', required: false,
    optionalReason: 'Compatibility with previously compiled manuals that used the older thumbnail sentence.',
    match: /能用截图工具时，用它出缩略图和遮字图。/g,
    replacement: '能用 `oil_ui_shoot` 时，用它出缩略图（保持桌面或手机的原始视口截图，再按原比例缩放到 480px 或 180px 宽，不能改成窄视口重新截图）和遮字图（`mask: true`），并用 `read_image` 查看截图。',
  },
  {
    id: 'reviewer.play-link', file: 'references/reviewer-manual.md', required: true,
    match: /\[游玩\]\(play\.md\)/g,
    replacement: '[游玩](references/play.md)',
  },
];

export interface RuleResult {
  id: string;
  file: string;
  required: boolean;
  matches: number;
  status: 'matched' | 'already-transformed' | 'unmatched';
}

export class SkillTransformError extends Error {
  readonly unmatchedRules: RuleResult[];

  constructor(unmatchedRules: RuleResult[]) {
    super(`Required Skill rewrite rules did not match:\n${unmatchedRules.map(rule => `- ${rule.id} (${rule.file})`).join('\n')}`);
    this.name = 'SkillTransformError';
    this.unmatchedRules = unmatchedRules;
  }
}

function assertRequiredRules(results: RuleResult[]): void {
  const missing = results.filter(rule => rule.required && rule.status === 'unmatched');
  if (missing.length) throw new SkillTransformError(missing);
}

/**
 * @param alreadyTransformed Evidence is taken from the input, never from text an earlier
 * rule inserted, so an already-native tree reports `already-transformed` rather than `matched`.
 */
export function transformSkillMarkdown(
  relativePath: string,
  raw: string,
  options: { mode?: 'strict' | 'lenient'; native?: boolean } = {},
): { markdown: string; rules: RuleResult[] } {
  const file = relativePath.split(/[/\\]/).join('/');
  const evidence = raw.split('\r\n').join('\n');
  const results: RuleResult[] = [];
  let markdown = raw;
  for (const rule of MARKDOWN_RULES) {
    if (rule.file !== file) continue;
    let matches = 0;
    const alreadyApplied = options.native === true && (rule.alreadyApplied
      ? rule.alreadyApplied(evidence)
      : evidence.includes(rule.replacement));
    markdown = markdown.replace(new RegExp(rule.match.source, rule.match.flags), () => {
      matches++;
      return rule.replacement;
    });
    results.push({ id: rule.id, file, required: rule.required, matches,
      status: matches ? 'matched' : alreadyApplied ? 'already-transformed' : 'unmatched' });
  }
  if (options.mode === 'strict') assertRequiredRules(results);
  return { markdown, rules: results };
}

/**
 * Check every rule file, including files absent from the fork distribution, and aggregate
 * failures before publishing so vendoring reports all drift at once.
 */
export async function validateSkillTree(sourceRoot: string, options: { mode?: 'strict' | 'lenient' } = {}) {
  const realSource = await realpath(sourceRoot);
  const results: RuleResult[] = [];
  const readMarkdown = async (file: string): Promise<string> => {
    try {
      const actual = await realpath(join(realSource, ...file.split('/')));
      const rel = relative(realSource, actual);
      if (rel === '..' || rel.startsWith(`..${sep}`)) throw new Error(`Skill entry escapes root: ${file}`);
      return await readFile(actual, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
      throw error;
    }
  };
  const skill = await readMarkdown('SKILL.md');
  if (!/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.test(skill)) throw new Error('Expected oil-ui SKILL.md frontmatter.');
  const native = isHarnessNativeSkillMarkdown(skill);
  for (const file of new Set(MARKDOWN_RULES.map(rule => rule.file))) {
    const raw = file === 'SKILL.md' ? skill : await readMarkdown(file);
    results.push(...transformSkillMarkdown(file, raw, { native }).rules);
  }
  if (options.mode === 'strict') assertRequiredRules(results);
  return { rules: results, unmatchedRules: results.filter(rule => rule.required && rule.status === 'unmatched') };
}

export function isHarnessNativeSkillMarkdown(raw: string): boolean {
  return raw.includes('oil_ui_skill_status');
}

export async function compileHarnessSkillTree(
  sourceRoot: string,
  targetRoot: string,
  options: { symlinkBinaryAssets?: boolean; mode?: 'strict' | 'lenient' } = {},
): Promise<void> {
  const realSource = await realpath(sourceRoot);
  // Validate the whole tree up front: a wording drift must fail before anything is published.
  const report = await validateSkillTree(realSource, { mode: options.mode });
  const native = isHarnessNativeSkillMarkdown(await readFile(join(realSource, 'SKILL.md'), 'utf8').catch(() => ''));
  await rm(targetRoot, { recursive: true, force: true });
  await mkdir(targetRoot, { recursive: true });

  async function walk(currentSource: string, relDir = ''): Promise<void> {
    const entries = await readdir(currentSource, { withFileTypes: true });
    for (const entry of entries) {
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (EXCLUDED_NAMES.has(entry.name) || DOC_ONLY_PATHS.has(relPath)) continue;
      if (!entry.isDirectory() && entry.name.endsWith('.pyc')) continue;

      const srcPath = await realpath(join(currentSource, entry.name));
      const relFromRoot = relative(realSource, srcPath);
      if (relFromRoot === '..' || relFromRoot.startsWith(`..${sep}`)) {
        throw new Error(`Skill entry escapes root: ${relPath}`);
      }
      const info = await stat(srcPath);
      const dstPath = join(targetRoot, ...relPath.split('/'));

      if (info.isDirectory()) {
        if (options.symlinkBinaryAssets && (relPath === 'assets' || relPath === 'scripts')) {
          await mkdir(dirname(dstPath), { recursive: true });
          await symlink(srcPath, dstPath, process.platform === 'win32' ? 'junction' : 'dir');
          continue;
        }
        await mkdir(dstPath, { recursive: true });
        await walk(srcPath, relPath);
        continue;
      }

      if (!info.isFile()) continue;
      await mkdir(dirname(dstPath), { recursive: true });
      if (entry.name.endsWith('.md')) {
        const raw = await readFile(srcPath, 'utf8');
        const transformed = transformSkillMarkdown(relPath, raw, { mode: options.mode, native });
        await writeFile(dstPath, transformed.markdown, 'utf8');
        await chmod(dstPath, info.mode & 0o777);
      } else {
        await copyFile(srcPath, dstPath);
        await chmod(dstPath, info.mode & 0o777);
      }
    }
  }

  await walk(realSource);
  // Ensure .gitignore is present if source had one
  const srcIgnore = join(realSource, '.gitignore');
  const hasIgnore = await lstat(srcIgnore).then(i => i.isFile(), () => false);
  if (hasIgnore) {
    const dstIgnore = join(targetRoot, '.gitignore');
    await copyFile(srcIgnore, dstIgnore);
  }
  void report;
}