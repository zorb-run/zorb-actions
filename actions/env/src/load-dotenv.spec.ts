import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mockContext } from '@/shared/action-helpers/testing';
import { action, parseDotenv } from './load-dotenv';

describe('parseDotenv', () => {
  test('parses KEY=VALUE pairs', () => {
    expect(parseDotenv('FOO=bar\nBAZ=qux\n')).toEqual([
      ['FOO', 'bar'],
      ['BAZ', 'qux'],
    ]);
  });

  test('skips blanks, comments, and malformed lines', () => {
    const text = ['', '# this is a comment', '  # indented comment', 'FOO=bar', 'NOPE_NO_EQUALS', 'BAZ=qux'].join('\n');
    expect(parseDotenv(text)).toEqual([
      ['FOO', 'bar'],
      ['BAZ', 'qux'],
    ]);
  });

  test('strips an `export ` prefix', () => {
    expect(parseDotenv('export FOO=bar\n')).toEqual([['FOO', 'bar']]);
  });

  test('handles double-quoted values with escape sequences', () => {
    expect(parseDotenv('FOO="a\\nb\\tc"\n')).toEqual([['FOO', 'a\nb\tc']]);
    expect(parseDotenv('FOO="he said \\"hi\\""\n')).toEqual([['FOO', 'he said "hi"']]);
  });

  test('treats single-quoted values as literal', () => {
    expect(parseDotenv("FOO='a\\nb'\n")).toEqual([['FOO', 'a\\nb']]);
  });

  test('trims surrounding whitespace on unquoted values', () => {
    expect(parseDotenv('FOO=   bar  \n')).toEqual([['FOO', 'bar']]);
  });
});

describe('@zorb/env/load-dotenv', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'zorb-env-dotenv-'));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  test('registers each pair from .env (default path)', async () => {
    await writeFile(join(tmp, '.env'), 'NODE_ENV=production\nLOG_LEVEL=info\n');
    const ctx = mockContext({ cwd: tmp });

    await action({}, ctx);

    expect(ctx.env).toEqual([
      { name: 'NODE_ENV', value: 'production' },
      { name: 'LOG_LEVEL', value: 'info' },
    ]);
  });

  test('loads multiple files in order', async () => {
    await writeFile(join(tmp, '.env'), 'A=1\n');
    await writeFile(join(tmp, '.env.local'), 'B=2\n');
    const ctx = mockContext({ cwd: tmp });

    await action({ path: ['.env', '.env.local'] }, ctx);

    expect(ctx.env).toEqual([
      { name: 'A', value: '1' },
      { name: 'B', value: '2' },
    ]);
  });

  test('respects only/except filters on the source key', async () => {
    await writeFile(join(tmp, '.env'), 'KEEP=1\nSKIP=2\nKEEP_TOO=3\n');
    const ctx = mockContext({ cwd: tmp });

    await action({ only: ['KEEP', 'KEEP_TOO'], except: ['KEEP_TOO'] }, ctx);

    expect(ctx.env).toEqual([{ name: 'KEEP', value: '1' }]);
  });

  test('applies prefix to each registered name', async () => {
    await writeFile(join(tmp, '.env'), 'DB_URL=postgres://x\nPORT=8080\n');
    const ctx = mockContext({ cwd: tmp });

    await action({ prefix: 'APP_' }, ctx);

    expect(ctx.env).toEqual([
      { name: 'APP_DB_URL', value: 'postgres://x' },
      { name: 'APP_PORT', value: '8080' },
    ]);
  });

  test('filters apply to the source key, then prefix is applied', async () => {
    await writeFile(join(tmp, '.env'), 'DB_URL=postgres://x\nIGNORED=nope\n');
    const ctx = mockContext({ cwd: tmp });

    await action({ prefix: 'APP_', only: ['DB_URL'] }, ctx);

    expect(ctx.env).toEqual([{ name: 'APP_DB_URL', value: 'postgres://x' }]);
  });

  test('throws when a required file is missing', async () => {
    const ctx = mockContext({ cwd: tmp });
    await expect(action({ path: 'missing.env' }, ctx)).rejects.toThrow(/file not found: missing\.env/);
  });

  test('warns and continues when required is false', async () => {
    await writeFile(join(tmp, '.env'), 'A=1\n');
    const ctx = mockContext({ cwd: tmp });

    await action({ path: ['.env', 'missing.env'], required: false }, ctx);

    expect(ctx.env).toEqual([{ name: 'A', value: '1' }]);
    expect(ctx.messages.warn).toEqual(['@zorb/env/load-dotenv: skipped missing file: missing.env']);
  });

  test('does not register into the secret table', async () => {
    await writeFile(join(tmp, '.env'), 'A=1\n');
    const ctx = mockContext({ cwd: tmp });

    await action({}, ctx);

    expect(ctx.secrets).toEqual([]);
  });
});
