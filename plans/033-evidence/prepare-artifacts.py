"""Freeze the executor handoff and adapt existing evidence runners; no sampling."""
import hashlib
import json
import shutil
import tarfile
from datetime import datetime, timezone
from pathlib import Path

repo = Path(__file__).resolve().parents[2]
evidence = repo / 'plans/033-evidence'
raw = repo / '.yarn/simplification-evidence/033'
worktree = repo / '.yarn/.codex-worktrees/plan033/vite-plugin-react-docgen-typescript'
executor = worktree / 'plans/033-evidence'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
read = lambda p: json.loads(p.read_text(encoding='utf-8'))
def write(p, value):
    if p.exists():
        assert read(p) == value, f'Preserve existing evidence: {p}'
        return
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8', newline='\n')

freeze = read(executor / 'source-freeze.json')
artifact = read(executor / 'artifact.json')
for item in freeze['files']:
    assert sha(worktree / item['path']) == item['sha256']
archive = Path(artifact['archive'])
assert sha(archive) == artifact['sha256']
candidate = raw / 'artifacts/candidate'
candidate.mkdir(parents=True, exist_ok=True)
with tarfile.open(archive) as bundle:
    for member in bundle.getmembers():
        if not member.isfile():
            continue
        relative = Path(member.name).relative_to('package')
        assert '..' not in relative.parts
        target = candidate / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        data = bundle.extractfile(member).read()
        if target.exists():
            assert target.read_bytes() == data
        else:
            target.write_bytes(data)
dist = {}
for item in artifact['distFiles']:
    assert sha(candidate / item['path']) == item['sha256']
    assert sha(worktree / 'packages/vite-plugin-react-docgen-typescript' / item['path']) == item['sha256']
    dist[item['path'].removeprefix('dist/')] = item['sha256']
if (raw / 'candidate.tgz').exists():
    assert sha(raw / 'candidate.tgz') == artifact['sha256']
else:
    shutil.copyfile(archive, raw / 'candidate.tgz')
if not (evidence / 'implementation').exists():
    shutil.copytree(executor, evidence / 'implementation')
for source in executor.iterdir():
    assert sha(source) == sha(evidence / 'implementation' / source.name)
if not (evidence / 'implementation-verification.md').exists():
    shutil.copyfile(worktree / 'plans/033-verification.md', evidence / 'implementation-verification.md')
assert sha(worktree / 'plans/033-verification.md') == sha(evidence / 'implementation-verification.md')
write(evidence / 'source-freeze.json', freeze)
old = read(repo / 'plans/029-evidence/compatibility/artifact.json')
manifest = {
    'createdAt': datetime.now(timezone.utc).isoformat(),
    'baseCommit': freeze['baseCommit'],
    'sourceRoot': str(worktree),
    'archive': str(raw / 'candidate.tgz'),
    'archiveSha256': artifact['sha256'],
    'verifierSha256': sha(repo / 'scripts/verify-runtime-compatibility.mjs'),
    'matrixSha256': sha(repo / '.github/runtime-compatibility-matrix.json'),
    'lockfileSha256': sha(repo / 'yarn.lock'),
    'sourceFreeze': freeze['files'],
    'distFiles': dist,
    'scope': 'Exact Plan033 packed artifact, verified independently against executor build and source freeze.'
}
assert manifest['verifierSha256'] == old['verifierSha256']
old_matrix = repo / '.yarn/.codex-worktrees/plan029/vite-plugin-react-docgen-typescript/.github/runtime-compatibility-matrix.json'
assert sha(old_matrix) == old['matrixSha256']
assert (repo / '.github/runtime-compatibility-matrix.json').read_bytes().replace(b'\r\n', b'\n') == old_matrix.read_bytes().replace(b'\r\n', b'\n')
assert read(repo / '.github/runtime-compatibility-matrix.json') == read(worktree / '.github/runtime-compatibility-matrix.json')
assert manifest['lockfileSha256'] == old['lockfileSha256']
write(evidence / 'compatibility/artifact.json', manifest)
write(evidence / 'artifact-inputs.json', {
    'baseline': {k: old[k] for k in ['archiveSha256', 'distFiles']},
    'candidate': {k: manifest[k] for k in ['archiveSha256', 'distFiles']},
})
setup = read(raw / 'setup-incomplete.json')
setup['note'] = 'Activated after exact candidate archive/source/dist verification; consumers, dependencies and options unchanged.'
write(raw / 'setup.json', setup)
for name in ['compat-run-row.mjs', 'compat-observe-install.mjs', 'compat-common.mjs', 'compat-verify-restart-cases.mjs', 'compat-verify-vite-watcher.mjs', 'compat-native-lower.mjs']:
    text = (repo / 'plans/029-evidence' / name).read_text(encoding='utf-8').replace('029', '033')
    if name == 'compat-common.mjs':
        text = text.replace('path.join(repo, "packages/vite-plugin-react-docgen-typescript/dist/index.mjs")', 'path.join(repo, ".yarn/simplification-evidence/033/artifacts/candidate/dist/index.mjs")')
        text = text.replace('const source = path.join(repo, "packages/vite-plugin-react-docgen-typescript/src");', 'const source = path.join(repo, ".yarn/.codex-worktrees/plan033/vite-plugin-react-docgen-typescript/packages/vite-plugin-react-docgen-typescript/src");')
    target = evidence / name
    assert not target.exists()
    target.write_text(text, encoding='utf-8', newline='\n')
(evidence / 'compatibility/native').mkdir(parents=True, exist_ok=True)
write(evidence / 'artifact-preparation.json', {'status': 'PASS', 'sourceFiles': len(freeze['files']), 'distFiles': len(dist), 'candidateArchiveSha256': sha(raw / 'candidate.tgz'), 'baselineArchiveSha256': sha(raw / 'baseline.tgz'), 'sourceRoot': str(worktree), 'adaptation': '029 runners change evidence destinations; compat-common imports packed candidate and records candidate source tree, using existing root dependencies.'})
print(json.dumps({'status': 'PASS', 'candidate': artifact['sha256'], 'distFiles': len(dist)}))
