/** Offline source-referenced one-shot account Sync regressions. No real accounts. */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { fetchQuotaSnapshot, normalizeQuotaModels, quotaGate } from "../src/auth/quota-snapshot.js";
import { synchronizeAntigravityCredential, refreshAntigravityToken } from "../src/auth/oauth.js";
import { accountAvailable, rememberAccount, failoverToNextAccount, loadAccountStore, removeAccount, activateAccount } from "../src/auth/accounts.js";
import { SANDBOX, DAILY, PRODUCTION, CODEX_USER_AGENT } from "../src/compat/profile.js";
process.env.ANTIGRAVITY_COMPAT_PROFILE = "codex";
process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "codex-sync-"));
for (const key of ["PROJECT_ID", "USER_AGENT", "QUOTA_GATE_ENABLED"]) { delete process.env[`ANTIGRAVITY_${key}`]; delete process.env[`NOAGY_${key}`]; }
const savedFetch = globalThis.fetch, savedDispatcher = getGlobalDispatcher();
const mock = new MockAgent(); mock.disableNetConnect(); setGlobalDispatcher(mock);
const now = Date.parse("2026-11-22T09:00:00Z");
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
const groups = [{ displayName: "fixtures", buckets: [{ bucketId: "3p-weekly", window: "weekly", remainingFraction: 0, resetTime: "2026-11-23T09:00:00Z" }, { bucketId: "gemini-5h", window: "5h", remainingFraction: .5, resetTime: "2026-11-22T11:00:00Z" }] }];
const defaults = (url: string) => url.endsWith("fetchAvailableModels") ? json({ models: { "claude-fixture": { quotaInfo: { remainingFraction: 0 } } } }) : url.endsWith("retrieveUserQuotaSummary") ? json({ groups }) : json({ paidTier: { availableCredits: [{ creditAmount: "12.5" }] } });
let passed = 0;
const test = async (name: string, run: () => Promise<void> | void) => { await run(); passed++; console.log(`PASS ${name}`); };
function profile(token: string, email: string, status = 200) { mock.get("https://www.googleapis.com").intercept({ path: "/oauth2/v2/userinfo", method: "GET", headers: { authorization: `Bearer ${token}` } }).reply(status, { email, verified_email: true }); }
function refresh(token: string, rotated: string) { mock.get("https://oauth2.googleapis.com").intercept({ path: "/token", method: "POST" }).reply(200, { access_token: token, refresh_token: rotated, expires_in: 3600 }); }
try {
  await test("source catalog sandbox/daily/production and per-endpoint 403 without-project retry", async () => {
    const calls: Array<{url: string; body: unknown; headers: Headers}> = [];
    globalThis.fetch = (async (url, init) => { const address = String(url); calls.push({ url: address, body: JSON.parse(String(init?.body)), headers: new Headers(init?.headers) }); return address.endsWith("fetchAvailableModels") && calls.length < 6 ? json({},403) : defaults(address); }) as typeof fetch;
    const result = await fetchQuotaSnapshot("fixture", "project", { now: () => now });
    assert.deepEqual(calls.slice(0,6).map(c => c.url), [SANDBOX,SANDBOX,DAILY,DAILY,PRODUCTION,PRODUCTION].map(base => `${base}/v1internal:fetchAvailableModels`));
    assert.deepEqual(calls.slice(0,6).map(c => c.body), [{project:"project"},{},{project:"project"},{},{project:"project"},{}]);
    assert.ok(calls.every(c => c.headers.get("User-Agent") === CODEX_USER_AGENT));
    assert.deepEqual(calls.at(-1)?.body, { metadata: { ide_type: "ANTIGRAVITY", ide_version: "2.19.1", ide_name: "antigravity" } });
    assert.equal(result.aiCredits,12.5); assert.equal(result.groupsObserved,true);
  });
  await test("source final forbidden snapshot denies dispatch but optional summary/credits remain observations", async () => {
    let count = 0; globalThis.fetch = (async () => { count++; return json({},403); }) as typeof fetch;
    const result = await fetchQuotaSnapshot("fixture", "project", { now: () => now });
    assert.equal(count,10); assert.equal(result.forbidden,true); assert.equal(quotaGate(result,"gemini-fixture",now).blocked,true);
    assert.deepEqual(result.warnings,["quota_summary_unavailable","ai_credits_unavailable"]);
  });
  await test("source catalog terminal 401/other 4xx; retryable 429/5xx/transport moves endpoint", async () => {
    for (const code of [400,401,404]) {
      let count = 0; globalThis.fetch = (async () => { count++; return json({},code); }) as typeof fetch;
      await assert.rejects(fetchQuotaSnapshot("fixture","project"), new RegExp(String(code))); assert.equal(count,1);
    }
    for (const code of [0,429,500,503]) {
      const hosts: string[]=[];
      globalThis.fetch = (async url => { const address = String(url); hosts.push(new URL(address).origin); if (hosts.length === 1) { if (code===0) throw new Error("synthetic transport"); return json({},code); } return defaults(address); }) as typeof fetch;
      await fetchQuotaSnapshot("fixture","project"); assert.deepEqual(hosts.slice(0,2),[SANDBOX,DAILY]);
    }
  });
  await test("source quota normalization keeps absent distinct from zero; clamps models and records catalog/forwarding", () => {
    const q=normalizeQuotaModels({models:{"gemini-a":{quotaInfo:{remainingFraction:-.2}},"claude-a":{quotaInfo:{}},"gpt-a":{quotaInfo:{remainingFraction:2}},"other":{isInternal:true},"bad id":{},"image-a":{quotaInfo:{remainingFraction:0}}},deprecatedModelIds:{old:{newModelId:" new "}}},now);
    assert.deepEqual(q.models.map(m=>[m.modelId,m.fractionPresent,m.remainingFraction,m.remainingPercent]),[["claude-a",false,undefined,0],["gemini-a",true,0,0],["gpt-a",true,1,100],["image-a",true,0,0]]);
    assert.deepEqual(q.internalModelIds,["other"]); assert.ok(!q.catalogModelIds.includes("bad id")); assert.deepEqual(q.modelForwardingRules,{old:"new"});
  });
  await test("source empty/failed summary retains old zero timestamps; missing fraction replaces old zero as unknown", async () => {
    globalThis.fetch = (async url=>defaults(String(url))) as typeof fetch;
    const old=await fetchQuotaSnapshot("fixture","project",{now:()=>now});
    for (const result of [json({groups:[]}),json({},401)]) {
      globalThis.fetch=(async url=>String(url).endsWith("retrieveUserQuotaSummary") ? result : defaults(String(url))) as typeof fetch;
      const q=await fetchQuotaSnapshot("fixture","project",{now:()=>now+1000,previous:old});
      assert.deepEqual(q.groups,old.groups); assert.deepEqual(q.groupsMeta,old.groupsMeta);
    }
    globalThis.fetch=(async url=>String(url).endsWith("retrieveUserQuotaSummary") ? json({groups:[{buckets:[{bucketId:"3p-weekly",window:"week"}]}]}) : defaults(String(url))) as typeof fetch;
    const updated=await fetchQuotaSnapshot("fixture","project",{now:()=>now+2000,previous:old});
    assert.equal(updated.groups[0].buckets[0].fractionPresent,false); assert.equal(updated.groups[0].buckets[0].remainingFraction,undefined); assert.equal(updated.groupsMeta?.appliedSeq,2);
    assert.equal(quotaGate(updated,"claude-fixture",now+2000).blocked,false);
  });
  await test("source summary 403/404 fallback; 400 stops; credits missing means zero vs malformed unknown", async () => {
    for (const code of [400,403,404]) {
      let count=0;
      globalThis.fetch=(async url=>{const u=String(url); if (u.endsWith("retrieveUserQuotaSummary")) return ++count===1 ? json({},code) : json({groups}); return defaults(u);}) as typeof fetch;
      const q=await fetchQuotaSnapshot("fixture","project",{now:()=>now}); assert.equal(count,code===400?1:2); assert.equal(q.groupsObserved,code!==400);
    }
    for (const [raw,known,value] of [[{},true,0],[{creditAmount:"0"},true,0],[{creditAmount:"bad"},false,undefined],[{creditAmount:false},false,undefined]] as const) {
      globalThis.fetch=(async url=>String(url).endsWith("loadCodeAssist") ? json({paidTier:{availableCredits:[raw]}}) : defaults(String(url))) as typeof fetch;
      const q=await fetchQuotaSnapshot("fixture","project",{now:()=>now}); assert.equal(q.aiCreditsObserved,known); assert.equal(q.aiCredits,value);
    }
  });
  await test("source quota401 recovers once and rebuilds email/project/entitlements before snapshot retry", async () => {
    profile("old-access","old@example.invalid"); refresh("new-access","rotated-fixture"); profile("new-access","new@example.invalid");
    const seen:Array<[string,string,unknown]>=[];
    globalThis.fetch=(async (url,init)=>{const method=String(url).split(":").at(-1)!;const token=new Headers(init?.headers).get("authorization")!; seen.push([token,method,JSON.parse(String(init?.body))]);
      if (method==="loadCodeAssist" && !(JSON.parse(String(init?.body)).metadata?.ide_name)) return json({cloudaicompanionProject:token.includes("old")?"old-project":"new-project"});
      if (method==="fetchAvailableModels" && token.includes("old")) return json({},401);
      return defaults(String(url)); }) as typeof fetch;
    const q=await synchronizeAntigravityCredential({access:"old-access",refresh:"fixture-refresh-a",expires:Date.now()+3600_000,email:"old@example.invalid",projectId:"stale-project"});
    assert.equal(q.email,"new@example.invalid");assert.equal(q.projectId,"new-project");assert.equal(q.refresh,"rotated-fixture");assert.ok(q.quota?.groupsObserved);
    assert.deepEqual(seen.slice(0,4).map(c=>c.slice(0,2)),[["Bearer old-access","loadCodeAssist"],["Bearer old-access","fetchAvailableModels"],["Bearer new-access","loadCodeAssist"],["Bearer new-access","fetchAvailableModels"]]);
    assert.deepEqual(seen[3][2],{project:"new-project"});
  });
  await test("source profile401 recovers only once; second quota401 terminates without token-refresh loop", async () => {
    profile("p-old","",401);refresh("p-new","p-rotated");profile("p-new","profile@example.invalid");
    globalThis.fetch=(async url=>String(url).endsWith("loadCodeAssist") ? json({cloudaicompanionProject:"project"}) : defaults(String(url))) as typeof fetch;
    const q=await synchronizeAntigravityCredential({access:"p-old",refresh:"profile-fixture",expires:Date.now()+3600_000});assert.equal(q.email,"profile@example.invalid");
    profile("q-old","quota@example.invalid");refresh("q-new","q-rotated");profile("q-new","quota@example.invalid");
    let quotaCalls=0;
    globalThis.fetch=(async url=>String(url).endsWith("fetchAvailableModels") ? (quotaCalls++,json({},401)) : json({cloudaicompanionProject:"project"})) as typeof fetch;
    await assert.rejects(synchronizeAntigravityCredential({access:"q-old",refresh:"quota-fixture",expires:Date.now()+3600_000}),/401/);assert.equal(quotaCalls,2);
  });
  await test("full one-shot refresh is single-flight, snapshot persisted and family-gated failover", async () => {
    refresh("flight-access","flight-rotated");profile("flight-access","flight@example.invalid");
    let catalogs=0;
    globalThis.fetch=(async (url,init)=>{const u=String(url);if(u.endsWith("fetchAvailableModels"))catalogs++;if(u.endsWith("loadCodeAssist")&&!JSON.parse(String(init?.body)).metadata?.ide_name)return json({cloudaicompanionProject:"flight-project"});return defaults(u);}) as typeof fetch;
    const values=await Promise.all(Array.from({length:8},()=>refreshAntigravityToken({access:"",refresh:"flight-fixture",expires:0})));
    assert.ok(values.every(v=>v===values[0]));assert.equal(catalogs,1);
    const saved=rememberAccount(values[0]);assert.ok(loadAccountStore().accounts[saved.accountId].quota?.groupsMeta);
    assert.equal(accountAvailable("flight-access","claude-fixture"),false);assert.equal(accountAvailable("flight-access","gemini-fixture"),true);
    assert.equal(await failoverToNextAccount(new Set(),"claude-fixture"),undefined);
  });
  await test("abort exits snapshot stages without fallback/probes", async () => {
    const controller=new AbortController();let calls=0;
    globalThis.fetch=(async()=>{calls++;controller.abort(new Error("fixture-abort"));throw controller.signal.reason;}) as typeof fetch;
    await assert.rejects(fetchQuotaSnapshot("fixture","project",{signal:controller.signal}),/fixture-abort/);assert.equal(calls,1);
  });
  await test("failed and successful refresh flights cannot resurrect concurrent removal/activation", async () => {
    const oldDir=process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR=mkdtempSync(join(tmpdir(),"codex-sync-removal-"));
    try {
      rememberAccount({access:"delete-failed-access",refresh:"delete-failed-refresh",expires:0,email:"delete-failed@example.invalid",projectId:"project"});
      mock.get("https://oauth2.googleapis.com").intercept({path:"/token",method:"POST"}).reply(400,{error:"invalid_grant"}).delay(20);
      const failed=failoverToNextAccount(new Set(),"claude-fixture");
      await removeAccount("delete-failed@example.invalid");
      assert.equal(await failed,undefined);assert.equal(Object.keys(loadAccountStore().accounts).length,0);
      rememberAccount({access:"delete-success-old",refresh:"delete-success-refresh",expires:0,email:"delete-success@example.invalid",projectId:"project"});
      mock.get("https://oauth2.googleapis.com").intercept({path:"/token",method:"POST"}).reply(200,{access_token:"delete-success-new",expires_in:3600}).delay(20);
      profile("delete-success-new","delete-success@example.invalid");
      globalThis.fetch=(async (url,init)=>String(url).endsWith("loadCodeAssist")&&!JSON.parse(String(init?.body)).metadata?.ide_name?json({cloudaicompanionProject:"project"}):defaults(String(url))) as typeof fetch;
      const activation=activateAccount("delete-success@example.invalid");
      const rejected=assert.rejects(activation,/removed during activation/);
      await removeAccount("delete-success@example.invalid");await rejected;
      assert.equal(Object.keys(loadAccountStore().accounts).length,0);
    } finally { process.env.PI_CODING_AGENT_DIR=oldDir; }
  });
  mock.assertNoPendingInterceptors(); console.log(`PASS ${passed} one-shot Sync groups`);
} finally { globalThis.fetch=savedFetch;setGlobalDispatcher(savedDispatcher);await mock.close(); }
