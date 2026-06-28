import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse as parseIni } from 'ini';
import type { ActionContext } from 'zorb/action';
import { input, type ActionInputs } from '@/shared/action-helpers';

/**
 * Load env vars from an INI file (via the `ini` npm package).
 *
 * INI files are inherently sectioned, but env vars are flat — so this loader
 * picks one slice of the file per invocation:
 *
 *   - By default, only top-level keys (those above any `[section]` header) are
 *     loaded. Section bodies — including dotted sub-sections like `[foo.bar]`,
 *     which `ini` parses into nested objects — are ignored.
 *   - Set `section: foo` to load keys from `[foo]` instead. Inside the chosen
 *     section, nested objects (from `[foo.bar]`) and array-valued keys
 *     (repeated `key[]=`) error — flatten the file or pick a leaf section.
 *
 * Array-valued keys at the top level also error, since arrays don't map to a
 * single env-var value.
 *
 * `only:` / `except:` filter on the source key (as it appears in the chosen
 * scope). `prefix:` is applied after filtering, before registration.
 */
export async function action(rawInputs: ActionInputs, context: ActionContext): Promise<void> {
  const path = input.string(rawInputs, 'path');
  const section = input.optional.string(rawInputs, 'section');
  const only = input.optional.strings(rawInputs, 'only');
  const except = input.optional.strings(rawInputs, 'except');
  const prefix = input.optional.string(rawInputs, 'prefix') ?? '';

  const abs = resolve(context.cwd, path);

  let text: string;
  try {
    text = await readFile(abs, 'utf8');
  } catch (err) {
    if (isENoEnt(err)) {
      throw new Error(`@zorb/env/load-ini: file not found: ${path} (resolved to ${abs})`);
    }
    throw err;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = parseIni(text) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`@zorb/env/load-ini: failed to parse ${path}: ${(err as Error).message}`);
  }

  const scope = pickScope(parsed, section, path);
  const onlySet = only ? new Set(only) : undefined;
  const exceptSet = except ? new Set(except) : undefined;

  for (const [name, raw] of Object.entries(scope)) {
    if (onlySet && !onlySet.has(name)) continue;
    if (exceptSet && exceptSet.has(name)) continue;
    if (raw === null || raw === undefined) continue;
    context.setEnv(`${prefix}${name}`, coerceValue(name, raw, path, section));
  }
}

function pickScope(
  parsed: Record<string, unknown>,
  section: string | undefined,
  path: string,
): Record<string, unknown> {
  if (section === undefined) {
    return extractTopLevel(parsed);
  }
  const raw = parsed[section];
  if (raw === undefined) {
    throw new Error(`@zorb/env/load-ini: section '[${section}]' not found in ${path}`);
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`@zorb/env/load-ini: '[${section}]' in ${path} is not a key/value section`);
  }
  return raw as Record<string, unknown>;
}

function extractTopLevel(parsed: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(parsed)) {
    // Section objects (from `[section]` headers, including dotted sub-sections
    // like `[foo.bar]`) are skipped — they belong to the section-scope path.
    // Arrays fall through to coerceValue, which rejects them with a clear
    // error so misconfigured `key[]=` entries don't get silently dropped.
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) continue;
    out[name] = value;
  }
  return out;
}

function coerceValue(name: string, raw: unknown, path: string, section: string | undefined): string {
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  const where = section === undefined ? path : `[${section}] in ${path}`;
  throw new Error(
    `@zorb/env/load-ini: ${where}: value for '${name}' must be a string, number, or boolean (got ${typeName(raw)})`,
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
