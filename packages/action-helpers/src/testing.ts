import type { ActionContext, ActionLogger } from './types.ts';

/**
 * In-memory fakes for testing actions without spinning up zorb's runner.
 * Mirrors the protocol the real runner implements: `setSecret` / `setEnv`
 * append to internal lists, `log.*` writes to per-level arrays you can
 * assert against.
 */

export interface MockLog {
  debug: string[];
  info: string[];
  warn: string[];
  error: string[];
}

export interface MockContext extends ActionContext {
  readonly log: MockActionLogger;
  readonly secrets: { name: string; value: string }[];
  readonly env: { name: string; value: string }[];
  readonly messages: MockLog;
}

export interface MockActionLogger extends ActionLogger {
  readonly messages: MockLog;
}

export interface MockContextOptions {
  cwd?: string;
  taskName?: string;
  stepId?: string;
}

export function mockLogger(): MockActionLogger {
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
    taskName: opts.taskName,
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
