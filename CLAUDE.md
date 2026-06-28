# CLAUDE.md

Project-specific guidance for Claude Code working in this repo. Read alongside the global rules and CONTRIBUTING.md.

## What this is

`@zorb-run/zorb-actions` — Bun monorepo of published actions for the [zorb](https://github.com/zorb-run/zorb-cli)
workflow runner. Each workspace under `actions/` publishes to NPM as a `@zorb/*` package; each ships TS sources plus a
compiled JS dist that zorb's runner loads at workflow execution time.

Status: early development. Milestone roadmap lives in `../PLAN.md` (one level up). The B-track (B1 → B12) builds the
published action collection.

## Layout

```
actions/
  <name>/               # one workspace per published package; publishes as @zorb/<name>
    package.json        # name: "@zorb/<name>", wildcard "exports" → dist/*.js
    src/                # TS sources + colocated *.spec.ts unit tests
    README.md
shared/
  action-helpers/       # internal: validation helpers, types, test fakes
    *.ts                # source files at the package root (no src/ wrapper)
    *.spec.ts           # bun unit tests alongside source
templates/
  action/               # canonical shape for a new @zorb/* package; copied by `bun run new-package`
scripts/
  build.ts              # compile every action workspace's src/ → dist/
  new-package.ts        # scaffold a new actions/<name>/ from templates/action/
  workspaces.ts         # workspace discovery for the build script
```

### Internal sharing

`shared/*` is **not** a workspace and **not** published. Action packages reference it via TypeScript path aliases
configured in `tsconfig.base.json`:

```jsonc
"paths": {
  "@shared/*": ["./shared/*"]
}
```

So `import { input } from '@shared/action-helpers'` resolves to `./shared/action-helpers/index.ts` at compile time, and
`@shared/action-helpers/testing` resolves to `./shared/action-helpers/testing.ts`. Future shared modules
(`@shared/utils`, `@shared/types`, …) plug in under the same wildcard with no tsconfig edit.

At build time `scripts/build.ts` bundles the resolved source into each action's `dist/`, so the published `@zorb/<name>`
package has zero runtime dependency on the helpers. Consumers install one package per action, not a dep graph.

`templates/action/` is also outside `actions/*` so its placeholder `@zorb/__name__` package name doesn't trip up
`bun install`. Treat it as scaffolding-only — don't import from it, don't add it to the workspaces array.

## The action contract

Every action file exports a named `action` function:

```ts
import type { ActionContext } from 'zorb/action';
import { input, type ActionInputs } from '@shared/action-helpers';

export async function action(rawInputs: ActionInputs, context: ActionContext): Promise<Outputs | void> {
  …
}
```

`runner.cjs` (shipped by `@zorb/cli`) loads the compiled JS, invokes the function, and writes outputs / secrets / env
back to zorb via a result file. See the CLI's runner for the full protocol.

Subpath resolution: `uses: '@zorb/aws/s3/sync'` resolves to `node_modules/@zorb/aws/dist/s3/sync.js` via the package's
`exports` wildcard. Authors keep nested layouts (`src/s3/sync.ts`) and the build preserves them under `dist/`.

## Dev loop

```sh
bun install                 # install root devDeps + link action workspaces
bun run typecheck           # tsc --noEmit over actions/ + shared/ + scripts/
bun run test                # bun test shared actions
bun run build               # compile every actions/* workspace's src/ → dist/
bun run new-package <name>  # scaffold actions/<name>/ from the template
bun run format
```

Always run typecheck + tests before committing.

## Conventions

- TypeScript strict, `noUncheckedIndexedAccess`. Prefer `undefined` over `null` in types.
- Kebab-case for filenames. Match siblings if a directory has an established style.
- Unit tests live alongside their source as `<name>.spec.ts` (action sources go in `src/hello.ts`, tests in
  `src/hello.spec.ts`). The build script filters `*.spec.ts` out of action entrypoints automatically.
- Use `path.resolve` / `path.join` for filesystem paths. No string concatenation with `/`.
- Action files should be small and pure: validate inputs at the top, do the work, return outputs.
- Validation goes through `@shared/action-helpers` (`input.string`, `input.number`, `input.boolean`). No ad-hoc
  `typeof inputs.x !== 'string'` checks.
- Action contract types (`ActionContext`, `ActionInput`, `ActionOutput`) come from `zorb/action` directly — that's the
  source of truth for the runner protocol.
- Let errors bubble. The runner catches and reports them with a stack trace.
- No runtime imports of `zorb` — actions communicate with the runner via the context object, never by reaching into the
  CLI package. Type-only imports from `zorb/action` are fine; they erase at build time.

## Out of scope (don't add)

- Action discovery / registry — zorb resolves `uses:` strings directly via node_modules.
- Cross-package shared state at runtime — each action is its own module, loaded fresh.
- Bundling actions into a single file per package. We ship per-file JS so subpath resolution stays trivial.
- Publishing `shared/*` to NPM. It's an internal source layer; published packages get the code bundled in.

If a request touches one of these, flag it and ask before proceeding — they're explicit non-goals.
