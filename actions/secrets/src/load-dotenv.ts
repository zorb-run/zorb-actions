import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ActionContext } from 'zorb/action';
import { input, type ActionInputs } from '@/shared/action-helpers';

/**
 * Load secrets from one or more `.env` files. Each `KEY=VALUE` pair is
 * registered into the run-scoped secret table so the value is masked in
 * later step output.
 *
 * Supports a minimal `.env` grammar:
 *   - blank lines and `# comment` lines are skipped
 *   - optional `export ` prefix is stripped
 *   - double-quoted values interpret `\n \r \t \\ \"` escapes
 *   - single-quoted values are taken literally
 *   - unquoted values are trimmed of surrounding whitespace
 *
 * Multi-line values, inline `# comment` stripping, and `$VAR` expansion are
 * intentionally not supported. If you need them, use `load-file` with a
 * structured format.
 */
export async function action(rawInputs: ActionInputs, context: ActionContext): Promise<void> {
  const paths = input.optional.strings(rawInputs, 'path') ?? ['.env'];
  const only = input.optional.strings(rawInputs, 'only');
  const except = input.optional.strings(rawInputs, 'except');
  const required = input.boolean(rawInputs, 'required', { default: true });

  const onlySet = only ? new Set(only) : undefined;
  const exceptSet = except ? new Set(except) : undefined;

  for (const rel of paths) {
    const abs = resolve(context.cwd, rel);
    const text = await readFileOrMissing(abs, rel, required, context);
    if (text === undefined) continue;

    for (const [name, value] of parseDotenv(text)) {
      if (onlySet && !onlySet.has(name)) continue;
      if (exceptSet && exceptSet.has(name)) continue;
      context.setSecret(name, value);
    }
  }
}

async function readFileOrMissing(
  abs: string,
  rel: string,
  required: boolean,
  context: ActionContext,
): Promise<string | undefined> {
  try {
    return await readFile(abs, 'utf8');
  } catch (err) {
    if (isENoEnt(err)) {
      if (required) {
        throw new Error(`@zorb/secrets/load-dotenv: file not found: ${rel} (resolved to ${abs})`);
      }
      context.log.warn(`@zorb/secrets/load-dotenv: skipped missing file: ${rel}`);
      return undefined;
    }
    throw err;
  }
}

function isENoEnt(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
}

export function parseDotenv(text: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s+/, '');
    if (line === '' || line.startsWith('#')) continue;

    const withoutExport = line.startsWith('export ') ? line.slice('export '.length).trimStart() : line;
    const eq = withoutExport.indexOf('=');
    if (eq === -1) continue;

    const name = withoutExport.slice(0, eq).trim();
    if (name === '') continue;

    const rest = withoutExport.slice(eq + 1);
    out.push([name, parseValue(rest)]);
  }
  return out;
}

function parseValue(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if (first === '"' && last === '"') {
      return unescapeDoubleQuoted(trimmed.slice(1, -1));
    }
    if (first === "'" && last === "'") {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function unescapeDoubleQuoted(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== '\\' || i + 1 >= s.length) {
      out += c;
      continue;
    }
    const next = s[i + 1];
    switch (next) {
      case 'n':
        out += '\n';
        break;
      case 'r':
        out += '\r';
        break;
      case 't':
        out += '\t';
        break;
      case '\\':
        out += '\\';
        break;
      case '"':
        out += '"';
        break;
      default:
        out += '\\' + next;
    }
    i++;
  }
  return out;
}
