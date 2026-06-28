import { describe, expect, test } from 'bun:test';
import { ActionInputError } from '@shared/action-helpers';
import { mockContext } from '@shared/action-helpers/testing';
import { action } from '../src/hello';

describe('hello', () => {
  test('greets with the default salutation', async () => {
    const ctx = mockContext();
    const result = await action({ name: 'world' }, ctx);
    expect(result.message).toBe('Hello, world!');
    expect(ctx.messages.info).toEqual(['Hello, world!']);
  });

  test('honours a custom greeting', async () => {
    const ctx = mockContext();
    const result = await action({ name: 'world', greeting: 'Ahoy' }, ctx);
    expect(result.message).toBe('Ahoy, world!');
  });

  test('throws when `name` is missing', async () => {
    const ctx = mockContext();
    await expect(action({}, ctx)).rejects.toBeInstanceOf(ActionInputError);
  });
});
