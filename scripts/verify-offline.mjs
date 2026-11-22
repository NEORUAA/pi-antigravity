import { spawnSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "..");
for (const path of [".cache/tmp", ".cache/home", ".cache/pi"]) mkdirSync(resolve(root, path), { recursive: true });
const environment = {
  ...process.env,
  HOME: resolve(root, ".cache/home"), USERPROFILE: resolve(root, ".cache/home"),
  TMPDIR: resolve(root, ".cache/tmp"), PI_CODING_AGENT_DIR: resolve(root, ".cache/pi"),
  NODE_OPTIONS: `--import=${resolve(root, "scripts/offline-guard.mjs")}`,
  ANTIGRAVITY_NO_PREWARM: "1", ANTIGRAVITY_COMPAT_PROFILE: "pi",
};
// This runner never invokes live smoke/probe scripts, installation hooks, or audit network requests.
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
let commands = [
  ["typecheck", "node_modules/.bin/tsc", ["--noEmit"]],
  ["lint", "node_modules/.bin/eslint", ["src", "scripts/test-web-fetch.ts", "scripts/test-reader-foundations.ts", "scripts/smoke-fetch-policy.ts"]],
  ["security-check", process.execPath, ["scripts/run-ts.mjs", "scripts/security-check.ts"]],
  ...pkg.scripts["test:legacy"].split(" && ").filter((command) => !command.includes("test-codex-parity")).map((command) => [command.split(" ").at(-1), process.execPath, command.split(" ").slice(1)]),
];
const codexCommand = ["codex-default-contracts", process.execPath, ["scripts/run-ts.mjs", "scripts/test-codex-parity.ts"]];
commands = process.argv.includes("--codex-only") ? [codexCommand] : [...commands, codexCommand];
const results = [];
for (const [name, executable, args] of commands) {
  const result = spawnSync(executable, args, { cwd: root, env: environment, encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
  writeFileSync(resolve(root, `.cache/${name.replaceAll("/", "-")}.log`), `${result.stdout ?? ""}${result.stderr ?? ""}`);
  results.push({ name, status: result.status, error: result.error?.message });
  console.log(`${result.status === 0 ? "PASS" : "FAIL"} ${name}${result.error ? `: ${result.error.message}` : ""}`);
}
writeFileSync(resolve(root, ".cache/verification-results.json"), JSON.stringify(results, null, 2));
process.exitCode = results.every((result) => result.status === 0) ? 0 : 1;
