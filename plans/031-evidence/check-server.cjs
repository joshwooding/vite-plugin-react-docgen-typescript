const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const repo = path.resolve(__dirname, '../..');
const raw = path.join(repo, '.yarn/simplification-evidence/031');
const result = { startedAt: new Date().toISOString(), flag: 'experimentalDocgenServer: true', url: 'http://127.0.0.1:6031' };
const json = async url => { const response = await fetch(result.url + url); const value = await response.json(); if (!response.ok) throw new Error(JSON.stringify(value)); return value; };
(async () => {
  const { writeSharedRevision } = await import(pathToFileURL(path.join(raw, 'backend-library.mjs')));
  const index = await json('/index.json');
  const entries = Object.values(index.entries);
  const first = entries[0];
  const id = first.id.split('--')[0];
  // Load the real Vite modules so the server has observed this story/component.
  for (const file of [first.importPath, first.componentPath]) {
    const response = await fetch(result.url + '/' + file.replace(/^\.\//, ''));
    if (!response.ok) throw new Error(`Module load failed: ${file}, ${response.status}`);
    await response.text();
  }
  result.before = await json(`/__docgen-probe?extract=true&id=${id}`);
  const shared = path.join(raw, 'fixture/shared/shared-types.ts');
  writeSharedRevision(shared, 2);
  result.sharedSourceAfterEdit = fs.readFileSync(shared, 'utf8');
  await new Promise(resolve => setTimeout(resolve, 2000));
  result.cachedAfterTwoSeconds = await json(`/__docgen-probe?id=${id}`);
  result.forcedAfterTwoSeconds = await json(`/__docgen-probe?extract=true&id=${id}`);
  await new Promise(resolve => setTimeout(resolve, 3000));
  result.forcedAfterFiveSeconds = await json(`/__docgen-probe?extract=true&id=${id}`);
  result.toneDescriptions = Object.fromEntries(['before', 'cachedAfterTwoSeconds', 'forcedAfterTwoSeconds', 'forcedAfterFiveSeconds'].map(key => [key, result[key].data?.reactComponentMeta?.props?.tone?.description]));
  result.status = result.toneDescriptions.forcedAfterFiveSeconds === 'Shared tone revision 002.' ? 'fresh' : 'stale';
  result.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(__dirname, 'server-freshness.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: result.status, toneDescriptions: result.toneDescriptions }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
