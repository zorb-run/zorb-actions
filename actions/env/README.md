# @zorb/env

Env-var loader actions for [zorb](https://github.com/zorb-run/zorb-cli) workflows. Each loader registers values into the
run-scoped env table via `context.setEnv(name, value)`; once registered, a name is referenceable as `${{ env.<name> }}`
in `with:` / `env:` and is added to the subprocess env of subsequent `run:` steps.

Sibling to [`@zorb/secrets`](../secrets) — same shape, but no masking. Use `@zorb/env` for non-secret config, and
`@zorb/secrets` for anything that should be hidden from step output.

> Status: first cut. Offline-safe loaders only (`set`, `load-dotenv`, `load-file`, `load-ini`). Remote loaders
> (`load-remote`, `load-aws-ssm`) ship in follow-up releases.

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

| input   | type   | required | description           |
| ------- | ------ | -------- | --------------------- |
| `name`  | string | yes      | env var name          |
| `value` | string | yes      | env var value (as-is) |

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

| input      | type               | required | default | description                                     |
| ---------- | ------------------ | -------- | ------- | ----------------------------------------------- |
| `path`     | string \| string[] | no       | `.env`  | path(s) resolved relative to the workflow's cwd |
| `prefix`   | string             | no       | `''`    | string prepended to every registered name       |
| `only`     | string \| string[] | no       | —       | only register keys in this list (source key)    |
| `except`   | string \| string[] | no       | —       | skip keys in this list (source key)             |
| `required` | boolean            | no       | `true`  | error if any listed file is missing             |

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

| input    | type               | required | default                 | description                                                          |
| -------- | ------------------ | -------- | ----------------------- | -------------------------------------------------------------------- |
| `path`   | string             | yes      | —                       | path resolved relative to the workflow's cwd                         |
| `format` | string             | no       | inferred from extension | `json` or `yaml`; needed when the extension isn't `.json/.yml/.yaml` |
| `prefix` | string             | no       | `''`                    | string prepended to every registered name                            |
| `only`   | string \| string[] | no       | —                       | only register keys in this list (source key)                         |
| `except` | string \| string[] | no       | —                       | skip keys in this list (source key)                                  |

TOML support is planned and will land in a follow-up release.

### `@zorb/env/load-ini`

Load env vars from an INI file (parsed via the [`ini`](https://www.npmjs.com/package/ini) package). INI is inherently
sectioned, so this loader picks one slice of the file per invocation:

- By default, only top-level keys (those above any `[section]` header) are loaded.
- Set `section: foo` to load keys from a specific `[foo]` section instead.

```yml
steps:
  - uses: '@zorb/env/load-ini'
    with:
      path: ~/.aws/credentials
      section: default
      prefix: AWS_
```

| input     | type               | required | default | description                                              |
| --------- | ------------------ | -------- | ------- | -------------------------------------------------------- |
| `path`    | string             | yes      | —       | path resolved relative to the workflow's cwd             |
| `section` | string             | no       | —       | section name; if omitted, only top-level keys are loaded |
| `prefix`  | string             | no       | `''`    | string prepended to every registered name                |
| `only`    | string \| string[] | no       | —       | only register keys in this list (source key)             |
| `except`  | string \| string[] | no       | —       | skip keys in this list (source key)                      |

Nested sub-sections and array-valued keys are rejected — flatten or pick a leaf section.

## Secrets vs env

If a value should be masked in step output, load it via [`@zorb/secrets`](../secrets) instead. The two tables are
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
