import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { lstat, readFile, readdir, realpath, mkdtemp, mkdir, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { loadUpstreamSkill, skillDirectory, skillStatus, resolveActiveSkill, resolveImageGenScript, createSkillProvider, loadReviewerManual } from '../src/upstream.ts';
import { TRANSFORM_VERSION, isHarnessNativeSkillMarkdown } from '../src/transform.ts';
import { createHash } from 'node:crypto';
import { join, relative, sep } from 'node:path';

const fixture = vi.hoisted(() => ({ home: '' }));
vi.mock('node:os', async original => ({ ...(await original<typeof import('node:os')>()), homedir: () => fixture.home }));

let root: string;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'oil-upstream-')));
  fixture.home = root;
  vi.stubEnv('DSH_HOME', join(root, '.dsh'));
  vi.stubEnv('DSH_AGENTS_HOME', '');
  vi.stubEnv('OIL_UI_SKILL_DIR', '');
  vi.stubEnv('OIL_UI_IMAGE_GEN_SCRIPT', '');
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});

async function localSkill(path: string, name = 'oil-ui', rawBody = 'Local instructions\n') {
  await mkdir(path, { recursive: true });
  await writeFile(
    join(path, 'SKILL.md'),
    `---\nname: ${name}\ndescription: Local Skill\nmetadata:\n  version: '9.8.7'\n---\n${rawBody}`,
  );
  return path;
}

describe('bundled open-source Skill registration', () => {
  it('registers the compiled native Harness open-source body and resource directory', async () => {
    const manifest = JSON.parse(await readFile(join(skillDirectory, '../oil-ui.manifest.json'), 'utf8'));
    const registered = await loadUpstreamSkill();
    const raw = await readFile(join(skillDirectory, 'SKILL.md'), 'utf8');
    expect(isHarnessNativeSkillMarkdown(raw)).toBe(true);
    expect(raw).not.toContain('check_update');
    expect(raw).not.toContain('oil-ui-pro');
    expect(raw).toContain('oil_ui_shoot');
    expect(raw).toContain('方法体系');
    expect(registered.content).toBe(raw.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, ''));
    expect(registered.name).toBe('oil-ui');
    expect(registered.metadata?.version).toBe(manifest.version);
    expect(registered.resourceBase).toEqual({ kind: 'directory', path: skillDirectory });
    expect(registered.invocation).toEqual({ modelInvocable: true, userInvocable: true });

    const toolsMd = await readFile(join(skillDirectory, 'references/tools.md'), 'utf8');
    expect(toolsMd).toContain('oil_ui_shoot');
    expect(toolsMd).not.toContain('node scripts/shoot.mjs');
  });

  it('bundles[27] public files with matching offline manifest evidence and no Pro tree', async () => {
    const manifest = JSON.parse(await readFile(join(skillDirectory, '../oil-ui.manifest.json'), 'utf8'));
    expect(manifest.name).toBe('oil-ui');
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.fileCount).toBe(27);
    const walk = async (directory: string): Promise<string[]> => {
      const paths: string[] = [];
      for (const row of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, row.name);
        const info = await lstat(path);
        expect(info.isSymbolicLink()).toBe(false);
        if (info.isDirectory()) paths.push(...(await walk(path)));
        else paths.push(relative(skillDirectory, path).split(sep).join('/'));
      }
      return paths;
    };
    expect((await walk(skillDirectory)).sort()).toEqual(manifest.files.map((f: { path: string }) => f.path).sort());
    expect(manifest.files).toHaveLength(27);
    for (const file of manifest.files) {
      expect(file.path).not.toMatch(/^(references\/(direction-concept|direction-workspace|direction-persuasion|review-modes|play-craft|cards)\.md|assets\/cards(?:\/|$)|scripts\/(check_update|recommend_once))/);
      const bytes = await readFile(join(skillDirectory, file.path));
      const info = await lstat(join(skillDirectory, file.path));
      expect(bytes.length).toBe(file.size);
      expect(`0${(info.mode & 0o777).toString(8).padStart(3, '0')}`).toBe(file.mode);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
    }
    expect((await readdir(join(skillDirectory, '..'))).sort()).toEqual(['oil-ui', 'oil-ui.manifest.json']);
  });

  it('reports bundled status without update channels or Pro recommendations', async () => {
    const manifest = JSON.parse(await readFile(join(skillDirectory, '../oil-ui.manifest.json'), 'utf8'));
    const status = await skillStatus(null);
    expect(status).toMatchObject({
      activeSkillName: 'oil-ui',
      name: 'oil-ui',
      bundledVersion: manifest.version,
      activeResourceBase: skillDirectory,
      fileCount: 27,
      visibleMatchesOriginal: true,
    });
    expect(status.path).toBe(join(skillDirectory, 'SKILL.md'));
    expect(status.note).toContain('No hash gate is enforced during loading or execution.');
    expect(status).not.toHaveProperty('edition');
    expect(status).not.toHaveProperty('updateAvailable');
    expect(status).not.toHaveProperty('recommendOnceNotice');
    expect(status).not.toHaveProperty('upgradeHint');
    expect(status).not.toHaveProperty('proInstalled');
  });

  it('keeps native docs free of CLI remnants and describes thumbnail scaling without narrowing the viewport', async () => {
    const manual = await readFile(join(skillDirectory, 'references/reviewer-manual.md'), 'utf8');
    expect(manual).not.toContain('size: "480x300"');
    expect(manual).toMatch(/原比例缩放到 480px 或 180px/);
    for (const [file, flag] of [['layout-and-viewport', '--compare'], ['media', '--sheet'], ['style-explorer', '--help']]) {
      expect(await readFile(join(skillDirectory, `references/${file}.md`), 'utf8')).not.toContain(flag);
    }
    const tools = await readFile(join(skillDirectory, 'references/tools.md'), 'utf8');
    expect(tools).toContain('默认 `1440x900`');
    expect(tools).toContain('https://example.org/image.jpg');
    const skill = await readFile(join(skillDirectory, 'SKILL.md'), 'utf8');
    expect(skill).not.toContain('--evidence');
    expect(skill).not.toContain('完整版');
    expect(TRANSFORM_VERSION.length).toBeGreaterThan(0);
  });
});

describe('explicit local Skill directory override', () => {
  it('activates a configured local oil-ui installation and reports its version', async () => {
    const rawBody = '用 `scripts/shoot.mjs` 截图\n';
    const dir = await localSkill(join(root, 'explicit'), 'oil-ui', rawBody);
    const options = { skillDir: ` ${dir} ` };
    const resolved = await resolveActiveSkill(options);
    expect(resolved).toMatchObject({ name: 'oil-ui', directory: dir, source: 'local-skill' });
    const registration = await loadUpstreamSkill(options);
    expect(registration.resourceBase).toEqual({ kind: 'directory', path: dir });
    expect(registration.content).toContain('oil_ui_shoot');
    expect(registration.content).not.toContain('scripts/shoot.mjs');
    const status = await skillStatus(
      { ...registration, invocation: registration.invocation!, source: registration.source!, provider: 'test' },
      options,
    );
    expect(status).toMatchObject({ activeSkillName: 'oil-ui', activeVersion: '9.8.7', activeResourceBase: dir });
    expect(status.visibleMatchesOriginal).toBe(true);
  });

  it('honors the environment override', async () => {
    const dir = await localSkill(join(root, 'env'));
    vi.stubEnv('OIL_UI_SKILL_DIR', dir);
    expect((await resolveActiveSkill()).directory).toBe(dir);
    expect((await resolveActiveSkill()).source).toBe('local-skill');
  });

  it('ignores wrong identity, malformed YAML and SKILL.md symlink escapes, falling back to bundled', async () => {
    const invalid = await localSkill(join(root, 'invalid'), 'other');
    expect((await resolveActiveSkill({ skillDir: invalid })).source).toBe('bundled');
    await writeFile(join(invalid, 'SKILL.md'), '---\nname: [invalid\n---\n');
    expect((await resolveActiveSkill({ skillDir: invalid })).source).toBe('bundled');
    const valid = await localSkill(join(root, 'valid'));
    await rm(join(invalid, 'SKILL.md'));
    await symlink(join(valid, 'SKILL.md'), join(invalid, 'SKILL.md'));
    expect((await resolveActiveSkill({ skillDir: invalid })).source).toBe('bundled');
    expect((await resolveActiveSkill({ skillDir: join(root, 'missing') })).source).toBe('bundled');
  });
});

async function imageScript(path: string) {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, '# local image script');
  return path;
}
describe('local image-gen discovery', () => {
  it('reports missing image-gen and discovers configured/env scripts without caching', async () => {
    expect(await resolveImageGenScript()).toBe(null);
    expect(await skillStatus(null)).toMatchObject({ imageGenAvailable: false, imageGenScriptPath: null });
    const env = await imageScript(join(root, 'env/image_gen.py'));
    vi.stubEnv('OIL_UI_IMAGE_GEN_SCRIPT', env);
    expect(await resolveImageGenScript()).toBe(env);
    const explicit = await imageScript(join(root, 'explicit/mock.py'));
    expect(await resolveImageGenScript({ imageGenScript: ' ' + explicit + ' ' })).toBe(explicit);
    expect(await skillStatus(null, { imageGenScript: explicit })).toMatchObject({
      imageGenAvailable: true,
      imageGenScriptPath: explicit,
    });
  });

  it('strictly follows DeepSeek Harness image-gen skill roots and ignores non-DSH hosts', async () => {
    for (const nonDshHost of ['.cursor', '.claude', '.codex']) {
      await imageScript(join(root, nonDshHost, 'skills/image-gen/scripts/image_gen.py'));
      expect(await resolveImageGenScript()).toBeNull();
    }
    const projectDir = join(root, 'workspace');
    for (const dir of [
      join(root, '.agents/skills/image-gen/scripts/image_gen.py'),
      join(root, '.dsh/skills/image-gen/scripts/image_gen.py'),
      join(projectDir, '.agents/skills/image-gen/scripts/image_gen.py'),
      join(projectDir, '.dsh/skills/image-gen/scripts/image_gen.py'),
    ]) {
      const path = await imageScript(dir);
      expect(await resolveImageGenScript({ cwd: projectDir })).toBe(path);
    }
  });

  it('ignores directories and rejects escaping script symlinks', async () => {
    const escaped = await imageScript(join(root, 'outside/mock.py'));
    const target = join(root, '.dsh/skills/image-gen/scripts/image_gen.py');
    await mkdir(join(target, '..'), { recursive: true });
    await symlink(escaped, target);
    expect(await resolveImageGenScript()).toBe(null);
    const explicit = join(root, 'links/mock.py');
    await mkdir(join(explicit, '..'), { recursive: true });
    await symlink(escaped, explicit);
    expect(await resolveImageGenScript({ imageGenScript: explicit })).toBe(null);
    expect(await resolveImageGenScript({ imageGenScript: root })).toBe(null);
  });
});

describe('discovery snapshots and provider arbitration', () => {
  it('discovers project roots from a nested cwd under a Git directory or worktree file', async () => {
    const project = join(root, 'project');
    const nested = join(project, 'src/deep');
    await mkdir(nested, { recursive: true });
    await writeFile(join(project, '.git'), 'gitdir: /not-needed-for-discovery');
    const script = await imageScript(join(project, '.dsh/skills/image-gen/scripts/image_gen.py'));
    expect(await resolveImageGenScript({ cwd: nested })).toBe(script);
  });

  it('lists the bundled Skill without caching, reuses headers, and refreshes on fingerprint change', async () => {
    const dir = await localSkill(join(root, 'raw-skill'));
    await mkdir(join(dir, 'references'));
    await writeFile(join(dir, 'references/tools.md'), '# 工具指南\nnode scripts/shoot.mjs <target>');
    const provider = createSkillProvider({ skillDir: dir }, { signal: new AbortController().signal, invalidate: vi.fn() });
    const first = (await provider.list({}))[0]!;
    expect(first).toMatchObject({ name: 'oil-ui', rank: 20, source: 'local-skill' });
    const snapshot = (await provider.refresh()).snapshot;
    expect((await provider.refresh()).snapshot.header).toBe(snapshot.header);
    expect((await provider.refresh()).changed).toBe(false);
    const loaded = await provider.get(first, {});
    expect(loaded?.resourceBase).toEqual(first.resourceBase);
    await writeFile(join(dir, 'SKILL.md'), '---\nname: oil-ui\ndescription: Changed\n---\nNew');
    expect((await provider.refresh()).changed).toBe(true);
    expect(await provider.get(first, {})).toBeUndefined();
  });

  it('flags an external scope override that is not the active installation', async () => {
    const dir = await localSkill(join(root, 'override'));
    const bundled = await loadUpstreamSkill();
    const visible = { ...bundled, provider: 'scope-override', invocation: bundled.invocation! };
    const status = await skillStatus(visible, { skillDir: dir });
    expect(status.detected).toMatchObject({ name: 'oil-ui', version: '9.8.7' });
    expect(status.effective).toMatchObject({ name: 'oil-ui', provider: 'scope-override' });
    expect(status.activeSkillName).toBe('oil-ui');
    expect(status.visibleMatchesOriginal).toBe(false);
  });
});

describe('reviewer manual loading', () => {
  it('loads the active Skill manual, refreshes on change and falls back to bundled', async () => {
    const dir = await localSkill(join(root, 'manual'));
    await mkdir(join(dir, 'references'));
    expect(await loadReviewerManual({ skillDir: dir })).toContain('# 视觉与交互评审手册（子代理专用）');
    await writeFile(join(dir, 'references', 'reviewer-manual.md'), '# Version one');
    expect(await loadReviewerManual({ skillDir: dir })).toBe('# Version one');
    await writeFile(join(dir, 'references', 'reviewer-manual.md'), '# Version two');
    expect(await loadReviewerManual({ skillDir: dir })).toBe('# Version two');
  });
});
