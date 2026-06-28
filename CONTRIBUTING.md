# Contributing to zorb-actions

This is the monorepo of published `@zorb/*` action packages for [zorb](https://github.com/zorb-run/zorb-cli).

## Prerequisites

- [Bun](https://bun.com) ≥ 1.3.13
- A POSIX shell (macOS or Linux)

```sh
brew install oven-sh/bun/bun
# or
curl -fsSL https://bun.com/install | bash
```

## Setup

```sh
git clone git@github.com:zorb-run/zorb-actions.git
cd zorb-actions
bun install
```

## Common commands

| Command                      | What it does                                               |
| ---------------------------- | ---------------------------------------------------------- |
| `bun run typecheck`          | Type-check actions/, shared/, scripts/ with `tsc --noEmit` |
| `bun run test`               | Run `bun test shared actions`                              |
| `bun run build`              | Compile every action workspace's `src/` → `dist/`          |
| `bun run new-package <name>` | Scaffold a new `actions/<name>/` package from the template |
| `bun run format`             | Format with Prettier                                       |

## Repo layout in one paragraph

`actions/<name>/` is each published `@zorb/<name>` package — one workspace per. `shared/<name>/` is **internal-only**
source the build bundles into each action's `dist/` (so consumers don't pull a transitive dep graph). The path alias
`@/shared/*: ./shared/*/src` lives in `tsconfig.base.json`; that's how action source code refers to the helpers.
`templates/action/` is the canonical shape for a new action package, copied by `bun run new-package`.

## Adding a new action package

```sh
bun run new-package slack --description "Slack notifier actions"
```

This copies `templates/action/` to `actions/slack/`, rewrites the package name to `@zorb/slack`, and leaves you with a
single example action (`src/hello.ts`) plus a passing test. Replace, add files, and you're done.

Per-package layout:

```
actions/<name>/
  package.json          # "name": "@zorb/<name>", wildcard exports → dist/*.js
  README.md             # short description + action reference
  src/
    <action>.ts         # one file per action — each exports an `action` function
    <action>.spec.ts    # bun unit test, sits next to the source it covers
```

Subpath resolution: an action at `src/s3/sync.ts` compiles to `dist/s3/sync.js` and is referenced from a workflow as
`uses: '@zorb/<name>/s3/sync'`.

## Authoring an action

Every action exports a named `action` function with this signature:

```ts
import type { ActionContext } from 'zorb/action';
import { input, type ActionInputs } from '@/shared/action-helpers';

export interface Outputs {
  message: string;
}

export async function action(rawInputs: ActionInputs, context: ActionContext): Promise<Outputs> {
  const name = input.string(rawInputs, 'name');
  const greeting = input.string(rawInputs, 'greeting', { default: 'Hello' });
  context.log.info(`${greeting}, ${name}!`);
  return { message: `${greeting}, ${name}!` };
}
```

- Action contract types (`ActionContext`, `ActionInput`, `ActionOutput`) come from `zorb/action` — that's the canonical
  source for the runner protocol. The import is type-only and erases at build time.
- Validate `rawInputs` with `@/shared/action-helpers` (`input.string`, `input.number`, `input.boolean`). Don't read
  `inputs.x` directly — the helpers give consistent error messages and coercion.
- `context.log.{info,warn,error,debug}` writes to the runner's stderr (debug only when zorb runs with `--debug`).
- Return value becomes `steps.<id>.outputs.*` in the calling workflow. Return `void` if there are no outputs.
- Use `context.setSecret(name, value)` to register a value into the run-scoped secret table (it's masked everywhere it
  appears in subsequent step output). `context.setEnv(name, value)` registers an env var for subsequent steps.

## Testing actions

Tests live alongside their source as `<name>.spec.ts`. Import the `action` function directly and pass a fake context:

```ts
import { describe, expect, test } from 'bun:test';
import { mockContext } from '@/shared/action-helpers/testing';
import { action } from './notify';

describe('notify', () => {
  test('emits a greeting', async () => {
    const ctx = mockContext();
    const result = await action({ name: 'world' }, ctx);
    expect(result.message).toBe('Hello, world!');
    expect(ctx.messages.info).toEqual(['Hello, world!']);
  });
});
```

Heavy actions that wrap a CLI (e.g. `op`, `doppler`) should mock the subprocess by default and gate integration tests on
the binary being present.

## Commit style

- One commit per logical change.
- Subject line is short and imperative: `B2: load-dotenv action`, `fix: aws/s3/sync handles empty bucket`, etc.
- Wrap the body at ~72 chars. Explain the _why_, not the _what_.
- No AI-tool trailers.

## Pull requests

- Branch from `main`. Name branches `feat/<short>`, `fix/<short>`, or `chore/<short>`.
- Before pushing: `bun run typecheck && bun run test && bun run format`.
- Keep PRs small. Per-package work should ship as its own PR where possible.
