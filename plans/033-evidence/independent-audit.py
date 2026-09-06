"""Independent Python audit of the completed fixed comparison and its evidence."""
import hashlib
import json
import statistics
from datetime import datetime, timezone
from pathlib import Path

repo = Path(__file__).resolve().parents[2]
evidence = repo / 'plans/033-evidence'
raw = repo / '.yarn/simplification-evidence/033'
read = lambda p: json.loads(p.read_text(encoding='utf-8'))
load = lambda name: read(evidence / name)
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
date = lambda value: datetime.fromisoformat(value.replace('Z', '+00:00'))
freeze = load('measurement-freeze.json')
assert not (evidence / 'independent-audit.json').exists(), 'Preserve successful audit'
for file, digest in freeze['hashes'].items():
    assert sha(evidence / file) == digest, file
artifact = freeze['artifact']
source = Path(artifact['sourceRoot'])
review = repo / '.yarn/.codex-worktrees/review033/vite-plugin-react-docgen-typescript'
for item in artifact['sourceFreeze']:
    assert sha(source / item['path']) == item['sha256']
    assert sha(review / item['path']) == item['sha256']
for variant in ['baseline', 'candidate']:
    manifest = load('artifact-inputs.json')[variant]
    assert sha(raw / f'{variant}.tgz') == manifest['archiveSha256']
    for file, digest in manifest['distFiles'].items():
        assert sha(raw / f'artifacts/{variant}/dist' / file) == digest

identities = load('identities.json')
comparison = load('comparison.json')
phases = {
    'cold': lambda s: s['metrics']['coldBatchMs'],
    'warm': lambda s: s['metrics']['warmBatchMs'],
    'component': lambda s: s['componentHmr']['totalCycleMs'],
    'shared': lambda s: s['sharedHmr']['totalCycleMs'],
    'close': lambda s: s['metrics']['closeMs'],
    'session': lambda s: s['metrics']['pluginSessionTotalMs'],
}
attempts = []
sample_count = 0
metadata_checks = 0
recomputed = {}
for workload in ['shallow', 'salt']:
    ledger = load(f'{workload}-attempts.json')
    assert ledger['finishedAt'] and len(ledger['attempts']) == 12
    assert ledger['budget'] == {'plannedProcesses': 12, 'rounds': 3, 'timeoutMsPerProcess': 1200000, 'noVarianceExtension': True}
    expected_rows = []
    for round_number in [1, 2, 3]:
        for mode in ['default', 'projectService']:
            baseline_first = round_number != 2 if mode == 'default' else round_number == 2
            for variant in (['baseline', 'candidate'] if baseline_first else ['candidate', 'baseline']):
                expected_rows.append({'workload': workload, 'mode': mode, 'variant': variant, 'label': f'r{round_number}'})
    assert ledger['rows'] == expected_rows
    for file, digest in ledger['hashes'].items():
        assert sha(evidence / file) == digest
    expected_harness = hashlib.sha256('\n'.join(f'{file}:{ledger["hashes"][file]}' for file in ['common.mjs', 'driver.mjs']).encode()).hexdigest()
    samples = []
    for attempt, row in zip(ledger['attempts'], expected_rows, strict=True):
        assert {key: attempt[key] for key in row} == row
        assert attempt['code'] == 0 and not attempt.get('timedOut', False) and attempt['restorationRequired'] == []
        assert sha(Path(attempt['log'])) == attempt['logSha256']
        sample = load('samples/' + '-'.join(row[key] for key in ['workload', 'mode', 'label', 'variant']) + '.json')
        assert {key: sample[key] for key in row} == row
        assert sample['identity'] == identities[workload][row['variant']]
        assert sample['harnessSha256'] == expected_harness
        assert sample['cache'] is False and sample['processFirstMeasuredInstance'] is True
        assert sample['compilerModulesBeforeCold'] == []
        assert date(attempt['startedAt']) <= date(sample['startIso']) <= date(sample['finishIso']) <= date(attempt['finishedAt'])
        for record, stage in zip(sample['metadataChecks'], ['baseline', 'baseline', 'component', 'shared'], strict=True):
            oracle = load(f'oracles/{workload}-{row["mode"]}-{stage}.json')
            assert record == {'stage': stage, **oracle['summary']}
            metadata_checks += 1
        for stage in ['component', 'shared']:
            expected_files = freeze['expectedSaltAffected'] if workload == 'salt' else freeze['expectedShallowAffected'][stage]
            hmr = sample[stage + 'Hmr']
            assert sorted(hmr['files']) == sorted(expected_files)
            assert len(hmr['files']) == len(set(hmr['files'])) == hmr['affectedTargetCount']
            assert hmr['metadataSha256'] == load(f'oracles/{workload}-{row["mode"]}-{stage}.json')['summary']['sha256']
        assert abs(sum(value(sample) for name, value in phases.items() if name != 'session') - phases['session'](sample)) < 1e-6
        samples.append(sample)
        attempts.append(attempt)
        sample_count += 1
    recomputed[workload] = {}
    for mode in ['default', 'projectService']:
        group = [s for s in samples if s['mode'] == mode]
        baseline = [s for s in group if s['variant'] == 'baseline']
        candidate = [s for s in group if s['variant'] == 'candidate']
        assert len(baseline) == len(candidate) == 3
        calculated = {}
        for phase, value in phases.items():
            a = [value(s) for s in baseline]
            b = [value(s) for s in candidate]
            ma, mb = statistics.median(a), statistics.median(b)
            mada = statistics.median(abs(x-ma) for x in a)
            madb = statistics.median(abs(x-mb) for x in b)
            deltas = [value(s)-value(next(c for c in candidate if c['label'] == s['label'])) for s in baseline]
            reduction = ma-mb
            percent = 100*reduction/ma
            inconclusive = 100*mada/ma > 20 or 100*madb/mb > 20 or (any(d>0 for d in deltas) and any(d<0 for d in deltas))
            regression = ((phase == 'warm' and -reduction > 10) or (phase in ['component', 'session'] and -reduction > 100 and -percent > 10)) if workload == 'salt' else (phase in ['cold', 'component', 'shared', 'session'] and -reduction > 20 and -percent > 10)
            useful = workload == 'salt' and phase in ['cold', 'shared'] and not inconclusive and reduction >= 100 and percent >= 10 and all(d > 0 for d in deltas)
            reported = comparison['workloads'][workload][mode]['phases'][phase]
            for variant, values, med, mad in [('baseline', a, ma, mada), ('candidate', b, mb, madb)]:
                assert reported[variant]['samples'] == values
                assert abs(reported[variant]['medianMs']-med) < 1e-6
                assert abs(reported[variant]['madMs']-mad) < 1e-6
            assert reported['pairedDeltasMs'] == deltas
            assert abs(reported['reductionMs']-reduction) < 1e-6
            assert abs(reported['reductionPercent']-percent) < 1e-6
            assert reported['inconclusive'] == inconclusive
            assert reported['regressionFlag'] == regression
            assert reported['usefulSaltPhase'] == useful
            calculated[phase] = {'baselineMedianMs':ma, 'candidateMedianMs':mb, 'reductionPercent':percent, 'inconclusive':inconclusive, 'regressionFlag':regression, 'usefulSaltPhase':useful}
        recomputed[workload][mode] = calculated
        reported_group = comparison['workloads'][workload][mode]
        flagged = [name for name, result in calculated.items() if result['regressionFlag']]
        assert reported_group['regressionFlags'] == flagged
        useful_group = workload == 'salt' and calculated['cold']['usefulSaltPhase'] and calculated['shared']['usefulSaltPhase'] and not flagged
        assert reported_group['usefulSaltBenefit'] == bool(useful_group)
for previous, current in zip(attempts, attempts[1:]):
    assert date(previous['finishedAt']) <= date(current['startedAt']), 'Overlapping process attempts'
assert sample_count == 24 and metadata_checks == 96
matrix = load('compatibility/summary.json')
assert matrix['status'] == 'PASS' and len(matrix['rows']) == 10
for i in range(1, 11):
    row = load(f'compatibility/rows/{i:02}.json')
    installed = load(f'compatibility/rows/{i:02}-installed.json')
    assert row['status'] == 'PASS' and row['archiveSha256'] == artifact['archiveSha256']
    assert installed['distFiles'] == artifact['distFiles']
    assert row['report']['result']['watcherHandles'] == 0
for filename, expected_count in [('restart-results.json', 26), ('watcher-results.json', 4)]:
    report = load('compatibility/' + filename)
    assert report['verdict'] == 'PASS' and len(report['rows']) == expected_count
    assert all(row['status'] == 'PASS' for row in report['rows'])
    assert report['identity']['buildSha256'] == artifact['distFiles']['index.mjs']
result = {'createdAt':datetime.now(timezone.utc).isoformat(), 'status':'PASS', 'samples':sample_count, 'fullMetadataChecks':metadata_checks, 'exactAffectedLists':48, 'nonoverlappingProcesses':True, 'retainedAllSuccessfulSamples':True, 'sourceHarnessArtifactHashes':'PASS', 'comparisonSha256':sha(evidence/'comparison.json'), 'scriptSha256':sha(Path(__file__)), 'recomputed':recomputed, 'scope':'Independent Python recomputation and semantic/affected-list/identity audit; consumer restoration is also rechecked separately with the actual identity helper after sampling.'}
(evidence / 'independent-audit.json').write_text(json.dumps(result, indent=2)+'\n', encoding='utf-8', newline='\n')
print(json.dumps({key:result[key] for key in ['status','samples','fullMetadataChecks','exactAffectedLists','comparisonSha256']}))
