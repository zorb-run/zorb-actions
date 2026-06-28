import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';

export interface Workspace {
  /** Absolute path to the workspace directory. */
  dir: string;
  /** "@zorb/aws", "@zorb/action-helpers", etc. */
  name: string;
  /** Contents of the workspace's package.json. */
  pkg: Record<string, unknown>;
}

const ROOT = resolvePath(import.meta.dir, '..');

/**
 * Discover every action workspace in the monorepo. `shared/*` is internal —
 * its source gets bundled into each action's dist at build time — so it
 * isn't a build target and we don't return it here.
 *
 * Skips directories that don't contain a package.json so a stray `.gitkeep`
 * or an in-progress scaffold doesn't crash the build.
 */
export function listWorkspaces(): Workspace[] {
  const out: Workspace[] = [];
  const parentDir = join(ROOT, 'actions');
  if (!safeIsDir(parentDir)) return out;
  for (const entry of readdirSync(parentDir)) {
    if (entry.startsWith('.') || entry.startsWith('_')) continue;
    const dir = join(parentDir, entry);
    if (!safeIsDir(dir)) continue;
    const pkgPath = join(dir, 'package.json');
    if (!safeIsFile(pkgPath)) continue;
    const pkg = readJson(pkgPath);
    const name = typeof pkg.name === 'string' ? pkg.name : entry;
    out.push({ dir, name, pkg });
  }
  return out;
}

export function repoRoot(): string {
  return ROOT;
}

function safeIsDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function safeIsFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function readJson(p: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch (err) {
    throw new Error(`failed to read ${p}: ${(err as Error).message}`);
  }
}
