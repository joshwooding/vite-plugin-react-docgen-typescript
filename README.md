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

| Option                       | Type           | Description                                                                                                                                         | Default                   |
| ---------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| tsconfigPath                 | string         | Specify the location of the `tsconfig.json` to use.                                                                                                 | `null`                    |
| compilerOptions              | object         | Specify compiler options. Cannot be used with `tsconfigPath`                                                                                        | `null`                    |
| setDisplayName               | boolean        | Set the components' display name. If you want to set display names yourself or are using another plugin to do this, you should disable this option. | `true`                    |
| typePropName                 | string         | Specify the name of the property for docgen info prop type.                                                                                         | `type`                    |
| exclude                      | glob[]         | Glob patterns to ignore and not generate docgen information for. (Great for ignoring large icon libraries)                                          | `[]`                      |
| include                      | glob[]         | Glob patterns to generate docgen information for                                                                                                    | `['**/**.tsx']`           |
| EXPERIMENTAL_useWatchProgram | boolean        | Enables an experimental watch mode to enable HMR support. **warning**: This may affect performance                                                  | `['**/**.tsx']`           |
