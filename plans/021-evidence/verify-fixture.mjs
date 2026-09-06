import path from "node:path";
import { evidence, filesUnder, identity, json, modes, raw, repo, run, writeJson } from "./common.mjs";

const root = path.join(repo, "benchmarks/fixtures/react-typing");
const rows = [];
for (const mode of modes) {
  const manifest = path.join(raw, "fixture-" + mode + ".json");
  writeJson(manifest, { mode, workspace: {
    root, scenario: "react-typing",
    tsconfigPath: path.join(root, "tsconfig.json"),
    changedFile: path.join(root, "src/components/Button.tsx"),
    files: filesUnder(path.join(root, "src")).filter((f) => f.endsWith(".tsx")),
  } });
  const result = await run(process.execPath, [path.join(repo, "scripts/benchmark-playground.mjs"), "--internal-validate", manifest], { cwd: repo, windowsHide: true, timeout: 120_000 });
  rows.push({ mode, status: "PASS", ...JSON.parse(result.stdout) });
  console.log(mode + ": real React fixture validation PASS");
}
writeJson(path.join(evidence, "fixture-results.json"), { identity: await identity(), rows });
