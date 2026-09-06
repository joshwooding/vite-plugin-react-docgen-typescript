import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import ts from 'file:///D:/OSS/vite-plugin-react-docgen-typescript/node_modules/typescript/lib/typescript.js';
import { readChangesets } from 'file:///D:/OSS/vite-plugin-react-docgen-typescript/node_modules/@changesets/read/dist/index.mjs';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const evidence = path.join(repo, 'plans/026-stage-a-evidence');
const raw = path.join(repo, '.yarn/simplification-evidence/026-stage-a');
const base = JSON.parse(readFileSync(path.join(raw, 'baseline-package.json'), 'utf8'));
const candidate = JSON.parse(readFileSync(path.join(raw, 'candidate-package.json'), 'utf8'));
const relative = 'packages/vite-plugin-react-docgen-typescript/src/utils/options.ts';
const original = execFileSync('git', ['show', `f6cfcdb:${relative}`], { cwd: repo, encoding: 'utf8', windowsHide: true });
const current = readFileSync(path.join(repo, relative), 'utf8');
const tokens = text => {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text);
  const result = [];
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) result.push([kind, scanner.getTokenText()]);
  return result;
};
assert.deepEqual(tokens(current), tokens(original), 'Source changes only comments/whitespace');
const outputs = [];
for (const name of ['package/dist/index.d.ts', 'package/dist/index.d.mts']) {
  assert.deepEqual(tokens(candidate[name]), tokens(base[name]), 'All public type tokens unchanged');
  const source = ts.createSourceFile(name, candidate[name], ts.ScriptTarget.Latest, true);
  let interfaceNode, optionNode;
  function visit(node) {
    if (ts.isInterfaceDeclaration(node) && node.name.text === 'FileSystemCacheOptions') interfaceNode = node;
    if (ts.isPropertySignature(node) && node.name.getText(source) === 'fileSystemCache') optionNode = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(interfaceNode && optionNode);
  for (const node of [interfaceNode, optionNode]) {
    const notice = ts.getJSDocTags(node).filter(tag => tag.tagName.text === 'deprecated');
    assert.equal(notice.length, 1);
    assert.equal(notice[0].comment, 'Remove `fileSystemCache` from configuration, or set it to `false`.');
  }
  assert.equal(ts.getJSDocTags(optionNode).find(tag => tag.tagName.text === 'default')?.comment, 'false');
  assert.equal(optionNode.type.getText(source), 'boolean | FileSystemCacheOptions');
  assert.ok(optionNode.questionToken);
  const enabled = interfaceNode.members.find(node => node.name?.getText(source) === 'enabled');
  assert.equal(ts.getJSDocTags(enabled).find(tag => tag.tagName.text === 'default')?.comment, 'true');
  outputs.push({ name, publicShapeUnchanged: true, interfaceDeprecated: true, optionDeprecated: true, defaultFalse: true, objectEnabledDefaultTrue: true });
}
const changesets = await readChangesets(repo);
const notice = changesets.filter(row => row.id === 'deprecate-filesystem-cache');
assert.equal(notice.length, 1);
assert.deepEqual(notice[0].releases, [{ name: '@joshwooding/vite-plugin-react-docgen-typescript', type: 'patch' }]);
const scope = JSON.parse(readFileSync(path.join(evidence, 'scope.json'), 'utf8'));
const hashes = Object.fromEntries(scope.sourceScope.map(file => [file, createHash('sha256').update(readFileSync(path.join(repo, file))).digest('hex')]));
const result = { status: 'PASS', typescript: ts.version, sourceExecutableAndTypeTokensUnchanged: true, declarations: outputs, changeset: notice[0], finalFileSha256: hashes, initialOptionsHashChangedOnlyForLfFormatting: hashes[relative] !== scope.fileSha256[relative] };
writeFileSync(path.join(evidence, 'declaration-and-release-verification.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
