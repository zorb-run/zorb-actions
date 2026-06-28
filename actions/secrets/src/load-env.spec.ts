import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { ActionInputError } from '@/shared/action-helpers';
import { mockContext } from '@/shared/action-helpers/testing';
import { action } from './load-env';

const SENTINELS = ['__ZORB_TEST_ENV_A', '__ZORB_TEST_ENV_B', '__ZORB_TEST_ENV_C'];

describe('@zorb/secrets/load-env', () => {
  beforeEach(() => {
    for (const k of SENTINELS) delete process.env[k];
  });

  afterEach(() => {
    for (const k of SENTINELS) delete process.env[k];
  });

  test('registers each env var found in process.env', async () => {
    process.env['__ZORB_TEST_ENV_A'] = 'alpha';
    process.env['__ZORB_TEST_ENV_B'] = 'beta';
    const ctx = mockContext();

    await action({ keys: ['__ZORB_TEST_ENV_A', '__ZORB_TEST_ENV_B'] }, ctx);

    expect(ctx.secrets).toEqual([
      { name: '__ZORB_TEST_ENV_A', value: 'alpha' },
      { name: '__ZORB_TEST_ENV_B', value: 'beta' },
    ]);
  });

  test('coerces a scalar `keys:` value into a single-element list', async () => {
    process.env['__ZORB_TEST_ENV_A'] = 'one';
    const ctx = mockContext();

    await action({ keys: '__ZORB_TEST_ENV_A' }, ctx);

    expect(ctx.secrets).toEqual([{ name: '__ZORB_TEST_ENV_A', value: 'one' }]);
  });

  test('throws on missing env vars by default', async () => {
    const ctx = mockContext();
    await expect(action({ keys: ['__ZORB_TEST_ENV_C'] }, ctx)).rejects.toThrow(
      /missing required env var\(s\): __ZORB_TEST_ENV_C/,
    );
    expect(ctx.secrets).toEqual([]);
  });

  test('warns and skips when required is false', async () => {
    process.env['__ZORB_TEST_ENV_A'] = 'alpha';
    const ctx = mockContext();

    await action({ keys: ['__ZORB_TEST_ENV_A', '__ZORB_TEST_ENV_C'], required: false }, ctx);

    expect(ctx.secrets).toEqual([{ name: '__ZORB_TEST_ENV_A', value: 'alpha' }]);
    expect(ctx.messages.warn).toEqual(['@zorb/secrets/load-env: skipped missing env var(s): __ZORB_TEST_ENV_C']);
  });

  test('throws when keys is missing', async () => {
    const ctx = mockContext();
    await expect(action({}, ctx)).rejects.toBeInstanceOf(ActionInputError);
  });
});
