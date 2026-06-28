// Re-export the canonical action contract types from `zorb/action`. The CLI
// owns these — duplicating them here would split the source of truth and
// silently drift the moment the runner's protocol changes.
export type { ActionContext, ActionInput, ActionOutput } from 'zorb/action';

/**
 * Convenience alias for the raw `with:` payload as it arrives at an action.
 * The runner JSON-deserialises into this shape; the `input.*` validators
 * narrow off it.
 */
export type ActionInputs = Record<string, unknown>;
