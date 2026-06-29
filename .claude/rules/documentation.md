# Documentation style — `@zorb/*` package READMEs

These rules describe the house style for `actions/<pkg>/README.md` files. They render on npmjs.com as well as
github.com, so anything that doesn't work on both is a bug.

## Top-level structure

Use this order for every package README. Skip a section only if it genuinely doesn't apply.

```
# @zorb/<pkg>

<one-sentence purpose, ending with a `.`>

> Ships ..., ..., and .... <Things that don't ship yet> ship in follow-up releases.

## Install

## <Authentication / Prerequisites / etc, optional>

## Actions

### `@zorb/<pkg>/<action>`
### `@zorb/<pkg>/<action>`
...

## Composition          (optional)
## IAM permissions      (optional, package-specific)
## Secrets vs env       (optional, where relevant)
```

- Don't include a `## License` section — `package.json` carries the license; both npm and GitHub render it.
- Don't lead with `> Status: first cut.` or any other dev-speak. State what ships and what's deferred in one
  matter-of-fact `> Ships ...` blockquote.
- Cross-package mentions (e.g. "Sibling to `@zorb/secrets`") go in the intro paragraph, before the `> Ships` line.

## Install section

Show **all four** package managers, in this order, in a single `sh` block:

````md
## Install

```sh
npm install @zorb/<pkg>
yarn add @zorb/<pkg>
pnpm add @zorb/<pkg>
bun add @zorb/<pkg>
```
````

## Per-action sections

Each action gets a `### \`@zorb/<pkg>/<action>\`` heading and this layout:

1. One- or two-sentence description (imperative voice).
2. Optional blockquote callout for hard prerequisites (e.g. credentials, CLI deps). Format:
   ```
   > Requires [`@zorb/aws/configure`](https://.../actions/aws#zorbawsconfigure) to have run earlier in the same task
   > (or via the top-level `secrets:` block).
   ```
3. **Workflow YAML example** (primary). Use `yml`, not `yaml`, as the fence tag.
4. **CLI example** (secondary), introduced with `…or directly from the CLI:` — every action that can be run via
   `zorb use` gets one. The exception is actions whose entire purpose is to populate shared state for later steps (e.g.
   `@zorb/aws/configure`) — `zorb use` would discard that state immediately, so skip the CLI form.
5. **Input table** (always).
6. **Output table** (only when the action returns outputs).
7. Optional bold-prefixed notes for grouped detail: `**Safety.**`, `**Globs.**`, `**Content types.**`, etc. — one
   paragraph each, no `####` subheadings for these.

### YAML / CLI examples

Show the YAML form using `steps:` or `secrets:` matching where the action is conventionally used. Then the CLI form:

````md
…or directly from the CLI:

```sh
zorb use @zorb/<pkg>/<action> --with key=value other=value
```
````

`--with` takes space-separated `key=value` pairs and does not support arrays. For array inputs:

- Show a single-element CLI example.
- Add a parenthetical note in the lead-in: `(single tag — use the YAML form for multiple)`.

## Tables

- **Headers** use Start case: `Input`, `Type`, `Required`, `Default`, `Description`, `Output`, `Mode`, `Inputs`,
  `What Happens`.
- **Description** cells use Sentence case (first letter capital), e.g. `Local path or s3://bucket[/prefix]`. Acronyms
  and proper nouns keep their case (`AWS region — …`).
- **Type** cells stay lowercase, matching TypeScript: `string`, `number`, `boolean`, `string | string[]`,
  `object | string | undefined`. Use `?` suffix sparingly (`string?`) for optional outputs.
- **Required** cells: `yes`, `no`, or a clause like `when \`roleArn\` is set`.
- **Default** cells: backtick-quoted literals (`` `false` ``, `` `'latest'` ``), or short prose like
  `inferred from extension`, or `—` for "no default".
- **Input/output names** are always backticked: `` `functionName` ``.

Example:

```md
| Input    | Type    | Required | Default | Description                          |
| -------- | ------- | -------- | ------- | ------------------------------------ |
| `source` | string  | yes      | —       | Local path or `s3://bucket[/prefix]` |
| `delete` | boolean | no       | `false` | Remove objects missing from source   |
```

Let prettier re-flow column widths; don't hand-align.

## Links

**All cross-package and intra-repo links must be absolute github.com URLs.** README files are rendered standalone on
npmjs.com, and relative paths (`../secrets`, `#zorbawsconfigure`) 404 there.

- Cross-package: `https://github.com/zorb-run/zorb-actions/tree/main/actions/<pkg>`
- Same-document section anchors: `https://github.com/zorb-run/zorb-actions/tree/main/actions/<pkg>#<slug>`
- External: just use the canonical URL.

Repeat the same long URL across a README rather than introducing reference-style links — readers on npm see the URL once
they hover, which is enough.

## Voice and tone

- Imperative, present tense ("Load env vars from…", not "This action loads…").
- One thought per sentence. Bullet lists when there are three or more parallel points.
- Bold-prefixed paragraphs (`**Safety.**`) instead of `####` subheadings within an action's section — keeps the heading
  hierarchy flat and the action's anchor clean.
- No emoji.
- No "we" or "you" unless giving an explicit instruction.
- Don't apologise for what's missing. Note it once in the `> Ships` blockquote at the top and move on.
