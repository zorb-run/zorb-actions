/**
 * Thrown by the input validation helpers. The runner prints these with a
 * clean error message + stack to stderr; the workflow then fails the step.
 */
export class ActionInputError extends Error {
  override readonly name = 'ActionInputError';
  constructor(message: string) {
    super(message);
  }
}
