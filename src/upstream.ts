import { open, readFile, realpath, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { join, resolve, relative, isAbsolute, dirname, sep } from 'node:path';
import { parse } from 'yaml';
import type { SkillRegistration, SkillDefinition, SkillProvider, SkillProviderControl } from '@deepseek-ai/dsh-skill';
import { TRANSFORM_VERSION, isHarnessNativeSkillMarkdown, transformSkillMarkdown } from './transform.ts';

export const bundledSkillDirectory = fileURLToPath(new URL('../skills/oil-ui', import.meta.url));
export const skillDirectory = bundledSkillDirectory;

export interface SkillOptions { skillDir?: string; cwd?: string }
export interface ImageGenOptions { imageGenScript?: string; cwd?: string }
export interface SkillStatusOptions extends SkillOptions, ImageGenOptions {}

export function dshSkillRoots(skillName: string, cwd?: string): string[] {
  const home = homedir();
  const dshHome = process.env.DSH_HOME?.trim();
  const agentsHome = process.env.DSH_AGENTS_HOME?.trim();
  let projectDir = cwd?.trim() ? resolve(cwd.trim()) : undefined;
  if (projectDir) {
    let ancestor = projectDir;
    while (true) {
      if (existsSync(join(ancestor, '.git'))) { projectDir = ancestor; break; }
      const parent = dirname(ancestor);
      if (parent === ancestor) break;
      ancestor = parent;
    }
  }
  const roots = [
    ...(projectDir
      ? [
          join(resolve(projectDir), '.dsh', 'skills', skillName),
          join(resolve(projectDir), '.agents', 'skills', skillName),
        ]
      : []),
    ...(dshHome ? [join(resolve(dshHome), 'skills', skillName)] : []),
    join(home, '.dsh', 'skills', skillName),
    ...(process.platform === 'darwin'
      ? [join(home, 'Library', 'Application Support', 'dsh-desktop', 'harness', 'skills', skillName)]
      : []),
    ...(agentsHome ? [join(resolve(agentsHome), 'skills', skillName)] : []),
    join(home, '.agents', 'skills', skillName),
  ];
  return [...new Set(roots)];
}

export async function resolveImageGenScript(options: ImageGenOptions = {}): Promise<string | null> {
  const explicit = options.imageGenScript?.trim() || process.env.OIL_UI_IMAGE_GEN_SCRIPT?.trim();
  const roots = dshSkillRoots('image-gen', options.cwd);
  const candidates = [
    ...(explicit ? [{ path: resolve(explicit), root: dirname(resolve(explicit)) }] : []),
    ...roots.map(root => ({ root, path: join(root, 'scripts', 'image_gen.py') })),
  ];
  for (const candidate of candidates) {
    try {
      const root = await realpath(candidate.root);
      const path = await realpath(candidate.path);
      const rel = relative(root, path);
      if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) continue;
      if ((await stat(path)).isFile()) return path;
    } catch { /* Missing, unreadable or escaping scripts are unavailable. */ }
  }
  return null;
}

export interface ActiveSkill {
  name: 'oil-ui';
  directory: string;
  source: 'local-skill' | 'bundled';
}

function frontmatter(raw: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
  if (!match) throw new Error('Skill frontmatter missing');
  const data = parse(match[1]!);
  if (!data || typeof data !== 'object') throw new Error('Invalid Skill frontmatter');
  return { data, content: raw.slice(match[0].length) };
}

interface SkillHeader { data: Record<string, unknown>; fingerprint: string }
const headers = new Map<string, { stamp: string; value: Promise<SkillHeader> }>();
async function readHeader(path: string): Promise<SkillHeader> {
  const info = await stat(path);
  const stamp = `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
  const old = headers.get(path);
  if (old?.stamp === stamp) return old.value;
  const value = (async () => {
    const handle = await open(path, 'r');
    try {
      let raw = '';
      const chunk = Buffer.alloc(1024);
      const chunks: Buffer[] = [];
      for (let offset = 0; offset < 65536; offset += chunk.length) {
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, offset);
        chunks.push(Buffer.from(chunk.subarray(0, bytesRead)));
        raw = Buffer.concat(chunks).toString('utf8');
        if (/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.test(raw) || !bytesRead) break;
      }
      return { data: frontmatter(raw).data, fingerprint: stamp };
    } finally { await handle.close(); }
  })();
  headers.set(path, { stamp, value });
  try { return await value; } catch (error) { headers.delete(path); throw error; }
}

// Explicit local Skill directory override (config `skillDir` or OIL_UI_SKILL_DIR).
// Only a valid `oil-ui` installation is accepted; there is no automatic scan or remote channel.
async function findSkillDir(options: SkillOptions): Promise<string | null> {
  const explicit = options.skillDir?.trim() || process.env.OIL_UI_SKILL_DIR?.trim();
  if (!explicit) return null;
  try {
    const directory = await realpath(resolve(explicit));
    const path = await realpath(join(directory, 'SKILL.md'));
    const rel = relative(directory, path);
    if (rel.startsWith('..') || isAbsolute(rel) || !(await stat(path)).isFile()) return null;
    const { data } = await readHeader(path);
    return data.name === 'oil-ui' ? directory : null;
  } catch { /* An absent, unreadable or invalid installation is not active. */ }
  return null;
}

export interface SkillSnapshot {
  active: ActiveSkill;
  header: SkillHeader;
  fingerprint: string;
}
export async function discoverSkill(options: SkillOptions = {}): Promise<SkillSnapshot> {
  const local = await findSkillDir(options);
  const active: ActiveSkill = local
    ? { name: 'oil-ui', directory: local, source: 'local-skill' }
    : { name: 'oil-ui', directory: bundledSkillDirectory, source: 'bundled' };
  const header = await readHeader(join(active.directory, 'SKILL.md'));
  return { active, header, fingerprint: `${active.directory}:${header.fingerprint}` };
}

export async function resolveActiveSkill(options: SkillOptions = {}, snapshot?: SkillSnapshot): Promise<ActiveSkill> {
  const { active } = snapshot ?? await discoverSkill(options);
  return active;
}

const reviewerManuals = new Map<string, Promise<string>>();
export async function loadReviewerManual(options: SkillOptions = {}, activeSkill?: ActiveSkill): Promise<string> {
  let active = activeSkill;
  try { active ??= await resolveActiveSkill(options); } catch { /* Use the bundled manual on discovery failure. */ }
  for (const path of [...new Set([
    ...(active ? [join(active.directory, 'references', 'reviewer-manual.md')] : []),
    join(bundledSkillDirectory, 'references', 'reviewer-manual.md'),
  ])]) {
    try {
      const info = await stat(path);
      const key = `${TRANSFORM_VERSION}:${path}:${info.ino}:${info.mtimeMs}:${info.ctimeMs}:${info.size}`;
      let manual = reviewerManuals.get(key);
      if (!manual) {
        manual = readFile(path, 'utf8').then(raw => transformSkillMarkdown('references/reviewer-manual.md', raw));
        reviewerManuals.set(key, manual);
      }
      return await manual;
    } catch { /* Continue to bundled manual. */ }
  }
  return '';
}

export async function loadUpstreamSkill(options: SkillOptions = {}, snapshot?: SkillSnapshot): Promise<SkillRegistration> {
  const active = await resolveActiveSkill(options, snapshot);
  const path = join(active.directory, 'SKILL.md');
  const raw = await readFile(path, 'utf8');
  const compiled = isHarnessNativeSkillMarkdown(raw) ? raw : transformSkillMarkdown('SKILL.md', raw);
  const { data, content } = frontmatter(compiled);
  if (data.name !== active.name) throw new Error('Invalid active Skill identity');
  return {
    name: active.name,
    description: typeof data.description === 'string' ? data.description : 'Oil UI Skill installation',
    metadata: data.metadata,
    path,
    source: active.source,
    resourceBase: { kind: 'directory', path: active.directory },
    invocation: { modelInvocable: true, userInvocable: true },
    content,
  };
}

export function createSkillProvider(options: SkillOptions, control: SkillProviderControl) {
  const name = 'oil-ui-provider';
  const snapshots = new Map<string, SkillSnapshot>();
  const refresh = async (cwd = options.cwd) => {
    control.signal.throwIfAborted();
    const key = cwd ?? '';
    const snapshot = await discoverSkill({ ...options, cwd });
    const previous = snapshots.get(key) ?? snapshots.get('');
    snapshots.set(key, snapshot);
    return { snapshot, changed: Boolean(previous && previous.fingerprint !== snapshot.fingerprint) };
  };
  return {
    name,
    refresh,
    async list(lookup) {
      lookup.signal?.throwIfAborted();
      const { snapshot } = await refresh(lookup.cwd);
      const { active, header } = snapshot;
      return [{ name: active.name, description: String(header.data.description ?? 'Oil UI'), metadata: header.data.metadata as Record<string, unknown> | undefined,
        path: join(active.directory, 'SKILL.md'), source: active.source, provider: name,
        resourceBase: { kind: 'directory' as const, path: active.directory },
        invocation: { modelInvocable: true, userInvocable: true },
        rank: 20, locator: snapshot.fingerprint }];
    },
    async get(candidate, lookup) {
      lookup.signal?.throwIfAborted();
      const snapshot = snapshots.get(lookup.cwd ?? options.cwd ?? '') ?? (await refresh(lookup.cwd)).snapshot;
      if (candidate.name !== snapshot.active.name || candidate.locator !== snapshot.fingerprint) return undefined;
      const skill = await loadUpstreamSkill({ ...options, cwd: lookup.cwd ?? options.cwd }, snapshot);
      control.signal.throwIfAborted(); lookup.signal?.throwIfAborted();
      return { ...skill, provider: name, invocation: skill.invocation! };
    },
  } satisfies SkillProvider & { refresh: typeof refresh };
}

export async function skillStatus(visible?: SkillDefinition | null, options: SkillStatusOptions = {}, snapshot?: SkillSnapshot) {
  snapshot ??= await discoverSkill(options);
  const active = snapshot.active;
  const expected = snapshot.header.data;
  const manifestPath = fileURLToPath(new URL('../skills/oil-ui.manifest.json', import.meta.url));
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { version: string; files: unknown[] };
  const detectedVersion = String((expected.metadata as Record<string, unknown> | undefined)?.version ?? 'unknown');
  const effective = visible ?? null;
  const effectiveBase = effective?.resourceBase?.kind === 'directory' ? effective.resourceBase.path : null;
  const activeVersion = String(effective?.metadata?.version ?? detectedVersion);
  const imageGenScriptPath = await resolveImageGenScript(options);
  return {
    imageGenAvailable: imageGenScriptPath !== null,
    imageGenScriptPath,
    activeSkillName: active.name,
    detected: { name: active.name, version: detectedVersion, path: join(active.directory, 'SKILL.md') },
    effective: effective ? { name: effective.name, version: activeVersion, path: effective.path, resourceBase: effective.resourceBase, provider: effective.provider } : null,
    activeVersion,
    bundledVersion: manifest.version,
    bundledSkillDirectory,
    activeResourceBase: effectiveBase ?? active.directory,
    name: active.name,
    version: activeVersion,
    fileCount: manifest.files.length,
    manifestPath,
    resourceBase: effective?.resourceBase ?? { kind: 'directory', path: active.directory },
    path: effective?.path ?? join(active.directory, 'SKILL.md'),
    visibleMatchesOriginal: Boolean(!effective || effective.name !== active.name
      || effective.provider === 'oil-ui-provider' || effective.path === join(active.directory, 'SKILL.md')),
    note: 'Manifest hashes are offline packaging evidence. No hash gate is enforced during loading or execution.',
  };
}
