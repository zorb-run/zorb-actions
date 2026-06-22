import { ActionInputError } from './errors.ts';
import type { ActionInputs } from './types.ts';

/**
 * Input validation helpers. Each function reads a named field off the
 * action's `inputs` object and coerces it to the requested type, throwing
 * `ActionInputError` on a missing or malformed value.
 *
 * Why centralise this?
 * - Workflow inputs arrive as `Record<string, unknown>` — actions have to
 *   narrow before doing anything useful.
 * - Coercion rules (e.g. how to read a boolean) should match what the CLI
 *   already does for `--with key=value`. The helpers mirror those rules so
 *   "true" / "yes" / "1" all behave the same way regardless of whether the
 *   value reached the action via CLI args or a workflow's `with:` block.
 */

export interface InputOptions<T> {
  /** Override the displayed name in error messages. Defaults to the key. */
  as?: string;
  /** Fallback when the key is absent. Without a default, a missing input throws. */
  default?: T;
}

const TRUE_TOKENS = new Set(['true', 'yes', '1']);
const FALSE_TOKENS = new Set(['false', 'no', '0']);

function pick(inputs: ActionInputs, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(inputs, key) ? inputs[key] : undefined;
}

function displayName(key: string, opts: InputOptions<unknown> | undefined): string {
  return opts?.as ?? key;
}

function asString(key: string, raw: unknown, opts: InputOptions<unknown> | undefined): string {
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  throw new ActionInputError(`input '${displayName(key, opts)}': expected a string, got ${typeName(raw)}`);
}

function asNumber(key: string, raw: unknown, opts: InputOptions<unknown> | undefined): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '') {
      throw new ActionInputError(`input '${displayName(key, opts)}': expected a number, got an empty string`);
    }
    const n = Number(trimmed);
    if (Number.isFinite(n)) return n;
  }
  throw new ActionInputError(`input '${displayName(key, opts)}': expected a number, got ${typeName(raw)}`);
}

function asBoolean(key: string, raw: unknown, opts: InputOptions<unknown> | undefined): boolean {
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') {
    const token = raw.trim().toLowerCase();
    if (TRUE_TOKENS.has(token)) return true;
    if (FALSE_TOKENS.has(token)) return false;
  }
  if (typeof raw === 'number') {
    if (raw === 1) return true;
    if (raw === 0) return false;
  }
  throw new ActionInputError(
    `input '${displayName(key, opts)}': expected a boolean (true/false/yes/no/1/0), got ${typeName(raw)}`,
  );
}

function typeName(raw: unknown): string {
  if (raw === null) return 'null';
  if (Array.isArray(raw)) return 'array';
  return typeof raw;
}

function requireString(inputs: ActionInputs, key: string, opts?: InputOptions<string>): string {
  const raw = pick(inputs, key);
  if (raw === undefined) {
    if (opts?.default !== undefined) return opts.default;
    throw new ActionInputError(`missing required input '${displayName(key, opts)}'`);
  }
  return asString(key, raw, opts);
}

function requireNumber(inputs: ActionInputs, key: string, opts?: InputOptions<number>): number {
  const raw = pick(inputs, key);
  if (raw === undefined) {
    if (opts?.default !== undefined) return opts.default;
    throw new ActionInputError(`missing required input '${displayName(key, opts)}'`);
  }
  return asNumber(key, raw, opts);
}

function requireBoolean(inputs: ActionInputs, key: string, opts?: InputOptions<boolean>): boolean {
  const raw = pick(inputs, key);
  if (raw === undefined) {
    if (opts?.default !== undefined) return opts.default;
    throw new ActionInputError(`missing required input '${displayName(key, opts)}'`);
  }
  return asBoolean(key, raw, opts);
}

function optionalString(
  inputs: ActionInputs,
  key: string,
  opts?: Omit<InputOptions<string>, 'default'>,
): string | undefined {
  const raw = pick(inputs, key);
  if (raw === undefined) return undefined;
  return asString(key, raw, opts);
}

function optionalNumber(
  inputs: ActionInputs,
  key: string,
  opts?: Omit<InputOptions<number>, 'default'>,
): number | undefined {
  const raw = pick(inputs, key);
  if (raw === undefined) return undefined;
  return asNumber(key, raw, opts);
}

function optionalBoolean(
  inputs: ActionInputs,
  key: string,
  opts?: Omit<InputOptions<boolean>, 'default'>,
): boolean | undefined {
  const raw = pick(inputs, key);
  if (raw === undefined) return undefined;
  return asBoolean(key, raw, opts);
}

export const input = {
  string: requireString,
  number: requireNumber,
  boolean: requireBoolean,
  optional: {
    string: optionalString,
    number: optionalNumber,
    boolean: optionalBoolean,
  },
};
