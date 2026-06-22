# @zorb/**name**

TODO: short description of what this package does.

## Actions

### `@zorb/__name__/hello`

Prints a greeting.

```yml
- uses: '@zorb/__name__/hello'
  with:
    name: world
```

**Inputs**

| name       | type   | required | default | description       |
| ---------- | ------ | -------- | ------- | ----------------- |
| `name`     | string | yes      | —       | who to greet      |
| `greeting` | string | no       | `Hello` | salutation prefix |

**Outputs**

| name      | type   | description                   |
| --------- | ------ | ----------------------------- |
| `message` | string | the greeting that was printed |
