import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dist = path.join(repo, 'packages/vite-plugin-react-docgen-typescript/dist/index.mjs');
const require = createRequire(dist);
const { default: createPlugin } = await import(pathToFileURL(dist).href);
const { createServer, normalizePath, resolveConfig } = await import(pathToFileURL(require.resolve('vite')).href);
const output = path.join(repo, 'plans/034-evidence/constraints-results.json');
const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const waitFor = async (predicate, timeout = 5000) => {
  const deadline = Date.now() + timeout;
  do { if (await predicate()) return true; await delay(25); } while (Date.now() < deadline);
  return false;
};
const names = ['Component', 'Second', 'Other'];
const metadata = result => {
  const code = typeof result === 'string' ? result : result?.code ?? '';
  const match = code.match(/__docgenInfo\s*=\s*(\{[^\r\n]*\})/);
  if (!match) return null;
  const doc = JSON.parse(match[1]);
  return { displayName: doc.displayName, description: doc.description, props: Object.fromEntries(Object.entries(doc.props).sort(([a],[b]) => a.localeCompare(b)).map(([name, prop]) => [name, { name:prop.name, description:prop.description, required:prop.required, type:prop.type, defaultValue:prop.defaultValue }])) };
};
const declaration = (type, description) => `export interface Props {\n/** ${description} */\nlabel: ${type};\n/** @default 7 */\namount?: number;\n}\n`;
const fixture = () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'vite-rdt034-constraints-'));
  const root = path.join(directory, 'app');
  const chosen = path.join(directory, 'shared-types');
  const sibling = path.join(directory, 'unrelated/deep');
  mkdirSync(path.join(root, 'src'), { recursive:true });
  mkdirSync(path.join(chosen, 'owned/deep'), { recursive:true });
  mkdirSync(sibling, { recursive:true });
  const control = path.join(root, 'src/control.js');
  writeFileSync(control, 'export const control=1; if (import.meta.hot) import.meta.hot.accept();\n');
  writeFileSync(path.join(chosen, 'owned/deep/noise.txt'), 'owned\n');
  writeFileSync(path.join(sibling, 'noise.txt'), 'unrelated\n');
  writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({compilerOptions:{jsx:'preserve',module:'ESNext',moduleResolution:'Bundler',strict:true,types:[]},include:['src/**/*']}));
  for (const [index,name] of names.entries()) writeFileSync(path.join(root,'src',name+'.tsx'), index < 2 ? `import type { Props } from '../../shared-types/${index===0?'types':'other'}';\nexport const ${name}=(_props:Props)=>null;\nif(import.meta.hot) import.meta.hot.accept();\n` : 'export const Other=(_props:{unaffected:boolean})=>null;\nif(import.meta.hot) import.meta.hot.accept();\n');
  return {directory,root,chosen,sibling,control,files:[path.join(chosen,'types.d.ts'),path.join(chosen,'other.ts')]};
};
const remove = f => {
  const relative = path.relative(path.resolve(tmpdir()),path.resolve(f.directory));
  assert(!path.isAbsolute(relative) && !relative.startsWith('..') && relative.startsWith('vite-rdt034-constraints-'), 'unsafe cleanup');
  rmSync(f.directory,{recursive:true,force:true});
};
const watcherResources = () => process.getActiveResourcesInfo().filter(name => /FS.*Wrap|FSEvent/i.test(name)).sort();
const recipe = (directory, observation) => ({
  name:'watch-external-types',apply:'serve',
  config() { observation.configCalls++; if (!statSync(directory).isDirectory()) throw new Error('externalTypesDirectory must be an existing directory'); },
  configureServer(server) { observation.configureCalls++; server.watcher.add(normalizePath(directory)); },
});
const start = async (f, watch={}, cache=false, directory=f.chosen) => {
  const docs={};const events=[];const payloads=[];const observation={configCalls:0,configureCalls:0};
  const plugin=createPlugin({docgenMode:'legacy',tsconfigPath:path.join(f.root,'tsconfig.json'),include:['src/**/*.tsx'],exclude:[],fileSystemCache:cache?{directory:path.join(f.root,'.cache')}:false});
  const transform=plugin.transform;
  plugin.transform=async function(...args) { const result=await transform.apply(this,args);const name=path.basename(args[1].split('?')[0],'.tsx');if(names.includes(name))docs[name]=metadata(result);return result; };
  const server=await createServer({root:f.root,configFile:false,appType:'custom',logLevel:'silent',optimizeDeps:{noDiscovery:true},plugins:[plugin,recipe(directory,observation)],server:{middlewareMode:true,watch}});
  server.watcher.on('all',(event,file)=>events.push({event,file:normalizePath(file)}));
  const hot=server.environments.client.hot;const send=hot.send;
  hot.send=function(...args) {if(typeof args[0]==='object')payloads.push(structuredClone(args[0]));return Reflect.apply(send,this,args);};
  return {server,docs,events,payloads,observation};
};
const load = async state => {for(const name of names)await state.server.transformRequest(`/src/${name}.tsx`);};
const census = (state,f) => Object.fromEntries(Object.entries(state.server.watcher.getWatched()).filter(([directory])=>normalizePath(directory).startsWith(normalizePath(f.directory))).map(([directory,entries])=>[normalizePath(path.relative(f.directory,directory))||'.',[...entries].sort()]));
const control = async (state,f) => {
  await state.server.transformRequest('/src/control.js');
  assert(await waitFor(()=>Object.entries(state.server.watcher.getWatched()).some(([directory,entries])=>normalizePath(directory)===normalizePath(path.dirname(f.control))&&entries.includes(path.basename(f.control)))),'control unregistered');
  await delay(150);state.events.length=0;state.payloads.length=0;
  writeFileSync(f.control,'export const control=2; if (import.meta.hot) import.meta.hot.accept();\n');
  assert(await waitFor(()=>state.events.some(({event,file})=>event==='change'&&file===normalizePath(f.control))),'native in-root control missing');
  await delay(200);state.events.length=0;state.payloads.length=0;
};
const close = async (state,f,row) => {
  await state.server.close();row.watchedAfterClose=state.server.watcher.getWatched();assert.deepEqual(row.watchedAfterClose,{});
  const count=state.events.length;writeFileSync(f.control,'export const control=3;\n');await delay(150);row.postCloseEvents=state.events.length-count;assert.equal(row.postCloseEvents,0);
};
const rows=[];
for(const kind of ['ignored','disabled','scope','depth','near-consecutive','offline-delete']) {
  const f=fixture();const row={kind,mode:'legacy'};let state;
  try {
    const watch=kind==='disabled'?null:kind==='ignored'?{ignored:[normalizePath(f.chosen)+'/**']}:kind==='depth'?{depth:0}:{};
    if(kind==='offline-delete') {
      for(const file of f.files)writeFileSync(file,declaration('string','Before offline deletion.'));
      state=await start(f,{},true);await load(state);row.seed=structuredClone(state.docs);
      assert.equal(row.seed.Component.props.label.type.name,'string');assert.equal(row.seed.Second.props.label.type.name,'string');
      await close(state,f,{});state=undefined;
      for(const file of f.files)rmSync(file);
    }
    state=await start(f,watch,kind==='offline-delete');await load(state);
    row.initial=structuredClone(state.docs);assert.deepEqual(row.initial.Component.props,{});assert.deepEqual(row.initial.Second.props,{});
    assert.equal(state.observation.configCalls,1);assert.equal(state.observation.configureCalls,1);
    if(kind!=='disabled') {await control(state,f);row.nativeControl=true;} else {row.nativeControl='not applicable: watcher intentionally disabled';assert.equal(state.server.config.server.watch,null);assert.deepEqual(state.server.watcher.getWatched(),{});}
    row.effectiveWatchSettings=state.server.config.server.watch;
    if(kind==='depth')assert.equal(state.server.config.server.watch.depth,0);
    if(kind==='ignored')assert.deepEqual(state.server.config.server.watch.ignored,watch.ignored);
    await delay(200);row.watched=census(state,f);
    assert(!Object.keys(row.watched).some(directory=>directory==='unrelated'||directory.startsWith('unrelated/')),'unrelated sibling descendants were watched');
    if(kind==='scope') {
      assert(Object.hasOwn(row.watched,'shared-types/owned/deep'),'chosen descendants not watched');
      const chosenNoise=path.join(f.chosen,'owned/deep/noise.txt');const siblingNoise=path.join(f.sibling,'noise.txt');
      writeFileSync(chosenNoise,'owned edited\n');writeFileSync(siblingNoise,'unrelated edited\n');
      assert(await waitFor(()=>state.events.some(event=>event.event==='change'&&event.file===normalizePath(chosenNoise))),'chosen noise control missing');
      await delay(350);assert(!state.events.some(event=>event.file===normalizePath(siblingNoise)),'unrelated sibling event received');assert.deepEqual(state.payloads.filter(payload=>['update','full-reload','error'].includes(payload.type)),[]);
      row.noise={events:structuredClone(state.events),payloads:structuredClone(state.payloads)};
    } else if(kind==='depth') {
      assert(!Object.hasOwn(row.watched,'shared-types/owned/deep'),'depth setting bypassed');
      const noise=path.join(f.chosen,'owned/deep/noise.txt');writeFileSync(noise,'depth excluded\n');await delay(350);assert(!state.events.some(event=>event.file===normalizePath(noise)));row.excludedDepthEvents=state.events;
    } else if(kind==='ignored'||kind==='disabled') {
      for(const file of f.files)writeFileSync(file,declaration('number','Blocked by consumer watcher settings.'));
      await delay(350);await load(state);assert.deepEqual(state.docs,row.initial);assert(!state.events.some(event=>f.files.map(normalizePath).includes(event.file)));assert.deepEqual(state.payloads.filter(payload=>['update','full-reload','error'].includes(payload.type)),[]);
      row.expectedLimitation={events:state.events,payloads:state.payloads,metadata:structuredClone(state.docs)};
      const fresh=await start(f,null,false);try {await load(fresh);assert.equal(fresh.docs.Component.props.label.type.name,'number');assert.equal(fresh.docs.Second.props.label.type.name,'number');row.fresh=structuredClone(fresh.docs);}finally{await fresh.server.close();}
    } else {
      state.events.length=0;state.payloads.length=0;
      // Back-to-back writes deliberately exercise distinct unresolved names in one parent.
      for(const file of f.files)writeFileSync(file,declaration('number','Created together.'));
      assert(await waitFor(()=>f.files.every(file=>state.events.some(event=>event.event==='add'&&event.file===normalizePath(file)))),'both creation events missing');
      const fresh=await start(f,null,false);let expected;
      try{await load(fresh);expected=structuredClone(fresh.docs);}finally{await fresh.server.close();}
      assert.equal(expected.Component.props.label.type.name,'number');assert.equal(expected.Second.props.label.type.name,'number');
      assert(await waitFor(async()=>{await load(state);return JSON.stringify(state.docs)===JSON.stringify(expected);}), 'fresh metadata did not settle');
      await delay(200);assert.deepEqual(state.payloads.filter(payload=>['full-reload','error'].includes(payload.type)),[]);
      const delivered=state.payloads.flatMap(payload=>payload.type==='update'?payload.updates.map(update=>update.path):[]);
      assert.deepEqual([...new Set(delivered)].sort(),['/src/Component.tsx','/src/Second.tsx']);
      row.creation={events:structuredClone(state.events),payloads:structuredClone(state.payloads),delivered,metadata:structuredClone(state.docs),oracle:expected};
    }
    await close(state,f,row);state=undefined;row.status='PASS';
  } catch(error) {row.status='FAIL';row.error=String(error.stack??error);}
  finally {if(state)await close(state,f,row).catch(error=>{row.cleanupError=String(error);row.status='FAIL';});remove(f);rows.push(row);}
  console.log(kind+': '+row.status);
  if(row.status!=='PASS')break;
}
if(rows.every(row=>row.status==='PASS'))for(const kind of ['missing-directory','regular-file']) {
  const f=fixture();const row={kind};const directory=path.join(f.directory,kind);const observation={configCalls:0,configureCalls:0};
  if(kind==='regular-file')writeFileSync(directory,'not a directory\n');
  try {
    await delay(150);const resources=watcherResources();
    let failure;try {await createServer({root:f.root,configFile:false,logLevel:'silent',plugins:[recipe(directory,observation)],server:{middlewareMode:true}});}catch(error){failure=error;}
    assert(failure,'configuration unexpectedly succeeded');assert.equal(observation.configCalls,1);assert.equal(observation.configureCalls,0);
    if(kind==='missing-directory'){assert.equal(failure.code,'ENOENT');assert.equal(path.resolve(failure.path),path.resolve(directory));}else assert.equal(failure.message,'externalTypesDirectory must be an existing directory');
    await delay(150);assert.deepEqual(watcherResources(),resources,'watcher resources leaked after config rejection');
    row.error={message:failure.message,code:failure.code,path:failure.path};row.observation=observation;row.resourcesBefore=resources;row.resourcesAfter=watcherResources();
    const buildObservation={configCalls:0,configureCalls:0};await resolveConfig({root:f.root,configFile:false,logLevel:'silent',plugins:[recipe(directory,buildObservation)]},'build');assert.deepEqual(buildObservation,{configCalls:0,configureCalls:0});row.buildObservation=buildObservation;row.status='PASS';
  }catch(error){row.status='FAIL';row.failure=String(error.stack??error);}finally{remove(f);rows.push(row);}
  console.log(kind+': '+row.status);
  if(row.status!=='PASS')break;
}
const result={status:rows.length===8&&rows.every(row=>row.status==='PASS')?'PASS':'FAIL',node:process.version,versions:Object.fromEntries(['vite','typescript','react-docgen-typescript'].map(name=>[name,JSON.parse(readFileSync(require.resolve(name+'/package.json'),'utf8')).version])),scriptSha256:sha(fileURLToPath(import.meta.url)),distSha256:sha(dist),rows};
writeFileSync(output,JSON.stringify(result,null,2)+'\n');
assert.equal(result.status,'PASS');
