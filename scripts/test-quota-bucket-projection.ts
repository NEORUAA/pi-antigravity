import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createInterface } from "node:readline";
const root = process.cwd();
mkdirSync(resolve(".cache"), { recursive: true });
const temp = mkdtempSync(resolve(".cache/native-quota-"));
mkdirSync(temp, { recursive: true });
const home = join(temp, "home");
mkdirSync(home, { recursive: true });
const authPath = join(temp, "plugin-auth.json"),
  calls = join(temp, "calls.jsonl");
writeFileSync(
  authPath,
  JSON.stringify(
    Object.fromEntries(
      ["A", "B", "C"].map((t) => [
        t === "A" ? "antigravity" : "antigravity#" + t,
        {
          type: "oauth",
          access: "fixture-" + t,
          refresh: "fixture-" + t + "-refresh",
          expires: Date.now() + 3600000,
        },
      ]),
    ),
  ),
);
const syntheticEnv = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) => !k.startsWith("ANTIGRAVITY_") && !k.startsWith("NOAGY_"),
    ),
  ),
  ANTIGRAVITY_CLIENT_ID: "fixture-client.apps.googleusercontent.com",
  ANTIGRAVITY_CLIENT_SECRET: "fixture-public-client",
};
const bun = execFileSync("bun", ["-p", "process.execPath"], { encoding: "utf8" }).trim();
function start(layout) {
  const dir = mkdtempSync(join(temp, "case-")),
    home = join(dir, "home"),
    authPath = join(dir, "plugin-auth.json"),
    layoutPath = join(dir, "layout.json");
  mkdirSync(home);
  writeFileSync(
    authPath,
    JSON.stringify({
      antigravity: {
        type: "oauth",
        access: "fixture-A",
        refresh: "fixture-A-refresh",
        expires: Date.now() + 3600000,
      },
    }),
  );
  writeFileSync(layoutPath, JSON.stringify(layout));
  const child = spawn(
    bun,
    [
      "--preload",
      resolve("scripts/native-quota-preload.mjs"),
      resolve("scripts/fixtures/magpie-host/host.js"),
    ],
    {
      cwd: root,
      env: {
        ...syntheticEnv,
        NODE_OPTIONS: "",
        HOME: home,
        PI_CODING_AGENT_DIR: join(home, "pi"),
        ANTIGRAVITY_COMPAT_PROFILE: "codex",
        NOAGY_COMPAT_PROFILE: "codex",
        MAGPIE_FIXTURE_CALLS: calls,
        MAGPIE_FIXTURE_QUOTA_LAYOUT: layoutPath,
        MAGPIE_FIXTURE_RECOVER: join(temp, "recover-T"),
      },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const pending = new Map<
    number,
    { resolve: (x: any) => void; reject: (e: Error) => void; events: any[]; abortOnChunk?: boolean }
  >();
  let id = 0,
    err = "";
  child.stderr.on("data", (b) => {
    err += String(b);
  });
  createInterface({ input: child.stdout }).on("line", (line) => {
    const m = JSON.parse(line),
      p = pending.get(m.id);
    if (!p) return;
    if (m.event) {
      p.events.push(m);
      if (m.event === "chunk" && p.abortOnChunk) {
        child.stdin.write(JSON.stringify({ method: "abort", params: { id: m.id } }) + "\n");
        pending.delete(m.id);
        p.resolve({ events: p.events, aborted: true });
      }
      return;
    }
    if (m.error) {
      pending.delete(m.id);
      if (p.events.length) p.resolve({ events: p.events, error: m.error.message });
      else p.reject(new Error(m.error.message + "; host stderr: " + err));
    } else if ("result" in m) {
      pending.delete(m.id);
      p.resolve(p.events.length ? { events: p.events, result: m.result } : m.result);
    }
  });
  child.on("exit", (code) => {
    for (const p of pending.values()) p.reject(new Error("host exited " + code + ": " + err));
  });
  const call = (method: string, params: unknown, abortOnChunk = false) =>
    new Promise<any>((res, rej) => {
      const n = ++id;
      const timer = setTimeout(() => {
        pending.delete(n);
        rej(new Error("host RPC timeout: " + method + " " + err));
      }, 20000);
      pending.set(n, {
        events: [],
        abortOnChunk,
        resolve: (x) => {
          clearTimeout(timer);
          res(x);
        },
        reject: (e) => {
          clearTimeout(timer);
          rej(e);
        },
      });
      child.stdin.write(JSON.stringify({ id: n, method, params }) + "\n");
    });
  return {
    child,
    call,
    async init() {
      const r = await call("init", {
        authPath,
        directory: temp,
        piPath: resolve("scripts/fixtures/magpie-host/pi.js"),
        plugins: [{ spec: "fixture-installed-root", target: root }],
      });
      assert(!r.plugins[0].error, JSON.stringify(r));
    },
    async close() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill();
          resolve();
        }, 2000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
        child.stdin.end();
      });
    },
  };
}

import { createHash } from "node:crypto";
import { runInNewContext } from "node:vm";
const ui = readFileSync("scripts/fixtures/magpie-host/ui-quota.js", "utf8"),
  provenance = JSON.parse(readFileSync("scripts/fixtures/magpie-host/ui-provenance.json", "utf8"));
assert.equal(createHash("sha256").update(ui).digest("hex"), provenance.extractSHA256);
const el = (tag, cls = "", text = "") => ({
  tag,
  cls,
  text,
  children: [],
  style: {},
  classList: { add() {} },
  append(...v) {
    this.children.push(...v);
  },
});
const sandbox = {
  el,
  t: (text, vars = {}) => text.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? k),
  quotaLeft: true,
  quotaCount: () => "",
  capMark: () => {},
  intlLang: () => "en",
  resetText: () => "",
  resetInText: () => "",
  runsOutText: () => "",
  shortWindow: (x) => x,
  quotaError: (x) => x,
};
const render = runInNewContext(ui + "\n({accountQuota,familyWindows})", sandbox);
const visible = (node) =>
  [node?.text ?? "", ...(node?.children ?? []).flatMap(visible)].filter(Boolean);
const hostProvenance = JSON.parse(
  readFileSync("scripts/fixtures/magpie-host/provenance.json", "utf8"),
);
for (const [name, sha] of Object.entries(hostProvenance.gitBlobSHA)) {
  const bytes = readFileSync("scripts/fixtures/magpie-host/" + name);
  assert.equal(
    createHash("sha1")
      .update("blob " + bytes.length + "\0")
      .update(bytes)
      .digest("hex"),
    sha,
    "host fixtures must remain unmodified",
  );
}
const source = JSON.parse(readFileSync("scripts/fixtures/quota-host-oracle.json", "utf8"));
let comparisons = 0;
for (const fixture of source.cases) {
  const host = start(fixture.groups);
  try {
    await host.init();
    const result = await host.call("check", { provider: "antigravity" });
    const buckets = fixture.groups.flatMap((g) => g.buckets);
    const summaries = result.usage.windows.slice(0, buckets.length);
    const compact = render.familyWindows(result.usage.windows);
    assert.deepEqual([...result.models].sort(), Object.keys(fixture.expected).sort());
    for (const [id, mask] of Object.entries(fixture.expected)) {
      assert.deepEqual(
        summaries.map((w) => w.models.includes(id)),
        mask,
        fixture.name + ": original-Go bucket mask for " + id,
      );
      comparisons++;
    }
    for (let i = 0; i < summaries.length; i++) {
      const row = summaries[i];
      if (typeof buckets[i].remainingFraction !== "number")
        assert.equal(
          row.display,
          "Unknown",
          fixture.name + ": missing summary fraction is not fabricated",
        );
      const shown = compact.find((w) => w.pool === row.pool && w.window === row.name);
      assert(shown, fixture.name + ": summary window visible in actual UI");
      const members = [...new Set(shown.members.flatMap((m) => m.models))].sort();
      assert.deepEqual(
        members,
        [...row.models].sort(),
        fixture.name + ": actual UI pool membership, not merely window fields",
      );
      for (let j = 0; j < i; j++)
        if (
          JSON.stringify([...summaries[j].models].sort()) !== JSON.stringify([...row.models].sort())
        )
          assert.notEqual(
            summaries[j].pool,
            row.pool,
            fixture.name + ": unequal members cannot share pool",
          );
    }
    let index = 0;
    for (const group of fixture.groups) {
      const byMembers = new Map();
      for (const _ of group.buckets) {
        const row = summaries[index++],
          key = JSON.stringify([...row.models].sort());
        if (row.models.length) {
          if (byMembers.has(key))
            assert.equal(
              row.pool,
              byMembers.get(key),
              fixture.name + ": same-family windows within one group share a pool",
            );
          byMembers.set(key, row.pool);
        }
      }
    }
    const unknown = result.usage.windows.find((w) => w.family && w.models.includes("future-model"));
    assert(unknown);
    assert.equal(unknown.display, "Unknown");
    assert(
      compact.some((w) => w.members?.some((m) => m.models.includes("future-model"))),
      fixture.name + ": Unknown fallback survives UI",
    );
    const claudeCovered = fixture.expected["claude-sonnet-4-6"].some(Boolean);
    if (!claudeCovered) {
      const raw = result.usage.windows.find(
        (w) => w.family && w.models.includes("claude-sonnet-4-6"),
      );
      assert.equal(raw.display, "Unknown");
      assert(
        compact.some((w) => w.members?.some((m) => m.models.includes("claude-sonnet-4-6"))),
        fixture.name + ": absent-family Unknown stays visible",
      );
    }
    assert(!result.usage.error, fixture.name);
    console.log("PASS actual host/UI original-Go layout: " + fixture.name);
  } finally {
    await host.close();
  }
}
console.log(
  `PASS ${source.cases.length} actual-host/UI layouts, ${comparisons} original-Go per-model bucket masks`,
);
