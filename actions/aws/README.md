# @zorb/aws

AWS service actions for [zorb](https://github.com/zorb-run/zorb-cli) workflows. Built on the AWS SDK v3.

> Status: first cut. Ships `configure`, `s3/sync`, `ecr/push`, and `lambda/invoke`. SSM and friends ship in follow-up
> releases.

## Authentication

zorb does not pass the calling shell's environment into actions implicitly, so the AWS SDK's default credential provider
chain only sees what zorb has been told about explicitly. The recommended pattern is to run `@zorb/aws/configure` up
front — it resolves credentials, verifies them via `sts:GetCallerIdentity`, and publishes them as both env vars (for
subsequent SDK clients and `aws` CLI invocations) and as masked secrets (so they never leak into step output).

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

See [`@zorb/aws/configure`](#zorbawsconfigure) for the three supported modes (default chain, named profile, role
assumption).

## Actions

### `@zorb/aws/configure`

Resolve a set of AWS credentials and publish them to subsequent steps. Three modes, selected by which inputs are
present:

| mode             | inputs                                           | what happens                                                                                 |
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

| input             | type   | required              | default           | description                                                                  |
| ----------------- | ------ | --------------------- | ----------------- | ---------------------------------------------------------------------------- |
| `region`          | string | no                    | —                 | AWS region — set as `AWS_REGION`/`AWS_DEFAULT_REGION` and used for STS calls |
| `profile`         | string | no                    | —                 | named profile from `~/.aws/credentials` / `~/.aws/config`                    |
| `roleArn`         | string | no                    | —                 | role to assume; requires `sessionName`                                       |
| `sessionName`     | string | when `roleArn` is set | —                 | session name passed to `sts:AssumeRole`                                      |
| `durationSeconds` | number | no (role mode only)   | SDK default (1 h) | session lifetime in seconds                                                  |
| `externalId`      | string | no (role mode only)   | —                 | external ID for cross-account trust                                          |

| output      | type   | description                                         |
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

| input          | type               | required | default                 | description                                              |
| -------------- | ------------------ | -------- | ----------------------- | -------------------------------------------------------- |
| `source`       | string             | yes      | —                       | local path or `s3://bucket[/prefix]`                     |
| `destination`  | string             | yes      | —                       | local path or `s3://bucket[/prefix]`                     |
| `delete`       | boolean            | no       | `false`                 | remove objects at destination missing from source        |
| `exclude`      | string \| string[] | no       | —                       | skip keys matching these globs                           |
| `include`      | string \| string[] | no       | —                       | rescue excluded keys matching these globs                |
| `region`       | string             | no       | SDK default chain       | explicit AWS region                                      |
| `dryRun`       | boolean            | no       | `false`                 | log intended uploads/deletes without making any S3 calls |
| `cacheControl` | string             | no       | —                       | `Cache-Control` header for uploaded objects              |
| `contentType`  | string             | no       | inferred from extension | override `Content-Type` for every uploaded object        |

| output       | type   | description                                  |
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

### `@zorb/aws/ecr/push`

Push a local Docker image to an Amazon ECR repository under one or more tags.

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

| input              | type               | required | default                             | description                                                                                     |
| ------------------ | ------------------ | -------- | ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| `image`            | string             | yes      | —                                   | local image reference (`name:tag`, image ID, etc.)                                              |
| `repository`       | string             | yes      | —                                   | ECR repository name (no registry prefix)                                                        |
| `tags`             | string \| string[] | no       | `['latest']`                        | tags to publish under                                                                           |
| `region`           | string             | no       | `AWS_REGION` / `AWS_DEFAULT_REGION` | AWS region of the ECR registry                                                                  |
| `createRepository` | boolean            | no       | `false`                             | create the repository (via `ecr:DescribeRepositories` + `CreateRepository`) if it doesn't exist |
| `imageScanOnPush`  | boolean            | no       | `true`                              | scan-on-push setting when creating the repository                                               |
| `immutable`        | boolean            | no       | `false`                             | use `IMMUTABLE` tag mutability when creating the repository                                     |

| output       | type     | description                                                          |
| ------------ | -------- | -------------------------------------------------------------------- |
| `registry`   | string   | registry host (e.g. `{account}.dkr.ecr.{region}.amazonaws.com[.cn]`) |
| `accountId`  | string   | AWS account id extracted from the registry host                      |
| `repository` | string   | the repository name (as supplied)                                    |
| `imageUris`  | string[] | one fully-qualified `registry/repo:tag` per pushed tag               |

The registry URL comes from the `proxyEndpoint` returned by `ecr:GetAuthorizationToken`, so the action works unmodified
in non-standard partitions (AWS China's `amazonaws.com.cn`, GovCloud, etc.).

The action shells out to `docker` for `login`/`tag`/`push`, so a working Docker CLI must be on PATH. Authentication uses
`ecr:GetAuthorizationToken` over the default credential chain — there's no need to run `aws ecr get-login-password`
beforehand.

### `@zorb/aws/lambda/invoke`

Invoke a Lambda function and capture its response. Payload is sent as JSON; objects are stringified automatically,
strings are forwarded verbatim. The response body is JSON-parsed when possible and surfaced as `outputs.response`.

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

| input            | type    | required | default           | description                                                                                 |
| ---------------- | ------- | -------- | ----------------- | ------------------------------------------------------------------------------------------- |
| `functionName`   | string  | yes      | —                 | Lambda function name or ARN                                                                 |
| `payload`        | any     | no       | —                 | JSON-serialisable value (object/array/scalar) or a pre-serialised string                    |
| `invocationType` | string  | no       | `RequestResponse` | one of `RequestResponse`, `Event`, `DryRun`                                                 |
| `qualifier`      | string  | no       | —                 | function version (`$LATEST`, `42`) or alias name                                            |
| `region`         | string  | no       | SDK default chain | explicit AWS region                                                                         |
| `logType`        | string  | no       | `None`            | `Tail` returns the last 4 KB of function logs and forwards each line to the step's info log |
| `failOnError`    | boolean | no       | `true`            | when Lambda returns a `FunctionError`, fail the step instead of returning it as an output   |

| output            | type                          | description                                                                    |
| ----------------- | ----------------------------- | ------------------------------------------------------------------------------ |
| `statusCode`      | number                        | HTTP status code returned by Lambda (200 sync, 202 async, 204 DryRun)          |
| `response`        | object \| string \| undefined | parsed JSON body if possible, raw string otherwise, undefined for empty bodies |
| `functionError`   | string?                       | `Handled` or `Unhandled` if Lambda reported an error                           |
| `logs`            | string?                       | decoded log tail when `logType: Tail`                                          |
| `executedVersion` | string?                       | the function version that actually ran                                         |

`Event` invocations return immediately with `statusCode: 202` and an empty body, so `response` is undefined for that
flow.

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
