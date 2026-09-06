"""Run only Plan034's eight cache-off native boundary rows, sequentially."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
from datetime import datetime, timezone

parser = argparse.ArgumentParser()
parser.add_argument("--run", default="initial")
parser.add_argument("--only", choices=["win32-lower", "win32-upper", "linux-lower", "linux-upper"])
args = parser.parse_args()
if not args.run.replace("-", "").isalnum():
    raise SystemExit("Invalid run label")
repo = Path(__file__).resolve().parents[3]
evidence = repo / "plans/034-evidence/boundary"
outputs = evidence / ("rows-" + args.run)
outputs.mkdir(exist_ok=True)
probe = evidence / "native-probe.mjs"
linux_repo = "/mnt/d/OSS/vite-plugin-react-docgen-typescript"
old_node = repo / ".yarn/.codex-worktrees/plan025/vite-plugin-react-docgen-typescript/.yarn/simplification-evidence/025/runtime-windows/node-v20.19.5-win-x64/node.exe"
rows = []
for platform in ["win32", "linux"]:
    for family, node_version in [("lower", "20.19.5"), ("upper", "24.10.0")]:
        key = platform + "-" + family
        if args.only and args.only != key:
            continue
        for mode in ["legacy", "project-service"]:
            label = key + "-" + mode
            output = outputs / (label + ".json")
            execution = outputs / (label + ".execution.json")
            if output.exists() or execution.exists():
                raise SystemExit("Refusing to overwrite " + label)
            if platform == "win32":
                node = str(old_node) if family == "lower" else "C:/nvm4w/nodejs/node.exe"
                command = [node, str(probe), "row", str(repo / (".yarn/simplification-evidence/034/boundary/windows-" + family)), mode, str(output)]
            else:
                command = ["wsl.exe", "-d", "Ubuntu", "--exec", f"/var/tmp/vite-rdt-plan025/node-v{node_version}-linux-x64/bin/node", linux_repo + "/plans/034-evidence/boundary/native-probe.mjs", "row", "/var/tmp/vite-rdt-plan034-boundary/linux-" + family, mode, linux_repo + "/plans/034-evidence/boundary/" + outputs.name + "/" + output.name]
            started = datetime.now(timezone.utc).isoformat()
            try:
                result = subprocess.run(command, cwd=repo, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=180)
                row = {"command": command, "exitCode": result.returncode, "stdout": result.stdout, "stderr": result.stderr, "error": None}
            except subprocess.TimeoutExpired as error:
                row = {"command": command, "exitCode": None, "stdout": str(error.stdout), "stderr": str(error.stderr), "error": "Process failed to complete and exit within 180 seconds"}
            row.update({"startedAt": started, "completedAt": datetime.now(timezone.utc).isoformat(), "probeSha256": hashlib.sha256(probe.read_bytes()).hexdigest(), "launcherSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "resultFile": str(output), "status": "PASS" if row["exitCode"] == 0 and output.exists() and json.loads(output.read_text(encoding="utf-8"))["status"] == "PASS" else "FAIL"})
            execution.write_text(json.dumps(row, indent=2) + "\n", encoding="utf-8")
            rows.append({"label": label, "status": row["status"], "result": str(output), "execution": str(execution)})
            print(json.dumps(rows[-1]), flush=True)
summary = outputs / ("summary-" + (args.only or "all") + ".json")
summary.write_text(json.dumps({"rows": rows, "status": "PASS" if all(row["status"] == "PASS" for row in rows) else "FAIL"}, indent=2) + "\n", encoding="utf-8")
raise SystemExit(0 if all(row["status"] == "PASS" for row in rows) else 1)
