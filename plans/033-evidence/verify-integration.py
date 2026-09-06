"""Verify main source/build against the measured artifact without rerunning timings."""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

repo = Path(__file__).resolve().parents[2]
evidence = repo / 'plans/033-evidence'
read = lambda p: json.loads(p.read_text(encoding='utf-8'))
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
artifact = read(evidence / 'compatibility/artifact.json')
for item in artifact['sourceFreeze']:
    assert sha(repo / item['path']) == item['sha256']
dist = repo / 'packages/vite-plugin-react-docgen-typescript/dist'
actual = {p.relative_to(dist).as_posix(): sha(p) for p in sorted(dist.rglob('*')) if p.is_file()}
assert actual == artifact['distFiles'], 'Main build differs from measured artifact'
checks = read(evidence / 'integration-checks.json')
assert all(code == 0 for code in checks['exitCodes'].values())
tests = (evidence / 'integration-tests.txt').read_text(encoding='utf-8-sig')
assert '4 passed (4)' in tests and '1 passed (1)' in tests
record = {'verifiedAt': datetime.now(timezone.utc).isoformat(), 'status':'PASS', 'sourceFiles':artifact['sourceFreeze'], 'distFiles':actual, 'candidateArchiveSha256':artifact['archiveSha256'], 'checks':checks, 'scope':'Main source hashes and all five rebuilt distribution files equal the reviewed and measured candidate; focused alias/lifecycle/error cases pass in main.'}
(evidence / 'integration-verification.json').write_text(json.dumps(record, indent=2)+'\n', encoding='utf-8', newline='\n')
print(json.dumps({'sourceFiles':len(artifact['sourceFreeze']), 'distributionFiles':len(actual), 'status':'PASS'}))
