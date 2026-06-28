# zorb-actions

Monorepo of published actions for the [zorb](https://github.com/zorb-run/zorb-cli) workflow runner.

Each workspace under `actions/` publishes to NPM as a `@zorb/*` package. Action files are written in TypeScript and
compiled to JS that zorb's runner loads at workflow execution time. Subpaths map one-to-one: `src/s3/sync.ts` ships as
`dist/s3/sync.js` and is referenced from a workflow as:

```yml
- uses: '@zorb/aws/s3/sync'
  with:
    bucket: my-bucket
```

## Layout

```
actions/              # one workspace per published @zorb/<name> package
                      # src/<name>.ts + src/<name>.spec.ts (unit tests next to source)
shared/
  action-helpers/     # internal: validators, types, test fakes
                      # bundled into each action's dist at build time
templates/
  action/             # scaffolding template; copied by `bun run new-package`
scripts/
  build.ts            # compile every action workspace's src/ → dist/
  new-package.ts      # scaffold a new actions/<name>/ from templates/action/
  workspaces.ts       # workspace discovery
```

`shared/*` is internal — referenced via the `@shared/*` tsconfig path alias and inlined into each action's compiled
output, so consumers install one package per action with no transitive deps on a separate helpers package.

## Quick start

```sh
bun install
bun run typecheck
bun run test
bun run build
```

Scaffold a new action package:

```sh
bun run new-package slack --description "Slack notifier actions"
# → actions/slack/ (publishes as @zorb/slack)
bun install                # discover the new workspace
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full development guide and action-authoring conventions.

## Status

Early development. Roadmap lives in [`../PLAN.md`](../PLAN.md). The B-track builds the published action collection; this
repo is set up by [B1](../PLAN.md#b1--action-package-scaffold) and each subsequent milestone adds one package
(`@zorb/secrets`, `@zorb/env`, `@zorb/aws`, …).
