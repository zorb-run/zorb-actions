# @zorb/aws

AWS service actions for [zorb](https://github.com/zorb-run/zorb-cli) workflows. Built on the AWS SDK v3 — credentials
resolve via the default provider chain, so anything `aws sts get-caller-identity` works against from your shell will
work here too.

> Status: first cut. Ships `s3/sync` and `ecr/push`. Lambda, SSM, and friends ship in follow-up releases.

## Actions

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

| input              | type               | required | default                              | description                                                                                     |
| ------------------ | ------------------ | -------- | ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `image`            | string             | yes      | —                                    | local image reference (`name:tag`, image ID, etc.)                                              |
| `repository`       | string             | yes      | —                                    | ECR repository name (no registry prefix)                                                        |
| `tags`             | string \| string[] | no       | `['latest']`                         | tags to publish under                                                                           |
| `region`           | string             | no       | `AWS_REGION` / `AWS_DEFAULT_REGION`  | AWS region of the ECR registry                                                                  |
| `accountId`        | string             | no       | resolved via `sts:GetCallerIdentity` | AWS account ID owning the registry                                                              |
| `createRepository` | boolean            | no       | `false`                              | create the repository (via `ecr:DescribeRepositories` + `CreateRepository`) if it doesn't exist |
| `imageScanOnPush`  | boolean            | no       | `true`                               | scan-on-push setting when creating the repository                                               |
| `immutable`        | boolean            | no       | `false`                              | use `IMMUTABLE` tag mutability when creating the repository                                     |

| output       | type     | description                                            |
| ------------ | -------- | ------------------------------------------------------ |
| `registry`   | string   | `{account}.dkr.ecr.{region}.amazonaws.com`             |
| `repository` | string   | the repository name (as supplied)                      |
| `imageUris`  | string[] | one fully-qualified `registry/repo:tag` per pushed tag |

The action shells out to `docker` for `login`/`tag`/`push`, so a working Docker CLI must be on PATH. Authentication uses
`ecr:GetAuthorizationToken` over the default credential chain — there's no need to run `aws ecr get-login-password`
beforehand.

## Credentials & permissions

Both actions use the AWS SDK v3 default credential provider chain — environment variables, shared config files,
container/EC2 instance metadata, etc. To scope IAM:

- `s3/sync` needs `s3:ListBucket`, `s3:GetObject`, `s3:PutObject`, and (when `delete: true`) `s3:DeleteObject` on the
  involved bucket(s).
- `ecr/push` needs `ecr:GetAuthorizationToken`, `ecr:BatchCheckLayerAvailability`, `ecr:CompleteLayerUpload`,
  `ecr:InitiateLayerUpload`, `ecr:PutImage`, `ecr:UploadLayerPart`, and (when `createRepository: true`)
  `ecr:DescribeRepositories` + `ecr:CreateRepository`. It also calls `sts:GetCallerIdentity` unless `accountId` is set
  explicitly.
