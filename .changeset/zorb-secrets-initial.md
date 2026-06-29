---
'@zorb/secrets': patch
---

Initial release of `@zorb/secrets` — secret-loader actions for zorb workflows. Each loader calls
`context.setSecret(name, value)` so the loaded values are referenceable via `${{ secrets.<name> }}` and masked
automatically in step stdout/stderr.

- `@zorb/secrets/set` — register a literal name/value pair (tests / one-offs).
- `@zorb/secrets/load-env` — promote selected `process.env` vars into the secrets table so they get masking.
- `@zorb/secrets/load-dotenv` — load secrets from one or more `.env` files.
- `@zorb/secrets/load-file` — load secrets from a structured JSON / YAML file.
