import type { ActionContext } from './types';

/**
 * In-memory fakes for testing actions without spinning up zorb's runner.
 * `setSecret` / `setEnv` append to internal lists; `log.*` writes to per-level
 * arrays you can assert against. The shape satisfies the canonical
 * `ActionContext` from `zorb/action`.
 */

export interface MockLog {
  debug: unknown[];
  info: unknown[];
  warn: unknown[];
  error: unknown[];
}

export interface MockLogger {
  readonly messages: MockLog;
  debug(msg: unknown): void;
  info(msg: unknown): void;
  warn(msg: unknown): void;
  error(msg: unknown): void;
}

export interface MockContext extends ActionContext {
  readonly log: MockLogger;
  readonly secrets: { name: string; value: string }[];
  readonly env: { name: string; value: string }[];
  readonly messages: MockLog;
}

export interface MockContextOptions {
  cwd?: string;
  taskName?: string;
  stepId?: string;
}

export function mockLogger(): MockLogger {
  const messages: MockLog = { debug: [], info: [], warn: [], error: [] };
  return {
    messages,
    debug(m) {
      messages.debug.push(m);
    },
    info(m) {
      messages.info.push(m);
    },
    warn(m) {
      messages.warn.push(m);
    },
    error(m) {
      messages.error.push(m);
    },
  };
}

export function mockContext(opts: MockContextOptions = {}): MockContext {
  const log = mockLogger();
  const secrets: { name: string; value: string }[] = [];
  const env: { name: string; value: string }[] = [];
  return {
    cwd: opts.cwd ?? process.cwd(),
    taskName: opts.taskName ?? 'test',
    stepId: opts.stepId,
    log,
    secrets,
    env,
    messages: log.messages,
    setSecret(name, value) {
      secrets.push({ name, value });
    },
    setEnv(name, value) {
      env.push({ name, value });
    },
  };
}
