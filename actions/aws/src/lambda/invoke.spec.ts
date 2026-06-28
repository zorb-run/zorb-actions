import { describe, expect, test } from 'bun:test';
import { mockContext } from '@/shared/action-helpers/testing';
import {
  parseResponse,
  runInvoke,
  serializePayload,
  type InvokePlan,
  type LambdaInvokeResult,
  type LambdaOps,
} from './invoke';

interface InvokeCall {
  functionName: string;
  payload: string | undefined;
  invocationType: string;
  qualifier: string | undefined;
  logType: string;
}

function fakeLambda(result: Partial<LambdaInvokeResult> = {}): LambdaOps & { calls: InvokeCall[] } {
  const calls: InvokeCall[] = [];
  return {
    calls,
    async invoke(args) {
      calls.push(args);
      return {
        statusCode: result.statusCode ?? 200,
        payload: result.payload,
        functionError: result.functionError,
        logResult: result.logResult,
        executedVersion: result.executedVersion,
      };
    },
  };
}

function plan(overrides: Partial<InvokePlan> = {}): InvokePlan {
  return {
    functionName: 'my-fn',
    payload: undefined,
    invocationType: 'RequestResponse',
    qualifier: undefined,
    logType: 'None',
    failOnError: true,
    ...overrides,
  };
}

describe('serializePayload', () => {
  test('returns undefined for nullish input', () => {
    expect(serializePayload(undefined)).toBeUndefined();
    expect(serializePayload(null)).toBeUndefined();
  });

  test('forwards strings verbatim', () => {
    expect(serializePayload('{"a":1}')).toBe('{"a":1}');
    expect(serializePayload('not even json')).toBe('not even json');
  });

  test('stringifies objects, numbers, booleans', () => {
    expect(serializePayload({ a: 1, b: 'two' })).toBe('{"a":1,"b":"two"}');
    expect(serializePayload(42)).toBe('42');
    expect(serializePayload(true)).toBe('true');
  });

  test('rejects unsupported types', () => {
    expect(() => serializePayload(() => undefined)).toThrow(/must be a string, number, boolean, or object/);
  });
});

describe('parseResponse', () => {
  test('returns undefined for empty payloads', () => {
    expect(parseResponse(undefined)).toBeUndefined();
    expect(parseResponse('')).toBeUndefined();
  });

  test('parses JSON when possible', () => {
    expect(parseResponse('{"ok":true}')).toEqual({ ok: true });
    expect(parseResponse('[1,2,3]')).toEqual([1, 2, 3]);
  });

  test('falls back to the raw string for non-JSON', () => {
    expect(parseResponse('plain text')).toBe('plain text');
  });
});

describe('runInvoke', () => {
  test('forwards plan to the client and returns parsed response', async () => {
    const lambda = fakeLambda({ statusCode: 200, payload: '{"ok":true}', executedVersion: '$LATEST' });
    const ctx = mockContext();

    const result = await runInvoke(
      plan({ payload: '{"key":"value"}', qualifier: 'prod', invocationType: 'RequestResponse' }),
      lambda,
      ctx,
    );

    expect(lambda.calls).toEqual([
      {
        functionName: 'my-fn',
        payload: '{"key":"value"}',
        invocationType: 'RequestResponse',
        qualifier: 'prod',
        logType: 'None',
      },
    ]);
    expect(result).toEqual({
      statusCode: 200,
      response: { ok: true },
      functionError: undefined,
      logs: undefined,
      executedVersion: '$LATEST',
    });
  });

  test('throws on functionError when failOnError is true', async () => {
    const lambda = fakeLambda({
      statusCode: 200,
      functionError: 'Unhandled',
      payload: '{"errorMessage":"boom"}',
    });
    const ctx = mockContext();

    await expect(runInvoke(plan(), lambda, ctx)).rejects.toThrow(/Unhandled error.*boom/);
  });

  test('returns functionError when failOnError is false', async () => {
    const lambda = fakeLambda({
      statusCode: 200,
      functionError: 'Handled',
      payload: '{"errorMessage":"caught"}',
    });
    const ctx = mockContext();

    const result = await runInvoke(plan({ failOnError: false }), lambda, ctx);
    expect(result.functionError).toBe('Handled');
    expect(result.response).toEqual({ errorMessage: 'caught' });
  });

  test('decodes base64 log tail and forwards it to context.log.info', async () => {
    const logText = 'START RequestId\nEND RequestId';
    const lambda = fakeLambda({
      statusCode: 200,
      payload: '{}',
      logResult: Buffer.from(logText, 'utf8').toString('base64'),
    });
    const ctx = mockContext();

    const result = await runInvoke(plan({ logType: 'Tail' }), lambda, ctx);
    expect(result.logs).toBe(logText);
    expect(ctx.messages.info).toEqual(['START RequestId', 'END RequestId']);
  });

  test('Event invocations return an undefined response when payload is empty', async () => {
    const lambda = fakeLambda({ statusCode: 202, payload: undefined });
    const ctx = mockContext();

    const result = await runInvoke(plan({ invocationType: 'Event' }), lambda, ctx);
    expect(result).toEqual({
      statusCode: 202,
      response: undefined,
      functionError: undefined,
      logs: undefined,
      executedVersion: undefined,
    });
  });
});
