import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mockContext } from '@/shared/action-helpers/testing';
import { action } from './load-file';

describe('@zorb/secrets/load-file', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'zorb-secrets-file-'));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  test('loads JSON files (format inferred from extension)', async () => {
    await writeFile(join(tmp, 'secrets.json'), JSON.stringify({ A: '1', B: 2, C: true }));
    const ctx = mockContext({ cwd: tmp });

    await action({ path: 'secrets.json' }, ctx);

    expect(ctx.secrets).toEqual([
      { name: 'A', value: '1' },
      { name: 'B', value: '2' },
      { name: 'C', value: 'true' },
    ]);
  });

  test('loads YAML files', async () => {
    await writeFile(join(tmp, 'secrets.yml'), 'API_KEY: abc\nDB_URL: postgres://x\n');
    const ctx = mockContext({ cwd: tmp });

    await action({ path: 'secrets.yml' }, ctx);

    expect(ctx.secrets).toEqual([
      { name: 'API_KEY', value: 'abc' },
      { name: 'DB_URL', value: 'postgres://x' },
    ]);
  });

  test('skips null values', async () => {
    await writeFile(join(tmp, 'secrets.json'), JSON.stringify({ A: '1', B: null }));
    const ctx = mockContext({ cwd: tmp });

    await action({ path: 'secrets.json' }, ctx);

    expect(ctx.secrets).toEqual([{ name: 'A', value: '1' }]);
  });

  test('applies only/except filters', async () => {
    await writeFile(join(tmp, 'secrets.json'), JSON.stringify({ KEEP: '1', SKIP: '2', KEEP_TOO: '3' }));
    const ctx = mockContext({ cwd: tmp });

    await action({ path: 'secrets.json', only: ['KEEP', 'KEEP_TOO'], except: ['KEEP_TOO'] }, ctx);

    expect(ctx.secrets).toEqual([{ name: 'KEEP', value: '1' }]);
  });

  test('honours explicit format override', async () => {
    await writeFile(join(tmp, 'secrets'), JSON.stringify({ A: '1' }));
    const ctx = mockContext({ cwd: tmp });

    await action({ path: 'secrets', format: 'json' }, ctx);

    expect(ctx.secrets).toEqual([{ name: 'A', value: '1' }]);
  });

  test('errors on unknown extension without explicit format', async () => {
    await writeFile(join(tmp, 'secrets.txt'), '{}');
    const ctx = mockContext({ cwd: tmp });

    await expect(action({ path: 'secrets.txt' }, ctx)).rejects.toThrow(/could not infer format/);
  });

  test('errors on missing file', async () => {
    const ctx = mockContext({ cwd: tmp });
    await expect(action({ path: 'nope.json' }, ctx)).rejects.toThrow(/file not found: nope\.json/);
  });

  test('errors on non-object top level', async () => {
    await writeFile(join(tmp, 'secrets.json'), JSON.stringify(['nope']));
    const ctx = mockContext({ cwd: tmp });

    await expect(action({ path: 'secrets.json' }, ctx)).rejects.toThrow(/top-level object/);
  });

  test('errors on nested object values', async () => {
    await writeFile(join(tmp, 'secrets.json'), JSON.stringify({ A: { nested: true } }));
    const ctx = mockContext({ cwd: tmp });

    await expect(action({ path: 'secrets.json' }, ctx)).rejects.toThrow(
      /value for 'A' must be a string, number, or boolean \(got object\)/,
    );
  });

  test('errors on malformed JSON', async () => {
    await writeFile(join(tmp, 'secrets.json'), '{ not json');
    const ctx = mockContext({ cwd: tmp });

    await expect(action({ path: 'secrets.json' }, ctx)).rejects.toThrow(/failed to parse .*\.json as JSON/);
  });
});
