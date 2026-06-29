# @zorb/aws

AWS service actions for [zorb](https://github.com/zorb-run/zorb-cli) workflows. Built on the AWS SDK v3.

> Ships `configure`, `s3/sync`, `ecr/push`, and `lambda/invoke`. SSM and friends ship in follow-up releases.

## Install

```sh
npm install @zorb/aws
yarn add @zorb/aws
pnpm add @zorb/aws
bun add @zorb/aws
```

## Authentication

zorb does not pass the calling shell's environment into actions implicitly, so the AWS SDK's default credential provider
chain only sees what zorb has been told about explicitly.

**Every `@zorb/aws/*` action requires AWS credentials to be present in the run-scoped env table — call
[`@zorb/aws/configure`](https://github.com/zorb-run/zorb-actions/tree/main/actions/aws#zorbawsconfigure) first to
publish them.** Without it the underlying SDK clients have nothing to authenticate with and will fail.

```yml
secrets:
  - uses: '@zorb/aws/configure'
    with:
      profile: deploy
      region: us-east-1

tasks:
  release:
    steps:
      - uses: '@zorb/aws/s3/sync'
        with:
          source: ./dist
          destination: s3://my-site
```

See [`@zorb/aws/configure`](https://github.com/zorb-run/zorb-actions/tree/main/actions/aws#zorbawsconfigure) for the
three supported modes (default chain, named profile, role assumption).

## Actions

### `@zorb/aws/configure`

Resolve a set of AWS credentials and publish them to subsequent steps. Three modes, selected by which inputs are
present:

| Mode             | Inputs                                           | What Happens                                                                                 |
| ---------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| 1. default chain | (no auth inputs; `region` optional)              | SDK default chain (env, `~/.aws/*`, SSO cache, IMDS), then `sts:GetCallerIdentity` to verify |
| 2. named profile | `profile` (`region` optional)                    | `fromIni({ profile })`, then verify                                                          |
| 3. assume role   | `roleArn` + `sessionName` (+ optional `profile`) | `sts:AssumeRole` (sourced from the profile if supplied, otherwise the default chain)         |

```yml
# Mode 1 — pick whatever the default chain finds
- uses: '@zorb/aws/configure'
  with:
    region: us-east-1

# Mode 2 — use a named profile from ~/.aws/credentials
- uses: '@zorb/aws/configure'
  with:
    profile: deploy
    region: us-east-1

# Mode 3 — assume a role
- uses: '@zorb/aws/configure'
  with:
    roleArn: arn:aws:iam::123456789012:role/Deploy
    sessionName: zorb-deploy
    region: us-east-1
    durationSeconds: 1800
```

| Input             | Type   | Required              | Default           | Description                                                                  |
| ----------------- | ------ | --------------------- | ----------------- | ---------------------------------------------------------------------------- |
| `region`          | string | no                    | —                 | AWS region — set as `AWS_REGION`/`AWS_DEFAULT_REGION` and used for STS calls |
| `profile`         | string | no                    | —                 | named profile from `~/.aws/credentials` / `~/.aws/config`                    |
| `roleArn`         | string | no                    | —                 | role to assume; requires `sessionName`                                       |
| `sessionName`     | string | when `roleArn` is set | —                 | session name passed to `sts:AssumeRole`                                      |
| `durationSeconds` | number | no (role mode only)   | SDK default (1 h) | session lifetime in seconds                                                  |
| `externalId`      | string | no (role mode only)   | —                 | external ID for cross-account trust                                          |

| Output      | Type   | Description                                         |
| ----------- | ------ | --------------------------------------------------- |
| `accountId` | string | account from `sts:GetCallerIdentity`                |
| `arn`       | string | caller ARN (assumed-role ARN in mode 3)             |
| `userId`    | string | unique principal ID                                 |
| `region`    | string | the `region` input as supplied (undefined if unset) |

**Side effects.** On success the action calls `context.setEnv` for `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
`AWS_SESSION_TOKEN` (when present), and `AWS_REGION` / `AWS_DEFAULT_REGION` (when `region` is set). The same key /
secret / session-token triplet is also registered via `context.setSecret` so the values are masked anywhere they appear
in step stdout/stderr.

### `@zorb/aws/s3/sync`

Sync files between a local directory and an S3 prefix (in either direction). S3-to-S3 syncs are not supported yet — for
those, fall back to the `aws` CLI.

> Requires [`@zorb/aws/configure`](https://github.com/zorb-run/zorb-actions/tree/main/actions/aws#zorbawsconfigure) to
> have run earlier in the same task (or via the top-level `secrets:` block).

```yml
steps:
  - uses: '@zorb/aws/s3/sync'
    with:
      source: ./dist
      destination: s3://my-site/assets
      delete: true
      exclude: ['**/*.map']
      cacheControl: public, max-age=31536000, immutable
```

…or directly from the CLI:

```sh
zorb use @zorb/aws/s3/sync --with source=./dist destination=s3://my-site/assets delete=true
```

| Input          | Type               | Required | Default                             | Description                                              |
| -------------- | ------------------ | -------- | ----------------------------------- | -------------------------------------------------------- |
| `source`       | string             | yes      | —                                   | local path or `s3://bucket[/prefix]`                     |
| `destination`  | string             | yes      | —                                   | local path or `s3://bucket[/prefix]`                     |
| `delete`       | boolean            | no       | `false`                             | remove objects at destination missing from source        |
| `exclude`      | string \| string[] | no       | —                                   | skip keys matching these globs                           |
| `include`      | string \| string[] | no       | —                                   | rescue excluded keys matching these globs                |
| `region`       | string             | no       | `AWS_REGION` / `AWS_DEFAULT_REGION` | explicit AWS region (overrides what `configure` set)     |
| `dryRun`       | boolean            | no       | `false`                             | log intended uploads/deletes without making any S3 calls |
| `cacheControl` | string             | no       | —                                   | `Cache-Control` header for uploaded objects              |
| `contentType`  | string             | no       | inferred from extension             | override `Content-Type` for every uploaded object        |

| Output       | Type   | Description                                  |
| ------------ | ------ | -------------------------------------------- |
| `uploaded`   | number | objects sent to S3                           |
| `downloaded` | number | objects fetched from S3                      |
| `deleted`    | number | objects removed (at the destination)         |
| `skipped`    | number | objects that already matched the destination |

**Comparison strategy.** For each candidate, the action compares against the destination by S3 ETag:

- Single-part ETags are compared against the MD5 of the local file.
- Multipart ETags (containing `-`) fall back to a size comparison.

This is tuned for static-site deploys (write-many, deterministic content). `aws s3 sync`'s mtime-based heuristic is not
emulated.

**Globs.** Supports `*` (within a path segment), `**` (across segments), and `?` (any single non-slash char). Patterns
are matched against the source-relative key using forward slashes on every platform. `exclude:` runs first, then
`include:` rescues anything you want to keep despite an exclude rule.

**Content types.** A small built-in table maps common extensions (`html`, `css`, `js`, `json`, `svg`, `png`, …) to MIME
types. Anything not in the table uploads without an explicit `Content-Type` (S3 stores it as
`application/octet-stream`). Set `contentType:` to override across the board for that step.

**Safety.** When downloading, S3 object keys containing `..` segments that would resolve outside the destination root
are rejected with an explicit error. S3 keys are attacker-controllable in many deployment models, so the destination
root is treated as a hard boundary.

### `@zorb/aws/ecr/push`

Push a local Docker image to an Amazon ECR repository under one or more tags. Auth happens via
`ecr:GetAuthorizationToken`; you do **not** need to run `aws ecr get-login-password` beforehand.

> Requires [`@zorb/aws/configure`](https://github.com/zorb-run/zorb-actions/tree/main/actions/aws#zorbawsconfigure) to
> have run earlier in the same task (or via the top-level `secrets:` block), plus a working `docker` CLI on PATH.

```yml
steps:
  - uses: '@zorb/aws/ecr/push'
    with:
      image: myapp:dev
      repository: myapp
      tags: [latest, '${{ inputs.version }}']
      region: us-east-1
      createRepository: true
```

…or directly from the CLI (single tag — use the YAML form for multiple):

```sh
zorb use @zorb/aws/ecr/push --with image=myapp:dev repository=myapp tags=latest region=us-east-1
```

| Input              | Type               | Required | Default                             | Description                                                                                     |
| ------------------ | ------------------ | -------- | ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| `image`            | string             | yes      | —                                   | local image reference (`name:tag`, image ID, etc.)                                              |
| `repository`       | string             | yes      | —                                   | ECR repository name (no registry prefix)                                                        |
| `tags`             | string \| string[] | no       | `['latest']`                        | tags to publish under                                                                           |
| `region`           | string             | no       | `AWS_REGION` / `AWS_DEFAULT_REGION` | AWS region of the ECR registry (overrides what `configure` set)                                 |
| `createRepository` | boolean            | no       | `false`                             | create the repository (via `ecr:DescribeRepositories` + `CreateRepository`) if it doesn't exist |
| `imageScanOnPush`  | boolean            | no       | `true`                              | scan-on-push setting when creating the repository                                               |
| `immutable`        | boolean            | no       | `false`                             | use `IMMUTABLE` tag mutability when creating the repository                                     |

| Output       | Type     | Description                                                          |
| ------------ | -------- | -------------------------------------------------------------------- |
| `registry`   | string   | registry host (e.g. `{account}.dkr.ecr.{region}.amazonaws.com[.cn]`) |
| `accountId`  | string   | AWS account id extracted from the registry host                      |
| `repository` | string   | the repository name (as supplied)                                    |
| `imageUris`  | string[] | one fully-qualified `registry/repo:tag` per pushed tag               |

The registry URL comes from the `proxyEndpoint` returned by `ecr:GetAuthorizationToken`, so the action works unmodified
in non-standard partitions (AWS China's `amazonaws.com.cn`, GovCloud, etc.).

### `@zorb/aws/lambda/invoke`

Invoke a Lambda function and capture its response. Payload is sent as JSON; objects are stringified automatically,
strings are forwarded verbatim. The response body is JSON-parsed when possible and surfaced as `outputs.response`.

> Requires [`@zorb/aws/configure`](https://github.com/zorb-run/zorb-actions/tree/main/actions/aws#zorbawsconfigure) to
> have run earlier in the same task (or via the top-level `secrets:` block).

```yml
steps:
  - id: hello
    uses: '@zorb/aws/lambda/invoke'
    with:
      functionName: hello-world
      qualifier: prod
      payload:
        name: zorb
      logType: Tail
```

…or directly from the CLI (payload is passed as a JSON string):

```sh
zorb use @zorb/aws/lambda/invoke --with functionName=hello-world payload='{"name":"zorb"}' logType=Tail
```

| Input            | Type    | Required | Default                             | Description                                                                                 |
| ---------------- | ------- | -------- | ----------------------------------- | ------------------------------------------------------------------------------------------- |
| `functionName`   | string  | yes      | —                                   | Lambda function name or ARN                                                                 |
| `payload`        | any     | no       | —                                   | JSON-serialisable value (object/array/scalar) or a pre-serialised string                    |
| `invocationType` | string  | no       | `RequestResponse`                   | one of `RequestResponse`, `Event`, `DryRun`                                                 |
| `qualifier`      | string  | no       | —                                   | function version (`$LATEST`, `42`) or alias name                                            |
| `region`         | string  | no       | `AWS_REGION` / `AWS_DEFAULT_REGION` | explicit AWS region (overrides what `configure` set)                                        |
| `logType`        | string  | no       | `None`                              | `Tail` returns the last 4 KB of function logs and forwards each line to the step's info log |
| `failOnError`    | boolean | no       | `true`                              | when Lambda returns a `FunctionError`, fail the step instead of returning it as an output   |

| Output            | Type                          | Description                                                                                                                                       |
| ----------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `statusCode`      | number                        | HTTP status code returned by Lambda (200 sync, 202 async, 204 DryRun)                                                                             |
| `response`        | object \| string \| undefined | parsed JSON value (object, array, number, boolean, string, or `null`) when the body is valid JSON; the raw string otherwise; `undefined` if empty |
| `functionError`   | string?                       | `Handled` or `Unhandled` if Lambda reported an error                                                                                              |
| `logs`            | string?                       | decoded log tail when `logType: Tail`                                                                                                             |
| `executedVersion` | string?                       | the function version that actually ran                                                                                                            |

`Event` invocations return immediately with `statusCode: 202` and an empty body, so `response` is undefined for that
flow.

## Composition

`@zorb/aws/configure` populates the run-scoped env table once; every later `@zorb/aws/*` step then picks up the
credentials transparently. A typical release task chains all four:

```yml
secrets:
  - uses: '@zorb/aws/configure'
    with:
      roleArn: arn:aws:iam::123456789012:role/Deploy
      sessionName: zorb-deploy
      region: us-east-1

tasks:
  release:
    steps:
      - uses: '@zorb/aws/ecr/push'
        with:
          image: myapp:dev
          repository: myapp
          tags: [latest, '${{ inputs.version }}']
      - uses: '@zorb/aws/s3/sync'
        with:
          source: ./dist
          destination: s3://my-cdn
          cacheControl: public, max-age=31536000, immutable
      - id: warmup
        uses: '@zorb/aws/lambda/invoke'
        with:
          functionName: api-warmup
          payload:
            origin: zorb
```

## IAM permissions

In addition to the obvious per-action scopes:

- `configure` needs `sts:GetCallerIdentity` always, plus `sts:AssumeRole` on the target role when used in
  role-assumption mode.
- `s3/sync` needs `s3:ListBucket`, `s3:GetObject`, `s3:PutObject`, and (when `delete: true`) `s3:DeleteObject` on the
  involved bucket(s).
- `ecr/push` needs `ecr:GetAuthorizationToken`, `ecr:BatchCheckLayerAvailability`, `ecr:CompleteLayerUpload`,
  `ecr:InitiateLayerUpload`, `ecr:PutImage`, `ecr:UploadLayerPart`, and (when `createRepository: true`)
  `ecr:DescribeRepositories` + `ecr:CreateRepository`.
- `lambda/invoke` needs `lambda:InvokeFunction` on the target function (or `*` for cross-version invocation when a
  `qualifier` is set).
