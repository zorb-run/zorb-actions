# CLAUDE.md

Project-specific guidance for Claude Code working in this repo. Read alongside the global rules and CONTRIBUTING.md.

## What this is

`@zorb-run/zorb-actions` — Bun-workspaces monorepo of published actions for the
[zorb](https://github.com/zorb-run/zorb-cli) workflow runner. Each workspace under `actions/` publishes to NPM as a
`@zorb/*` package; each ships TS sources plus a compiled JS dist that zorb's runner loads at workflow execution time.

Status: early development. Milestone roadmap lives in `../PLAN.md` (one level up). The B-track (B1 → B12) builds the
published action collection.

## Layout

```
actions/
  <name>/               # one workspace per published package; publishes as @zorb/<name>
    package.json        # name: "@zorb/<name>", wildcard "exports" → dist/*.js
    tsconfig.json       # extends ../../tsconfig.base.json
    src/                # TS sources; each file is a separate action entry
    test/               # bun test files
    README.md
packages/
  action-helpers/       # @zorb/action-helpers — input validation + shared types + test fakes
templates/
  action/               # canonical shape for a new @zorb/* package; copied by `bun run new-package`
scripts/
  build.ts              # compile every workspace's src/ → dist/
  new-package.ts        # scaffold a new actions/<name>/ from templates/action/
```

`templates/action/` is deliberately outside `actions/*` so its placeholder `@zorb/__name__` package name doesn't trip up
`bun install`. Treat it as scaffolding-only — don't import from it, don't add it to the workspaces array.

## The action contract

Every action file exports a named `action` function:

```ts
export async function action(inputs: Inputs, context: ActionContext): Promise<Outputs | void> { … }
```

`runner.cjs` (shipped by `@zorb/cli`) loads the compiled JS, invokes the function, and writes outputs / secrets / env
back to zorb via a result file. See `@zorb/cli`'s runner for the full protocol.

Subpath resolution: `uses: '@zorb/aws/s3/sync'` resolves to `node_modules/@zorb/aws/dist/s3/sync.js` via the package's
`exports` wildcard. Authors keep nested layouts (`src/s3/sync.ts`) and the build preserves them under `dist/`.

## Dev loop

```sh
bun install                 # install workspaces
bun run typecheck           # tsc --noEmit over every workspace
bun run test                # bun test across workspaces
bun run build               # compile every workspace's src/ → dist/
bun run new-package <name>  # scaffold actions/<name>/ from the template
bun run format
```

Always run typecheck + tests before committing.

## Conventions

- TypeScript strict, `noUncheckedIndexedAccess`. Prefer `undefined` over `null` in types.
- Kebab-case for filenames. Match siblings if a directory has an established style.
- Use `path.resolve` / `path.join` for filesystem paths. No string concatenation with `/`.
- Action files should be small and pure: validate inputs at the top, do the work, return outputs.
- Validation goes through `@zorb/action-helpers` — no ad-hoc `typeof inputs.x !== 'string'` checks.
- Let errors bubble. The runner catches and reports them with a stack trace.
- No runtime imports of `@zorb/cli` — actions communicate with zorb via the context object the runner provides, never by
  reaching into the CLI package.

## Out of scope (don't add)

- Action discovery / registry — zorb resolves `uses:` strings directly via node_modules.
- Cross-package shared state at runtime — each action is its own module, loaded fresh.
- Bundling actions into a single file per package. We ship per-file JS so subpath resolution stays trivial.

If a request touches one of these, flag it and ask before proceeding — they're explicit non-goals.
