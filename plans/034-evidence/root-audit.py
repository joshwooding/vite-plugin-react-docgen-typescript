"""Read-only audit of final Plan034 source and retained native evidence."""
import hashlib
import json
from pathlib import Path
import subprocess

MAIN = Path(__file__).resolve().parents[2]
EVIDENCE = MAIN / "plans/034-evidence"
WORKTREE = MAIN / ".yarn/.codex-worktrees/plan034/vite-plugin-react-docgen-typescript"


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


freeze = read(WORKTREE / "plans/034-evidence/source-freeze.json")
assert len(freeze["files"]) == 2
for item in freeze["files"]:
    assert sha(WORKTREE / item["path"]) == item["sha256"]
runtime = read(EVIDENCE / "design-review.json")["runtimeFiles"]
assert len(runtime) == 15
checkout_line_endings = []
for item in runtime:
    assert sha(MAIN / item["path"]) == item["sha256"]
    committed = subprocess.run(["git", "show", f"{freeze['base']}:{item['path']}"], cwd=MAIN, capture_output=True, check=True).stdout
    candidate = (WORKTREE / item["path"]).read_bytes()
    assert candidate == committed
    original = (MAIN / item["path"]).read_bytes()
    assert original.replace(b"\r\n", b"\n") == candidate
    if original != candidate:
        checkout_line_endings.append({"path": item["path"], "mainSha256": sha(MAIN / item["path"]), "worktreeAndGitBlobSha256": sha(WORKTREE / item["path"]), "difference": "Existing main CRLF versus isolated LF checkout only; neither file edited."})
artifact = read(MAIN / "plans/033-evidence/compatibility/artifact.json")
assert sha(Path(artifact["archive"])) == artifact["archiveSha256"]
for name, expected in artifact["distFiles"].items():
    assert sha(WORKTREE / "packages/vite-plugin-react-docgen-typescript/dist" / name) == expected
diff = subprocess.run(
    ["git", "-c", "core.autocrlf=false", "diff", "--name-only", freeze["base"], "--", "README.md", "packages", ".changeset", "package.json", "yarn.lock"],
    cwd=WORKTREE, capture_output=True, check=True, encoding="utf-8",
).stdout.splitlines()
assert sorted(diff) == sorted(item["path"] for item in freeze["files"]), diff
boundary = EVIDENCE / "boundary"
summary = read(boundary / "rows-import-entry-corrected/summary-all.json")
assert summary["status"] == "PASS" and len(summary["rows"]) == 8
probe_hash = sha(boundary / "native-probe.mjs")
launcher_hash = sha(boundary / "run-boundaries.py")
verified_rows = []
for entry in summary["rows"]:
    row = read(Path(entry["result"]))
    execution = read(Path(entry["execution"]))
    assert row["status"] == entry["status"] == execution["status"] == "PASS"
    assert execution["exitCode"] == 0 and execution["error"] is None
    assert execution["probeSha256"] == row["scriptSha256"] == probe_hash
    assert execution["launcherSha256"] == launcher_hash
    assert row["archiveSha256"] == artifact["archiveSha256"]
    assert row["distFiles"] == artifact["distFiles"] and row["distUnchangedAfter"]
    assert row["transformsAtRegistration"] == 0
    assert row["configCalls"] == row["registrationCalls"] == 1
    assert row["initial"] == row["initialOracle"]["docs"]
    assert row["initialOracle"]["cache"] is False
    assert row["control"]["event"]["event"] == "change"
    if row["platform"] == "linux":
        assert row["fixture"].startswith("/var/tmp/vite-rdt-plan034-boundary/")
    checkpoints = row["checkpoints"]
    assert len(checkpoints) == 5
    previous = row["initial"]
    for point in checkpoints:
        assert point["status"] == "PASS"
        assert point["metadata"] == point["oracle"]["docs"]
        assert point["oracle"]["cache"] is False
        assert point["deliveredSet"] == point["expectedComponents"]
        assert any(event["event"] == point["expectedEvent"] and event["file"].replace("\\", "/") == point["file"].replace("\\", "/") for event in point["events"])
        assert not any(payload["type"] in ["error", "full-reload"] for payload in point["payloads"])
        affected = Path(point["expectedComponents"][0]).stem
        assert previous[affected] != point["metadata"][affected]
        for name in previous:
            if name != affected:
                assert previous[name] == point["metadata"][name]
        previous = point["metadata"]
    assert row["noise"][0]["events"] and row["noise"][0]["payloads"] == []
    assert row["noise"][1]["events"] == row["noise"][1]["payloads"] == []
    assert row["close"] == {"closed": True, "watchedDirectories": 0, "postCloseEvents": 0, "postClosePayloads": 0}
    verified_rows.append({"label": entry["label"], "checkpoints": len(checkpoints), "resultSha256": sha(Path(entry["result"]))})
constraints = read(WORKTREE / "plans/034-evidence/constraints-summary.json")
assert constraints["status"] == "PASS" and len(constraints["passedRows"]) == 8
for name, expected in constraints["evidence"].items():
    assert sha(WORKTREE / "plans/034-evidence" / name) == expected
log = (EVIDENCE / "root-focused-tests.txt").read_text(encoding="utf-8")
assert "29 passed (29)" in log and "2 passed (2)" in log
print(json.dumps({
    "status": "PASS", "base": freeze["base"], "candidateFiles": freeze["files"],
    "runtimeFilesUnchanged": len(runtime), "distFilesUnchanged": len(artifact["distFiles"]),
    "checkoutLineEndings": checkout_line_endings,
    "nativeRows": verified_rows, "nativeCheckpoints": 40,
    "currentEnvironmentConstraintCases": constraints["passedRows"],
    "finalFocusedTests": {"passed": 29, "files": 2, "exitCode": 0, "durationSeconds": 50.66, "logSha256": sha(EVIDENCE / "root-focused-tests.txt")},
    "review": "This command audits local proof only; see separate review-result.json for the external review outcome.",
    "automaticDiscovery": "Plan023 gap remains open without explicit configuration."
}, indent=2))
