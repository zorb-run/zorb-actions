import { describe, expect, test } from 'bun:test';
import { ActionInputError, input } from './index';

describe('input.string', () => {
  test('returns string values as-is', () => {
    expect(input.string({ name: 'world' }, 'name')).toBe('world');
  });

  test('coerces numbers and booleans', () => {
    expect(input.string({ count: 3 }, 'count')).toBe('3');
    expect(input.string({ flag: true }, 'flag')).toBe('true');
  });

  test('throws on a missing required input', () => {
    expect(() => input.string({}, 'name')).toThrow(ActionInputError);
    expect(() => input.string({}, 'name')).toThrow(/missing required input 'name'/);
  });

  test('returns the default when missing', () => {
    expect(input.string({}, 'name', { default: 'fallback' })).toBe('fallback');
  });

  test('rejects array values', () => {
    expect(() => input.string({ name: ['a'] }, 'name')).toThrow(/expected a string, got array/);
  });
});

describe('input.number', () => {
  test('returns finite numbers as-is', () => {
    expect(input.number({ n: 42 }, 'n')).toBe(42);
  });

  test('coerces numeric strings', () => {
    expect(input.number({ n: '42' }, 'n')).toBe(42);
    expect(input.number({ n: '3.14' }, 'n')).toBe(3.14);
  });

  test('rejects non-numeric strings', () => {
    expect(() => input.number({ n: 'nope' }, 'n')).toThrow(/expected a number/);
  });

  test('rejects empty strings', () => {
    expect(() => input.number({ n: '' }, 'n')).toThrow(/empty string/);
  });

  test('returns the default when missing', () => {
    expect(input.number({}, 'n', { default: 7 })).toBe(7);
  });
});

describe('input.boolean', () => {
  test('returns booleans as-is', () => {
    expect(input.boolean({ flag: true }, 'flag')).toBe(true);
    expect(input.boolean({ flag: false }, 'flag')).toBe(false);
  });

  test('accepts truthy and falsy string tokens', () => {
    for (const token of ['true', 'yes', '1', 'YES', ' True ']) {
      expect(input.boolean({ flag: token }, 'flag')).toBe(true);
    }
    for (const token of ['false', 'no', '0', 'NO']) {
      expect(input.boolean({ flag: token }, 'flag')).toBe(false);
    }
  });

  test('accepts numeric 0/1', () => {
    expect(input.boolean({ flag: 1 }, 'flag')).toBe(true);
    expect(input.boolean({ flag: 0 }, 'flag')).toBe(false);
  });

  test('rejects unrecognised tokens', () => {
    expect(() => input.boolean({ flag: 'maybe' }, 'flag')).toThrow(/expected a boolean/);
    expect(() => input.boolean({ flag: 2 }, 'flag')).toThrow(/expected a boolean/);
  });
});

describe('input.strings', () => {
  test('returns array values as-is', () => {
    expect(input.strings({ keys: ['A', 'B'] }, 'keys')).toEqual(['A', 'B']);
  });

  test('wraps a single string into a one-element array', () => {
    expect(input.strings({ path: '.env' }, 'path')).toEqual(['.env']);
  });

  test('rejects non-string array elements', () => {
    expect(() => input.strings({ keys: ['A', 7] }, 'keys')).toThrow(/'keys\[1\]': expected a string, got number/);
  });

  test('rejects other types', () => {
    expect(() => input.strings({ keys: 42 }, 'keys')).toThrow(/expected a string or array of strings, got number/);
  });

  test('throws on a missing required input', () => {
    expect(() => input.strings({}, 'keys')).toThrow(/missing required input 'keys'/);
  });

  test('returns the default when missing', () => {
    expect(input.strings({}, 'keys', { default: ['fallback'] })).toEqual(['fallback']);
  });
});

describe('input.optional', () => {
  test('returns undefined when missing', () => {
    expect(input.optional.string({}, 'name')).toBeUndefined();
    expect(input.optional.number({}, 'n')).toBeUndefined();
    expect(input.optional.boolean({}, 'flag')).toBeUndefined();
    expect(input.optional.strings({}, 'keys')).toBeUndefined();
  });

  test('coerces when present', () => {
    expect(input.optional.string({ name: 'x' }, 'name')).toBe('x');
    expect(input.optional.number({ n: '5' }, 'n')).toBe(5);
    expect(input.optional.boolean({ flag: 'yes' }, 'flag')).toBe(true);
    expect(input.optional.strings({ keys: 'one' }, 'keys')).toEqual(['one']);
    expect(input.optional.strings({ keys: ['a', 'b'] }, 'keys')).toEqual(['a', 'b']);
  });
});

describe('display name override', () => {
  test('uses `as:` in error messages', () => {
    expect(() => input.string({}, 'firstName', { as: 'first-name' })).toThrow(/'first-name'/);
  });
});
