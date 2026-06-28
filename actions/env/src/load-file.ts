import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { ActionContext } from 'zorb/action';
import { input, type ActionInputs } from '@/shared/action-helpers';

type Format = 'json' | 'yaml';

/**
 * Load env vars from a structured file (JSON or YAML). The file's top level
 * must be a flat object of string/number/boolean values; each entry is
 * registered into the run-scoped env table.
 *
 * Format is auto-detected from the file extension (`.json`, `.yml`,
 * `.yaml`) or can be set explicitly via `format:`. TOML support is planned;
 * for now feed `load-file` JSON or YAML.
 *
 * `only:` / `except:` filter on the source key (as it appears in the file).
 * `prefix:` is applied after filtering, before registration.
 */
export async function action(rawInputs: ActionInputs, context: ActionContext): Promise<void> {
  const path = input.string(rawInputs, 'path');
  const explicitFormat = input.optional.string(rawInputs, 'format');
  const only = input.optional.strings(rawInputs, 'only');
  const except = input.optional.strings(rawInputs, 'except');
  const prefix = input.optional.string(rawInputs, 'prefix') ?? '';

  const format = resolveFormat(path, explicitFormat);
  const abs = resolve(context.cwd, path);

  let text: string;
  try {
    text = await readFile(abs, 'utf8');
  } catch (err) {
    if (isENoEnt(err)) {
      throw new Error(`@zorb/env/load-file: file not found: ${path} (resolved to ${abs})`);
    }
    throw err;
  }

  const parsed = format === 'json' ? parseJson(text, path) : parseYamlText(text, path);
  const onlySet = only ? new Set(only) : undefined;
  const exceptSet = except ? new Set(except) : undefined;

  for (const [name, raw] of Object.entries(parsed)) {
    if (onlySet && !onlySet.has(name)) continue;
    if (exceptSet && exceptSet.has(name)) continue;
    if (raw === null || raw === undefined) continue;
    context.setEnv(`${prefix}${name}`, coerceValue(name, raw, path));
  }
}

function resolveFormat(path: string, explicit: string | undefined): Format {
  if (explicit !== undefined) {
    if (explicit === 'json' || explicit === 'yaml') return explicit;
    if (explicit === 'yml') return 'yaml';
    throw new Error(`@zorb/env/load-file: unsupported format '${explicit}' (expected 'json' or 'yaml')`);
  }
  const ext = extname(path).toLowerCase();
  if (ext === '.json') return 'json';
  if (ext === '.yml' || ext === '.yaml') return 'yaml';
  throw new Error(`@zorb/env/load-file: could not infer format from '${path}' — set 'format: json' or 'format: yaml'`);
}

function parseJson(text: string, path: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    throw new Error(`@zorb/env/load-file: failed to parse ${path} as JSON: ${(err as Error).message}`);
  }
  return ensureFlatObject(value, path);
}

function parseYamlText(text: string, path: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = parseYaml(text);
  } catch (err) {
    throw new Error(`@zorb/env/load-file: failed to parse ${path} as YAML: ${(err as Error).message}`);
  }
  return ensureFlatObject(value, path);
}

function ensureFlatObject(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`@zorb/env/load-file: ${path} must contain a top-level object of key/value pairs`);
  }
  return value as Record<string, unknown>;
}

function coerceValue(name: string, raw: unknown, path: string): string {
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  throw new Error(
    `@zorb/env/load-file: ${path}: value for '${name}' must be a string, number, or boolean (got ${typeName(raw)})`,
  );
}

function typeName(raw: unknown): string {
  if (raw === null) return 'null';
  if (Array.isArray(raw)) return 'array';
  return typeof raw;
}

function isENoEnt(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
}
