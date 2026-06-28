import type { ActionContext } from 'zorb/action';
import { input, type ActionInputs } from '@/shared/action-helpers';

/**
 * Register a literal name/value pair into the run-scoped env table.
 * Intended for tests and one-offs — production workflows should load env vars
 * via a dedicated loader (`load-dotenv`, `load-file`, ...) or declare them
 * statically with `env:` in the workflow.
 */
export async function action(rawInputs: ActionInputs, context: ActionContext): Promise<void> {
  const name = input.string(rawInputs, 'name');
  const value = input.string(rawInputs, 'value');

  context.setEnv(name, value);
  context.log.debug(`registered env '${name}'`);
}
