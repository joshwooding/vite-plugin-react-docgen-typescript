"""Recompute Plan035 statistics from retained raw samples, without Node helpers."""
import hashlib
import json
import math
from pathlib import Path
from statistics import median
import sys

directory = Path(sys.argv[1]).resolve()


def read(name):
    return json.loads((directory / name).read_text(encoding="utf-8"))


def sha(name):
    return hashlib.sha256((directory / name).read_bytes()).hexdigest()


def check_number(actual, expected):
    assert math.isfinite(actual) and math.isfinite(expected)
    assert math.isclose(actual, expected, rel_tol=1e-12, abs_tol=1e-8), (actual, expected)


capture = read("capture.json")
summary = read("summary.json")
frozen = read("frozen-identity.json")
controls = read("controls-results.json")
assert capture["status"] == "COMPLETE" and capture["stage"] == "final"
assert capture["failures"] == [] and capture["before"] == capture["after"]
assert sha("controls-results.json") == capture["correctnessControlsSha256"]
assert sha("frozen-identity.json") == capture["frozenIdentitySha256"]
groups = [(scenario, mode) for scenario in ["large-project", "react-typing"] for mode in ["default", "projectService"]]
states = ["off", "populate", "restart"]
expected_order = []
for round_number in range(1, 11):
    for scenario, mode in groups:
        if round_number > 5 and f"{scenario}/{mode}" not in capture["extendedGroups"]:
            continue
        offset = (round_number - 1) % 3
        for cache in states[offset:] + states[:offset]:
            expected_order.append((scenario, mode, cache, round_number))
assert len(capture["samples"]) == len(expected_order)
data = {}
previous_finish = None
for index, (sample, expected) in enumerate(zip(capture["samples"], expected_order), 1):
    assert tuple(sample[k] for k in ["scenario", "mode", "cache", "round"]) == expected
    assert sample["status"] == "PASS" and sample["exitCode"] == 0
    assert sample["invocation"] == index and sample["invocationId"] == f"035-{index:03}"
    assert sample["startedAt"] <= sample["finishedAt"]
    if previous_finish is not None:
        assert previous_finish <= sample["startedAt"]
    previous_finish = sample["finishedAt"]
    assert sha(sample["report"]) == sample["reportSha256"]
    report = read(sample["report"])
    assert report["processId"] == sample["childPid"]
    assert sample["startedAt"] <= report["createdAt"] <= sample["finishedAt"]
    assert report["schemaVersion"] == 2 and report["benchmarkKind"] == "direct-plugin"
    assert report["identity"] == summary["evaluatedIdentity"]
    assert report["identity"] == frozen["harnessIdentity"]
    assert report["modes"] == [sample["mode"]] and report["iterations"] == 1
    assert report["cache"] == sample["cache"] and report["scenario"]["name"] == sample["scenario"]
    assert len(report["results"]) == len(report["results"][0]["runs"]) == 1
    run = report["results"][0]["runs"][0]
    assert run["processFirstMeasuredInstance"] and run["componentHmr"]["status"] == "updated"
    control = next(group for group in controls["groups"] if (group["scenario"], group["mode"]) == expected[:2])
    assert report["scenario"]["sourceSha256"] == control["sourceSha256"]
    assert run["fileCount"] == report["scenario"]["fileCount"] == len(control["files"])
    assert run["componentHmr"]["affectedModuleCount"] == len(control["states"][0]["observation"]["transformed"])
    assert run["componentHmr"]["invalidatedModuleCount"] == len(control["states"][0]["observation"]["invalidated"])
    control_state = next(state for state in control["states"] if state["cache"] == sample["cache"])
    for field in ["initialEntryCount", "finalEntryCount"]:
        assert run["cacheLifecycle"][field] == control_state[field]
    if sample["cache"] == "restart":
        assert run["cacheLifecycle"]["seedProcessId"] != report["processId"]
    data.setdefault(expected[:3], []).append(run)

rows = {}
initial_noisy, final_noisy, zero_groups = set(), set(), set()
for key, runs in data.items():
    recorded = next(row for row in summary["rows"] if (row["scenario"], row["mode"], row["cache"]) == key)
    expected_count = 10 if "/".join(key[:2]) in capture["extendedGroups"] else 5
    assert len(runs) == recorded["count"] == expected_count
    metrics = {}
    for name, field in [("cold", "coldBatchMs"), ("warm", "warmBatchMs"), ("hmr", None), ("session", "sessionTotalMs")]:
        values = [run[field] if field else run["componentHmr"]["totalCycleMs"] for run in runs]
        assert all(math.isfinite(value) and value >= 0 for value in values)
        center = median(values)
        mad = median(abs(value - center) for value in values)
        check_number(recorded[name]["median"], center)
        check_number(recorded[name]["mad"], mad)
        metrics[name] = center
        if name != "warm":
            first_center = median(values[:5])
            first_mad = median(abs(value - first_center) for value in values[:5])
            if first_mad > first_center * 0.2:
                initial_noisy.add("/".join(key[:2]))
            if mad > center * 0.2:
                final_noisy.add("/".join(key[:2]))
            if center == 0:
                zero_groups.add("/".join(key[:2]))
    rows[key] = metrics
assert sorted(capture["extendedGroups"]) == sorted(initial_noisy)
assert sorted(summary["initialNoisyGroups"]) == sorted(initial_noisy)
assert sorted(summary["noisyGroups"]) == sorted(final_noisy)
assert sorted(summary["zeroDenominatorGroups"]) == sorted(zero_groups)
comparisons = []
for group in groups:
    off, populate, restart = (rows[(*group, state)] for state in states)
    recorded = next(row for row in summary["comparisons"] if (row["scenario"], row["mode"]) == group)
    saving = off["cold"] - restart["cold"]
    saving_percent = 100 * saving / off["cold"] if off["cold"] else "INCONCLUSIVE_ZERO_DENOMINATOR"
    benefit = isinstance(saving_percent, (int, float)) and saving >= 100 and saving_percent >= 20
    check_number(recorded["coldSavingMs"], saving)
    if isinstance(saving_percent, str):
        assert recorded["coldSavingPercent"] == saving_percent
    else:
        check_number(recorded["coldSavingPercent"], saving_percent)
    assert recorded["benefitThreshold"] == benefit
    hmr = []
    for state, values in [("populate", populate), ("restart", restart)]:
        delta = values["hmr"] - off["hmr"]
        percent = 100 * delta / off["hmr"] if off["hmr"] else "INCONCLUSIVE_ZERO_DENOMINATOR"
        material = isinstance(percent, (int, float)) and delta > 10 and percent > 10
        saved = next(row for row in recorded["hmr"] if row["cache"] == state)
        check_number(saved["deltaMs"], delta)
        if isinstance(percent, str):
            assert saved["deltaPercent"] == percent
        else:
            check_number(saved["deltaPercent"], percent)
        assert saved["materialRegression"] == material
        hmr.append({"cache": state, "deltaMs": delta, "deltaPercent": percent, "materialRegression": material})
    overhead, session_saving = populate["session"] - off["session"], off["session"] - restart["session"]
    break_even = math.ceil(max(0, overhead) / session_saving) if session_saving > 0 else "NO_DEMONSTRATED_BREAK_EVEN"
    check_number(recorded["populationSessionOverheadMs"], overhead)
    check_number(recorded["restartSessionSavingMs"], session_saving)
    assert recorded["projectedReuseSessionsToBreakEven"] == break_even
    assert recorded["eligibleWithinGroup"] == (benefit and not any(row["materialRegression"] for row in hmr))
    comparisons.append({"scenario": group[0], "mode": group[1], "coldSavingMs": saving, "coldSavingPercent": saving_percent, "benefitThreshold": benefit, "hmr": hmr, "populationSessionOverheadMs": overhead, "restartSessionSavingMs": session_saving, "projectedReuseSessionsToBreakEven": break_even})
verdict = "INCONCLUSIVE" if final_noisy or zero_groups else "KEEP" if any(row["benefitThreshold"] for row in comparisons) and not any(hmr["materialRegression"] for row in comparisons for hmr in row["hmr"]) else "SIMPLIFY_OR_DEPRECATE"
assert summary["verdict"] == verdict
print(json.dumps({"status": "PASS", "method": "Independent Python statistics from every raw sample; no Node summarizer import.", "samples": len(capture["samples"]), "rows": len(rows), "extendedGroups": sorted(initial_noisy), "noisyGroups": sorted(final_noisy), "verdict": verdict, "comparisons": comparisons}, indent=2))
