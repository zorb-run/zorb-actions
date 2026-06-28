import type { ActionContext } from 'zorb/action';
import { input, type ActionInputs } from '@/shared/action-helpers';

/**
 * Register a literal name/value pair into the run-scoped secret table.
 * Intended for tests and one-offs — production workflows should load secrets
 * via a dedicated loader (`load-env`, `load-dotenv`, `load-file`, …).
 */
export async function action(rawInputs: ActionInputs, context: ActionContext): Promise<void> {
  const name = input.string(rawInputs, 'name');
  const value = input.string(rawInputs, 'value');

  context.setSecret(name, value);
  context.log.debug(`registered secret '${name}'`);
}
