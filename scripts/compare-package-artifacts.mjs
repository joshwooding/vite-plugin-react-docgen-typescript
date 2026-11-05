import { readdirSync, statSync } from "node:fs";
import path from "node:path";

const parseArguments = (arguments_) => {
  const parsed = new Map();
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (!argument.startsWith("--")) continue;
    const next = arguments_[index + 1];
    parsed.set(argument, next?.startsWith("--") ? true : (next ?? true));
    if (next && !next.startsWith("--")) index += 1;
  }
  return parsed;
};

const walk = (directory, root = directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    return entry.isDirectory()
      ? walk(absolutePath, root)
      : [
          {
            bytes: statSync(absolutePath).size,
            file: path.relative(root, absolutePath).replaceAll("\\", "/"),
          },
        ];
  });

export const summarizeInventory = (inventory) => {
  const sum = (predicate) =>
    inventory
      .filter(({ file }) => predicate(file))
      .reduce((total, item) => total + item.bytes, 0);
  return {
    declarations: sum(
      (file) => file.endsWith(".d.ts") || file.endsWith(".d.mts"),
    ),
    javascript: sum((file) => file.endsWith(".mjs")),
    sourceMaps: sum((file) => file.endsWith(".map")),
  };
};

export const compareArtifactSizes = (
  baseline,
  candidate,
  maximumGrowth,
  maximumGrowthBytes = {},
) => {
  const rows = Object.keys(baseline).map((category) => {
    const baselineBytes = baseline[category];
    const candidateBytes = candidate[category];
    const growthBytes = candidateBytes - baselineBytes;
    const growth =
      baselineBytes === 0
        ? candidateBytes === 0
          ? 0
          : Number.POSITIVE_INFINITY
        : ((candidateBytes - baselineBytes) / baselineBytes) * 100;
    return { baselineBytes, candidateBytes, category, growth, growthBytes };
  });
  return {
    failures: rows
      .filter(({ category, growth, growthBytes }) =>
        maximumGrowthBytes[category] === undefined
          ? growth > maximumGrowth
          : growthBytes > maximumGrowthBytes[category],
      )
      .map(({ category, growth, growthBytes }) =>
        maximumGrowthBytes[category] === undefined
          ? `${category}: ${growth.toFixed(2)}% growth exceeds ${maximumGrowth}%`
          : `${category}: ${growthBytes} byte growth exceeds ${maximumGrowthBytes[category]} bytes`,
      ),
    rows,
  };
};

const runSelfTest = () => {
  const summary = summarizeInventory([
    { bytes: 10, file: "index.mjs" },
    { bytes: 5, file: "index.d.ts" },
    { bytes: 3, file: "index.mjs.map" },
  ]);
  if (
    summary.javascript !== 10 ||
    summary.declarations !== 5 ||
    summary.sourceMaps !== 3
  ) {
    throw new Error("inventory self-test failed");
  }
  const comparison = compareArtifactSizes(
    { archive: 100, ...summary },
    { archive: 101, declarations: 5, javascript: 10, sourceMaps: 3 },
    2,
    { archive: 2 },
  );
  if (comparison.failures.length !== 0)
    throw new Error("comparison self-test failed");
  console.log("artifact comparator self-test passed");
};

const main = () => {
  const arguments_ = parseArguments(process.argv.slice(2));
  if (arguments_.has("--self-test")) return runSelfTest();
  const baselineDist = arguments_.get("--baseline-dist");
  const candidateDist = arguments_.get("--candidate-dist");
  const baselinePack = arguments_.get("--baseline-pack");
  const candidatePack = arguments_.get("--candidate-pack");
  const maximumGrowth = Number(arguments_.get("--max-growth"));
  const maximumArchiveGrowthBytes = Number(
    arguments_.get("--max-archive-growth-bytes"),
  );
  const maximumJavaScriptGrowthBytes = Number(
    arguments_.get("--max-javascript-growth-bytes"),
  );
  if (
    [baselineDist, candidateDist, baselinePack, candidatePack].some(
      (value) => typeof value !== "string",
    ) ||
    !Number.isFinite(maximumGrowth) ||
    !Number.isFinite(maximumArchiveGrowthBytes) ||
    !Number.isFinite(maximumJavaScriptGrowthBytes)
  ) {
    throw new Error(
      "Usage: --baseline-dist <path> --candidate-dist <path> --baseline-pack <file> --candidate-pack <file> --max-growth <percent> --max-javascript-growth-bytes <bytes> --max-archive-growth-bytes <bytes>",
    );
  }

  const baselineInventory = walk(baselineDist).sort((left, right) =>
    left.file.localeCompare(right.file),
  );
  const candidateInventory = walk(candidateDist).sort((left, right) =>
    left.file.localeCompare(right.file),
  );
  console.log("baseline inventory", JSON.stringify(baselineInventory));
  console.log("candidate inventory", JSON.stringify(candidateInventory));
  const comparison = compareArtifactSizes(
    {
      ...summarizeInventory(baselineInventory),
      archive: statSync(baselinePack).size,
    },
    {
      ...summarizeInventory(candidateInventory),
      archive: statSync(candidatePack).size,
    },
    maximumGrowth,
    {
      archive: maximumArchiveGrowthBytes,
      javascript: maximumJavaScriptGrowthBytes,
    },
  );
  for (const row of comparison.rows) {
    console.log(
      `${row.category}: ${row.baselineBytes} -> ${row.candidateBytes} (${row.growth.toFixed(2)}%, ${row.growthBytes} bytes)`,
    );
  }
  for (const failure of comparison.failures) console.error(failure);
  if (comparison.failures.length > 0) process.exitCode = 1;
};

main();
