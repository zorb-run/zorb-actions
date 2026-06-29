# @zorb/env

Env-var loader actions for [zorb](https://github.com/zorb-run/zorb-cli) workflows. Each loader registers values into the
run-scoped env table via `context.setEnv(name, value)`; once registered, a name is referenceable as `${{ env.<name> }}`
in `with:` / `env:` and is added to the subprocess env of subsequent `run:` steps.

Sibling to [`@zorb/secrets`](https://github.com/zorb-run/zorb-actions/tree/main/actions/secrets) — same shape, but no
masking. Use `@zorb/env` for non-secret config, and `@zorb/secrets` for anything that should be hidden from step output.

> Ships `set`, `load-dotenv`, `load-file`, and `load-ini`. Remote loaders (`load-remote`, `load-aws-ssm`) ship in
> follow-up releases.

## Install

```sh
npm install @zorb/env
yarn add @zorb/env
pnpm add @zorb/env
bun add @zorb/env
```

## Actions

### `@zorb/env/set`

Register a literal name/value pair. Intended for tests and one-offs — real workflows should use a dedicated loader or
declare static values with `env:` in the workflow itself.

```yml
steps:
  - uses: '@zorb/env/set'
    with:
      name: NODE_ENV
      value: production
```

…or directly from the CLI:

```sh
zorb use @zorb/env/set --with name=NODE_ENV value=production
```

| Input   | Type   | Required | Description           |
| ------- | ------ | -------- | --------------------- |
| `name`  | string | yes      | Env var name          |
| `value` | string | yes      | Env var value (as-is) |

### `@zorb/env/load-dotenv`

Load env vars from one or more `.env` files. More flexible than the top-level `--env-file` CLI flag: can be dynamic per
task, supports multiple paths, and supports conditional loading.

```yml
steps:
  - uses: '@zorb/env/load-dotenv'
    with:
      path: [.env, .env.local]
      prefix: APP_
      only: [DB_URL, PORT]
```

…or directly from the CLI (single path / single filter — use the YAML form for multiples):

```sh
zorb use @zorb/env/load-dotenv --with path=.env.local prefix=APP_
```

| Input      | Type               | Required | Default | Description                                     |
| ---------- | ------------------ | -------- | ------- | ----------------------------------------------- |
| `path`     | string \| string[] | no       | `.env`  | Path(s) resolved relative to the workflow's cwd |
| `prefix`   | string             | no       | `''`    | String prepended to every registered name       |
| `only`     | string \| string[] | no       | —       | Only register keys in this list (source key)    |
| `except`   | string \| string[] | no       | —       | Skip keys in this list (source key)             |
| `required` | boolean            | no       | `true`  | Error if any listed file is missing             |

Supported `.env` grammar: blank lines + `#` comments are skipped, `export ` prefix is stripped, double-quoted values
interpret `\n \r \t \\ \"` escapes, single-quoted values are literal, unquoted values are trimmed. Multi-line values and
`$VAR` expansion are not supported — use `load-file` for richer formats.

`only:` / `except:` match the **source key** as it appears in the file. `prefix:` is applied **after** filtering, so
`only: [DB_URL]` with `prefix: APP_` registers `APP_DB_URL`.

### `@zorb/env/load-file`

Load env vars from a structured JSON or YAML file. The top level must be a flat object of string/number/boolean values.

```yml
steps:
  - uses: '@zorb/env/load-file'
    with:
      path: ./config/env.yml
      prefix: APP_
```

…or directly from the CLI:

```sh
zorb use @zorb/env/load-file --with path=./config/env.yml prefix=APP_
```

| Input    | Type               | Required | Default                 | Description                                                          |
| -------- | ------------------ | -------- | ----------------------- | -------------------------------------------------------------------- |
| `path`   | string             | yes      | —                       | Path resolved relative to the workflow's cwd                         |
| `format` | string             | no       | inferred from extension | `json` or `yaml`; needed when the extension isn't `.json/.yml/.yaml` |
| `prefix` | string             | no       | `''`                    | String prepended to every registered name                            |
| `only`   | string \| string[] | no       | —                       | Only register keys in this list (source key)                         |
| `except` | string \| string[] | no       | —                       | Skip keys in this list (source key)                                  |

TOML support is planned and will land in a follow-up release.

### `@zorb/env/load-ini`

Load env vars from an INI file (parsed via the [`ini`](https://www.npmjs.com/package/ini) package). INI is inherently
sectioned, so this loader picks one slice of the file per invocation:

- By default, only top-level keys (those above any `[section]` header) are loaded. Section bodies — including dotted
  sub-sections like `[foo.bar]`, which `ini` parses into nested objects — are ignored.
- Set `section: foo` to load keys from `[foo]` instead. Inside the chosen section, nested objects (from `[foo.bar]`) and
  array-valued keys (`key[]=`) error rather than being silently dropped.

```yml
steps:
  - uses: '@zorb/env/load-ini'
    with:
      path: ~/.aws/credentials
      section: default
      prefix: AWS_
```

…or directly from the CLI:

```sh
zorb use @zorb/env/load-ini --with path=~/.aws/credentials section=default prefix=AWS_
```

| Input     | Type               | Required | Default | Description                                              |
| --------- | ------------------ | -------- | ------- | -------------------------------------------------------- |
| `path`    | string             | yes      | —       | Path resolved relative to the workflow's cwd             |
| `section` | string             | no       | —       | Section name; if omitted, only top-level keys are loaded |
| `prefix`  | string             | no       | `''`    | String prepended to every registered name                |
| `only`    | string \| string[] | no       | —       | Only register keys in this list (source key)             |
| `except`  | string \| string[] | no       | —       | Skip keys in this list (source key)                      |

Array-valued keys at the top level also error, since arrays don't map to a single env-var value.

## Secrets vs env

If a value should be masked in step output, load it via
[`@zorb/secrets`](https://github.com/zorb-run/zorb-actions/tree/main/actions/secrets) instead. The two tables are
separate — `setEnv` does **not** populate the secret table, and `setSecret` does **not** populate the env table — but
they share the same loader patterns so workflows can layer both side-by-side.

```yml
secrets:
  - uses: '@zorb/secrets/load-dotenv'
    with:
      path: .env.secrets

tasks:
  build:
    steps:
      - uses: '@zorb/env/load-file'
        with:
          path: ./config/env.yml
      - run: ./scripts/build.sh
```
