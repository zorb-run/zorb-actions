# @zorb/action-helpers

Shared helpers for authoring [zorb](https://github.com/zorb-run/zorb-cli) actions: input validation, types for the
`context` object, and test fakes.

## Input validation

```ts
import { input } from '@zorb/action-helpers';

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
import type { ActionContext, ActionFn, ActionInputs } from '@zorb/action-helpers';
```

- `ActionContext` — shape of the second argument the runner passes to your action.
- `ActionInputs` — alias for `Record<string, unknown>`; what workflow `with:` values look like before validation.
- `ActionFn<I, O>` — typed action function signature, mostly useful for higher-order helpers.

## Test fakes

```ts
import { mockContext } from '@zorb/action-helpers/testing';

const ctx = mockContext({ taskName: 'deploy' });
await action({ name: 'world' }, ctx);

expect(ctx.messages.info).toContain('Hello, world!');
expect(ctx.secrets).toEqual([{ name: 'TOKEN', value: 'abc' }]);
```

`mockContext()` returns a fake `ActionContext` that records every `log.*`, `setSecret`, and `setEnv` call. No file I/O,
no subprocesses — just import your action's `action` function and exercise it directly.
