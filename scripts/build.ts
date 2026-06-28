#!/usr/bin/env bun
// Build every action workspace's TS sources into dist/.
//
// For each workspace:
//   src/foo.ts      → dist/foo.js
//   src/sub/bar.ts  → dist/sub/bar.js
//
// We preserve the src/ tree under dist/ so an action authored at
// src/s3/sync.ts is published as `@zorb/aws/s3/sync` — the package.json's
// "./*": "./dist/*.js" exports map relies on the one-to-one layout.
//
// External vs bundled:
// - Anything the workspace declares in `dependencies` or `peerDependencies`
//   stays external. Those resolve from the consumer's node_modules at
//   runtime (third-party SDKs, `zorb` if peer-listed, etc.).
// - `@shared/*` imports — resolved via tsconfig `paths` to ./shared/<name>/src
//   — are bundled in. The published package then has no runtime dependency
//   on the helpers, so consumers don't pull a separate @shared/* package.
// - `zorb/action` is type-only; types erase to nothing so it doesn't appear
//   in the output even though it isn't in `external`.
//
// Usage:
//   bun scripts/build.ts                  # build every workspace
//   bun scripts/build.ts --only=@zorb/aws # build one
//   bun scripts/build.ts --clean          # remove dist/ before rebuilding

import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import minimist from 'minimist';
import { listWorkspaces, repoRoot, type Workspace } from './workspaces';

interface BuildOptions {
  clean: boolean;
  only: string | undefined;
}

async function main() {
  const argv = minimist(process.argv.slice(2), {
    boolean: ['clean'],
    string: ['only'],
  });
  const opts: BuildOptions = {
    clean: Boolean(argv.clean),
    only: typeof argv.only === 'string' ? argv.only : undefined,
  };

  const workspaces = listWorkspaces();
  const targets = opts.only ? workspaces.filter((w) => w.name === opts.only) : workspaces;

  if (opts.only && targets.length === 0) {
    process.stderr.write(`no workspace named '${opts.only}'\n`);
    process.exit(1);
  }

  for (const ws of targets) {
    await buildWorkspace(ws, opts);
  }

  process.stderr.write(`> built ${targets.length} workspace(s)\n`);
}

async function buildWorkspace(ws: Workspace, opts: BuildOptions): Promise<void> {
  const srcDir = join(ws.dir, 'src');
  if (!existsSync(srcDir)) {
    process.stderr.write(`> ${ws.name}: no src/ — skipping\n`);
    return;
  }

  const distDir = join(ws.dir, 'dist');
  if (opts.clean && existsSync(distDir)) {
    rmSync(distDir, { recursive: true, force: true });
  }
  mkdirSync(distDir, { recursive: true });

  const entrypoints = collectEntrypoints(srcDir);
  if (entrypoints.length === 0) {
    process.stderr.write(`> ${ws.name}: no .ts files under src/ — skipping\n`);
    return;
  }

  process.stderr.write(`> ${ws.name}: building ${entrypoints.length} file(s) → ${relative(repoRoot(), distDir)}\n`);

  const external = declaredDeps(ws);
  const result = await Bun.build({
    entrypoints,
    outdir: distDir,
    root: srcDir,
    target: 'node',
    format: 'esm',
    external,
    minify: false,
    sourcemap: 'external',
  });

  if (!result.success) {
    for (const log of result.logs) process.stderr.write(`${log}\n`);
    throw new Error(`bun build failed for ${ws.name}`);
  }
}

function declaredDeps(ws: Workspace): string[] {
  const deps = ws.pkg.dependencies as Record<string, string> | undefined;
  const peer = ws.pkg.peerDependencies as Record<string, string> | undefined;
  const out = new Set<string>();
  if (deps) for (const k of Object.keys(deps)) out.add(k);
  if (peer) for (const k of Object.keys(peer)) out.add(k);
  return [...out];
}

function collectEntrypoints(srcDir: string): string[] {
  const out: string[] = [];
  walk(srcDir, (p) => {
    if (p.endsWith('.ts') && !p.endsWith('.d.ts') && !p.endsWith('.test.ts') && !p.endsWith('.spec.ts')) {
      out.push(p);
    }
  });
  return out;
}

function walk(dir: string, visit: (file: string) => void): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, visit);
    else if (st.isFile()) visit(full);
  }
}

if (import.meta.main) {
  await main();
}
