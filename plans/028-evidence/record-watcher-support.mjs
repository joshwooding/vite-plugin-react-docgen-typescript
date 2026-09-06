import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceRoot = process.argv[2];
assert(sourceRoot && path.isAbsolute(sourceRoot));
const versions = ["3.2.11", "4.5.14", "5.4.21", "6.1.0", "7.2.4", "8.1.5"];
const results = versions.map((version) => {
  const root = path.join(sourceRoot, `vite-${version}-linux/vite`);
  assert.equal(
    JSON.parse(readFileSync(path.join(root, "package.json"))).version,
    version,
  );
  const recordFile = (relative, select) => {
    const bytes = readFileSync(path.join(root, relative));
    const lines = bytes.toString("utf8").split(/\r?\n/);
    return {
      path: relative,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      excerpts: select(lines),
    };
  };
  const declarations = recordFile("dist/node/index.d.ts", (lines) =>
    lines.flatMap((text, index) =>
      /^(export declare )?type (AnymatchFn|AnymatchPattern|AnymatchMatcher|Matcher) =|^\s*ignored\?:|^\s*watch\?: WatchOptions/.test(
        text,
      )
        ? [{ line: index + 1, text }]
        : [],
    ),
  );
  const chunks = path.join(root, "dist/node/chunks");
  const source = readdirSync(chunks)
    .filter((name) => name.endsWith(".js"))
    .map((name) =>
      recordFile(`dist/node/chunks/${name}`, (lines) => {
        const start = lines.findIndex((line) =>
          line.startsWith("function resolveChokidarOptions("),
        );
        if (start < 0) return [];
        const close = lines.findIndex(
          (line, index) => index > start && line === "}",
        );
        assert(close > start);
        return [
          { line: start + 1, text: lines.slice(start, close + 1).join("\n") },
        ];
      }),
    )
    .filter((file) => file.excerpts.length);
  assert.equal(source.length, 1);
  assert(declarations.excerpts.some(({ text }) => text.includes("ignored?:")));
  assert(declarations.excerpts.some(({ text }) => text.includes("=> boolean")));
  return { version, declarations, source: source[0] };
});
writeFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "watcher-support.json",
  ),
  `${JSON.stringify({ sourceRoot, results }, null, 2)}\n`,
);
console.log(
  JSON.stringify({ versions: results.map(({ version }) => version) }),
);
