---
'@zorb/aws': minor
---

Initial release of `@zorb/aws` — AWS service actions for zorb workflows, built on AWS SDK v3.

- `@zorb/aws/configure` — resolve AWS credentials (default chain / named profile / role assumption), verify via
  `sts:GetCallerIdentity`, and publish them to subsequent steps as both env vars and masked secrets.
- `@zorb/aws/s3/sync` — local↔S3 sync with ETag-based comparison, include/exclude globs, `delete`, `dryRun`,
  `cacheControl`, and `contentType` controls.
- `@zorb/aws/ecr/push` — push a local Docker image under one or more tags, with optional repository auto-creation. The
  registry URL comes from `ecr:GetAuthorizationToken`'s `proxyEndpoint`, so the action works in non-standard partitions
  (AWS China, GovCloud).
- `@zorb/aws/lambda/invoke` — synchronous and fire-and-forget Lambda invocations with JSON payload handling, optional
  `Tail` log capture, and a `failOnError` toggle for surfacing `FunctionError`.
