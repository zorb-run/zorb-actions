#!/usr/bin/env bun
// Copy templates/action/ into a new actions/<name>/ workspace.
//
// Usage:
//   bun scripts/new-package.ts <name>
//   bun scripts/new-package.ts <name> --description "AWS service actions"
//
// `<name>` is the bare package name (slack, aws, claude…) — we publish it as
// `@zorb/<name>` and put the source under `actions/<name>/`. Anywhere the
// template uses the placeholder `__name__`, this script substitutes the real
// name in-place. After scaffolding the script prompts the operator to run
// `bun install` so the new workspace is linked.

import { cpSync, existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import minimist from 'minimist';
import { repoRoot } from './workspaces.ts';

const PLACEHOLDER = '__name__';
const NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

async function main() {
  const argv = minimist(process.argv.slice(2), {
    string: ['description'],
  });

  const [name] = argv._;
  if (typeof name !== 'string' || name === '') {
    process.stderr.write('usage: bun scripts/new-package.ts <name> [--description "…"]\n');
    process.exit(2);
  }

  if (!NAME_PATTERN.test(name)) {
    process.stderr.write(`invalid package name '${name}' — use lowercase letters, digits, and dashes\n`);
    process.exit(2);
  }

  const root = repoRoot();
  const src = join(root, 'templates', 'action');
  const dst = join(root, 'actions', name);

  if (!existsSync(src)) {
    process.stderr.write(`template not found at ${src}\n`);
    process.exit(1);
  }
  if (existsSync(dst)) {
    process.stderr.write(`destination already exists: ${dst}\n`);
    process.exit(1);
  }

  cpSync(src, dst, { recursive: true });
  rewriteTree(dst, name, typeof argv.description === 'string' ? argv.description : undefined);

  process.stderr.write(`> created actions/${name}/ (publishes as @zorb/${name})\n`);
  process.stderr.write(`> next: bun install && bun run typecheck\n`);
}

function rewriteTree(dir: string, name: string, description: string | undefined): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      rewriteTree(full, name, description);
      continue;
    }
    if (!st.isFile()) continue;
    const renamed = entry.includes(PLACEHOLDER) ? entry.split(PLACEHOLDER).join(name) : entry;
    const target = renamed === entry ? full : join(dir, renamed);
    if (renamed !== entry) renameSync(full, target);
    if (isTextFile(target)) rewriteFile(target, name, description);
  }
}

function isTextFile(p: string): boolean {
  return /\.(ts|js|json|md|yml|yaml|toml)$/i.test(p);
}

function rewriteFile(p: string, name: string, description: string | undefined): void {
  let content = readFileSync(p, 'utf8');
  content = content.split(PLACEHOLDER).join(name);
  if (description && p.endsWith('package.json')) {
    content = content.replace(/"TODO: short description of what this package does"/, JSON.stringify(description));
  }
  writeFileSync(p, content);
}

if (import.meta.main) {
  await main();
}
