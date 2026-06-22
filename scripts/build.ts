#!/usr/bin/env bun
// Build every workspace package's TS sources into dist/.
//
// For each workspace:
//   src/foo.ts      → dist/foo.js
//   src/sub/bar.ts  → dist/sub/bar.js
//
// We preserve the src/ tree under dist/ so that an action authored at
// src/s3/sync.ts is published as `@zorb/aws/s3/sync` — the package.json's
// "./*": "./dist/*.js" exports map relies on that one-to-one layout.
//
// Two phases per package:
//   1. Bun.build emits the runtime .js (workspace + external deps stay
//      external — they're resolved by the consumer's node_modules).
//   2. tsc --declaration --emitDeclarationOnly emits matching .d.ts files
//      from the same sources.
//
// Usage:
//   bun scripts/build.ts                 # build every workspace
//   bun scripts/build.ts --only=@zorb/action-helpers
//   bun scripts/build.ts --clean         # remove dist/ before rebuilding

import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import minimist from 'minimist';
import { listWorkspaces, repoRoot, type Workspace } from './workspaces.ts';

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

  const result = await Bun.build({
    entrypoints,
    outdir: distDir,
    root: srcDir,
    target: 'node',
    format: 'esm',
    // Leave every bare import unresolved. The consumer's node_modules
    // supplies @zorb/action-helpers, third-party SDKs, etc. — bundling them
    // here would duplicate code and break workspace linking.
    packages: 'external',
    minify: false,
    sourcemap: 'external',
  });

  if (!result.success) {
    for (const log of result.logs) process.stderr.write(`${log}\n`);
    throw new Error(`bun build failed for ${ws.name}`);
  }

  await emitDeclarations(ws, srcDir, distDir);
}

function collectEntrypoints(srcDir: string): string[] {
  const out: string[] = [];
  walk(srcDir, (p) => {
    if (p.endsWith('.ts') && !p.endsWith('.d.ts') && !p.endsWith('.test.ts')) {
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

async function emitDeclarations(ws: Workspace, srcDir: string, distDir: string): Promise<void> {
  // tsc is run as a child process; the workspace's tsconfig.json controls
  // the compiler options, we just override emit settings on the CLI.
  const tsconfigPath = join(ws.dir, 'tsconfig.json');
  if (!existsSync(tsconfigPath)) {
    process.stderr.write(`> ${ws.name}: no tsconfig.json — skipping .d.ts emit\n`);
    return;
  }

  // Run tsc against the workspace's tsconfig with declaration-only overrides.
  // The workspace tsconfig extends our base (declaration: true) and includes
  // both src/ and test/, so we re-include only src/ here to keep dist/ clean.
  const args = [
    '--project',
    tsconfigPath,
    '--declaration',
    '--emitDeclarationOnly',
    '--rootDir',
    srcDir,
    '--outDir',
    distDir,
  ];

  const proc = Bun.spawn(['bunx', 'tsc', ...args], {
    cwd: ws.dir,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    process.stderr.write(stdout);
    process.stderr.write(stderr);
    throw new Error(`tsc declaration emit failed for ${ws.name}`);
  }
}

if (import.meta.main) {
  await main();
}
