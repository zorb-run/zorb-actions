import { describe, expect, test } from 'bun:test';
import { ActionInputError } from '@/shared/action-helpers';
import { mockContext } from '@/shared/action-helpers/testing';
import { action } from './set';

describe('@zorb/secrets/set', () => {
  test('registers a literal name/value pair', async () => {
    const ctx = mockContext();
    await action({ name: 'API_KEY', value: 'super-secret' }, ctx);
    expect(ctx.secrets).toEqual([{ name: 'API_KEY', value: 'super-secret' }]);
  });

  test('throws when name is missing', async () => {
    const ctx = mockContext();
    await expect(action({ value: 'x' }, ctx)).rejects.toBeInstanceOf(ActionInputError);
  });

  test('throws when value is missing', async () => {
    const ctx = mockContext();
    await expect(action({ name: 'X' }, ctx)).rejects.toBeInstanceOf(ActionInputError);
  });

  test('allows an empty string value (masking just becomes a no-op)', async () => {
    const ctx = mockContext();
    await action({ name: 'X', value: '' }, ctx);
    expect(ctx.secrets).toEqual([{ name: 'X', value: '' }]);
  });
});
