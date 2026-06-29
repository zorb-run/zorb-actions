---
'@zorb/env': patch
---

Initial release of `@zorb/env` — env-var loader actions for zorb workflows. Sibling to `@zorb/secrets`, same shape, no
masking. Each loader registers values into the run-scoped env table via `context.setEnv(name, value)`.

- `@zorb/env/set` — register a literal name/value pair (tests / one-offs).
- `@zorb/env/load-dotenv` — load `.env` files (multiple paths, `required:` toggle, `prefix:` / `only:` / `except:`
  filters).
- `@zorb/env/load-file` — load JSON / YAML files (TOML deferred).
- `@zorb/env/load-ini` — load INI files via the `ini` package; `section:` picks a slice, default loads top-level keys
  only.
