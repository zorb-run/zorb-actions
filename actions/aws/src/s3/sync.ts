import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import type { ActionContext } from 'zorb/action';
import { input, type ActionInputs } from '@/shared/action-helpers';

export interface SyncOutputs {
  uploaded: number;
  downloaded: number;
  deleted: number;
  skipped: number;
}

interface S3Location {
  kind: 's3';
  bucket: string;
  prefix: string;
}

interface LocalLocation {
  kind: 'local';
  path: string;
}

type Location = S3Location | LocalLocation;

interface LocalFile {
  /** Path relative to the sync root, using `/` separators. */
  key: string;
  /** Absolute filesystem path. */
  abs: string;
  size: number;
}

interface RemoteObject {
  /** Object key relative to the sync prefix, using `/` separators. */
  key: string;
  /** Full S3 key (prefix + relative key). */
  fullKey: string;
  size: number;
  etag: string;
}

/**
 * S3 operations the action needs. Extracted so tests can swap in an in-memory
 * fake instead of mocking the SDK at the prototype level.
 */
export interface S3Ops {
  list(bucket: string, prefix: string): Promise<RemoteObject[]>;
  upload(
    bucket: string,
    key: string,
    body: Readable,
    meta: { contentType?: string; cacheControl?: string },
  ): Promise<void>;
  download(bucket: string, key: string, target: Writable): Promise<void>;
  remove(bucket: string, keys: string[]): Promise<void>;
}

/**
 * Sync files between a local directory and an S3 prefix (in either direction).
 * Local↔S3 only — S3↔S3 syncs are not supported in this release; use the AWS
 * CLI or `@zorb/aws/s3/copy` (future) for those.
 *
 * Comparison strategy mirrors common static-site deploy needs rather than
 * `aws s3 sync`'s mtime heuristic:
 *   - Single-part S3 ETags are compared against the MD5 of the local file.
 *   - Multipart ETags (containing `-`) fall back to a size comparison.
 *
 * `exclude:` runs first, `include:` runs after. Both accept simple `*` / `**`
 * / `?` globs matched against the source-relative key (forward slashes on all
 * platforms).
 */
export async function action(rawInputs: ActionInputs, context: ActionContext): Promise<SyncOutputs> {
  const source = parseLocation(input.string(rawInputs, 'source'), context.cwd, 'source');
  const destination = parseLocation(input.string(rawInputs, 'destination'), context.cwd, 'destination');
  const deletes = input.boolean(rawInputs, 'delete', { default: false });
  const exclude = input.optional.strings(rawInputs, 'exclude');
  const include = input.optional.strings(rawInputs, 'include');
  const region = input.optional.string(rawInputs, 'region');
  const dryRun = input.boolean(rawInputs, 'dryRun', { default: false });
  const cacheControl = input.optional.string(rawInputs, 'cacheControl');
  const contentType = input.optional.string(rawInputs, 'contentType');

  if (source.kind === 'local' && destination.kind === 'local') {
    throw new Error('@zorb/aws/s3/sync: at least one of source/destination must be an s3:// URL');
  }
  if (source.kind === 's3' && destination.kind === 's3') {
    throw new Error('@zorb/aws/s3/sync: S3-to-S3 sync is not supported yet');
  }

  const filter = makeFilter(exclude, include);
  const ops = source.kind === 's3' || destination.kind === 's3' ? defaultOps(buildClient(region)) : undefined;

  if (source.kind === 'local' && destination.kind === 's3') {
    return runUpload(source, destination, { deletes, dryRun, cacheControl, contentType, filter }, ops!, context);
  }
  if (source.kind === 's3' && destination.kind === 'local') {
    return runDownload(source, destination, { deletes, dryRun, filter }, ops!, context);
  }
  // Unreachable given the guards above.
  throw new Error('@zorb/aws/s3/sync: unreachable sync direction');
}

interface UploadOptions {
  deletes: boolean;
  dryRun: boolean;
  cacheControl: string | undefined;
  contentType: string | undefined;
  filter: (key: string) => boolean;
}

interface DownloadOptions {
  deletes: boolean;
  dryRun: boolean;
  filter: (key: string) => boolean;
}

export async function runUpload(
  source: LocalLocation,
  destination: S3Location,
  opts: UploadOptions,
  ops: S3Ops,
  context: ActionContext,
): Promise<SyncOutputs> {
  const local = (await walkLocal(source.path)).filter((f) => opts.filter(f.key));
  const remote = await ops.list(destination.bucket, destination.prefix);
  const remoteByKey = new Map(remote.map((r) => [r.key, r]));

  let uploaded = 0;
  let skipped = 0;
  let deleted = 0;

  for (const file of local) {
    const existing = remoteByKey.get(file.key);
    const action = await diffLocalToRemote(file, existing);
    if (action === 'skip') {
      skipped++;
      continue;
    }
    const fullKey = joinKey(destination.prefix, file.key);
    if (opts.dryRun) {
      context.log.info(`(dry-run) upload s3://${destination.bucket}/${fullKey}`);
    } else {
      await ops.upload(destination.bucket, fullKey, createReadStream(file.abs), {
        contentType: opts.contentType ?? guessContentType(file.key),
        cacheControl: opts.cacheControl,
      });
      context.log.info(`upload s3://${destination.bucket}/${fullKey}`);
    }
    uploaded++;
  }

  if (opts.deletes) {
    const localKeys = new Set(local.map((f) => f.key));
    const stale = remote.filter((r) => !localKeys.has(r.key)).map((r) => r.fullKey);
    if (stale.length > 0) {
      if (opts.dryRun) {
        for (const key of stale) context.log.info(`(dry-run) delete s3://${destination.bucket}/${key}`);
      } else {
        await ops.remove(destination.bucket, stale);
        for (const key of stale) context.log.info(`delete s3://${destination.bucket}/${key}`);
      }
      deleted = stale.length;
    }
  }

  return { uploaded, downloaded: 0, deleted, skipped };
}

export async function runDownload(
  source: S3Location,
  destination: LocalLocation,
  opts: DownloadOptions,
  ops: S3Ops,
  context: ActionContext,
): Promise<SyncOutputs> {
  const remote = (await ops.list(source.bucket, source.prefix)).filter((r) => opts.filter(r.key));
  const local = await walkLocalIfExists(destination.path);
  const localByKey = new Map(local.map((f) => [f.key, f]));

  let downloaded = 0;
  let skipped = 0;
  let deleted = 0;

  for (const obj of remote) {
    const existing = localByKey.get(obj.key);
    const action = existing ? await diffRemoteToLocal(obj, existing) : 'copy';
    if (action === 'skip') {
      skipped++;
      continue;
    }
    const target = safeJoin(destination.path, obj.key, obj.fullKey);
    if (opts.dryRun) {
      context.log.info(`(dry-run) download ${target}`);
    } else {
      await mkdir(dirname(target), { recursive: true });
      await ops.download(source.bucket, obj.fullKey, createWriteStream(target));
      context.log.info(`download ${target}`);
    }
    downloaded++;
  }

  if (opts.deletes) {
    const remoteKeys = new Set(remote.map((r) => r.key));
    const stale = local.filter((f) => !remoteKeys.has(f.key));
    for (const file of stale) {
      if (opts.dryRun) {
        context.log.info(`(dry-run) delete ${file.abs}`);
      } else {
        await unlink(file.abs);
        context.log.info(`delete ${file.abs}`);
      }
      deleted++;
    }
  }

  return { uploaded: 0, downloaded, deleted, skipped };
}

async function diffLocalToRemote(local: LocalFile, remote: RemoteObject | undefined): Promise<'copy' | 'skip'> {
  if (!remote) return 'copy';
  if (remote.size !== local.size) return 'copy';
  if (remote.etag.includes('-')) return 'skip';
  const md5 = await hashFile(local.abs);
  return md5 === remote.etag ? 'skip' : 'copy';
}

async function diffRemoteToLocal(remote: RemoteObject, local: LocalFile): Promise<'copy' | 'skip'> {
  if (remote.size !== local.size) return 'copy';
  if (remote.etag.includes('-')) return 'skip';
  const md5 = await hashFile(local.abs);
  return md5 === remote.etag ? 'skip' : 'copy';
}

/**
 * Resolve a remote object's key into a destination filesystem path while
 * rejecting any path that would escape the destination root (e.g. an S3 key
 * containing `..` segments). S3 keys are attacker-controllable in many
 * deployment models, so the destination root must be a hard boundary.
 */
function safeJoin(root: string, relativeKey: string, fullKey: string): string {
  const target = resolve(root, ...relativeKey.split('/'));
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  if (target !== root && !target.startsWith(rootWithSep)) {
    throw new Error(
      `@zorb/aws/s3/sync: refusing to write outside destination: key '${fullKey}' resolves to '${target}'`,
    );
  }
  return target;
}

export function parseLocation(raw: string, cwd: string, field: string): Location {
  if (raw.trim() === '') {
    throw new Error(`@zorb/aws/s3/sync: ${field} cannot be empty`);
  }
  if (raw.startsWith('s3://')) {
    const rest = raw.slice('s3://'.length);
    const slash = rest.indexOf('/');
    if (rest === '') {
      throw new Error(`@zorb/aws/s3/sync: ${field}: s3:// URL must include a bucket`);
    }
    if (slash === -1) {
      return { kind: 's3', bucket: rest, prefix: '' };
    }
    const bucket = rest.slice(0, slash);
    let prefix = rest.slice(slash + 1);
    if (bucket === '') {
      throw new Error(`@zorb/aws/s3/sync: ${field}: s3:// URL must include a bucket`);
    }
    if (prefix !== '' && !prefix.endsWith('/')) prefix += '/';
    return { kind: 's3', bucket, prefix };
  }
  return { kind: 'local', path: resolve(cwd, raw) };
}

export function makeFilter(exclude: string[] | undefined, include: string[] | undefined): (key: string) => boolean {
  const ex = (exclude ?? []).map(globToRegExp);
  const inc = (include ?? []).map(globToRegExp);
  return (key) => {
    if (ex.some((re) => re.test(key))) {
      return inc.length > 0 && inc.some((re) => re.test(key));
    }
    return true;
  };
}

/**
 * Convert a `*` / `**` / `?` glob into an anchored regex matching forward-slash paths.
 *
 * `**` semantics follow gitignore / picomatch:
 * - `**` on its own (or as `**` at end-of-pattern) matches any number of path segments.
 * - `**\/` (followed by more pattern) matches zero or more full path segments and a
 *   trailing `/`, so `**\/foo.js` matches `foo.js`, `a/foo.js`, `a/b/foo.js` — but
 *   never `barfoo.js`, because the boundary is preserved.
 * - `*` and `?` stay within a single segment (never match `/`).
 */
export function globToRegExp(glob: string): RegExp {
  let re = '^';
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i += 2;
        if (glob[i] === '/') {
          // `**/` — zero or more full path segments, each followed by `/`.
          re += '(?:[^/]+/)*';
          i++;
        } else {
          // `**` — match anything (including slashes).
          re += '.*';
        }
      } else {
        re += '[^/]*';
        i++;
      }
    } else if (c === '?') {
      re += '[^/]';
      i++;
    } else if ('.+()|{}[]^$\\'.includes(c!)) {
      re += '\\' + c;
      i++;
    } else {
      re += c;
      i++;
    }
  }
  re += '$';
  return new RegExp(re);
}

export function joinKey(prefix: string, key: string): string {
  if (prefix === '') return key;
  return prefix + key;
}

function guessContentType(key: string): string | undefined {
  const dot = key.lastIndexOf('.');
  if (dot === -1) return undefined;
  const ext = key.slice(dot + 1).toLowerCase();
  return CONTENT_TYPES[ext];
}

const CONTENT_TYPES: Record<string, string> = {
  css: 'text/css',
  csv: 'text/csv',
  gif: 'image/gif',
  htm: 'text/html',
  html: 'text/html',
  ico: 'image/x-icon',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  js: 'application/javascript',
  json: 'application/json',
  mjs: 'application/javascript',
  pdf: 'application/pdf',
  png: 'image/png',
  svg: 'image/svg+xml',
  txt: 'text/plain',
  webp: 'image/webp',
  woff: 'font/woff',
  woff2: 'font/woff2',
  xml: 'application/xml',
};

async function walkLocal(root: string): Promise<LocalFile[]> {
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) {
    throw new Error(`@zorb/aws/s3/sync: local source is not a directory: ${root}`);
  }
  const out: LocalFile[] = [];
  await walk(root, root, out);
  return out;
}

async function walkLocalIfExists(root: string): Promise<LocalFile[]> {
  try {
    const s = await stat(root);
    if (!s.isDirectory()) return [];
  } catch (err) {
    if (isENoEnt(err)) return [];
    throw err;
  }
  return walkLocal(root);
}

async function walk(root: string, dir: string, out: LocalFile[]): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(root, abs, out);
    } else if (entry.isFile()) {
      const s = await stat(abs);
      out.push({ key: relative(root, abs).split(sep).join('/'), abs, size: s.size });
    }
  }
}

async function hashFile(path: string): Promise<string> {
  const h = createHash('md5');
  await pipeline(createReadStream(path), h);
  return h.digest('hex');
}

function isENoEnt(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
}

function buildClient(region: string | undefined): S3Client {
  const config: S3ClientConfig = {};
  if (region !== undefined) config.region = region;
  return new S3Client(config);
}

export function defaultOps(client: S3Client): S3Ops {
  return {
    async list(bucket, prefix) {
      const out: RemoteObject[] = [];
      let token: string | undefined;
      do {
        const res = await client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix === '' ? undefined : prefix,
            ContinuationToken: token,
          }),
        );
        for (const obj of res.Contents ?? []) {
          if (obj.Key === undefined) continue;
          const fullKey = obj.Key;
          const key = prefix === '' ? fullKey : fullKey.slice(prefix.length);
          if (key === '' || key.endsWith('/')) continue;
          out.push({
            key,
            fullKey,
            size: obj.Size ?? 0,
            etag: (obj.ETag ?? '').replace(/^"|"$/g, ''),
          });
        }
        token = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (token !== undefined);
      return out;
    },
    async upload(bucket, key, body, meta) {
      const upload = new Upload({
        client,
        params: {
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: meta.contentType,
          CacheControl: meta.cacheControl,
        },
      });
      await upload.done();
    },
    async download(bucket, key, target) {
      const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const body = res.Body;
      if (body === undefined) {
        throw new Error(`@zorb/aws/s3/sync: empty body for s3://${bucket}/${key}`);
      }
      await pipeline(body as unknown as Readable, target);
    },
    async remove(bucket, keys) {
      // DeleteObjects caps at 1000 keys per request.
      for (let i = 0; i < keys.length; i += 1000) {
        const chunk = keys.slice(i, i + 1000);
        await client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
          }),
        );
      }
    },
  };
}
