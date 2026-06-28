import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mockContext } from '@/shared/action-helpers/testing';
import { globToRegExp, makeFilter, parseLocation, runDownload, runUpload, type S3Ops } from './sync';

interface FakeObject {
  fullKey: string;
  key: string;
  size: number;
  etag: string;
  body: Buffer;
}

function fakeOps(initial: FakeObject[] = []): S3Ops & {
  store: Map<string, FakeObject>;
  uploads: Array<{ bucket: string; key: string; body: Buffer; meta: { contentType?: string; cacheControl?: string } }>;
  removals: Array<{ bucket: string; keys: string[] }>;
} {
  const store = new Map(initial.map((o) => [o.fullKey, o]));
  const uploads: Array<{
    bucket: string;
    key: string;
    body: Buffer;
    meta: { contentType?: string; cacheControl?: string };
  }> = [];
  const removals: Array<{ bucket: string; keys: string[] }> = [];
  return {
    store,
    uploads,
    removals,
    async list(_bucket, prefix) {
      const out: FakeObject[] = [];
      for (const obj of store.values()) {
        if (!obj.fullKey.startsWith(prefix)) continue;
        out.push(obj);
      }
      return out.map((o) => ({ key: o.key, fullKey: o.fullKey, size: o.size, etag: o.etag }));
    },
    async upload(bucket, key, body, meta) {
      const buf = await streamToBuffer(body);
      uploads.push({ bucket, key, body: buf, meta });
      const etag = createHash('md5').update(buf).digest('hex');
      store.set(key, { fullKey: key, key, size: buf.length, etag, body: buf });
    },
    async download(_bucket, key, target) {
      const obj = store.get(key);
      if (!obj) throw new Error(`fake: missing ${key}`);
      await new Promise<void>((resolveTarget, rejectTarget) => {
        target.on('error', rejectTarget);
        target.on('finish', resolveTarget);
        target.end(obj.body);
      });
    },
    async remove(bucket, keys) {
      removals.push({ bucket, keys: [...keys] });
      for (const k of keys) store.delete(k);
    },
  };
}

async function streamToBuffer(body: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks);
}

function md5(buf: Buffer): string {
  return createHash('md5').update(buf).digest('hex');
}

describe('parseLocation', () => {
  test('parses s3:// with bucket only', () => {
    expect(parseLocation('s3://my-bucket', '/cwd', 'source')).toEqual({
      kind: 's3',
      bucket: 'my-bucket',
      prefix: '',
    });
  });

  test('parses s3:// with prefix and trailing slash', () => {
    expect(parseLocation('s3://my-bucket/path', '/cwd', 'source')).toEqual({
      kind: 's3',
      bucket: 'my-bucket',
      prefix: 'path/',
    });
    expect(parseLocation('s3://my-bucket/path/', '/cwd', 'source')).toEqual({
      kind: 's3',
      bucket: 'my-bucket',
      prefix: 'path/',
    });
  });

  test('parses local path relative to cwd', () => {
    expect(parseLocation('./dist', '/cwd', 'source')).toEqual({ kind: 'local', path: '/cwd/dist' });
    expect(parseLocation('/abs/dir', '/cwd', 'source')).toEqual({ kind: 'local', path: '/abs/dir' });
  });

  test('rejects s3:// without a bucket', () => {
    expect(() => parseLocation('s3://', '/cwd', 'source')).toThrow(/must include a bucket/);
    expect(() => parseLocation('s3:///foo', '/cwd', 'source')).toThrow(/must include a bucket/);
  });

  test('rejects empty / whitespace-only inputs', () => {
    expect(() => parseLocation('', '/cwd', 'source')).toThrow(/source cannot be empty/);
    expect(() => parseLocation('   ', '/cwd', 'destination')).toThrow(/destination cannot be empty/);
  });
});

describe('globToRegExp', () => {
  test('* matches within a single segment', () => {
    expect(globToRegExp('*.js').test('foo.js')).toBe(true);
    expect(globToRegExp('*.js').test('foo/bar.js')).toBe(false);
  });

  test('** matches across segments', () => {
    expect(globToRegExp('**/*.js').test('foo/bar.js')).toBe(true);
    expect(globToRegExp('**/*.js').test('foo/baz/qux.js')).toBe(true);
    expect(globToRegExp('docs/**').test('docs/a/b/c.md')).toBe(true);
  });

  test('**/ requires a segment boundary', () => {
    // **/foo.js matches foo.js, a/foo.js, a/b/foo.js — never barfoo.js
    expect(globToRegExp('**/foo.js').test('foo.js')).toBe(true);
    expect(globToRegExp('**/foo.js').test('a/foo.js')).toBe(true);
    expect(globToRegExp('**/foo.js').test('a/b/foo.js')).toBe(true);
    expect(globToRegExp('**/foo.js').test('barfoo.js')).toBe(false);
    // docs/**/a requires that 'a' sits on its own segment under docs/
    expect(globToRegExp('docs/**/a').test('docs/a')).toBe(true);
    expect(globToRegExp('docs/**/a').test('docs/x/a')).toBe(true);
    expect(globToRegExp('docs/**/a').test('docs/ba')).toBe(false);
  });

  test('? matches one non-slash char', () => {
    expect(globToRegExp('a?c.js').test('abc.js')).toBe(true);
    expect(globToRegExp('a?c.js').test('a/c.js')).toBe(false);
  });

  test('regex metacharacters are escaped', () => {
    expect(globToRegExp('a.b+c').test('a.b+c')).toBe(true);
    expect(globToRegExp('a.b+c').test('axbxc')).toBe(false);
  });
});

describe('makeFilter', () => {
  test('passes everything by default', () => {
    const f = makeFilter(undefined, undefined);
    expect(f('anything.txt')).toBe(true);
  });

  test('exclude rejects matching keys', () => {
    const f = makeFilter(['**/*.map'], undefined);
    expect(f('app.map')).toBe(false);
    expect(f('dist/app.map')).toBe(false);
    expect(f('app.js')).toBe(true);
  });

  test('include rescues an excluded key', () => {
    const f = makeFilter(['**/*.map'], ['important.map']);
    expect(f('app.map')).toBe(false);
    expect(f('important.map')).toBe(true);
  });
});

describe('runUpload', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'zorb-aws-s3-sync-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('uploads new files and skips matching ones (by md5)', async () => {
    await writeFile(join(dir, 'a.txt'), 'hello');
    await writeFile(join(dir, 'b.txt'), 'world');

    const existing = Buffer.from('hello');
    const ops = fakeOps([
      { fullKey: 'site/a.txt', key: 'a.txt', size: existing.length, etag: md5(existing), body: existing },
    ]);

    const ctx = mockContext({ cwd: dir });
    const result = await runUpload(
      { kind: 'local', path: dir },
      { kind: 's3', bucket: 'my-bucket', prefix: 'site/' },
      { deletes: false, dryRun: false, cacheControl: undefined, contentType: undefined, filter: () => true },
      ops,
      ctx,
    );

    expect(result).toEqual({ uploaded: 1, downloaded: 0, deleted: 0, skipped: 1 });
    expect(ops.uploads.map((u) => u.key)).toEqual(['site/b.txt']);
    expect(ops.uploads[0]!.meta.contentType).toBe('text/plain');
  });

  test('falls back to size comparison for multipart ETags', async () => {
    await writeFile(join(dir, 'big.bin'), 'aaa');

    const ops = fakeOps([{ fullKey: 'big.bin', key: 'big.bin', size: 3, etag: 'deadbeef-2', body: Buffer.alloc(0) }]);

    const ctx = mockContext({ cwd: dir });
    const result = await runUpload(
      { kind: 'local', path: dir },
      { kind: 's3', bucket: 'my-bucket', prefix: '' },
      { deletes: false, dryRun: false, cacheControl: undefined, contentType: undefined, filter: () => true },
      ops,
      ctx,
    );

    expect(result).toEqual({ uploaded: 0, downloaded: 0, deleted: 0, skipped: 1 });
    expect(ops.uploads).toEqual([]);
  });

  test('delete:true removes stale remote objects', async () => {
    await writeFile(join(dir, 'keep.txt'), 'keep');

    const ops = fakeOps([
      { fullKey: 'keep.txt', key: 'keep.txt', size: 4, etag: md5(Buffer.from('keep')), body: Buffer.from('keep') },
      { fullKey: 'old.txt', key: 'old.txt', size: 3, etag: md5(Buffer.from('old')), body: Buffer.from('old') },
    ]);

    const ctx = mockContext({ cwd: dir });
    const result = await runUpload(
      { kind: 'local', path: dir },
      { kind: 's3', bucket: 'my-bucket', prefix: '' },
      { deletes: true, dryRun: false, cacheControl: undefined, contentType: undefined, filter: () => true },
      ops,
      ctx,
    );

    expect(result).toEqual({ uploaded: 0, downloaded: 0, deleted: 1, skipped: 1 });
    expect(ops.removals).toEqual([{ bucket: 'my-bucket', keys: ['old.txt'] }]);
  });

  test('dryRun does not call upload or remove', async () => {
    await writeFile(join(dir, 'new.txt'), 'fresh');

    const ops = fakeOps([
      { fullKey: 'stale.txt', key: 'stale.txt', size: 3, etag: md5(Buffer.from('old')), body: Buffer.from('old') },
    ]);

    const ctx = mockContext({ cwd: dir });
    const result = await runUpload(
      { kind: 'local', path: dir },
      { kind: 's3', bucket: 'my-bucket', prefix: '' },
      { deletes: true, dryRun: true, cacheControl: undefined, contentType: undefined, filter: () => true },
      ops,
      ctx,
    );

    expect(result).toEqual({ uploaded: 1, downloaded: 0, deleted: 1, skipped: 0 });
    expect(ops.uploads).toEqual([]);
    expect(ops.removals).toEqual([]);
  });

  test('filter excludes files before comparison', async () => {
    await writeFile(join(dir, 'app.js'), 'js');
    await writeFile(join(dir, 'app.js.map'), 'map');

    const ops = fakeOps();
    const ctx = mockContext({ cwd: dir });
    const result = await runUpload(
      { kind: 'local', path: dir },
      { kind: 's3', bucket: 'my-bucket', prefix: '' },
      {
        deletes: false,
        dryRun: false,
        cacheControl: undefined,
        contentType: undefined,
        filter: makeFilter(['*.map'], undefined),
      },
      ops,
      ctx,
    );

    expect(result.uploaded).toBe(1);
    expect(ops.uploads.map((u) => u.key)).toEqual(['app.js']);
  });

  test('applies cacheControl and explicit contentType to upload meta', async () => {
    await writeFile(join(dir, 'index.html'), '<p>hi</p>');

    const ops = fakeOps();
    const ctx = mockContext({ cwd: dir });
    await runUpload(
      { kind: 'local', path: dir },
      { kind: 's3', bucket: 'my-bucket', prefix: '' },
      {
        deletes: false,
        dryRun: false,
        cacheControl: 'public, max-age=60',
        contentType: 'text/html; charset=utf-8',
        filter: () => true,
      },
      ops,
      ctx,
    );

    expect(ops.uploads[0]!.meta).toEqual({
      contentType: 'text/html; charset=utf-8',
      cacheControl: 'public, max-age=60',
    });
  });
});

describe('runDownload', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'zorb-aws-s3-sync-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('downloads new objects into nested directories', async () => {
    const body = Buffer.from('payload');
    const ops = fakeOps([
      { fullKey: 'data/nested/file.txt', key: 'nested/file.txt', size: body.length, etag: md5(body), body },
    ]);

    const ctx = mockContext({ cwd: dir });
    const result = await runDownload(
      { kind: 's3', bucket: 'my-bucket', prefix: 'data/' },
      { kind: 'local', path: dir },
      { deletes: false, dryRun: false, filter: () => true },
      ops,
      ctx,
    );

    expect(result).toEqual({ uploaded: 0, downloaded: 1, deleted: 0, skipped: 0 });
    const written = await readFile(join(dir, 'nested', 'file.txt'));
    expect(written.toString()).toBe('payload');
  });

  test('delete:true removes local files that are not in remote', async () => {
    await mkdir(join(dir, 'sub'), { recursive: true });
    await writeFile(join(dir, 'sub', 'stale.txt'), 'old');

    const ops = fakeOps();
    const ctx = mockContext({ cwd: dir });
    const result = await runDownload(
      { kind: 's3', bucket: 'my-bucket', prefix: '' },
      { kind: 'local', path: dir },
      { deletes: true, dryRun: false, filter: () => true },
      ops,
      ctx,
    );

    expect(result).toEqual({ uploaded: 0, downloaded: 0, deleted: 1, skipped: 0 });
    await expect(stat(join(dir, 'sub', 'stale.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('skips objects whose md5 matches the local file', async () => {
    const body = Buffer.from('same');
    await writeFile(join(dir, 'same.txt'), body);

    const ops = fakeOps([{ fullKey: 'same.txt', key: 'same.txt', size: body.length, etag: md5(body), body }]);

    const ctx = mockContext({ cwd: dir });
    const result = await runDownload(
      { kind: 's3', bucket: 'my-bucket', prefix: '' },
      { kind: 'local', path: dir },
      { deletes: false, dryRun: false, filter: () => true },
      ops,
      ctx,
    );

    expect(result).toEqual({ uploaded: 0, downloaded: 0, deleted: 0, skipped: 1 });
  });

  test('refuses to write outside the destination root', async () => {
    const body = Buffer.from('pwn');
    const ops = fakeOps([
      { fullKey: '../../etc/escape.txt', key: '../../etc/escape.txt', size: body.length, etag: md5(body), body },
    ]);

    const ctx = mockContext({ cwd: dir });
    await expect(
      runDownload(
        { kind: 's3', bucket: 'my-bucket', prefix: '' },
        { kind: 'local', path: dir },
        { deletes: false, dryRun: false, filter: () => true },
        ops,
        ctx,
      ),
    ).rejects.toThrow(/refusing to write outside destination/);
  });
});
