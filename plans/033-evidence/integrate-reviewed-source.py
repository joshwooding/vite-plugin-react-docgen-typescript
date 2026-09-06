"""Copy only the reviewed source after all Plan033 gates have passed."""
import hashlib
import json
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

repo = Path(__file__).resolve().parents[2]
evidence = repo / 'plans/033-evidence'
source = repo / '.yarn/.codex-worktrees/plan033/vite-plugin-react-docgen-typescript'
review_root = repo / '.yarn/.codex-worktrees/review033/vite-plugin-react-docgen-typescript'
read = lambda p: json.loads(p.read_text(encoding='utf-8'))
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
git = lambda *args: subprocess.check_output(['git', *args], cwd=repo)
freeze = read(evidence / 'source-freeze.json')
assert git('rev-parse', 'HEAD').decode().strip() == freeze['baseCommit']
assert not git('diff', '--name-only').strip()
assert not git('diff', '--cached', '--name-only').strip()
review = read(evidence / 'autoreview.json')
assert review['findings'] == [] and review['overall_correctness'] == 'patch is correct'
assert read(evidence / 'review-result.json')['exitCode'] == 0
comparison = read(evidence / 'comparison.json')
assert all(comparison['workloads']['salt'][mode]['usefulSaltBenefit'] for mode in ['default', 'projectService'])
assert not any(group['regressionFlags'] for groups in comparison['workloads'].values() for group in groups.values())
audit = read(evidence / 'independent-audit.json')
assert audit['status'] == 'PASS' and audit['samples'] == 24
assert sha(evidence / 'comparison.json') == audit['comparisonSha256']
assert read(evidence / 'restored-inputs.json')['status'] == 'PASS'
for item in freeze['files']:
    assert sha(source / item['path']) == item['sha256']
    assert sha(review_root / item['path']) == item['sha256']
    destination = repo / item['path']
    if destination.exists():
        tracked = subprocess.run(['git', 'ls-files', '--error-unmatch', '--', item['path']], cwd=repo, capture_output=True)
        assert tracked.returncode == 0, f'Preserve untracked destination: {destination}'
for item in freeze['files']:
    destination = repo / item['path']
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source / item['path'], destination)
    assert sha(destination) == item['sha256']
record = {'copiedAt': datetime.now(timezone.utc).isoformat(), 'baseCommit': freeze['baseCommit'], 'sourceFiles': freeze['files'], 'sourceReviewAndMeasurementGates': 'PASS', 'scope': 'Exactly three reviewed files copied to main. Existing plans and worktrees preserved. Main build, targeted checks and signed commit remain.'}
(evidence / 'integration-copy.json').write_text(json.dumps(record, indent=2)+'\n', encoding='utf-8', newline='\n')
print(json.dumps({'copiedFiles': len(freeze['files']), 'status': 'PASS'}))
