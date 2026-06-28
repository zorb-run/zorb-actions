import type { ActionContext } from 'zorb/action';
import { input, type ActionInputs } from '@/shared/action-helpers';

/**
 * Promote selected `process.env` vars into the run-scoped secret table so
 * subsequent step output is masked. Useful when a CI provider already
 * injects credentials as env vars and you want zorb to treat them as
 * secrets rather than plain env.
 */
export async function action(rawInputs: ActionInputs, context: ActionContext): Promise<void> {
  const keys = input.strings(rawInputs, 'keys');
  const required = input.boolean(rawInputs, 'required', { default: true });

  const missing: string[] = [];
  for (const name of keys) {
    const value = process.env[name];
    if (value === undefined) {
      missing.push(name);
      continue;
    }
    context.setSecret(name, value);
  }

  if (missing.length > 0) {
    const list = missing.join(', ');
    if (required) {
      throw new Error(`@zorb/secrets/load-env: missing required env var(s): ${list}`);
    }
    context.log.warn(`@zorb/secrets/load-env: skipped missing env var(s): ${list}`);
  }
}
