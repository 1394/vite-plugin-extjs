# vite-plugin-extjs

Develop and build Ext JS projects using Vite.

## Install

```bash
npm i -D vite-plugin-extjs
```

## Usage

```js
// vite.config.js
import viteExtJS from 'vite-plugin-extjs';

export default {
  plugins: [
      viteExtJS(
          {
              paths: {
                  Ext: false,
              },
              entryPoints: [],
              theme: {
                  basePath: '',
                  sassPath: '',
                  sassFile: '',
                  outputDir: '',
                  setSassVars: [],
                  replaceImportPaths: {
                      search: '',
                      replace: '',
                  },
              },
              symlink: {},
              debug: {
                  error: true,
                  warn: true,
                  info: true,
              },
          }
      ),
  ],
};
```
## Options

### `paths`
- **Type:** `object`
  - `key`: Ext JS namespace
  - `value`: 'path/to/classes/root/folder' or `false` to exclude namespace from analyzing

Analyzer will scan folders to build class map for namespaces.

### `entryPoints`
- **Type:** `string[]`

Paths to any files that needs to be analyzed, for example app.js and other, that is not listed in `paths` option.

### `theme`
- **Type:** `object`
  - `basePath` : `string`
  - `sassPath` : `string`
  - `sassFile` : `string`
  - `outputDir` : `string`
  - `setSassVars` : `string[]`
  - `replaceImportPaths` : `object`
    - `search`: : `string[]`
    - `replace`: : `string[]`

### `symlink`
- **Type:** `object`
  - `key`: Ext JS namespace
  - `value`: 'path/to/local/folder'

If you're modifying files in `node_modules` folder Vite does not recognize this changes, so this is to fix that behavior.

### `debug`
- **Type:** `object | boolean`
  - `error`: `boolean`
  - `warn`: `boolean`
  - `info`: `boolean`

Plugin debug levels.
