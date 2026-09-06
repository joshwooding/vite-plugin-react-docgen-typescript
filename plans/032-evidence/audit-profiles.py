from pathlib import Path
from collections import defaultdict
import datetime, hashlib, json, math

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / "plans/032-evidence"
def read(path):
    return json.loads(path.read_text(encoding="utf-8"))
def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()
def same_float(actual, expected):
    assert math.isclose(actual, expected, rel_tol=1e-10, abs_tol=1e-8), (actual, expected)
summary = read(EVIDENCE / "profile-summary.json")
assert len(summary["rows"]) == 4
before = read(EVIDENCE / "preflight-before.json")
after = read(EVIDENCE / "preflight-after.json")
assert before["identity"] == after["identity"]
assert before["sourceFilesVerified"] == after["sourceFilesVerified"] == 5
assert before["distFilesVerified"] == after["distFilesVerified"] == 5
assert before["inheritedHarnessFilesVerified"] == after["inheritedHarnessFilesVerified"] == 8
artifact_dist = before["identity"]["artifact"]["root"].replace(chr(92), "/") + "/dist"
def owner(frame):
    url = frame.get("url", "").replace(chr(92), "/")
    name = frame.get("functionName", "")
    if "/typescript/lib/" in url: return "TypeScript compiler"
    if "/react-docgen-typescript/" in url: return "react-docgen-typescript extraction"
    if url.endswith(artifact_dist + "/index.mjs") or artifact_dist + "/chunks/" in url: return "Plugin"
    if url.startswith("node:fs") or "internal/fs" in url: return "Node filesystem"
    if "/plans/032-evidence/" in url or "/plans/029-evidence/" in url: return "Profile driver"
    if name == "(garbage collector)": return "V8 garbage collection"
    if url.startswith("node:") or url.startswith("internal/"): return "Other Node runtime"
    if "/node_modules/" in url: return "Other dependency"
    if not url and "realpath" in name.lower(): return "Native filesystem: realpath"
    if not url and "existssync" in name.lower(): return "Native filesystem: existsSync"
    return "V8 / unattributed"
verified = []
reports = []
for mode in ["default", "projectService"]:
    report = read(EVIDENCE / "profiles" / f"salt-{mode}-post029-candidate.json")
    reports.append(report)
    assert report["identity"] == before["identity"]
    assert report["compilerModulesBeforeCold"] == [] and report["cache"] is False
    assert [c["stage"] for c in report["metadataChecks"]] == ["baseline", "baseline", "component", "shared"]
    for check in report["metadataChecks"]:
        oracle = read(ROOT / "plans/029-evidence/oracles" / f"salt-{mode}-{check['stage']}.json")
        assert check["sha256"] == oracle["summary"]["sha256"]
        assert (check["fileCount"], check["metadataFileCount"], check["componentCount"]) == (215, 201, 221)
    targets = list(report["metadataChecks"][0]["files"])
    for kind in ["componentHmr", "sharedHmr"]:
        assert report[kind]["affectedTargetCount"] == 215
        assert sorted(report[kind]["files"]) == sorted(targets)
    for phase in ["cold", "shared"]:
        row = next(r for r in summary["rows"] if r["mode"] == mode and r["phase"] == phase)
        record = report["profiles"][phase]
        raw_path = Path(record["path"])
        assert raw_path.resolve().is_relative_to((EVIDENCE / "raw/profiles").resolve())
        assert sha(raw_path) == record["sha256"] == row["profile"]["sha256"]
        profile = read(raw_path)
        assert len(profile["samples"]) == len(profile["timeDeltas"]) == record["samples"]
        negative_deltas = [delta for delta in profile["timeDeltas"] if delta < 0]
        nodes = {n["id"]: n for n in profile["nodes"]}
        parents = {child: n["id"] for n in profile["nodes"] for child in n.get("children", [])}
        weighted = defaultdict(int)
        nonnegative_weighted = defaultdict(int)
        chains = defaultdict(int)
        total = sum(profile["timeDeltas"])
        for node_id, weight in zip(profile["samples"], profile["timeDeltas"]):
            frame = nodes[node_id]["callFrame"]
            group = owner(frame)
            weighted[group] += weight
            nonnegative_weighted[group] += max(weight, 0)
            native = "realpath" if group == "Native filesystem: realpath" else "existsSync" if group == "Native filesystem: existsSync" else None
            if native:
                chain = []
                current = node_id
                while current is not None:
                    ancestor = nodes[current]["callFrame"]
                    if owner(ancestor) in ["Plugin", "react-docgen-typescript extraction"]:
                        chain.append(ancestor.get("functionName") or "(anonymous)")
                    current = parents.get(current)
                chains[(native, tuple(chain[:8]))] += weight
        same_float(row["totalWeightedSampleMs"], total / 1000)
        assert row["sampleCount"] == len(profile["samples"])
        same_float(row["phaseProfileDurationMs"], (profile["endTime"]-profile["startTime"]) / 1000)
        assert len(weighted) == len(row["ownership"])
        for group in row["ownership"]:
            same_float(group["weightedSelfMs"], weighted[group["owner"]] / 1000)
            same_float(group["percent"], weighted[group["owner"]] * 100 / total)
        nonnegative_total = sum(nonnegative_weighted.values())
        maximum_owner_shift = max(abs(weighted[name]*100/total - nonnegative_weighted[name]*100/nonnegative_total) for name in weighted)
        assert sorted(weighted, key=weighted.get, reverse=True)[:2] == sorted(nonnegative_weighted, key=nonnegative_weighted.get, reverse=True)[:2]
        derived_chains = defaultdict(float)
        for group in row["nativeFilesystemByCaller"]:
            key = (group["nativeKind"].removeprefix("native "), tuple(f["functionName"] for f in group["responsibleCallChain"]))
            derived_chains[key] += group["weightedNativeSelfMs"]
        assert set(derived_chains) == set(chains)
        for key, weight in chains.items(): same_float(derived_chains[key], weight/1000)
        backend_realpath = sum(weight for (native, chain), weight in chains.items() if native == "realpath" and chain[:4] == ("resolvePhysicalPath", "normalizeBoundaryPath", "normalizeBoundaryPaths", "analyze"))
        watch_exists = sum(weight for (native, chain), weight in chains.items() if native == "existsSync" and chain[:1] == ("watchFiles",))
        verified.append({"mode": mode, "phase": phase, "samples": len(profile["samples"]), "weightedSampleMs": total/1000, "backendAnalysisRealpathPercent": 100*backend_realpath/total, "watchFilesNativeExistsPercent": 100*watch_exists/total, "rawSha256": record["sha256"], "negativeDeltaSensitivity": {"count": len(negative_deltas), "sumMs": sum(negative_deltas)/1000, "absolutePercent": -sum(negative_deltas)*100/total, "zeroClampedMaximumOwnershipShiftPercentagePoints": maximum_owner_shift, "topTwoOwnersUnchanged": True}, "profileEndGapMs": (profile["endTime"]-profile["startTime"]-total)/1000})
assert reports[0]["finishIso"] < reports[1]["startIso"], "Profile processes overlap"
for name, expected in read(EVIDENCE / "harness-freeze.json").items(): assert sha(EVIDENCE/name) == expected
result = {"verifiedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(), "profileCount": 4, "processCount": 2, "metadataChecks": 8, "restoredWorkloadIdentity": True, "exactCurrentArtifact": True, "nonOverlappingProcesses": True, "summaryRecomputedIndependently": True, "summarySha256": sha(EVIDENCE/"profile-summary.json"), "auditScriptSha256": sha(Path(__file__)), "negativeDeltaPolicy": "Primary summary retains every signed V8 timeDelta unchanged. Separately recomputed owner shares with negative values set to zero to quantify sensitivity; no profile or sample replaced.", "rows": verified}
output = EVIDENCE / "independent-audit.json"
assert not output.exists(), "Do not overwrite an audit"
output.write_text(json.dumps(result, indent=2)+"\n", encoding="utf-8", newline="\n")
print(json.dumps(result, indent=2))
