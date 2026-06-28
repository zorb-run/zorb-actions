# @zorb/secrets

Secret-loader actions for [zorb](https://github.com/zorb-run/zorb-cli) workflows. Each loader registers values into the
run-scoped secret table via `context.setSecret(name, value)`; once registered, a secret is referenceable as
`${{ secrets.<name> }}` in `with:` / `env:` and is automatically masked in subsequent step output.

> Status: first cut. Offline-safe loaders only (`set`, `load-env`, `load-dotenv`, `load-file`). CLI- and SDK-wrapping
> loaders (`load-1password`, `load-doppler`, `load-aws`, `load-vault`, `load-gcp`, `load-keychain`) ship in follow-up
> releases.

## Actions

### `@zorb/secrets/set`

Register a literal name/value pair. Intended for tests and one-offs — real workflows should use a dedicated loader.

```yml
secrets:
  - uses: '@zorb/secrets/set'
    with:
      name: API_KEY
      value: super-secret
```

| input   | type   | required | description                     |
| ------- | ------ | -------- | ------------------------------- |
| `name`  | string | yes      | secret name                     |
| `value` | string | yes      | secret value (registered as-is) |

### `@zorb/secrets/load-env`

Promote selected `process.env` vars into the secret table so they get masked. Useful when CI already injects credentials
as env vars.

```yml
secrets:
  - uses: '@zorb/secrets/load-env'
    with:
      keys: [STRIPE_KEY, DATABASE_URL]
```

| input      | type               | required | default | description                           |
| ---------- | ------------------ | -------- | ------- | ------------------------------------- |
| `keys`     | string \| string[] | yes      | —       | env var names to promote              |
| `required` | boolean            | no       | `true`  | error if any named env var is missing |

### `@zorb/secrets/load-dotenv`

Load secrets from one or more `.env` files.

```yml
secrets:
  - uses: '@zorb/secrets/load-dotenv'
    with:
      path: [.env, .env.local]
      only: [API_KEY, DB_URL]
```

| input      | type               | required | default | description                                     |
| ---------- | ------------------ | -------- | ------- | ----------------------------------------------- |
| `path`     | string \| string[] | no       | `.env`  | path(s) resolved relative to the workflow's cwd |
| `only`     | string \| string[] | no       | —       | only register keys in this list                 |
| `except`   | string \| string[] | no       | —       | skip keys in this list                          |
| `required` | boolean            | no       | `true`  | error if any listed file is missing             |

Supported `.env` grammar: blank lines + `#` comments are skipped, `export ` prefix is stripped, double-quoted values
interpret `\n \r \t \\ \"` escapes, single-quoted values are literal, unquoted values are trimmed. Multi-line values and
`$VAR` expansion are not supported — use `load-file` for richer formats.

### `@zorb/secrets/load-file`

Load secrets from a structured JSON or YAML file. The top level must be a flat object of string/number/boolean values.

```yml
secrets:
  - uses: '@zorb/secrets/load-file'
    with:
      path: ./config/secrets.yml
```

| input    | type               | required | default                 | description                                                          |
| -------- | ------------------ | -------- | ----------------------- | -------------------------------------------------------------------- |
| `path`   | string             | yes      | —                       | path resolved relative to the workflow's cwd                         |
| `format` | string             | no       | inferred from extension | `json` or `yaml`; needed when the extension isn't `.json/.yml/.yaml` |
| `only`   | string \| string[] | no       | —                       | only register keys in this list                                      |
| `except` | string \| string[] | no       | —                       | skip keys in this list                                               |

Decryption (SOPS, age, gpg) is not yet supported — feed `load-file` already-decrypted plaintext. Decryptor support ships
in a follow-up.

## Composition

The runner enforces first-write-wins for the secret table. Layer loaders to model local-overrides-prod patterns:

```yml
secrets:
  - uses: '@zorb/secrets/load-dotenv' # developer's local .env (wins if present)
    with:
      path: .env.local
      required: false
  - uses: '@zorb/secrets/load-file' # shared team secrets
    with:
      path: ./config/secrets.yml
```
