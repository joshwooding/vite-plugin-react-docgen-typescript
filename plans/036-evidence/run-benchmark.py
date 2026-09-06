"""Run the unchanged PR87 harness against frozen trunk/performance artifacts."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,subprocess,sys
root=Path(__file__).resolve().parents[2]
e=root/'plans/036-evidence'
protocol=json.loads((e/'protocol.json').read_text(encoding='utf-8'))
environment=json.loads((e/'environment.json').read_text(encoding='utf-8'))
kind=sys.argv[1]
assert kind in ('smoke','measured')
settings=protocol['smoke'] if kind=='smoke' else protocol['measurement']
report=e/(kind+'.json');log=e/(kind+'.txt');manifest=e/(kind+'-invocation.json')
assert not any(p.exists() for p in (report,log,manifest)), 'Preserve completed or failed runs'
sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
def check_inputs():
    assert sha(protocol['harness']['path'])==protocol['harness']['sha256']
    assert sha(Path(protocol['harness']['path']).with_name('benchmark-memory-sampler.mjs'))==protocol['harness']['memorySamplerSha256']
    assert sha(protocol['node']['path'])==protocol['node']['sha256']
    for artifact in protocol['artifacts'].values():
        assert sha(artifact['archive'])==artifact['archiveSha256']
        package=Path(artifact['root'])/'packages/vite-plugin-react-docgen-typescript'
        for rel,expected in artifact['members'].items():
            if rel.startswith('package/dist/'):assert sha(package/rel.removeprefix('package/'))==expected
    for row in environment['variants'].values():
        for package in row['packages'].values():assert sha(package['packageFile'])==package['packageSha256']
        for path,expected in row['files'].items():assert sha(path)==expected
    return {'status':'PASS','at':datetime.now(timezone.utc).isoformat()}
args=[protocol['node']['path'],protocol['harness']['path'],'--plugin-entry',protocol['artifacts']['trunk']['entry'],'--label','trunk','--compare-plugin-entry',protocol['artifacts']['performance']['entry'],'--compare-label','performance','--components',str(settings['components']),'--projects',str(settings['projects']),'--iterations',str(settings.get('iterations',settings.get('iterationsPerLane'))),'--edits',str(settings.get('edits',settings.get('editsPerProcess'))),'--modes','default,projectService','--require-parity','--keep-temp','--output',str(report)]
record={'status':'RUNNING','kind':kind,'args':args,'cwd':protocol['artifacts']['performance']['root'],'before':check_inputs(),'protocolSha256':sha(e/'protocol.json'),'environmentSha256':sha(e/'environment.json')}
def save():manifest.write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8')
save()
with log.open('w',encoding='utf-8') as output:
    process=subprocess.Popen(args,cwd=record['cwd'],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,encoding='utf-8',creationflags=subprocess.CREATE_NO_WINDOW)
    record['parentPid']=process.pid;save()
    for line in process.stdout:
        output.write(line);output.flush();print(line,end='',flush=True)
    code=process.wait()
record['exitCode']=code;record['finishedAt']=datetime.now(timezone.utc).isoformat();record['logSha256']=sha(log)
record['status']='PASS' if code==0 else 'FAILED'
if report.exists():record['reportSha256']=sha(report)
record['after']=check_inputs();save()
assert code==0, f'{kind} benchmark failed; output retained'
