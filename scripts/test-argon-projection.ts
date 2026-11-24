import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { createInterface } from "node:readline";
import { bucketFamily, modelQuotaFamily } from "../src/auth/quota-snapshot.js";
const coverage = JSON.parse(readFileSync("scripts/fixtures/argon-coverage-oracle.json", "utf8"));
for (const { input, expected } of coverage.vectors) {
  const snapshot = {
    groups: input.snapshot.quota_groups.map((g) => ({
      displayName: g.display_name,
      buckets: g.buckets.map((b) => ({ bucketId: b.bucket_id, window: b.window })),
    })),
  };
  const family = modelQuotaFamily(snapshot as any, input.model);
  assert.deepEqual(
    snapshot.groups
      .flatMap((g) => g.buckets)
      .map((b) => Boolean(family) && bucketFamily(b.bucketId) === family),
    expected,
    "original Go scope, including absent vs dedicated Argon and unknown families",
  );
}
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
  ANTIGRAVITY_EXPOSE_THOUGHTS: "1",
  ANTIGRAVITY_CLIENT_ID: "fixture-client.apps.googleusercontent.com",
  ANTIGRAVITY_CLIENT_SECRET: "fixture-public-client",
};
const bun = execFileSync("bun", ["-p", "process.execPath"], { encoding: "utf8" }).trim();
function start() {
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
        MAGPIE_FIXTURE_ARGON: join(temp, "merged"),
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
const oracle = JSON.parse(readFileSync("scripts/fixtures/native-oracle.json", "utf8"));
let host = start();
try {
  await host.init();
  const first = await host.call("check", { provider: "antigravity" });
  assert(first.usage.windows.some((w) => w.pool === "Gemini Argon Models" && w.span === 604800));
  assert(
    !first.usage.windows
      .find((w) => w.pool === "Gemini Models" && w.span === 18000)
      .models.some((id) => id.includes("argon")),
  );
  const before = visible(render.accountQuota({ a: first.usage }, "a")).join(" | ");
  assert(before.includes("Gemini Argon Models"));
  // A real summary refresh after a host restart must replace persisted old Argon pools.
  writeFileSync(join(temp, "merged"), "1");
  const refreshed = await host.call("check", { provider: "antigravity" });
  assert(
    !render.familyWindows(refreshed.usage.windows).some((w) => /argon/i.test(w.pool ?? "")),
    "same-process refresh replaces the old dedicated group",
  );
  const saved = JSON.parse(readFileSync(authPath, "utf8")).antigravity;
  assert(
    !saved.quota.groups.some((g) => g.buckets.some((b) => b.bucketId.includes("argon"))),
    "no stale dedicated group retained in the account snapshot",
  );
  await host.close();
  host = start();
  await host.init();
  for (const tag of ["A", "B", "C"]) {
    const result = await host.call("check", {
      provider: "antigravity",
      ...(tag === "A" ? {} : { account: "antigravity#" + tag }),
    });
    const compact = render.familyWindows(result.usage.windows);
    assert(
      !compact.some((w) => /argon/i.test(w.pool ?? "")),
      "covered Argon backing must not become a separate compact-card pool",
    );
    const gemini = result.usage.windows.find((w) => w.pool === "Gemini Models" && w.span === 18000);
    assert.deepEqual(gemini.models.filter((id) => id.startsWith("gemini-4-argon")), [
      "gemini-4-argon",
    ]);
    const argonRows = result.usage.windows.filter(
      (w) => w.models?.includes("gemini-4-argon") && w.family,
    );
    assert.equal(argonRows.length, 1, "Argon's tiers share one observed quota row");
    const [argon] = argonRows;
    assert.equal(argon.pool, "Gemini Models");
    assert(
      Math.abs(argon.used - 18.4) < 0.001,
      "actual per-model detail remains intact, not replaced by group percentage",
    );
    const future = result.usage.windows.find(
      (w) => w.models?.includes("future-model") && !w.family,
    );
    assert(future);
    assert.equal(future.name, "Reported quota");
    if (tag !== "A") {
      const claude = result.usage.windows.find(
        (w) => w.models?.includes("claude-sonnet-4-6") && !w.family,
      );
      assert(claude);
      if (tag === "C") assert.equal(claude.display, "Unknown");
      else assert.equal(Math.round(claude.used), 60);
    }
    const card = visible(render.accountQuota({ a: result.usage }, "a")).join(" | ");
    assert(!card.includes("Gemini 4 Argon (High)"));
  }
  const listed = await host.call("providers", {});
  const provider =
    listed.providers?.find((p) => p.id === "antigravity") ??
    listed.find?.((p) => p.id === "antigravity");
  assert(provider, JSON.stringify(listed));
  const levels = ["low", "medium", "high"];
  for (const [id, label] of [
    ["gemini-4-argon", "Gemini 4 Argon"],
    ["gemini-3.7-flash", "Gemini 3.7 Flash"],
  ]) {
    const models = provider.models.filter((model) => model.id.startsWith(id));
    assert.deepEqual(models.map((model) => model.id), [id]);
    assert.equal(models[0].name, label);
    assert.deepEqual([...models[0].variants].sort(), [...levels].sort());
  }
  const futureModel = provider.models.find((m) => m.id === "future-model");
  assert.equal(futureModel.name, "future-model");
  assert.deepEqual(futureModel.variants, [], "unknown models must not acquire fabricated tiers");
  async function checkWireRequest(
    model: string,
    {
      input,
      expected,
    }: { input: { request: object }; expected: { wire: string; request: object } },
    headers?: Record<string, string>,
  ) {
    const r = await host.call("fetch", {
      provider: "antigravity",
      model,
      npm: "@ai-sdk/google",
      url: `https://antigravity.invalid/v1beta/models/${model}:generateContent`,
      method: "POST",
      headers,
      body: Buffer.from(JSON.stringify(input.request)).toString("base64"),
    });
    assert.equal(r.events[0].status, 200, JSON.stringify(r));
    const trace = readFileSync(calls, "utf8")
      .trim()
      .split("\n")
      .map((x) => JSON.parse(x))
      .filter((x) => x.method === "generateContent")
      .at(-1).request;
    delete trace.request.sessionId;
    assert.equal(trace.model, expected.wire);
    assert.deepEqual(trace.request, expected.request);
  }

  let n = 0;
  for (const level of levels) {
    const model = "gemini-4-argon-" + level;
    const vectors = oracle.filter(
      (v) =>
        v.input.kind === "request" &&
        v.input.model === model &&
        v.input.request.contents &&
        (Object.keys(v.input.request).length === 1 ||
          v.input.request.generationConfig?.thinkingConfig ||
          v.input.request.generation_config?.thinking_config),
    );
    assert(vectors.length >= 3);
    for (const vector of vectors) {
      await checkWireRequest(model, vector);
      n++;
    }
    const thinking = vectors.find(({ input }) => Object.keys(input.request).length === 1);
    assert(thinking);
    await checkWireRequest("gemini-4-argon", thinking, { "X-Magpie-Effort": level });
    n++;
  }
  console.log(
    `PASS actual Magpie host/UI: dedicated→merged Argon quota refresh, account isolation, partial summary/Unknown, grouped models and native efforts; ${n} original-Go native request captures`,
  );
} finally {
  await host.close();
}
