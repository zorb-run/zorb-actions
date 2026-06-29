# Package publishing

## First-run

Ensure:

- `package.json` has `repository` set with `url` & `directory`

Then run:

```sh
# Reauthenticate NPM
$ npm login

# Publish package for the first time
$ bun publish

# Enable OIDC/provenance for new package
$ npm trust github @zorb/<name> --repo=zorb-run/zorb-actions --file=release.yml --allow-publish
```

## Subsequent runs

- Open a PR with a changeset
- Merge, the `release` workflow will take care of the rest!
