# @shared/action-helpers

Internal helpers for authoring [zorb](https://github.com/zorb-run/zorb-cli) actions: input validation, type re-exports
from `zorb/action`, and test fakes.

**Internal only.** Action packages reference this via the `@shared/action-helpers` tsconfig path alias; at build time
the helpers source is bundled into each `@zorb/<name>` package's `dist/`, so consumers don't see it as a runtime
dependency.

## Input validation

```ts
import { input } from '@shared/action-helpers';

export async function action(rawInputs: Record<string, unknown>, context) {
  const bucket = input.string(rawInputs, 'bucket');
  const region = input.string(rawInputs, 'region', { default: 'us-east-1' });
  const dryRun = input.boolean(rawInputs, 'dry-run', { default: false, as: 'dry-run' });
  const retries = input.optional.number(rawInputs, 'retries');
  // …
}
```

- `input.string` / `input.number` / `input.boolean` — required by default; pass `{ default }` to make optional.
- `input.optional.*` — return `undefined` if absent, otherwise coerce.
- `{ as: 'name-in-errors' }` — override how the key appears in error messages (useful when the workflow author writes
  kebab-case but TypeScript prefers camelCase locally).
- Coercion mirrors the CLI's `--with key=value` rules: `"true" / "yes" / "1"` are truthy, `"false" / "no" / "0"` are
  falsy, strings parse to numbers when they look numeric.

Validation failures throw `ActionInputError`. The runner catches it and fails the step with a clean message.

## Types

```ts
import type { ActionContext, ActionInput, ActionInputs, ActionOutput } from '@shared/action-helpers';
```

`ActionContext`, `ActionInput`, and `ActionOutput` are re-exported from `zorb/action` — the canonical source for the
runner protocol. `ActionInputs` is a local convenience alias for `Record<string, unknown>`: the JSON shape the runner
delivers as the action's first argument.

## Test fakes

```ts
import { mockContext } from '@shared/action-helpers/testing';

const ctx = mockContext({ taskName: 'deploy' });
await action({ name: 'world' }, ctx);

expect(ctx.messages.info).toContain('Hello, world!');
expect(ctx.secrets).toEqual([{ name: 'TOKEN', value: 'abc' }]);
```

`mockContext()` returns a fake `ActionContext` that records every `log.*`, `setSecret`, and `setEnv` call. No file I/O,
no subprocesses — just import your action's `action` function and exercise it directly.
