"""Audit every retained child and apply the protocol's process-level comparison."""
from datetime import datetime, timezone
from pathlib import Path
from statistics import median
import hashlib
import json
import math
import re
import shutil

E = Path(__file__).resolve().parent
read = lambda p: json.loads(Path(p).read_text(encoding="utf-8"))
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()
protocol = read(E / "protocol.json")
invocation = read(E / "measured-invocation.json")
assert invocation["status"] == "PASS" and invocation["exitCode"] == 0
assert invocation["before"]["status"] == invocation["after"]["status"] == "PASS"
for key, name in [("protocolSha256", "protocol.json"), ("environmentSha256", "environment.json"), ("reportSha256", "measured.json"), ("logSha256", "measured.txt")]:
    assert invocation[key] == sha(E / name), name
report = read(E / "measured.json")
assert report["iterations"] == 4 and report["edits"] == 10
assert report["fixture"]["componentCount"] == 188
assert report["fixture"]["projectCount"] == 7
assert report["counterbalanced"]
assert report["nodeVersion"] == protocol["node"]["version"]
assert report["platform"] == "win32"
lanes = ["trunk:default", "trunk:projectService", "performance:default", "performance:projectService"]
assert report["executionOrder"] == [lanes[i:] + lanes[:i] for i in range(4)]
log = (E / "measured.txt").read_text(encoding="utf-8")
workspace = Path(re.findall(r"Kept benchmark workspace at (.+)", log)[-1].strip())
assert len(list(workspace.glob("run-*.json"))) == 16
children = E / "measured-children"
assert not children.exists(), "Preserve an existing completed audit"
children.mkdir()
expected_names = [f"Component{i:03}" for i in range(188)]
reference = None
manifest = []
samples = {}
for result in report["results"]:
    lane = f'{result["targetLabel"]}:{result["mode"]}'
    assert lane in lanes and lane not in samples
    assert len(result["runs"]) == 4
    samples[lane] = []
    for iteration, run in enumerate(result["runs"]):
        assert run["iteration"] == iteration
        order = report["executionOrder"][iteration].index(lane)
        assert run["order"] == order
        child_path = workspace / f"run-{iteration}-{order}.json"
        child = read(child_path)
        assert {k: v for k, v in child.items() if k != "output"} == {k: v for k, v in run.items() if k not in ("iteration", "order")}
        assert child["targetLabel"] == result["targetLabel"]
        assert child["mode"] == result["mode"]
        assert child["metadata"]["typescriptVersion"] == "6.0.3"
        assert Path(child["metadata"]["pluginEntry"]) == Path(protocol["artifacts"][result["targetLabel"]]["entry"])
        output = child["output"]
        assert sorted(output) == expected_names
        digest = hashlib.sha256(json.dumps(output, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()
        assert digest == child["outputDigest"]
        for i, name in enumerate(expected_names):
            component = output[name]
            assert component["displayName"] == name
            assert component["description"] == f"Benchmark component {i}."
            props = component["props"]
            assert sorted(props) == ["density", "label", "tone", "variant"]
            assert props["label"] == {"defaultValue": None, "description": f"Visible label for {name}.", "required": True, "type": {"name": "string"}}
            for prop, description, values in [
                ("tone", "Shared tone revision 010.", ['"base"', '"revision-010"']),
                ("variant", "Local visual variant.", ['"outline"', '"solid"']),
                ("density", "Project-local density.", ['"comfortable"', '"compact"']),
            ]:
                assert props[prop] == {"defaultValue": None, "description": description, "required": False, "type": {"name": "enum", "values": values}}
        if reference is None:
            reference = output
        assert output == reference, lane
        assert len(child["editSamplesMs"]) == len(child["editMeasurements"]) == 10
        assert all(math.isfinite(n) and n > 0 for n in child["editSamplesMs"])
        cold = child["cold"]
        assert math.isclose(cold["totalMs"], cold["moduleLoadMs"] + cold["setupMs"] + cold["extractionMs"])
        for duration, measurement in zip(child["editSamplesMs"], child["editMeasurements"]):
            assert duration == measurement["integration"]["totalMs"]
        samples[lane].append({"iteration": iteration, "order": order, "coldMs": cold["totalMs"], "editMedianMs": median(child["editSamplesMs"]), "coldPeakRssBytes": child["memory"]["cold"]["peakRssBytes"], "editPeakRssBytes": child["memory"]["edits"]["peakRssBytes"]})
        destination = children / child_path.name
        shutil.copyfile(child_path, destination)
        manifest.append({"lane": lane, "iteration": iteration, "order": order, "originalPath": str(child_path), "retainedPath": str(destination.relative_to(E)), "sha256": sha(destination), "outputDigest": digest})
assert sorted(samples) == sorted(lanes)

def describe(values):
    center = median(values)
    mad = median(abs(value - center) for value in values)
    return {"samples": values, "median": center, "mad": mad, "madFraction": mad / center}

comparisons = []
for mode in ("default", "projectService"):
    for metric in ("coldMs", "editMedianMs"):
        trunk = describe([row[metric] for row in samples[f"trunk:{mode}"]])
        performance = describe([row[metric] for row in samples[f"performance:{mode}"]])
        pairs = [{"iteration": i, "trunkMs": left, "performanceMs": right, "deltaMs": right-left, "reductionPercent": (1-right/left)*100} for i, (left, right) in enumerate(zip(trunk["samples"], performance["samples"]))]
        consistent = all(pair["deltaMs"] < 0 for pair in pairs) and max(trunk["madFraction"], performance["madFraction"]) <= .2
        comparisons.append({"mode": mode, "metric": metric, "trunk": trunk, "performance": performance, "pairedRounds": pairs, "medianReductionPercent": (1-performance["median"]/trunk["median"])*100, "ratioOfMedians": trunk["median"]/performance["median"], "verdict": "CONSISTENT_IMPROVEMENT" if consistent else "INCONCLUSIVE"})

audit = {
    "status": "PASS", "createdAt": datetime.now(timezone.utc).isoformat(),
    "protocolSha256": sha(E / "protocol.json"), "reportSha256": sha(E / "measured.json"),
    "independentProcesses": 16, "processesPerLane": 4, "editsPerProcess": 10,
    "fullFinalMetadata": "All 188 components and all four normalized prop records match the expected final fixture and one another in every retained child.",
    "intermediateChecks": "The unchanged harness fails on missing/stale cold or edit revision descriptions and incomplete affected sets. Intermediate complete outputs are not retained; this is not an independent fresh oracle for every phase.",
    "statistics": "Arithmetic midpoint median for even N; unscaled MAD. Edits are reduced to one median per process before comparison. No discarded or added samples; smoke excluded.",
    "samples": samples, "comparisons": comparisons, "children": manifest,
}
(E / "measured-verification.json").write_text(json.dumps(audit, indent=2) + "\n", encoding="utf-8")
lines = ["| Mode | Metric | Trunk median ± MAD | Performance median ± MAD | Reduction | Paired rule |", "| --- | --- | ---: | ---: | ---: | --- |"]
for c in comparisons:
    a, b = c["trunk"], c["performance"]
    lines.append(f'| {c["mode"]} | {c["metric"]} | {a["median"]:.1f} ± {a["mad"]:.1f} ms | {b["median"]:.1f} ± {b["mad"]:.1f} ms | {c["medianReductionPercent"]:.1f}% | {c["verdict"]} |')
(E / "comparison-table.md").write_text("\n".join(lines)+"\n", encoding="utf-8")
print("PASS: all 16 child outputs and frozen input identities audited")
print("\n".join(lines))
