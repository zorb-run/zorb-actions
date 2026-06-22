import type { ActionContext, ActionInputs } from '@zorb/action-helpers';
import { input } from '@zorb/action-helpers';

/**
 * Demonstrates a nested action path. Authored as `src/sub/nested.ts`, compiled
 * to `dist/sub/nested.js`, referenced from a workflow as
 * `uses: '@zorb/__name__/sub/nested'`.
 *
 * Delete this file when scaffolding a real package — it's only here so the
 * template exercises the nested resolution path end-to-end.
 */
export async function action(rawInputs: ActionInputs, context: ActionContext): Promise<void> {
  const value = input.string(rawInputs, 'value');
  context.log.info(`nested action received: ${value}`);
}
