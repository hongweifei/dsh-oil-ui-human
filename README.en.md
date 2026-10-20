<p align="center">
  <img src="assets/readme/hero.en.webp" alt="dsh-oil-ui — Push DeepSeek's UI design to its limits." width="100%">
</p>

<p align="center">
  <a href="https://ui.oiloil.org/en">Showcase Gallery</a> ·
  <a href="https://github.com/hongweifei/oil-ui-human">oil-ui-human Skill</a> ·
  <a href="#installation">Installation</a> ·
  <a href="#native-tools--slash-commands">Native Tools</a> ·
  <a href="README.md">中文文档</a>
</p>

---

**This repository is a fork of [dsh-oil-ui](https://github.com/oil-oil/dsh-oil-ui), bundling the [oil-ui-human](https://github.com/hongweifei/oil-ui-human) edition of the Skill.**

It brings the full `oil-ui` design workflow straight into DeepSeek Harness: explore 3 genuinely distinct first-screen directions side by side in a single comparison page, pick the strongest one, and refine the final interface against real browser screenshots, interactive step checks, and multi-viewport captures directly in your working directory.

For the design methodology, see the **[oil-ui-human repository](https://github.com/hongweifei/oil-ui-human)**. This README covers how the plugin works inside DeepSeek Harness and what differs from upstream.

<p align="center">
  <img src="assets/readme/showcase.en.webp" alt="Built autonomously by DeepSeek Harness + dsh-oil-ui" width="100%">
</p>

All 6 interfaces above (`ARCHON`, `Sonar`, `Tempo 2026`, `Atelier Volders`, `Fonderie Mercier`, and `Vesper`) were designed and built from scratch by `DeepSeek 4.1 Flash` + `dsh-oil-ui` in isolated workspaces from short text prompts—complete with 3-direction comparison pages, interactive states, and responsive checks.

---

## Why a Native Plugin

DeepSeek Harness already ships with native file tools (`read`, `write`, `edit`), shell execution (`bash`), image inspection (`read_image`), and subagents (`subagent`). Wrapping a separate project sandbox or an adapter layer on top forces the model to guess between duplicate file tools and nested directories.

`dsh-oil-ui` is built natively for DeepSeek Harness:

- **Works directly in `cwd`**: No hidden `projects/<uuid>` nesting. HTML, CSS, scripts, and screenshots live right in the current working directory alongside native `read`, `write`, and `read_image`.
- **Registers only the 5 specialized `oil-ui` tools**: Comparison page bundling, headless browser captures & interaction scripts, public-domain media search, AI image generation, and Skill status discovery.
- **Derived from the `oil-ui-human` Skill repository**: `SKILL.md` and `references/*.md` are automatically transformed so CLI script invocations map cleanly to native tool calls. When the Skill repo changes, a single `pnpm sync:skill` updates the plugin. Derivation only reads a local repository—the plugin never contacts a remote update source at runtime.

---

## How It Runs in DeepSeek Harness

From a short prompt, the agent runs the full loop—**explore directions → bundle comparison page → build interactive interface → verify on real screenshots**:

<p align="center">
  <img src="assets/readme/proof-archon.webp" alt="ARCHON 3-direction comparison page in DeepSeek Harness" width="100%">
</p>

<p align="center">
  <img src="assets/readme/proof-tempo.webp" alt="Tempo 2026 3-direction mobile comparison page in DeepSeek Harness" width="100%">
</p>

1. Calls `oil_ui_skill_status` to confirm the active Skill and image-generation availability, then loads the `oil-ui` Skill and reference manuals via the native `skill` tool.
2. Builds 3 distinct first-screen candidates in `explore/` and bundles them into a self-contained `style-explorer.html` via `oil_ui_explorer`.
3. Implements the chosen direction in `index.html` (and `screens.html` for multi-screen mobile flows), verifies states, interactions, and responsive viewports with `oil_ui_shoot`, and inspects every capture with `read_image`.

---

## Native Tools & Slash Commands

The plugin registers 5 tools, all resolved relative to the active session's working directory (`cwd`):

| Tool | What it does |
| --- | --- |
| `oil_ui_skill_status` | Refreshes local Skill discovery and returns the active `activeSkillName`, Skill directory, version and `image-gen` availability; in this fork the active Skill is always the open-source `oil-ui`, and no remote version check is performed |
| `oil_ui_explorer` | Reads `explore/manifest.json` (normalizing common shorthand fields) and bundles candidate HTML files into a single interactive `style-explorer.html` comparison page |
| `oil_ui_shoot` | Captures real browser screenshots of local files or URLs: supports custom viewports, 2x zoom crops, multi-state captures (`states`), scripted interactions (`steps`), motion recordings (`record` / `motion`), contact sheets (`evidence`), and built-in console/overflow/contrast checks |
| `oil_ui_media` | Searches, previews, and downloads public-domain images, museum collections (Met, AIC, Cleveland, Wikimedia, Openverse), video clips, and map tiles |
| `oil_ui_image` | Generates or edits hero visuals, illustrations, textures, and cutout assets via the locally installed `image-gen` Skill |

It also registers 3 `oil-ui-` slash commands in the composer (namespaced to avoid collisions with other `oil-*` Skills):

| Command | What it does |
| --- | --- |
| `/oil-ui-status` | Inspects the active Skill's version, directory and `image-gen` availability |
| `/oil-ui-explore <brief>` | Accepts optional reference attachments and queues a 3-direction exploration (`style-explorer.html`) |
| `/oil-ui-review [target]` | Accepts optional screenshot/file attachments and queues a two-track UI/UX review (visual hierarchy + task flow) |

---

## Subagent Review Injection

When the main agent spawns a `subagent` for visual and interaction review, the plugin automatically injects the native-transformed `reviewer-manual.md` and the absolute `references/` path of the active Skill into the subagent's system prompt—no manual path stitching, no re-reading of the manual, and the reviewer only reports objective findings without touching project files.

## Differences from Upstream `dsh-oil-ui`

This repository is a fork of `dsh-oil-ui`. Every channel that could alter the plugin's content at runtime or insert commercial promotion has been removed:

- **No version check, no self-update**: upstream silently queries `ui.oiloil.org` during `oil_ui_skill_status` and can rewrite the local Skill directory in place via `update: true` through a pinned CLI installer. For a fork that is exactly the wrong behavior—remote content would overwrite local changes—so the whole channel is deleted. The plugin no longer contacts any distribution server at runtime, and `/oil-ui-status` has no `update` argument.
- **No Pro detection or promotion**: local `oil-ui-pro` auto-discovery, the edition/PRO badge, and the one-time Pro recommendation (and its `~/.local/state` marker files) are all removed.
- **The bundled Skill is `oil-ui-human`**: `skills/oil-ui` is now a derived runtime copy (27 files) of the [oil-ui-human](https://github.com/hongweifei/oil-ui-human) repository—the variant with the aesthetic dogmas and canned menus removed—so documentation wording and manual structure follow that fork.
- **Explicit local Skill directory**: instead of auto-scanning installed Skill directories for hot-switching, set `skillDir` explicitly to point the plugin tools at a local `oil-ui` directory (e.g. a work-in-progress fork copy). Only installations whose `SKILL.md` declares `name: oil-ui` are accepted; anything else falls back to the bundled copy.

---

## Installation

### 1. One-line install into DeepSeek Harness

For the default DeepSeek Harness Web UI (`dsh web`), run:

```bash
dsh plugin --profile web add github:hongweifei/dsh-oil-ui-human
```

(For headless CLI runs, replace `--profile web` with `--profile headless`.)

Because prebuilt `lib/index.js` and the bundled `oil-ui` Skill (derived from `oil-ui-human`) are committed directly to the repository, no build allowance is required—just launch `dsh web` after installing.

<details>
<summary>Build and install from a local checkout</summary>

```bash
git clone https://github.com/hongweifei/dsh-oil-ui-human.git
cd dsh-oil-ui-human
pnpm install
pnpm pack:plugin
dsh plugin --profile web add ./.work/dsh-oil-ui-0.3.2.tgz
```

</details>

### 2. Optional configuration & runtime dependencies

The plugin works out of the box: it uses the bundled `oil-ui` Skill and auto-discovers the local `image-gen` Skill. To override paths or ports, add an entry override to `~/.dsh/cordis.patch.yml` (global) or `~/.dsh/profiles/web/cordis.patch.yml` (per-profile), matching [`src/config.ts`](src/config.ts):

```yaml
- id: dsh-oil-ui
  name: dsh-oil-ui
  config:
    # Optional: explicitly point the tools at a local oil-ui Skill directory
    # (defaults to the bundled copy; OIL_UI_SKILL_DIR works too; only directories
    # whose SKILL.md declares `name: oil-ui` are accepted)
    # skillDir: /home/you/Projects/oil-ui-human
    # Optional: custom path to image_gen.py (auto-discovered in ~/.dsh/skills/image-gen and ~/.agents/skills/image-gen)
    # imageGenScript: /Users/you/.agents/skills/image-gen/scripts/image_gen.py
    # Optional: override workspace root and local preview server port (0 = random available port)
    # workspaceRoot: /path/to/workspace
    # previewPort: 0
```

- **Browser captures (`oil_ui_shoot`)**: Uses locally installed Chrome / Chromium (or Playwright Chromium). Motion frame strips (`record` / `motion`) require `ffmpeg`.
- **AI image generation (`oil_ui_image`)**: Delegates to your local `image-gen` Skill (`python3`), using `image-gen`'s own environment variables for model and API key configuration.

---

## Syncing from the `oil-ui-human` Skill Repository

When `oil-ui-human` updates its `SKILL.md`, reference manuals, or scripts (default source: the sibling `../oil-ui-human`, overridable via `OIL_UI_REPO`):

```bash
pnpm sync:skill     # Re-derives the bundled Skill and manifest from ../oil-ui-human
pnpm check          # Typecheck + tests + rebuilds lib/index.js
pnpm pack:plugin    # Rebuilds and packs .work/dsh-oil-ui-<version>.tgz
```

Upstream's daily scheduled CI job that pulled `oil-oil/oil-ui`, re-vendored and auto-pushed has been removed: syncing only happens when you run it explicitly, so remote content can never overwrite local changes.

---

## License

Released under the [MIT License](LICENSE).
