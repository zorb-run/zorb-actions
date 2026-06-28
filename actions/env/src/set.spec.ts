import { describe, expect, test } from 'bun:test';
import { ActionInputError } from '@/shared/action-helpers';
import { mockContext } from '@/shared/action-helpers/testing';
import { action } from './set';

describe('@zorb/env/set', () => {
  test('registers a literal name/value pair', async () => {
    const ctx = mockContext();
    await action({ name: 'NODE_ENV', value: 'production' }, ctx);
    expect(ctx.env).toEqual([{ name: 'NODE_ENV', value: 'production' }]);
  });

  test('throws when name is missing', async () => {
    const ctx = mockContext();
    await expect(action({ value: 'x' }, ctx)).rejects.toBeInstanceOf(ActionInputError);
  });

  test('throws when value is missing', async () => {
    const ctx = mockContext();
    await expect(action({ name: 'X' }, ctx)).rejects.toBeInstanceOf(ActionInputError);
  });

  test('allows an empty string value', async () => {
    const ctx = mockContext();
    await action({ name: 'X', value: '' }, ctx);
    expect(ctx.env).toEqual([{ name: 'X', value: '' }]);
  });

  test('does not register into the secret table', async () => {
    const ctx = mockContext();
    await action({ name: 'X', value: 'y' }, ctx);
    expect(ctx.secrets).toEqual([]);
  });
});
