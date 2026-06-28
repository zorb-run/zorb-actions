import type { ActionContext } from 'zorb/action';
import { input, type ActionInputs } from '@shared/action-helpers';

export interface HelloOutputs {
  message: string;
}

export async function action(rawInputs: ActionInputs, context: ActionContext): Promise<HelloOutputs> {
  const name = input.string(rawInputs, 'name');
  const greeting = input.string(rawInputs, 'greeting', { default: 'Hello' });

  const message = `${greeting}, ${name}!`;
  context.log.info(message);
  return { message };
}
