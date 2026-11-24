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
// Never let inherited personal OAuth configuration enter fixture stores.
for (const key of Object.keys(environment)) if (/^(ANTIGRAVITY|NOAGY)_(CLIENT_ID|CLIENT_SECRET|OAUTH_CLIENTS|OAUTH_CLIENT_KEY|ACCESS_TOKEN|REFRESH_TOKEN|API_KEY)$/.test(key)) delete environment[key];
environment.ANTIGRAVITY_CLIENT_ID="fixture-client.apps.googleusercontent.com";
environment.ANTIGRAVITY_CLIENT_SECRET="fixture-public-client";
// This runner never invokes live smoke/probe scripts, installation hooks, or audit network requests.
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
let commands = [
  ["typecheck", "node_modules/.bin/tsc", ["--noEmit"]],
  ["lint", "node_modules/.bin/eslint", ["src", "scripts/test-web-fetch.ts", "scripts/test-reader-foundations.ts", "scripts/smoke-fetch-policy.ts"]],
  ["security-check", process.execPath, ["scripts/run-ts.mjs", "scripts/security-check.ts"]],
  ...pkg.scripts["test:legacy"].split(" && ").filter((command) => !command.includes("test-codex-parity")).map((command) => [command.split(" ").at(-1), process.execPath, command.split(" ").slice(1)]),
];
const codexCommand = ["codex-default-contracts", process.execPath, ["scripts/run-ts.mjs", "scripts/test-codex-parity.ts"]];
const differential = ["codex-reference-differential", process.execPath, ["scripts/run-ts.mjs", "scripts/test-codex-differential.ts"]];
const application = ["codex-application-state-machines", process.execPath, ["scripts/run-ts.mjs", "scripts/test-codex-application.ts"]];
const sync = ["codex-one-shot-sync", process.execPath, ["scripts/run-ts.mjs", "scripts/test-codex-sync.ts"]];
const checkpoint = ["codex-durable-checkpoint", process.execPath, ["scripts/run-ts.mjs", "scripts/test-credential-checkpoint.ts"]];
const accountCatalog = ["account-model-go-differential", process.execPath, ["scripts/run-ts.mjs", "scripts/test-account-catalog.ts"]];
const magpie = ["magpie-real-host-contract", process.execPath, ["scripts/run-ts.mjs", "scripts/test-magpie-host.ts"]];
const nativeChecks=[
 ["native-independent-body-cancel","bun",["scripts/test-native-cancel.ts"],{NODE_OPTIONS:""}],
 ["native-original-go-differential",process.execPath,["scripts/run-ts.mjs","scripts/test-native-oracle.ts"]],
 ["native-canonical-health-generation",process.execPath,["scripts/run-ts.mjs","scripts/test-native-health-journal.ts"]],
 ["native-directory-durability",process.execPath,["scripts/run-ts.mjs","scripts/test-directory-sync.ts"]],
 ["native-real-quota-ui",process.execPath,["scripts/run-ts.mjs","scripts/test-native-quota-ui.ts"]],
 ...["validation","cooldown","delete"].map(kind=>["native-host-race-"+kind,process.execPath,["scripts/run-ts.mjs","scripts/test-native-race.ts","--scenario",kind]]),
];
const consumerChecks=[codexCommand,differential,application,sync,checkpoint,accountCatalog,magpie,...nativeChecks];
commands = process.argv.includes("--native-only")?nativeChecks:process.argv.includes("--codex-only")?consumerChecks:[...commands,...consumerChecks];
const results = [];
for (const [name, executable, args, overrides] of commands) {
  const result = spawnSync(executable, args, { cwd: root, env: {...environment,...overrides}, encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
  writeFileSync(resolve(root, `.cache/${name.replaceAll("/", "-")}.log`), `${result.stdout ?? ""}${result.stderr ?? ""}`);
  results.push({ name, status: result.status, error: result.error?.message });
  console.log(`${result.status === 0 ? "PASS" : "FAIL"} ${name}${result.error ? `: ${result.error.message}` : ""}`);
}
writeFileSync(resolve(root, ".cache/verification-results.json"), JSON.stringify(results, null, 2));
process.exitCode = results.every((result) => result.status === 0) ? 0 : 1;
