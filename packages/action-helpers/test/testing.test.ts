import { describe, expect, test } from 'bun:test';
import { mockContext } from '../src/testing.ts';

describe('mockContext', () => {
  test('captures log calls per level', () => {
    const ctx = mockContext();
    ctx.log.info('hello');
    ctx.log.warn('careful');
    ctx.log.error('boom');
    ctx.log.debug('chatter');

    expect(ctx.messages.info).toEqual(['hello']);
    expect(ctx.messages.warn).toEqual(['careful']);
    expect(ctx.messages.error).toEqual(['boom']);
    expect(ctx.messages.debug).toEqual(['chatter']);
  });

  test('records setSecret / setEnv calls', () => {
    const ctx = mockContext();
    ctx.setSecret('DATABASE_URL', 'postgres://localhost');
    ctx.setEnv('AWS_REGION', 'eu-west-1');
    expect(ctx.secrets).toEqual([{ name: 'DATABASE_URL', value: 'postgres://localhost' }]);
    expect(ctx.env).toEqual([{ name: 'AWS_REGION', value: 'eu-west-1' }]);
  });

  test('honours overrides', () => {
    const ctx = mockContext({ cwd: '/tmp/x', taskName: 'deploy', stepId: 'tag' });
    expect(ctx.cwd).toBe('/tmp/x');
    expect(ctx.taskName).toBe('deploy');
    expect(ctx.stepId).toBe('tag');
  });
});
