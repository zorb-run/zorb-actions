import { describe, expect, test } from 'bun:test';
import { mockContext } from '@/shared/action-helpers/testing';
import { runPush, type DockerOps, type EcrOps, type PushPlan, type StsOps } from './push';

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

function fakeEcr(opts: { repoExists?: boolean } = {}): EcrOps & {
  describeCalls: string[];
  createCalls: Array<{ name: string; scanOnPush: boolean; immutable: boolean }>;
} {
  let exists = opts.repoExists ?? true;
  const describeCalls: string[] = [];
  const createCalls: Array<{ name: string; scanOnPush: boolean; immutable: boolean }> = [];
  return {
    describeCalls,
    createCalls,
    async getAuthorizationToken() {
      return { username: 'AWS', password: 'pw-token', endpoint: 'https://123.dkr.ecr.us-east-1.amazonaws.com' };
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

function fakeSts(account: string): StsOps & { called: number } {
  let called = 0;
  return {
    get called() {
      return called;
    },
    set called(_v) {
      called = _v;
    },
    async getAccountId() {
      called++;
      return account;
    },
  };
}

function plan(overrides: Partial<PushPlan> = {}): PushPlan {
  return {
    image: 'myapp:dev',
    repository: 'myapp',
    tags: ['latest'],
    region: 'us-east-1',
    accountId: '123456789012',
    createRepository: false,
    imageScanOnPush: true,
    immutable: false,
    ...overrides,
  };
}

describe('runPush', () => {
  test('logs in, tags, and pushes each tag', async () => {
    const docker = fakeDocker();
    const ecr = fakeEcr();
    const sts = fakeSts('UNUSED');

    const result = await runPush(plan({ tags: ['latest', 'v1.2.3'] }), { ecr, sts, docker }, mockContext());

    expect(result.registry).toBe('123456789012.dkr.ecr.us-east-1.amazonaws.com');
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
    expect(sts.called).toBe(0);
  });

  test('falls back to STS GetCallerIdentity when accountId is not supplied', async () => {
    const docker = fakeDocker();
    const ecr = fakeEcr();
    const sts = fakeSts('999988887777');

    const result = await runPush(plan({ accountId: undefined }), { ecr, sts, docker }, mockContext());

    expect(sts.called).toBe(1);
    expect(result.registry).toBe('999988887777.dkr.ecr.us-east-1.amazonaws.com');
  });

  test('does not check or create the repository when createRepository is false', async () => {
    const docker = fakeDocker();
    const ecr = fakeEcr({ repoExists: false });
    const sts = fakeSts('UNUSED');

    await runPush(plan(), { ecr, sts, docker }, mockContext());

    expect(ecr.describeCalls).toEqual([]);
    expect(ecr.createCalls).toEqual([]);
  });

  test('creates the repository when missing and createRepository is true', async () => {
    const docker = fakeDocker();
    const ecr = fakeEcr({ repoExists: false });
    const sts = fakeSts('UNUSED');

    await runPush(
      plan({ createRepository: true, immutable: true, imageScanOnPush: false }),
      { ecr, sts, docker },
      mockContext(),
    );

    expect(ecr.describeCalls).toEqual(['myapp']);
    expect(ecr.createCalls).toEqual([{ name: 'myapp', scanOnPush: false, immutable: true }]);
  });

  test('skips creation when the repository already exists', async () => {
    const docker = fakeDocker();
    const ecr = fakeEcr({ repoExists: true });
    const sts = fakeSts('UNUSED');

    await runPush(plan({ createRepository: true }), { ecr, sts, docker }, mockContext());

    expect(ecr.describeCalls).toEqual(['myapp']);
    expect(ecr.createCalls).toEqual([]);
  });
});
