/**
 * Shape of the `context` object that zorb's runner hands to every action.
 *
 * Authors should import this type rather than redeclaring it locally — keeping
 * one definition here means a runner-side change ripples through all action
 * packages at type-check time, not at run time.
 */
export interface ActionContext {
  readonly cwd: string;
  readonly taskName: string | undefined;
  readonly stepId: string | undefined;
  readonly log: ActionLogger;
  setSecret(name: string, value: string): void;
  setEnv(name: string, value: string): void;
}

export interface ActionLogger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/**
 * `inputs` arrives at the action as a JSON object: zorb only renders values
 * `with:` is allowed to carry (strings, numbers, booleans). Helpers in
 * `./inputs.ts` narrow this safely; everything else should stay opaque until
 * validated.
 */
export type ActionInputs = Record<string, unknown>;

/**
 * Action return value. Keys become `steps.<id>.outputs.<key>` in the workflow.
 * Values are JSON-stringified by the runner — keep them serialisable.
 */
export type ActionOutputs = Record<string, unknown> | void;

export type ActionFn<I extends ActionInputs = ActionInputs, O extends ActionOutputs = ActionOutputs> = (
  inputs: I,
  context: ActionContext,
) => O | Promise<O>;
