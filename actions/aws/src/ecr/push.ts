import { spawn } from 'node:child_process';
import {
  CreateRepositoryCommand,
  DescribeRepositoriesCommand,
  ECRClient,
  type ECRClientConfig,
  GetAuthorizationTokenCommand,
  RepositoryNotFoundException,
} from '@aws-sdk/client-ecr';
import type { ActionContext } from 'zorb/action';
import { input, type ActionInputs } from '@/shared/action-helpers';

export interface PushOutputs {
  registry: string;
  repository: string;
  accountId: string;
  imageUris: string[];
}

/**
 * AWS API calls the action needs. Behind an interface so unit tests can
 * inject deterministic fakes without prototype-patching the SDK.
 */
export interface EcrOps {
  getAuthorizationToken(): Promise<{ username: string; password: string; endpoint: string }>;
  describeRepository(name: string): Promise<{ exists: boolean }>;
  createRepository(name: string, opts: { scanOnPush: boolean; immutable: boolean }): Promise<void>;
}

/**
 * Docker CLI operations. Real impl shells out via `docker`; tests pass a fake
 * that records calls.
 */
export interface DockerOps {
  login(registry: string, username: string, password: string): Promise<void>;
  tag(source: string, target: string): Promise<void>;
  push(reference: string): Promise<void>;
}

export interface PushPlan {
  image: string;
  repository: string;
  tags: string[];
  region: string;
  createRepository: boolean;
  imageScanOnPush: boolean;
  immutable: boolean;
}

/**
 * Push a local Docker image to an Amazon ECR repository under one or more
 * tags. The registry URL is taken from `GetAuthorizationToken`'s
 * `proxyEndpoint` rather than constructed from `account + region`, so the
 * action is correct in non-standard partitions (AWS China's
 * `amazonaws.com.cn`, GovCloud, etc.).
 *
 * `createRepository: true` calls `DescribeRepositories` first; if the
 * repository does not exist it is created with the supplied
 * `imageScanOnPush` and `immutable` settings. Otherwise a missing repository
 * surfaces as the usual `docker push` failure.
 *
 * Requires a working `docker` CLI on PATH and AWS credentials resolvable via
 * the default provider chain (use `@zorb/aws/configure` to publish them).
 */
export async function action(rawInputs: ActionInputs, context: ActionContext): Promise<PushOutputs> {
  const plan: PushPlan = {
    image: input.string(rawInputs, 'image'),
    repository: input.string(rawInputs, 'repository'),
    tags: input.optional.strings(rawInputs, 'tags') ?? ['latest'],
    region: resolveRegion(input.optional.string(rawInputs, 'region')),
    createRepository: input.boolean(rawInputs, 'createRepository', { default: false }),
    imageScanOnPush: input.boolean(rawInputs, 'imageScanOnPush', { default: true }),
    immutable: input.boolean(rawInputs, 'immutable', { default: false }),
  };

  if (plan.tags.length === 0) {
    throw new Error('@zorb/aws/ecr/push: tags must contain at least one value');
  }

  const ecr = new ECRClient(clientConfig(plan.region));
  return runPush(plan, { ecr: defaultEcrOps(ecr), docker: defaultDockerOps() }, context);
}

export async function runPush(
  plan: PushPlan,
  deps: { ecr: EcrOps; docker: DockerOps },
  context: ActionContext,
): Promise<PushOutputs> {
  if (plan.createRepository) {
    const { exists } = await deps.ecr.describeRepository(plan.repository);
    if (!exists) {
      context.log.info(`creating ECR repository '${plan.repository}'`);
      await deps.ecr.createRepository(plan.repository, {
        scanOnPush: plan.imageScanOnPush,
        immutable: plan.immutable,
      });
    }
  }

  const auth = await deps.ecr.getAuthorizationToken();
  const registry = parseRegistryHost(auth.endpoint);
  const accountId = parseAccountId(registry);

  await deps.docker.login(registry, auth.username, auth.password);

  const imageUris: string[] = [];
  for (const tag of plan.tags) {
    const target = `${registry}/${plan.repository}:${tag}`;
    await deps.docker.tag(plan.image, target);
    context.log.info(`push ${target}`);
    await deps.docker.push(target);
    imageUris.push(target);
  }

  return { registry, repository: plan.repository, accountId, imageUris };
}

export function parseRegistryHost(proxyEndpoint: string): string {
  try {
    const url = new URL(proxyEndpoint);
    return url.host;
  } catch {
    throw new Error(`@zorb/aws/ecr/push: ECR returned a malformed proxyEndpoint '${proxyEndpoint}'`);
  }
}

export function parseAccountId(registryHost: string): string {
  const match = /^(\d+)\.dkr\.ecr\./.exec(registryHost);
  if (!match) {
    throw new Error(`@zorb/aws/ecr/push: could not extract account id from registry '${registryHost}'`);
  }
  return match[1]!;
}

function resolveRegion(explicit: string | undefined): string {
  if (explicit !== undefined) return explicit;
  const fromEnv = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  throw new Error(
    "@zorb/aws/ecr/push: region must be set via the 'region' input or AWS_REGION / AWS_DEFAULT_REGION env var",
  );
}

function clientConfig(region: string): ECRClientConfig {
  return { region };
}

export function defaultEcrOps(client: ECRClient): EcrOps {
  return {
    async getAuthorizationToken() {
      const res = await client.send(new GetAuthorizationTokenCommand({}));
      const data = res.authorizationData?.[0];
      if (!data?.authorizationToken || !data.proxyEndpoint) {
        throw new Error('@zorb/aws/ecr/push: ECR returned an empty authorization token');
      }
      const decoded = Buffer.from(data.authorizationToken, 'base64').toString('utf8');
      const colon = decoded.indexOf(':');
      if (colon === -1) {
        throw new Error('@zorb/aws/ecr/push: malformed authorization token from ECR');
      }
      return {
        username: decoded.slice(0, colon),
        password: decoded.slice(colon + 1),
        endpoint: data.proxyEndpoint,
      };
    },
    async describeRepository(name) {
      try {
        await client.send(new DescribeRepositoriesCommand({ repositoryNames: [name] }));
        return { exists: true };
      } catch (err) {
        if (err instanceof RepositoryNotFoundException) return { exists: false };
        throw err;
      }
    },
    async createRepository(name, opts) {
      await client.send(
        new CreateRepositoryCommand({
          repositoryName: name,
          imageScanningConfiguration: { scanOnPush: opts.scanOnPush },
          imageTagMutability: opts.immutable ? 'IMMUTABLE' : 'MUTABLE',
        }),
      );
    },
  };
}

export function defaultDockerOps(): DockerOps {
  return {
    async login(registry, username, password) {
      await runDocker(['login', '--username', username, '--password-stdin', registry], password);
    },
    async tag(source, target) {
      await runDocker(['tag', source, target]);
    },
    async push(reference) {
      await runDocker(['push', reference]);
    },
  };
}

function runDocker(args: string[], stdin?: string): Promise<void> {
  return new Promise((resolveFn, rejectFn) => {
    const child = spawn('docker', args, { stdio: ['pipe', 'inherit', 'inherit'] });
    child.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        rejectFn(new Error("@zorb/aws/ecr/push: 'docker' CLI not found on PATH"));
      } else {
        rejectFn(err);
      }
    });
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolveFn();
        return;
      }
      const detail = signal ? `signal ${signal}` : `exit code ${code}`;
      rejectFn(new Error(`@zorb/aws/ecr/push: 'docker ${args[0]}' failed (${detail})`));
    });
    if (stdin !== undefined) child.stdin.end(stdin);
    else child.stdin.end();
  });
}
