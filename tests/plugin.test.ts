import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools';
import SkillRegistry, { type SkillRegistration, type SkillProvider } from '@deepseek-ai/dsh-skill';
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt';
import { apply } from '../src/index.ts';

const localHome = vi.hoisted(() => ({ path: '' }));
vi.mock('node:os', async original => {
  const os = await original<typeof import('node:os')>();
  return { ...os, homedir: () => localHome.path || os.homedir() };
});

beforeEach(() => { vi.stubEnv('OIL_UI_SKILL_DIR', ''); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('presents all five tools with native call views and declares explorer/image deliverable paths', async () => {
  const tools = new Map<string, ToolDefinition>();
  const disposers: (() => void | Promise<void>)[] = [];
  const ctx = {
    effect(fn: () => () => void | Promise<void>) { disposers.push(fn()); },
    inject(services: string[], fn: (value: unknown) => unknown) {
      if (services.includes('tools')) fn(ctx);
    },
    tools: { register(tool: ToolDefinition) { tools.set(tool.name, tool); } },
  };
  try {
    apply(ctx as unknown as Context, { previewPort: 0 });
    expect(tools.size).toBe(5);
    for (const tool of tools.values()) expect(tool.presentCall).toBeTypeOf('function');
    const present = (name: string, args: Record<string, unknown> = {}) => tools.get(name)!.presentCall!(args);

    // Generic edit locations are the host's producedPaths contract for deliverable links.
    expect(present('oil_ui_explorer')).toEqual({
      card: 'generic', title: '生成风格对比页', kind: 'edit', locations: [{ path: 'style-explorer.html' }],
    });
    expect(present('oil_ui_explorer', { out: 'review/comparison.html' })).toMatchObject({
      card: 'generic', kind: 'edit', locations: [{ path: 'review/comparison.html' }],
    });
    expect(present('oil_ui_image', { prompt: 'A ceramic vase' })).toEqual({
      card: 'generic', title: '生成图片', kind: 'edit', locations: [{ path: 'assets/generated.png' }],
    });
    expect(present('oil_ui_image', { prompt: 'Change the color', images: ['assets/source.png'], out: 'assets/variant.webp' })).toEqual({
      card: 'generic', title: '编辑图片', kind: 'edit', locations: [{ path: 'assets/variant.webp' }],
    });
    expect(present('oil_ui_image', { prompt: 'Generate', mode: 'generate', images: ['source.png'] })?.title).toBe('生成图片');
    expect(present('oil_ui_shoot')).toEqual({
      card: 'generic', title: '截图与交互取证', kind: 'execute', locations: [{ path: 'index.html' }],
    });
    expect(present('oil_ui_shoot', { target: 'explore/a.html', out: 'shots/a.png' })).toMatchObject({
      card: 'generic', kind: 'execute', locations: [{ path: 'explore/a.html' }, { path: 'shots/a.png' }],
    });
    expect(present('oil_ui_media', { query: 'wood' })).toEqual({
      card: 'generic', title: '搜索并下载素材', kind: 'fetch', locations: [{ path: 'assets/media' }],
    });
    expect(present('oil_ui_media', { action: 'search', query: 'wood', dir: 'candidates' })).toEqual({
      card: 'generic', title: '搜索素材', kind: 'search', locations: [{ path: 'candidates' }],
    });
    expect(present('oil_ui_media', { action: 'preview', refs: ['T1'], out: 'shots/candidates.png' })).toEqual({
      card: 'generic', title: '预览素材候选', kind: 'read', locations: [{ path: 'shots/candidates.png' }],
    });
    expect(present('oil_ui_media', { refs: ['T1'], dir: 'assets', out: 'assets/wood.jpg' })).toEqual({
      card: 'generic', title: '下载素材', kind: 'fetch', locations: [{ path: 'assets/wood.jpg' }],
    });
    expect(present('oil_ui_skill_status')).toEqual({ card: 'generic', title: '查看 Oil UI Skill 状态', kind: 'read' });

    // Replay may contain malformed/older arguments; defineTool must degrade safely.
    expect(present('oil_ui_explorer', { out: 123 })).toBeUndefined();
    expect(present('oil_ui_image', {})).toBeUndefined();
  } finally {
    await Promise.all(disposers.map(dispose => dispose()));
  }
});

it('registers 5 native Harness tools, validates their schemas and operates directly in session cwd', async () => {
  const root = await mkdtemp(join(tmpdir(), 'oil-plugin-'));
  const tools = new Map<string, ToolDefinition>();
  const commands = new Map<string, { name: string; handler: (inv: unknown) => Promise<{ kind: string; text?: string }> | { kind: string; text?: string } }>();
  const pending: Promise<unknown>[] = [];
  const disposers: (() => void | Promise<void>)[] = [];
  let registration: SkillRegistration | undefined;
  let prompt = '';
  const ctx = {
    effect(fn: () => () => void | Promise<void>) {
      disposers.push(fn());
    },
    inject(_services: string[], fn: (ctx: unknown) => unknown) {
      pending.push(Promise.resolve(fn(ctx)));
    },
    tools: {
      register(tool: ToolDefinition) {
        tools.set(tool.name, tool);
      },
    },
    commands: {
      register(cmd: { name: string; handler: (inv: unknown) => Promise<{ kind: string; text?: string }> | { kind: string; text?: string } }) {
        commands.set(cmd.name, cmd);
        return () => {
          commands.delete(cmd.name);
        };
      },
    },
    skills: {
      register(skill: SkillRegistration) {
        registration = skill;
      },
      get: async () => registration,
    },
    systemPrompt: {
      section(section: { text: string }) {
        prompt = section.text;
      },
    },
  };
  const followupMessages: unknown[] = [];
  const exec = {
    agent: {
      session: { id: 'alice', header: { cwd: root } },
      followup(msg: unknown) {
        followupMessages.push(msg);
      },
    },
    signal: new AbortController().signal,
  } as unknown as ToolRunContext;
  const run = async (name: string, args: Record<string, unknown>) => tools.get(name)!.execute(args, exec);
  try {
    apply(ctx as unknown as Context, { previewPort: 0 });
    await Promise.all(pending);
    expect([...tools.keys()].sort()).toEqual(
      ['oil_ui_explorer', 'oil_ui_image', 'oil_ui_media', 'oil_ui_shoot', 'oil_ui_skill_status'].sort(),
    );
    expect([...commands.keys()].sort()).toEqual(['oil-ui-explore', 'oil-ui-review', 'oil-ui-status']);
    const statusCmd = await commands.get('oil-ui-status')!.handler({
      agent: exec.agent,
      rawInput: '',
      attachments: [],
      signal: exec.signal,
    });
    expect(statusCmd).toMatchObject({ kind: 'success' });
    expect(statusCmd.text).toContain('当前生效 Skill：oil-ui v');
    expect(statusCmd.text).not.toContain('oil-ui-pro');
    expect((await commands.get('oil-ui-status')!.handler({ agent: exec.agent, rawInput: ' update', attachments: [], signal: exec.signal }))).toMatchObject({ kind: 'error' });
    const exploreCmd = await commands.get('oil-ui-explore')!.handler({
      agent: exec.agent,
      rawInput: ' Hero landing page',
      attachments: [],
      signal: exec.signal,
    });
    expect(exploreCmd).toMatchObject({ kind: 'success' });
    expect(followupMessages).toHaveLength(1);
    expect(registration?.name).toBe('oil-ui');
    expect(prompt).toContain('call oil_ui_skill_status first');
    expect(prompt).toContain('oil_ui_shoot');
    expect(prompt).not.toContain('oil-ui-pro');
    expect(prompt).not.toContain('ADAPTER.md');
    expect(prompt).not.toContain('shoot.mjs');
    expect(await run('oil_ui_skill_status', {})).toMatchObject({
      activeSkillName: 'oil-ui',
      name: 'oil-ui',
      visibleMatchesOriginal: true,
    });
    expect(tools.get('oil_ui_skill_status')!.isConcurrencySafe?.({})).toBe(true);
    expect(tools.get('oil_ui_media')!.isConcurrencySafe?.({ action: 'search', query: 'ceramic' })).toBe(true);
    expect(tools.get('oil_ui_media')!.isConcurrencySafe?.({ action: 'search', query: 'ceramic', out: 'res.json' })).toBe(
      false,
    );
    expect(tools.get('oil_ui_media')!.isConcurrencySafe?.({ action: 'fetch', refs: '1,2' })).toBe(false);
    for (const name of ['oil_ui_explorer', 'oil_ui_shoot', 'oil_ui_image']) {
      expect(tools.get(name)!.isConcurrencySafe?.({}) ?? false).toBe(false);
    }

    for (const tool of tools.values()) {
      for (const field of Object.values(tool.parameters.properties ?? {})) {
        expect(field.description).toMatch(/[\u4e00-\u9fff]/);
      }
    }
    for (const [name, args] of [
      ['oil_ui_shoot', { states: { invalid: true } }],
      ['oil_ui_shoot', { stitch: [{ label: 'missing path' }] }],
      ['oil_ui_shoot', { record: {} }],
      ['oil_ui_media', { refs: [1] }],
      ['oil_ui_media', { maps: false }],
      ['oil_ui_explorer', { manifest: [] }],
    ] as const) await expect(run(name, args)).rejects.toThrow();

    await expect(run('oil_ui_image', {})).rejects.toThrow();
    await expect(run('oil_ui_image', { prompt: '' })).rejects.toThrow('prompt');

    await mkdir(join(root, 'explore'), { recursive: true });
    for (const direction of ['a', 'b', 'c']) {
      await writeFile(join(root, `explore/${direction}.html`), `<title>${direction}</title>`);
    }
    expect(await run('oil_ui_explorer', { title: 'Native explorer', request: 'Compare designs' })).toMatchObject({
      ok: true,
      explorerPath: 'style-explorer.html',
    });

    await expect(run('oil_ui_shoot', { viewport: 'invalid' })).rejects.toThrow('viewport');
    await expect(run('oil_ui_media', { query: '' })).rejects.toThrow('query');
    await expect(run('oil_ui_media', {})).rejects.toThrow('query');
    await expect(tools.get('oil_ui_explorer')!.execute({}, { signal: exec.signal } as ToolRunContext)).rejects.toThrow(
      'session-owned',
    );
  } finally {
    await Promise.all(disposers.map(dispose => dispose()));
    await rm(root, { recursive: true, force: true });
  }
});

it('reads the Skill registry from the injected context instead of the apply context', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'oil-injected-context-')));
  localHome.path = root;
  vi.stubEnv('DSH_HOME', join(root, '.dsh'));
  const skillDir = join(root, 'local-skill');
  await mkdir(join(skillDir, 'references'), { recursive: true });
  await writeFile(join(skillDir, 'SKILL.md'), '---\nname: oil-ui\ndescription: Local\nmetadata:\n  version: 9.9.9\n---\nLocal body');
  await writeFile(join(skillDir, 'references/reviewer-manual.md'), '# 视觉与交互评审手册（Injected Context）');
  const disposers: (() => void | Promise<void>)[] = [];
  const tools = new Map<string, ToolDefinition>();
  const commands = new Map<string, { name: string; handler: (inv: unknown) => Promise<{ kind: string; text?: string }> | { kind: string; text?: string } }>();
  const createdListeners: ((payload: { agent: unknown }) => Promise<void> | void)[] = [];
  const pending: Promise<unknown>[] = [];
  let registration: SkillRegistration | undefined;
  const ctx: any = {
    effect(fn: () => () => void | Promise<void>) {
      disposers.push(fn());
    },
    on(event: string, listener: (payload: { agent: unknown }) => Promise<void> | void) {
      if (event === 'agent/created') createdListeners.push(listener);
      return () => {};
    },
    inject(services: string[], fn: (ctx: unknown) => unknown) {
      const child = Object.create(ctx);
      if (services.includes('tools')) {
        Object.defineProperty(child, 'tools', {
          value: { register(tool: ToolDefinition) { tools.set(tool.name, tool); } },
        });
      }
      if (services.includes('commands')) {
        Object.defineProperty(child, 'commands', {
          value: {
            register(cmd: { name: string; handler: (inv: unknown) => Promise<{ kind: string; text?: string }> | { kind: string; text?: string } }) {
              commands.set(cmd.name, cmd);
              return () => {};
            },
          },
        });
      }
      if (services.includes('skills')) {
        Object.defineProperty(child, 'skills', {
          value: {
            register(skill: SkillRegistration) { registration = skill; },
            get: async (name: string) => (registration?.name === name ? registration : undefined),
          },
        });
      }
      if (services.includes('systemPrompt')) {
        Object.defineProperty(child, 'systemPrompt', {
          value: { section() { return () => {}; } },
        });
      }
      pending.push(Promise.resolve(fn(child)));
    },
  };
  Object.defineProperty(ctx, 'skills', {
    get() {
      throw new Error('cannot get property "skills" without inject');
    },
  });
  try {
    apply(ctx as unknown as Context, { previewPort: 0, skillDir });
    await Promise.all(pending);
    const exec = {
      agent: { session: { id: 'alice', header: { cwd: root } } },
      signal: new AbortController().signal,
    } as unknown as ToolRunContext;
    await expect(tools.get('oil_ui_skill_status')!.execute({}, exec)).resolves.toMatchObject({
      activeSkillName: 'oil-ui',
      activeVersion: '9.9.9',
    });
    await expect(commands.get('oil-ui-status')!.handler({
      agent: exec.agent,
      rawInput: '',
      attachments: [],
      signal: exec.signal,
    })).resolves.toMatchObject({
      kind: 'success',
      text: expect.stringContaining('oil-ui v9.9.9'),
    });
    const subSections: { name: string; text: string }[] = [];
    for (const listener of createdListeners) {
      await listener({
        agent: {
          session: { id: 'sub-1', header: { cwd: root, origin: 'subagent' } },
          ctx: { systemPrompt: { section(sec: { name: string; text: string }) { subSections.push(sec); return () => {}; } } },
        },
      });
    }
    await vi.waitFor(() => expect(subSections).toHaveLength(1), { timeout: 5000 });
    expect(subSections[0]!.text).toContain('Injected Context');
  } finally {
    await Promise.all(disposers.map(dispose => dispose()));
    localHome.path = '';
    await rm(root, { recursive: true, force: true });
  }
});

it('registers through the Skill provider and refreshes when the active installation changes', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'oil-provider-')));
  const skillDir = join(root, 'home/local-oil-ui');
  vi.stubEnv('DSH_HOME', join(root, 'home/.dsh'));
  localHome.path = join(root, 'home');
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, 'SKILL.md'),
    '---\nname: oil-ui\ndescription: Hot-installed local Skill\nmetadata:\n  version: hot-1\n---\nLocal body with `scripts/shoot.mjs`',
  );
  const registry = new SkillRegistry(new Context());
  const tools = new Map<string, ToolDefinition>();
  const pending: Promise<unknown>[] = [];
  const disposers: (() => void | Promise<void>)[] = [];
  let provider: SkillProvider | undefined;
  const invalidate = vi.fn();
  const ctx = {
    effect(fn: () => () => Promise<void>) {
      disposers.push(fn());
    },
    inject(_services: string[], fn: (ctx: unknown) => unknown) {
      pending.push(Promise.resolve(fn(ctx)));
    },
    tools: {
      register(tool: ToolDefinition) {
        tools.set(tool.name, tool);
      },
    },
    skills: {
      register: vi.fn(),
      get: registry.get.bind(registry),
      registerProvider(create: Parameters<SkillRegistry['registerProvider']>[0]) {
        const dispose = registry.registerProvider(control => {
          invalidate.mockImplementation(() => control.invalidate?.());
          return provider = create({ ...control, invalidate });
        });
        disposers.push(dispose);
        return dispose;
      },
    },
    systemPrompt: { section() {} },
  };
  try {
    apply(ctx as unknown as Context, { previewPort: 0, skillDir });
    await Promise.all(pending);
    expect(ctx.skills.register).not.toHaveBeenCalled();
    expect(provider?.name).toBe('oil-ui-provider');
    expect((await registry.list()).map(s => s.name)).toEqual(['oil-ui']);
    const before = await provider!.list({});
    expect(before).toEqual([expect.objectContaining({ name: 'oil-ui', rank: 20, source: 'local-skill' })]);

    const exec = {
      agent: { session: { id: 'alice', header: { cwd: root } } },
      signal: new AbortController().signal,
    } as ToolRunContext;
    expect(await tools.get('oil_ui_skill_status')!.execute({}, exec)).toMatchObject({
      activeSkillName: 'oil-ui',
      activeVersion: 'hot-1',
      visibleMatchesOriginal: true,
    });
    expect(invalidate).not.toHaveBeenCalled();

    await writeFile(join(skillDir, 'SKILL.md'), '---\nname: oil-ui\ndescription: Updated local Skill\nmetadata:\n  version: hot-2\n---\nUpdated body');
    await tools.get('oil_ui_skill_status')!.execute({}, exec);
    expect(invalidate).toHaveBeenCalledTimes(1);
    const loaded = await registry.get('oil-ui');
    expect(loaded?.metadata?.version).toBe('hot-2');
    expect(loaded?.content).toContain('Updated body');
    const stale = Array.isArray(before) ? before[0] : undefined;
    expect(await provider!.get(stale!, {})).toBeUndefined();

    disposers.push(registry.registerProvider(() => ({
      name: 'filesystem',
      async list() { return [{ name: 'oil-ui', description: 'Raw filesystem Skill', source: 'project-dsh', provider: 'filesystem', rank: 100, locator: skillDir, invocation: { modelInvocable: true, userInvocable: true } }]; },
      async get() { throw new Error('Filesystem Skill must lose arbitration'); },
    })));
    expect((await registry.get('oil-ui'))?.provider).toBe('oil-ui-provider');
  } finally {
    await Promise.all(disposers.map(dispose => dispose()));
    localHome.path = '';
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
});

it('automatically injects reviewer-manual.md into subagent system prompt and preserves the main section', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-oil-ui-subagent-')));
  const rootCtx = new Context();
  new SystemPrompt(rootCtx, {});
  const createdListeners: ((payload: { agent: unknown }) => Promise<void> | void)[] = [];
  const pending: Promise<unknown>[] = [];
  const disposers: (() => void | Promise<void>)[] = [];

  const hostCtx = {
    systemPrompt: rootCtx.systemPrompt,
    agents: { list: () => [] },
    effect(fn: () => () => void | Promise<void>) {
      disposers.push(fn());
    },
    inject(services: string[], fn: (ctx: unknown) => unknown) {
      if (services.includes('systemPrompt')) {
        pending.push(Promise.resolve(fn(hostCtx)));
      }
    },
    on(event: string, listener: (payload: { agent: unknown }) => Promise<void> | void) {
      if (event === 'agent/created') createdListeners.push(listener);
      return () => {};
    },
  };

  try {
    apply(hostCtx as unknown as Context, { previewPort: 0 });
    await Promise.all(pending);

    const mainSections: { name: string; order: number; interpolate?: boolean; text: string }[] = [];
    const mainAgent = {
      id: 'main-1',
      session: { id: 'main-1', header: { cwd: root } },
      ctx: {
        systemPrompt: {
          section(sec: { name: string; order: number; interpolate?: boolean; text: string }) {
            mainSections.push(sec);
            return () => {};
          },
        },
      },
    };
    for (const listener of createdListeners) await listener({ agent: mainAgent });
    expect(mainSections).toHaveLength(0);
    const mainPrompt = renderPrompt(await rootCtx.systemPrompt.assemble({}));
    expect(mainPrompt).toContain('call oil_ui_skill_status first');
    expect(mainPrompt).not.toContain('视觉与交互评审手册');

    const subSections: { name: string; order: number; interpolate?: boolean; text: string }[] = [];
    const liteSubagent = {
      id: 'sub-lite',
      session: { id: 'sub-lite', header: { cwd: root, origin: 'subagent', parentSession: 'main-1' } },
      ctx: {
        systemPrompt: {
          section(sec: { name: string; order: number; interpolate?: boolean; text: string }) {
            subSections.push(sec);
            return () => {};
          },
        },
      },
    };
    for (const listener of createdListeners) await listener({ agent: liteSubagent });
    await vi.waitFor(() => expect(subSections).toHaveLength(1), { timeout: 5000 });
    expect(subSections[0]!.name).toBe('oil-ui-subagent-reviewer');
    expect(subSections[0]!.text).toContain('/references');
    expect(subSections[0]!.text).toContain('# 视觉与交互评审手册（子代理专用）');
    expect(subSections[0]!.text).toContain('oil_ui_shoot');
    expect(subSections[0]!.text).toContain('read_image');
    expect(subSections[0]!.text).not.toContain('review-modes.md');
    expect(subSections[0]!.text).not.toContain('call oil_ui_skill_status first');
  } finally {
    await Promise.all(disposers.map(dispose => dispose()));
    await rm(root, { recursive: true, force: true });
  }
});

it('never awaits reviewer setup in agent/created, falls back after a broken local Skill, and disposes only its own section', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'oil-reviewer-fallback-')));
  const skill = join(root, 'skill');
  const disposers: (() => void | Promise<void>)[] = [];
  let listener: ((payload: { agent: unknown }) => unknown) | undefined;
  const inherited = 'Main Oil UI guidance';
  const sections = new Map([['oil-ui', inherited]]);
  const disposeReviewer = vi.fn();
  const agent = {
    session: { header: { cwd: root, origin: 'subagent' } },
    ctx: { systemPrompt: { section(section: { name: string; text: string }) {
      sections.set(section.name, section.text);
      return () => { sections.delete(section.name); disposeReviewer(); };
    } } },
  };
  const ctx = {
    effect(fn: () => () => void | Promise<void>) { disposers.push(fn()); },
    inject(services: string[], fn: (value: unknown) => unknown) { if (services.includes('systemPrompt')) fn(ctx); },
    systemPrompt: { section() { return () => {}; } },
    on(_name: string, fn: typeof listener) { listener = fn; },
  };
  try {
    // A local Skill directory without references must not break reviewer setup.
    await mkdir(skill, { recursive: true });
    await writeFile(join(skill, 'SKILL.md'), '---\nname: oil-ui\ndescription: Test\n---\nTest');
    apply(ctx as unknown as Context, { previewPort: 0, skillDir: skill });
    expect(listener!({ agent })).toBeUndefined();
    expect(listener!({ agent })).toBeUndefined();
    await vi.waitFor(() => expect(sections.get('oil-ui-subagent-reviewer')).toContain('# 视觉与交互评审手册'), { timeout: 5000 });
    expect(sections.get('oil-ui')).toBe(inherited);
    expect(sections.size).toBe(2);
    await Promise.all(disposers.map(dispose => dispose()));
    expect(disposeReviewer).toHaveBeenCalledTimes(1);
    expect(sections.get('oil-ui')).toBe(inherited);
    expect(sections.size).toBe(1);
    expect(listener!({ agent })).toBeUndefined();
  } finally {
    await Promise.all(disposers.map(dispose => dispose()));
    await rm(root, { recursive: true, force: true });
  }
});
