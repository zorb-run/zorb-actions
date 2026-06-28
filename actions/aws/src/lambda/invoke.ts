import { InvokeCommand, LambdaClient, type LambdaClientConfig } from '@aws-sdk/client-lambda';
import type { ActionContext } from 'zorb/action';
import { input, type ActionInputs } from '@/shared/action-helpers';

export interface InvokeOutputs {
  statusCode: number;
  response: unknown;
  functionError: string | undefined;
  logs: string | undefined;
  executedVersion: string | undefined;
}

export type InvocationType = 'RequestResponse' | 'Event' | 'DryRun';
export type LogType = 'None' | 'Tail';

export interface InvokePlan {
  functionName: string;
  payload: string | undefined;
  invocationType: InvocationType;
  qualifier: string | undefined;
  logType: LogType;
  failOnError: boolean;
}

export interface LambdaInvokeResult {
  statusCode: number;
  payload: string | undefined;
  functionError: string | undefined;
  logResult: string | undefined;
  executedVersion: string | undefined;
}

export interface LambdaOps {
  invoke(args: {
    functionName: string;
    payload: string | undefined;
    invocationType: InvocationType;
    qualifier: string | undefined;
    logType: LogType;
  }): Promise<LambdaInvokeResult>;
}

const INVOCATION_TYPES: ReadonlySet<InvocationType> = new Set(['RequestResponse', 'Event', 'DryRun']);
const LOG_TYPES: ReadonlySet<LogType> = new Set(['None', 'Tail']);

/**
 * Invoke an AWS Lambda function and surface its response. The payload is
 * sent as JSON; objects are stringified, strings are forwarded verbatim
 * (callers that want to pass non-JSON bytes can pre-serialize). The response
 * body is JSON-parsed when possible and exposed as `outputs.response`.
 *
 * `invocationType` defaults to `RequestResponse` (synchronous). Use `Event`
 * for fire-and-forget; the response body will be empty in that case.
 *
 * `failOnError: true` (the default) treats a Lambda `FunctionError` as a step
 * failure. Set it to `false` to let the workflow continue and inspect
 * `outputs.functionError` itself.
 */
export async function action(rawInputs: ActionInputs, context: ActionContext): Promise<InvokeOutputs> {
  const region = input.optional.string(rawInputs, 'region');
  const plan: InvokePlan = {
    functionName: input.string(rawInputs, 'functionName'),
    payload: serializePayload(rawInputs['payload']),
    invocationType: parseInvocationType(input.optional.string(rawInputs, 'invocationType')),
    qualifier: input.optional.string(rawInputs, 'qualifier'),
    logType: parseLogType(input.optional.string(rawInputs, 'logType')),
    failOnError: input.boolean(rawInputs, 'failOnError', { default: true }),
  };

  const ops = defaultOps(buildClient(region));
  return runInvoke(plan, ops, context);
}

export async function runInvoke(plan: InvokePlan, ops: LambdaOps, context: ActionContext): Promise<InvokeOutputs> {
  const result = await ops.invoke({
    functionName: plan.functionName,
    payload: plan.payload,
    invocationType: plan.invocationType,
    qualifier: plan.qualifier,
    logType: plan.logType,
  });

  const logs = result.logResult !== undefined ? Buffer.from(result.logResult, 'base64').toString('utf8') : undefined;
  const response = parseResponse(result.payload);

  if (logs !== undefined) {
    for (const line of logs.split('\n')) {
      if (line !== '') context.log.info(line);
    }
  }

  if (result.functionError !== undefined && plan.failOnError) {
    const detail =
      typeof response === 'object' && response !== null ? JSON.stringify(response) : String(response ?? '');
    throw new Error(`@zorb/aws/lambda/invoke: ${plan.functionName} returned ${result.functionError} error: ${detail}`);
  }

  return {
    statusCode: result.statusCode,
    response,
    functionError: result.functionError,
    logs,
    executedVersion: result.executedVersion,
  };
}

export function serializePayload(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') return JSON.stringify(raw);
  if (typeof raw === 'object') return JSON.stringify(raw);
  throw new Error(`@zorb/aws/lambda/invoke: payload must be a string, number, boolean, or object`);
}

export function parseResponse(raw: string | undefined): unknown {
  if (raw === undefined || raw === '') return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function parseInvocationType(raw: string | undefined): InvocationType {
  if (raw === undefined) return 'RequestResponse';
  if (!INVOCATION_TYPES.has(raw as InvocationType)) {
    throw new Error(
      `@zorb/aws/lambda/invoke: invocationType must be one of RequestResponse, Event, DryRun (got '${raw}')`,
    );
  }
  return raw as InvocationType;
}

function parseLogType(raw: string | undefined): LogType {
  if (raw === undefined) return 'None';
  if (!LOG_TYPES.has(raw as LogType)) {
    throw new Error(`@zorb/aws/lambda/invoke: logType must be 'None' or 'Tail' (got '${raw}')`);
  }
  return raw as LogType;
}

function buildClient(region: string | undefined): LambdaClient {
  const config: LambdaClientConfig = {};
  if (region !== undefined) config.region = region;
  return new LambdaClient(config);
}

export function defaultOps(client: LambdaClient): LambdaOps {
  return {
    async invoke(args) {
      const res = await client.send(
        new InvokeCommand({
          FunctionName: args.functionName,
          Payload: args.payload === undefined ? undefined : Buffer.from(args.payload, 'utf8'),
          InvocationType: args.invocationType,
          Qualifier: args.qualifier,
          LogType: args.logType,
        }),
      );
      return {
        statusCode: res.StatusCode ?? 0,
        payload: res.Payload === undefined ? undefined : Buffer.from(res.Payload).toString('utf8'),
        functionError: res.FunctionError,
        logResult: res.LogResult,
        executedVersion: res.ExecutedVersion,
      };
    },
  };
}
