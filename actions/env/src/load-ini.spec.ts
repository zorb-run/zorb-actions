import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mockContext } from '@/shared/action-helpers/testing';
import { action } from './load-ini';

const SECTIONED = `name=zorb
debug=true
port=8080

[database]
url=postgres://x
ssl=false

[cache]
ttl=60
`;

describe('@zorb/env/load-ini', () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'zorb-env-ini-'));
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  test('loads top-level keys by default and ignores sections', async () => {
    await writeFile(join(tmp, 'config.ini'), SECTIONED);
    const ctx = mockContext({ cwd: tmp });

    await action({ path: 'config.ini' }, ctx);

    expect(ctx.env).toEqual([
      { name: 'name', value: 'zorb' },
      { name: 'debug', value: 'true' },
      { name: 'port', value: '8080' },
    ]);
  });

  test('loads a named section when `section:` is set', async () => {
    await writeFile(join(tmp, 'config.ini'), SECTIONED);
    const ctx = mockContext({ cwd: tmp });

    await action({ path: 'config.ini', section: 'database' }, ctx);

    expect(ctx.env).toEqual([
      { name: 'url', value: 'postgres://x' },
      { name: 'ssl', value: 'false' },
    ]);
  });

  test('errors when the named section is missing', async () => {
    await writeFile(join(tmp, 'config.ini'), SECTIONED);
    const ctx = mockContext({ cwd: tmp });

    await expect(action({ path: 'config.ini', section: 'nope' }, ctx)).rejects.toThrow(/section '\[nope\]' not found/);
  });

  test('applies only/except filters to the chosen scope', async () => {
    await writeFile(join(tmp, 'config.ini'), SECTIONED);
    const ctx = mockContext({ cwd: tmp });

    await action({ path: 'config.ini', section: 'database', only: ['url', 'ssl'], except: ['ssl'] }, ctx);

    expect(ctx.env).toEqual([{ name: 'url', value: 'postgres://x' }]);
  });

  test('applies prefix to each registered name', async () => {
    await writeFile(join(tmp, 'config.ini'), SECTIONED);
    const ctx = mockContext({ cwd: tmp });

    await action({ path: 'config.ini', section: 'database', prefix: 'DB_' }, ctx);

    expect(ctx.env).toEqual([
      { name: 'DB_url', value: 'postgres://x' },
      { name: 'DB_ssl', value: 'false' },
    ]);
  });

  test('errors on missing file', async () => {
    const ctx = mockContext({ cwd: tmp });
    await expect(action({ path: 'nope.ini' }, ctx)).rejects.toThrow(/file not found: nope\.ini/);
  });

  test('errors when a chosen section contains a nested sub-section', async () => {
    // `ini` parses [foo.bar] into { foo: { bar: { baz: '1' } } }, so picking
    // `section: foo` exposes `bar` as a nested object — which can't be
    // coerced to a single env value.
    await writeFile(join(tmp, 'config.ini'), '[foo.bar]\nbaz=1\n');
    const ctx = mockContext({ cwd: tmp });

    await expect(action({ path: 'config.ini', section: 'foo' }, ctx)).rejects.toThrow(
      /value for 'bar' must be a string, number, or boolean \(got object\)/,
    );
  });

  test('errors on array-valued top-level keys', async () => {
    await writeFile(join(tmp, 'config.ini'), 'items[]=a\nitems[]=b\n');
    const ctx = mockContext({ cwd: tmp });

    await expect(action({ path: 'config.ini' }, ctx)).rejects.toThrow(
      /value for 'items' must be a string, number, or boolean \(got array\)/,
    );
  });

  test('errors on array-valued keys inside a chosen section', async () => {
    await writeFile(join(tmp, 'config.ini'), '[s]\nitems[]=a\nitems[]=b\n');
    const ctx = mockContext({ cwd: tmp });

    await expect(action({ path: 'config.ini', section: 's' }, ctx)).rejects.toThrow(
      /value for 'items' must be a string, number, or boolean \(got array\)/,
    );
  });

  test('does not register into the secret table', async () => {
    await writeFile(join(tmp, 'config.ini'), 'A=1\n');
    const ctx = mockContext({ cwd: tmp });

    await action({ path: 'config.ini' }, ctx);

    expect(ctx.secrets).toEqual([]);
  });
});
