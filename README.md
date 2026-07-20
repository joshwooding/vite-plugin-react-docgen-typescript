# @joshwooding/vite-plugin-react-docgen-typescript

[![npm](https://img.shields.io/npm/v/@joshwooding/vite-plugin-react-docgen-typescript.svg)](https://www.npmjs.com/package/@joshwooding/vite-plugin-react-docgen-typescript)
[![Code style: Prettier](https://img.shields.io/badge/code_style-prettier-ff69b4.svg)](https://github.com/prettier/prettier)

> A vite plugin to inject react typescript docgen information

&nbsp;

### Usage

```ts
import reactDocgenTypescript from "@joshwooding/vite-plugin-react-docgen-typescript";

export default {
  plugins: [reactDocgenTypescript()],
};
```

### Options

This plugins support all parser options from [react-docgen-typescript](https://github.com/styleguidist/react-docgen-typescript#parseroptions) and all of the following options:

| Option                         | Type           | Description                                                                                                                                         | Default         |
|--------------------------------| -------------- |-----------------------------------------------------------------------------------------------------------------------------------------------------|-----------------|
| tsconfigPath                   | string         | Specify the location of the `tsconfig.json` to use.                                                                                                 | `null`          |
| compilerOptions                | object         | Specify compiler options. Cannot be used with `tsconfigPath`                                                                                        | `null`          |
| setDisplayName                 | boolean        | Set the components' display name. If you want to set display names yourself or are using another plugin to do this, you should disable this option. | `true`          |
| typePropName                   | string         | Specify the name of the property for docgen info prop type.                                                                                         | `type`          |
| exclude                        | glob[]         | Glob patterns to ignore and not generate docgen information for. (Great for ignoring large icon libraries)                                          | `[]`            |
| include                        | glob[]         | Glob patterns to generate docgen information for                                                                                                    | `['**/**.tsx']` |
| fileSystemCache                | boolean/object | Enables a persistent file-system cache. Configure with `{ enabled?: boolean; directory?: string }`.                                                 | `false`         |
| EXPERIMENTAL_useWatchProgram   | boolean        | Enables an experimental watch mode to enable HMR support. **warning**: This may affect performance                                                  | `false`         |
| EXPERIMENTAL_useProjectService | boolean        | Enables an experimental mode that uses the TS project service to enable HMR support. **warning**: This may affect performance                       | `false`         |

When `fileSystemCache` is enabled without a custom directory, cache entries are stored in `node_modules/.cache/vite-plugin-react-docgen-typescript`.

### TypeScript compatibility

This plugin supports the TypeScript JavaScript compiler API in TypeScript
`>=4.3 <7`. TypeScript 7's root npm export does not provide the legacy stable
compiler API consumed by this plugin and `react-docgen-typescript`, so installing
TypeScript 7 as `typescript` produces an early compatibility error.

TypeScript 7 includes unstable native API subpaths, but they use a different
project, snapshot, and checker model. They are not a supported drop-in
replacement in this release. Native support needs a separate backend plus
parity, HMR, and packaging evidence before the peer range can be widened.

If a project needs the TypeScript 7 CLI alongside docgen, expose Microsoft's
TypeScript 6 compatibility package under the name `typescript` and install
TypeScript 7 under another alias:

```json
{
  "devDependencies": {
    "typescript": "npm:@typescript/typescript6@6.0.x",
    "typescript7": "npm:typescript@7.0.2"
  }
}
```

This keeps docgen on the TypeScript 6 compiler API; it does not make the plugin
use TypeScript 7. Yarn 4.13 applies an incompatible built-in patch to that
reverse alias, so Yarn users should install `typescript@6.0.x` under its normal
name instead and keep TypeScript 7 on the separate alias.
