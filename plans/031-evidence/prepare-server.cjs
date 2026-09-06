const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const repo = path.resolve(__dirname, '../..');
const raw = path.join(repo, '.yarn/simplification-evidence/031');
const runtime = path.join(raw, 'storybook-runtime');
const fixture = path.join(raw, 'fixture');
const req = createRequire(path.join(runtime, 'package.json'));
fs.mkdirSync(path.join(fixture, '.storybook'), { recursive: true });
fs.symlinkSync(path.join(runtime, 'node_modules'), path.join(fixture, 'node_modules'), 'junction');
fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({ name: 'storybook-docgen-fixture', version: '0.0.0', private: true, type: 'module' }) + '\n', { flag: 'wx' });
// Pinned internal registry export used by Storybook 10.6.0's own common preset.
const serviceUrl = pathToFileURL(path.join(path.dirname(req.resolve('storybook/package.json')), 'dist/_node-chunks/chunk-UAW7LJY2.js')).href;
const config = `import { getService } from ${JSON.stringify(serviceUrl)};
export default {
  framework: { name: ${JSON.stringify(path.dirname(req.resolve('@storybook/react-vite/package.json')))}, options: {} },
  stories: ['../packages/**/*.stories.tsx'],
  features: { experimentalDocgenServer: true },
  core: { disableTelemetry: true, disableWhatsNewNotifications: true },
  viteFinal(config) {
    return { ...config, plugins: [...config.plugins, {
      name: 'local-docgen-probe',
      configureServer(server) {
        server.middlewares.use('/__docgen-probe', async (request, response) => {
          try {
            const service = getService('core/docgen', { internal: true });
            const params = new URL(request.url, 'http://127.0.0.1').searchParams;
            const id = params.get('id') || 'project-00-src-component000';
            const data = params.get('extract') === 'true'
              ? await service.commands.extractDocgen({ id })
              : service.queries.docgen.get({ id });
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify({ data }));
          } catch (error) { response.statusCode = 500; response.end(JSON.stringify({ error: error.stack })); }
        });
      }
    }] };
  }
};
`;
fs.writeFileSync(path.join(fixture, '.storybook/main.js'), config, { flag: 'wx' });
console.log(path.join(fixture, '.storybook/main.js'));
