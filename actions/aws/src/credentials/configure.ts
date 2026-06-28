import { AssumeRoleCommand, GetCallerIdentityCommand, STSClient, type STSClientConfig } from '@aws-sdk/client-sts';
import { fromIni, fromNodeProviderChain } from '@aws-sdk/credential-providers';
import type { ActionContext } from 'zorb/action';
import { input, type ActionInputs } from '@/shared/action-helpers';

export interface ConfigureOutputs {
  accountId: string;
  arn: string;
  userId: string;
  region: string | undefined;
}

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string | undefined;
}

export interface Identity {
  accountId: string;
  arn: string;
  userId: string;
}

export interface AssumeRoleArgs {
  roleArn: string;
  sessionName: string;
  region: string | undefined;
  durationSeconds: number | undefined;
  externalId: string | undefined;
  /** When undefined, the default provider chain is used as the source identity. */
  source: AwsCredentials | undefined;
}

/**
 * Credential operations the action needs. Extracted behind an interface so
 * the spec can substitute deterministic fakes — no network, no env reads.
 */
export interface CredentialOps {
  resolveDefault(): Promise<AwsCredentials>;
  resolveProfile(profile: string): Promise<AwsCredentials>;
  assumeRole(args: AssumeRoleArgs): Promise<AwsCredentials>;
  whoami(creds: AwsCredentials, region: string | undefined): Promise<Identity>;
}

export interface ConfigurePlan {
  region: string | undefined;
  profile: string | undefined;
  roleArn: string | undefined;
  sessionName: string | undefined;
  durationSeconds: number | undefined;
  externalId: string | undefined;
}

/**
 * Configure AWS credentials for subsequent steps in a zorb run. Resolves a
 * credential set in one of three modes:
 *
 * 1. **No args** — the SDK's default credential provider chain (env vars,
 *    shared config, SSO, IMDS, …). Zorb does not pass shell env into actions
 *    implicitly, so this only works if the credentials are reachable via
 *    files (e.g. `~/.aws/credentials`, SSO cache) or instance metadata.
 * 2. **`profile`** — load from a named profile in `~/.aws/credentials` /
 *    `~/.aws/config`. SSO and `source_profile` chains are honoured.
 * 3. **`roleArn` + `sessionName`** — call `sts:AssumeRole`. The source
 *    identity is the default chain unless `profile` is also set, in which
 *    case the profile is used as the source.
 *
 * In every mode the action calls `sts:GetCallerIdentity` to verify the
 * credentials work and capture the identity for the step outputs and the log
 * line. The resolved credentials are then exposed to subsequent steps via:
 *
 * - `context.setEnv` for `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
 *   `AWS_SESSION_TOKEN` (when present), and `AWS_REGION` /
 *   `AWS_DEFAULT_REGION` (when `region` is supplied). Subsequent SDK clients
 *   and any `aws` CLI invocations in `run:` blocks pick these up natively.
 * - `context.setSecret` for the same key / secret / session-token triplet so
 *   they are masked in step stdout/stderr if they ever leak.
 */
export async function action(rawInputs: ActionInputs, context: ActionContext): Promise<ConfigureOutputs> {
  const plan: ConfigurePlan = {
    region: input.optional.string(rawInputs, 'region'),
    profile: input.optional.string(rawInputs, 'profile'),
    roleArn: input.optional.string(rawInputs, 'roleArn'),
    sessionName: input.optional.string(rawInputs, 'sessionName'),
    durationSeconds: input.optional.number(rawInputs, 'durationSeconds'),
    externalId: input.optional.string(rawInputs, 'externalId'),
  };

  return runConfigure(plan, defaultOps(), context);
}

export async function runConfigure(
  plan: ConfigurePlan,
  ops: CredentialOps,
  context: ActionContext,
): Promise<ConfigureOutputs> {
  validate(plan);
  const creds = await resolveCredentials(plan, ops);
  const identity = await ops.whoami(creds, plan.region);

  context.setSecret('AWS_ACCESS_KEY_ID', creds.accessKeyId);
  context.setSecret('AWS_SECRET_ACCESS_KEY', creds.secretAccessKey);
  context.setEnv('AWS_ACCESS_KEY_ID', creds.accessKeyId);
  context.setEnv('AWS_SECRET_ACCESS_KEY', creds.secretAccessKey);
  if (creds.sessionToken !== undefined) {
    context.setSecret('AWS_SESSION_TOKEN', creds.sessionToken);
    context.setEnv('AWS_SESSION_TOKEN', creds.sessionToken);
  }
  if (plan.region !== undefined) {
    context.setEnv('AWS_REGION', plan.region);
    context.setEnv('AWS_DEFAULT_REGION', plan.region);
  }

  context.log.info(`configured AWS credentials for ${identity.arn}`);

  return {
    accountId: identity.accountId,
    arn: identity.arn,
    userId: identity.userId,
    region: plan.region,
  };
}

function validate(plan: ConfigurePlan): void {
  if (plan.roleArn !== undefined && plan.sessionName === undefined) {
    throw new Error("@zorb/aws/credentials/configure: 'sessionName' is required when 'roleArn' is set");
  }
  if (plan.sessionName !== undefined && plan.roleArn === undefined) {
    throw new Error("@zorb/aws/credentials/configure: 'sessionName' requires 'roleArn' to be set");
  }
  if (plan.durationSeconds !== undefined && plan.roleArn === undefined) {
    throw new Error("@zorb/aws/credentials/configure: 'durationSeconds' only applies when assuming a role");
  }
  if (plan.externalId !== undefined && plan.roleArn === undefined) {
    throw new Error("@zorb/aws/credentials/configure: 'externalId' only applies when assuming a role");
  }
}

async function resolveCredentials(plan: ConfigurePlan, ops: CredentialOps): Promise<AwsCredentials> {
  if (plan.roleArn !== undefined && plan.sessionName !== undefined) {
    const source = plan.profile !== undefined ? await ops.resolveProfile(plan.profile) : undefined;
    return ops.assumeRole({
      roleArn: plan.roleArn,
      sessionName: plan.sessionName,
      region: plan.region,
      durationSeconds: plan.durationSeconds,
      externalId: plan.externalId,
      source,
    });
  }
  if (plan.profile !== undefined) {
    return ops.resolveProfile(plan.profile);
  }
  return ops.resolveDefault();
}

export function defaultOps(): CredentialOps {
  return {
    async resolveDefault() {
      const provider = fromNodeProviderChain();
      return materialize(await provider());
    },
    async resolveProfile(profile) {
      const provider = fromIni({ profile });
      return materialize(await provider());
    },
    async assumeRole(args) {
      const stsConfig: STSClientConfig = {};
      if (args.region !== undefined) stsConfig.region = args.region;
      if (args.source !== undefined) {
        stsConfig.credentials = {
          accessKeyId: args.source.accessKeyId,
          secretAccessKey: args.source.secretAccessKey,
          sessionToken: args.source.sessionToken,
        };
      }
      const sts = new STSClient(stsConfig);
      const res = await sts.send(
        new AssumeRoleCommand({
          RoleArn: args.roleArn,
          RoleSessionName: args.sessionName,
          DurationSeconds: args.durationSeconds,
          ExternalId: args.externalId,
        }),
      );
      const c = res.Credentials;
      if (!c?.AccessKeyId || !c.SecretAccessKey) {
        throw new Error('@zorb/aws/credentials/configure: sts:AssumeRole returned incomplete credentials');
      }
      return {
        accessKeyId: c.AccessKeyId,
        secretAccessKey: c.SecretAccessKey,
        sessionToken: c.SessionToken ?? undefined,
      };
    },
    async whoami(creds, region) {
      const stsConfig: STSClientConfig = {
        credentials: {
          accessKeyId: creds.accessKeyId,
          secretAccessKey: creds.secretAccessKey,
          sessionToken: creds.sessionToken,
        },
      };
      if (region !== undefined) stsConfig.region = region;
      const sts = new STSClient(stsConfig);
      const res = await sts.send(new GetCallerIdentityCommand({}));
      if (!res.Account || !res.Arn || !res.UserId) {
        throw new Error('@zorb/aws/credentials/configure: sts:GetCallerIdentity returned an incomplete response');
      }
      return { accountId: res.Account, arn: res.Arn, userId: res.UserId };
    },
  };
}

function materialize(c: { accessKeyId: string; secretAccessKey: string; sessionToken?: string }): AwsCredentials {
  return {
    accessKeyId: c.accessKeyId,
    secretAccessKey: c.secretAccessKey,
    sessionToken: c.sessionToken,
  };
}
