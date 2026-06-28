import { describe, expect, test } from 'bun:test';
import { mockContext } from '@/shared/action-helpers/testing';
import { parseAccountId, parseRegistryHost, runPush, type DockerOps, type EcrOps, type PushPlan } from './push';

interface DockerCall {
  kind: 'login' | 'tag' | 'push';
  args: string[];
}

function fakeDocker(): DockerOps & { calls: DockerCall[] } {
  const calls: DockerCall[] = [];
  return {
    calls,
    async login(registry, username, password) {
      calls.push({ kind: 'login', args: [registry, username, password] });
    },
    async tag(source, target) {
      calls.push({ kind: 'tag', args: [source, target] });
    },
    async push(reference) {
      calls.push({ kind: 'push', args: [reference] });
    },
  };
}

interface FakeEcrOpts {
  repoExists?: boolean;
  endpoint?: string;
}

function fakeEcr(opts: FakeEcrOpts = {}): EcrOps & {
  describeCalls: string[];
  createCalls: Array<{ name: string; scanOnPush: boolean; immutable: boolean }>;
} {
  let exists = opts.repoExists ?? true;
  const endpoint = opts.endpoint ?? 'https://123456789012.dkr.ecr.us-east-1.amazonaws.com';
  const describeCalls: string[] = [];
  const createCalls: Array<{ name: string; scanOnPush: boolean; immutable: boolean }> = [];
  return {
    describeCalls,
    createCalls,
    async getAuthorizationToken() {
      return { username: 'AWS', password: 'pw-token', endpoint };
    },
    async describeRepository(name) {
      describeCalls.push(name);
      return { exists };
    },
    async createRepository(name, o) {
      createCalls.push({ name, scanOnPush: o.scanOnPush, immutable: o.immutable });
      exists = true;
    },
  };
}

function plan(overrides: Partial<PushPlan> = {}): PushPlan {
  return {
    image: 'myapp:dev',
    repository: 'myapp',
    tags: ['latest'],
    region: 'us-east-1',
    createRepository: false,
    imageScanOnPush: true,
    immutable: false,
    ...overrides,
  };
}

describe('parseRegistryHost', () => {
  test('strips the URL scheme', () => {
    expect(parseRegistryHost('https://123456789012.dkr.ecr.us-east-1.amazonaws.com')).toBe(
      '123456789012.dkr.ecr.us-east-1.amazonaws.com',
    );
  });

  test('works for the AWS China partition', () => {
    expect(parseRegistryHost('https://123456789012.dkr.ecr.cn-north-1.amazonaws.com.cn')).toBe(
      '123456789012.dkr.ecr.cn-north-1.amazonaws.com.cn',
    );
  });

  test('throws on a malformed endpoint', () => {
    expect(() => parseRegistryHost('not a url')).toThrow(/malformed proxyEndpoint/);
  });
});

describe('parseAccountId', () => {
  test('extracts the account id from a standard registry host', () => {
    expect(parseAccountId('123456789012.dkr.ecr.us-east-1.amazonaws.com')).toBe('123456789012');
  });

  test('extracts the account id from a China-partition registry host', () => {
    expect(parseAccountId('999988887777.dkr.ecr.cn-north-1.amazonaws.com.cn')).toBe('999988887777');
  });

  test('throws when the host does not match the expected shape', () => {
    expect(() => parseAccountId('example.com')).toThrow(/could not extract account id/);
  });
});

describe('runPush', () => {
  test('uses proxyEndpoint as the registry source of truth', async () => {
    const docker = fakeDocker();
    const ecr = fakeEcr({ endpoint: 'https://999988887777.dkr.ecr.cn-north-1.amazonaws.com.cn' });

    const result = await runPush(plan({ region: 'cn-north-1', tags: ['v1'] }), { ecr, docker }, mockContext());

    expect(result.registry).toBe('999988887777.dkr.ecr.cn-north-1.amazonaws.com.cn');
    expect(result.accountId).toBe('999988887777');
    expect(result.imageUris).toEqual(['999988887777.dkr.ecr.cn-north-1.amazonaws.com.cn/myapp:v1']);
    expect(docker.calls[0]).toEqual({
      kind: 'login',
      args: ['999988887777.dkr.ecr.cn-north-1.amazonaws.com.cn', 'AWS', 'pw-token'],
    });
  });

  test('logs in, tags, and pushes each tag', async () => {
    const docker = fakeDocker();
    const ecr = fakeEcr();

    const result = await runPush(plan({ tags: ['latest', 'v1.2.3'] }), { ecr, docker }, mockContext());

    expect(result.registry).toBe('123456789012.dkr.ecr.us-east-1.amazonaws.com');
    expect(result.accountId).toBe('123456789012');
    expect(result.repository).toBe('myapp');
    expect(result.imageUris).toEqual([
      '123456789012.dkr.ecr.us-east-1.amazonaws.com/myapp:latest',
      '123456789012.dkr.ecr.us-east-1.amazonaws.com/myapp:v1.2.3',
    ]);
    expect(docker.calls).toEqual([
      { kind: 'login', args: ['123456789012.dkr.ecr.us-east-1.amazonaws.com', 'AWS', 'pw-token'] },
      { kind: 'tag', args: ['myapp:dev', '123456789012.dkr.ecr.us-east-1.amazonaws.com/myapp:latest'] },
      { kind: 'push', args: ['123456789012.dkr.ecr.us-east-1.amazonaws.com/myapp:latest'] },
      { kind: 'tag', args: ['myapp:dev', '123456789012.dkr.ecr.us-east-1.amazonaws.com/myapp:v1.2.3'] },
      { kind: 'push', args: ['123456789012.dkr.ecr.us-east-1.amazonaws.com/myapp:v1.2.3'] },
    ]);
  });

  test('does not check or create the repository when createRepository is false', async () => {
    const docker = fakeDocker();
    const ecr = fakeEcr({ repoExists: false });

    await runPush(plan(), { ecr, docker }, mockContext());

    expect(ecr.describeCalls).toEqual([]);
    expect(ecr.createCalls).toEqual([]);
  });

  test('creates the repository when missing and createRepository is true', async () => {
    const docker = fakeDocker();
    const ecr = fakeEcr({ repoExists: false });

    await runPush(
      plan({ createRepository: true, immutable: true, imageScanOnPush: false }),
      { ecr, docker },
      mockContext(),
    );

    expect(ecr.describeCalls).toEqual(['myapp']);
    expect(ecr.createCalls).toEqual([{ name: 'myapp', scanOnPush: false, immutable: true }]);
  });

  test('skips creation when the repository already exists', async () => {
    const docker = fakeDocker();
    const ecr = fakeEcr({ repoExists: true });

    await runPush(plan({ createRepository: true }), { ecr, docker }, mockContext());

    expect(ecr.describeCalls).toEqual(['myapp']);
    expect(ecr.createCalls).toEqual([]);
  });
});
