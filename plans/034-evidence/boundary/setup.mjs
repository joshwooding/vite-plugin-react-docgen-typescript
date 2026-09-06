import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const [directoryArgument, family, attempt = "offline"] = process.argv.slice(2);
const directory = path.resolve(directoryArgument);
const allowed = process.platform === "win32"
  ? path.join(repo, ".yarn/simplification-evidence/034/boundary")
  : "/var/tmp/vite-rdt-plan034-boundary";
const relative = path.relative(allowed, directory);
if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Setup directory is outside owned boundary workspace");
if (!["lower", "upper"].includes(family) || !["offline", "online"].includes(attempt)) throw new Error("Invalid setup arguments");
const versions = family === "lower" ? { node: "20.19.5", vite: "3.2.11", typescript: "4.3.5" } : { node: "24.10.0", vite: "8.1.5", typescript: "6.0.3" };
if (process.versions.node !== versions.node) throw new Error("Unexpected Node version");
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const artifact = path.join(repo, ".yarn/simplification-evidence/033/candidate.tgz");
const archiveSha256 = sha(artifact);
if (archiveSha256 !== "a7aa4620b18c2eebfffbeab4cb623d94f91b4f0371b684b37eacd52ee901dfbe") throw new Error("Wrong packed artifact");
mkdirSync(directory, { recursive: true });
const packageFile = path.join(directory, "package.json");
if (!existsSync(packageFile)) writeFileSync(packageFile, JSON.stringify({ private: true, type: "module", name: "plan034-boundary-" + family, version: "0.0.0" }, null, 2) + "\n");
const npmCli = process.platform === "win32"
  ? path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js")
  : path.resolve(path.dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js");
const arguments_ = [npmCli, "install", "--ignore-scripts", "--no-audit", "--no-fund", "--save-exact", ...(attempt === "offline" ? ["--offline"] : ["--prefer-offline"]), artifact, "vite@" + versions.vite, "typescript@" + versions.typescript, "react-docgen-typescript@2.2.2", "glob@13.0.6"];
const command = [process.execPath, ...arguments_];
const startedAt = new Date().toISOString();
const result = spawnSync(process.execPath, arguments_, { cwd: directory, encoding: "utf8", windowsHide: true, timeout: 180000, maxBuffer: 4000000, env: { ...process.env, PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH } });
const report = { startedAt, completedAt: new Date().toISOString(), directory, versions, command, archiveSha256, scriptSha256: sha(fileURLToPath(import.meta.url)), exitCode: result.status, error: result.error?.message ?? null, stdout: result.stdout, stderr: result.stderr };
const output = path.join(repo, "plans/034-evidence/boundary", `${process.platform}-${family}-setup-${attempt}.json`);
if (existsSync(output)) throw new Error("Refusing to overwrite setup evidence: " + output);
writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ output, exitCode: result.status, error: report.error }));
process.exitCode = result.status === 0 ? 0 : 1;
