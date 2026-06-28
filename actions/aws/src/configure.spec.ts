import { describe, expect, test } from 'bun:test';
import { mockContext } from '@/shared/action-helpers/testing';
import {
  runConfigure,
  type AssumeRoleArgs,
  type AwsCredentials,
  type ConfigurePlan,
  type CredentialOps,
  type Identity,
} from './configure';

interface FakeBehaviour {
  defaultCreds?: AwsCredentials;
  profileCreds?: Record<string, AwsCredentials>;
  assumeResult?: AwsCredentials;
  identity?: Identity;
}

interface FakeRecords {
  defaultCalls: number;
  profileCalls: string[];
  assumeCalls: AssumeRoleArgs[];
  whoamiCalls: Array<{ creds: AwsCredentials; region: string | undefined }>;
}

function fakeOps(behaviour: FakeBehaviour = {}): CredentialOps & { records: FakeRecords } {
  const records: FakeRecords = {
    defaultCalls: 0,
    profileCalls: [],
    assumeCalls: [],
    whoamiCalls: [],
  };
  const defaultCreds = behaviour.defaultCreds ?? {
    accessKeyId: 'AKIA-default',
    secretAccessKey: 'secret-default',
    sessionToken: undefined,
  };
  const assumeResult = behaviour.assumeResult ?? {
    accessKeyId: 'ASIA-assumed',
    secretAccessKey: 'secret-assumed',
    sessionToken: 'session-assumed',
  };
  const identity = behaviour.identity ?? {
    accountId: '123456789012',
    arn: 'arn:aws:iam::123456789012:user/default',
    userId: 'AIDA-default',
  };
  return {
    records,
    async resolveDefault() {
      records.defaultCalls++;
      return defaultCreds;
    },
    async resolveProfile(profile) {
      records.profileCalls.push(profile);
      const fromMap = behaviour.profileCreds?.[profile];
      if (fromMap !== undefined) return fromMap;
      return { accessKeyId: `AKIA-${profile}`, secretAccessKey: `secret-${profile}`, sessionToken: undefined };
    },
    async assumeRole(args) {
      records.assumeCalls.push(args);
      return assumeResult;
    },
    async whoami(creds, region) {
      records.whoamiCalls.push({ creds, region });
      return identity;
    },
  };
}

function plan(overrides: Partial<ConfigurePlan> = {}): ConfigurePlan {
  return {
    region: undefined,
    profile: undefined,
    roleArn: undefined,
    sessionName: undefined,
    durationSeconds: undefined,
    externalId: undefined,
    ...overrides,
  };
}

describe('runConfigure — mode 1 (no args)', () => {
  test('resolves via the default chain, verifies, and registers env + secrets', async () => {
    const ops = fakeOps();
    const ctx = mockContext();

    const result = await runConfigure(plan(), ops, ctx);

    expect(ops.records.defaultCalls).toBe(1);
    expect(ops.records.profileCalls).toEqual([]);
    expect(ops.records.assumeCalls).toEqual([]);
    expect(result).toEqual({
      accountId: '123456789012',
      arn: 'arn:aws:iam::123456789012:user/default',
      userId: 'AIDA-default',
      region: undefined,
    });
    expect(ctx.env).toEqual([
      { name: 'AWS_ACCESS_KEY_ID', value: 'AKIA-default' },
      { name: 'AWS_SECRET_ACCESS_KEY', value: 'secret-default' },
    ]);
    expect(ctx.secrets).toEqual([
      { name: 'AWS_ACCESS_KEY_ID', value: 'AKIA-default' },
      { name: 'AWS_SECRET_ACCESS_KEY', value: 'secret-default' },
    ]);
  });

  test('passes region through to AWS_REGION and AWS_DEFAULT_REGION', async () => {
    const ops = fakeOps();
    const ctx = mockContext();

    const result = await runConfigure(plan({ region: 'eu-west-1' }), ops, ctx);

    expect(result.region).toBe('eu-west-1');
    expect(ctx.env).toContainEqual({ name: 'AWS_REGION', value: 'eu-west-1' });
    expect(ctx.env).toContainEqual({ name: 'AWS_DEFAULT_REGION', value: 'eu-west-1' });
  });

  test('forwards region to whoami so STS hits the right endpoint', async () => {
    const ops = fakeOps();
    await runConfigure(plan({ region: 'ap-southeast-2' }), ops, mockContext());
    expect(ops.records.whoamiCalls).toHaveLength(1);
    expect(ops.records.whoamiCalls[0]!.region).toBe('ap-southeast-2');
  });
});

describe('runConfigure — mode 2 (profile)', () => {
  test('resolves via fromIni and registers the profile credentials', async () => {
    const ops = fakeOps({
      profileCreds: { dev: { accessKeyId: 'AKIA-dev', secretAccessKey: 'secret-dev', sessionToken: undefined } },
    });
    const ctx = mockContext();

    await runConfigure(plan({ profile: 'dev', region: 'us-east-1' }), ops, ctx);

    expect(ops.records.defaultCalls).toBe(0);
    expect(ops.records.profileCalls).toEqual(['dev']);
    expect(ctx.env).toContainEqual({ name: 'AWS_ACCESS_KEY_ID', value: 'AKIA-dev' });
    expect(ctx.env).toContainEqual({ name: 'AWS_REGION', value: 'us-east-1' });
  });
});

describe('runConfigure — mode 3 (assume role)', () => {
  test('assumes the role from the default chain by default', async () => {
    const ops = fakeOps();
    const ctx = mockContext();

    await runConfigure(
      plan({
        roleArn: 'arn:aws:iam::999:role/Deploy',
        sessionName: 'zorb-deploy',
        region: 'us-east-1',
        durationSeconds: 1800,
        externalId: 'EXT-1',
      }),
      ops,
      ctx,
    );

    expect(ops.records.defaultCalls).toBe(0);
    expect(ops.records.profileCalls).toEqual([]);
    expect(ops.records.assumeCalls).toEqual([
      {
        roleArn: 'arn:aws:iam::999:role/Deploy',
        sessionName: 'zorb-deploy',
        region: 'us-east-1',
        durationSeconds: 1800,
        externalId: 'EXT-1',
        source: undefined,
      },
    ]);
    expect(ctx.env).toContainEqual({ name: 'AWS_ACCESS_KEY_ID', value: 'ASIA-assumed' });
    expect(ctx.env).toContainEqual({ name: 'AWS_SESSION_TOKEN', value: 'session-assumed' });
    expect(ctx.secrets).toContainEqual({ name: 'AWS_SESSION_TOKEN', value: 'session-assumed' });
  });

  test('sources the AssumeRole call from the supplied profile when both are set', async () => {
    const ops = fakeOps({
      profileCreds: { ops: { accessKeyId: 'AKIA-ops', secretAccessKey: 'secret-ops', sessionToken: undefined } },
    });
    const ctx = mockContext();

    await runConfigure(
      plan({
        profile: 'ops',
        roleArn: 'arn:aws:iam::999:role/Deploy',
        sessionName: 'zorb-deploy',
        region: 'us-east-1',
      }),
      ops,
      ctx,
    );

    expect(ops.records.profileCalls).toEqual(['ops']);
    expect(ops.records.assumeCalls).toHaveLength(1);
    expect(ops.records.assumeCalls[0]!.source).toEqual({
      accessKeyId: 'AKIA-ops',
      secretAccessKey: 'secret-ops',
      sessionToken: undefined,
    });
  });
});

describe('runConfigure — validation', () => {
  test('errors when roleArn is set without sessionName', async () => {
    await expect(runConfigure(plan({ roleArn: 'arn:aws:iam::1:role/X' }), fakeOps(), mockContext())).rejects.toThrow(
      /sessionName.*required when 'roleArn'/,
    );
  });

  test('errors when sessionName is set without roleArn', async () => {
    await expect(runConfigure(plan({ sessionName: 'orphan' }), fakeOps(), mockContext())).rejects.toThrow(
      /sessionName.*requires 'roleArn'/,
    );
  });

  test('errors when durationSeconds is set without roleArn', async () => {
    await expect(runConfigure(plan({ durationSeconds: 900 }), fakeOps(), mockContext())).rejects.toThrow(
      /durationSeconds.*only applies when assuming a role/,
    );
  });

  test('errors when externalId is set without roleArn', async () => {
    await expect(runConfigure(plan({ externalId: 'EXT' }), fakeOps(), mockContext())).rejects.toThrow(
      /externalId.*only applies when assuming a role/,
    );
  });
});

describe('runConfigure — secret/env interplay', () => {
  test('does not register AWS_SESSION_TOKEN when the source has no session token', async () => {
    const ops = fakeOps();
    const ctx = mockContext();

    await runConfigure(plan(), ops, ctx);

    expect(ctx.env.find((e) => e.name === 'AWS_SESSION_TOKEN')).toBeUndefined();
    expect(ctx.secrets.find((s) => s.name === 'AWS_SESSION_TOKEN')).toBeUndefined();
  });

  test('logs the resolved caller identity', async () => {
    const ops = fakeOps();
    const ctx = mockContext();
    await runConfigure(plan(), ops, ctx);
    expect(ctx.messages.info).toEqual(['configured AWS credentials for arn:aws:iam::123456789012:user/default']);
  });
});
