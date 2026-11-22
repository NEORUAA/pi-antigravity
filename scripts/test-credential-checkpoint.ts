import fsDefault from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { normalizeQuotaModels, quotaGate } from "../src/auth/quota-snapshot.js";
/** Offline fixture-only durable checkpoint tests, including a real process restart. */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher } from "undici";
import { refreshAntigravityToken, synchronizeAntigravityCredential, getApiKey, OAuthRefreshError } from "../src/auth/oauth.js";
import { rememberAccount, loadAccountStore, updateRememberedAccount, syncCurrentAuth, removeAccount, listAccounts, accountAvailable, recoverPendingActiveAccount } from "../src/auth/accounts.js";
import { parseApiKey } from "../src/client/client.js";
import { beginCredentialFlight, checkpointRotation, revokeCredentialCheckpoint, validatedCredential } from "../src/auth/checkpoint.js";
process.env.ANTIGRAVITY_COMPAT_PROFILE="codex";
for(const key of ["PROJECT_ID","USER_AGENT","OAUTH_CLIENTS","OAUTH_CLIENT_KEY"]) {delete process.env[`ANTIGRAVITY_${key}`];delete process.env[`NOAGY_${key}`];}
const old={access:"checkpoint-old-access",refresh:"checkpoint-old-refresh",expires:0,email:"verified@example.invalid",projectId:"old-project"};
const rotated={access:"checkpoint-new-access",refresh:"checkpoint-new-refresh",expires:Date.now()+3500_000};
const originalFetch=globalThis.fetch,dispatcher=getGlobalDispatcher();
const mock=new MockAgent();mock.disableNetConnect();setGlobalDispatcher(mock);
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status});
function profile(token:string,verified=true,status=200){mock.get("https://www.googleapis.com").intercept({path:"/oauth2/v2/userinfo",method:"GET",headers:{authorization:`Bearer ${token}`}}).reply(status,{id:"verified-google-subject",email:"verified@example.invalid",verified_email:verified});}
function token(access=rotated.access,refresh=rotated.refresh,delay=1){mock.get("https://oauth2.googleapis.com").intercept({path:"/token",method:"POST"}).reply(200,{access_token:access,refresh_token:refresh,expires_in:3600}).delay(delay);}
function control(){globalThis.fetch=(async url=>String(url).endsWith("fetchAvailableModels")?json({models:{"gemini-fixture":{quotaInfo:{remainingFraction:1}}}}):String(url).endsWith("retrieveUserQuotaSummary")?json({groups:[]}):json({cloudaicompanionProject:"verified-project"})) as typeof fetch;}
function root(){process.env.PI_CODING_AGENT_DIR=mkdtempSync(join(tmpdir(),"checkpoint-fixture-"));return process.env.PI_CODING_AGENT_DIR;}
function journal(){return JSON.parse(readFileSync(join(process.env.PI_CODING_AGENT_DIR!,"antigravity-checkpoints.json"),"utf8"));}
function entry(){return Object.values(journal().families)[0] as any;}
function seed(){rememberAccount(old);writeFileSync(join(process.env.PI_CODING_AGENT_DIR!,"auth.json"),JSON.stringify({antigravity:{...old,type:"oauth"}}),{mode:0o600});}
async function failAfterRotation(){token();profile(rotated.access,true,503);await assert.rejects(refreshAntigravityToken(old),/503/);assert.equal(entry().state,"pending");assert.equal(entry().credentials.refresh,rotated.refresh);}
let count=0;
async function test(name:string,run:()=>Promise<void>|void){await run();count++;console.log(`PASS ${name}`);}
try {
  if(process.argv.includes("--worker")) {
    const mode=process.argv.at(-1);
    if(mode==="rotate") {seed();await failAfterRotation();assert.equal(loadAccountStore().accounts[old.email].access,old.access);assert.equal(accountAvailable(old.access,"gemini-fixture"),false);assert.throws(()=>getApiKey(old),/pending/);}
    else if(mode==="recover") {profile(rotated.access);control();assert.equal(await recoverPendingActiveAccount(),true);const value=await refreshAntigravityToken(old);assert.equal(value.refresh,rotated.refresh);assert.equal(value.email,"verified@example.invalid");updateRememberedAccount(old,value);syncCurrentAuth();assert.equal(entry().state,"verified");assert.equal(Object.values(loadAccountStore().accounts)[0].projectId,"verified-project");assert.deepEqual(JSON.parse(getApiKey(old)),{token:rotated.access,projectId:"verified-project"});assert.throws(()=>parseApiKey(JSON.stringify({token:old.access,projectId:"old-project"})),/Invalid/);}
    else throw new Error("Unknown offline worker mode");
    mock.assertNoPendingInterceptors();console.log("PASS isolated restart worker");
  } else {
    await test("durable rotated refresh survives real process restart, never publishes pending identity",()=>{
      const dir=root();
      for(const mode of ["rotate","recover"]) {const result=spawnSync(process.execPath,["scripts/run-ts.mjs","scripts/test-credential-checkpoint.ts","--worker",mode],{env:{...process.env,PI_CODING_AGENT_DIR:dir},encoding:"utf8",timeout:30_000});assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/PASS isolated restart worker/);assert.ok(!result.stdout.includes(rotated.refresh));}
      assert.equal(statSync(join(dir,"antigravity-checkpoints.json")).mode&0o777,0o600);assert.equal(statSync(dir).mode&0o777,0o700);assert.ok(!readdirSync(dir).some(n=>n.endsWith(".tmp")));
    });
    await test("temporary failure keeps rotated tuple, single-flight recovery never repeats token exchange",async()=>{
      root();seed();await failAfterRotation();profile(rotated.access);control();
      assert.throws(()=>parseApiKey(JSON.stringify({token:rotated.access,projectId:"unverified-project"})),/Invalid/);
      const values=await Promise.all(Array.from({length:8},()=>refreshAntigravityToken(old)));assert.ok(values.every(v=>v===values[0]));assert.equal(values[0].projectId,"verified-project");assert.equal(entry().failure,undefined);
    });
    await test("unverified userinfo is permanent quarantine; forged ID token cannot authenticate; fresh verified login can recover",async()=>{
      root();seed();token();profile(rotated.access,false);await assert.rejects(refreshAntigravityToken({...old,idToken:"fixture.unverified.claims"}),/verified email/);
      assert.equal(entry().state,"permanent");assert.equal(accountAvailable(rotated.access,"gemini-fixture"),false);await assert.rejects(refreshAntigravityToken(old),e=>e instanceof OAuthRefreshError&&e.permanent);
      profile("fresh-consent-access");control();const fresh=await synchronizeAntigravityCredential({access:"fresh-consent-access",refresh:rotated.refresh,expires:Date.now()+3500_000},{freshLogin:true});assert.equal(fresh.email,"verified@example.invalid");assert.equal(entry().state,"verified");
    });
    await test("permanent invalid_grant clears unusable secret tuple and prevents automatic retry",async()=>{
      root();seed();await failAfterRotation();profile(rotated.access,true,401);mock.get("https://oauth2.googleapis.com").intercept({path:"/token",method:"POST"}).reply(400,{error:"invalid_grant"});
      await assert.rejects(refreshAntigravityToken(old),e=>e instanceof OAuthRefreshError&&e.permanent);assert.equal(entry().state,"permanent");assert.equal(entry().credentials,undefined);await assert.rejects(refreshAntigravityToken(old),/fresh login/);
    });
    await test("mandatory catalog failure retains pending; successful optional observations are required only as source specifies",async()=>{
      root();seed();token();profile(rotated.access);globalThis.fetch=(async url=>String(url).endsWith("fetchAvailableModels")?json({},503):json({cloudaicompanionProject:"verified-project"})) as typeof fetch;
      await assert.rejects(refreshAntigravityToken(old),/503/);assert.equal(entry().state,"pending");profile(rotated.access);control();await refreshAntigravityToken(old);assert.equal(entry().state,"verified");
    });
    await test("deletion fences late token response, strips secrets, and stale SDK auth cannot resurrect account",async()=>{
      root();seed();token(rotated.access,rotated.refresh,30);const pending=refreshAntigravityToken(old);const rejected=assert.rejects(pending,/superseded/);await new Promise(resolve=>setImmediate(resolve));await removeAccount(old.email);await rejected;
      assert.equal(entry().state,"revoked");assert.equal(entry().credentials,undefined);writeFileSync(join(process.env.PI_CODING_AGENT_DIR!,"auth.json"),JSON.stringify({antigravity:{...old,type:"oauth"}}));assert.equal(listAccounts().length,0);assert.throws(()=>getApiKey(old),/revoked/);await assert.rejects(refreshAntigravityToken(old),/fresh login/);
    });
    await test("new verified consent supersedes old in-flight refresh without old failures poisoning new epoch",async()=>{
      root();seed();token("late-old-access","late-old-refresh",30);const pending=refreshAntigravityToken(old);const rejected=assert.rejects(pending,/superseded/);await new Promise(resolve=>setImmediate(resolve));
      profile("new-consent-access");control();await synchronizeAntigravityCredential({access:"new-consent-access",refresh:old.refresh,expires:Date.now()+3500_000},{freshLogin:true});await rejected;assert.equal(entry().state,"verified");assert.equal(entry().credentials.access,"new-consent-access");assert.equal(entry().failure,undefined);
    });
    await test("quarantine is shared by credential parser and all helpers, corrupt journal fails closed without overwrite",()=>{
      const dir=root(),flight=beginCredentialFlight(old);checkpointRotation(flight,rotated);for(const token of [old.access,rotated.access])assert.throws(()=>parseApiKey(JSON.stringify({token,projectId:"project"})),/Invalid/);
      revokeCredentialCheckpoint(old);assert.throws(()=>validatedCredential(old),/revoked/);const file=join(dir,"antigravity-checkpoints.json");writeFileSync(file,"{corrupt fixture");assert.throws(()=>getApiKey(old),/corrupt/);assert.equal(readFileSync(file,"utf8"),"{corrupt fixture");
    });
    await test("cancel after rotated checkpoint retains recovery, late promotion cannot pass a revocation fence",()=>{
      root();const flight=beginCredentialFlight(old);checkpointRotation(flight,rotated);assert.equal(entry().state,"pending");revokeCredentialCheckpoint(old);assert.throws(()=>checkpointRotation(flight,{...rotated,access:"late"}),/superseded/);assert.equal(entry().credentials,undefined);
    });
    await test("failed atomic replacement cleans owner-only temporary files and does not publish partial data",()=>{
      const dir=root(),flight=beginCredentialFlight(old),rename=fsDefault.renameSync;
      try {fsDefault.renameSync=()=>{throw new Error("fixture-write-refused");};syncBuiltinESMExports();assert.throws(()=>checkpointRotation(flight,rotated),/fixture-write-refused/);}
      finally{fsDefault.renameSync=rename;syncBuiltinESMExports();}
      assert.equal(entry().state,"baseline");assert.equal(entry().credentials.refresh,old.refresh);assert.ok(!readdirSync(dir).some(name=>name.endsWith(".tmp")));
    });
    await test("queued revoked flight stops before token HTTP request",async()=>{
      root();seed();const pending=refreshAntigravityToken(old);const rejected=assert.rejects(pending,/superseded/);await removeAccount(old.email);await rejected;assert.equal(entry().state,"revoked");
    });
    await test("same verified principal/project retains known zero after optional summary failure across rotation",async()=>{
      root();const q=normalizeQuotaModels({},Date.now()),observedAt=Date.now();q.groups=[{displayName:"fixture",description:"",buckets:[{bucketId:"3p-weekly",window:"weekly",remainingFraction:0,fractionPresent:true,resetTime:new Date(observedAt+3600_000).toISOString(),observedAt,observationSeq:1,ttlSeconds:7200}]}];q.groupsMeta={appliedSeq:1,observedAt,summaryIntegrity:true};
      const prior={...old,email:"verified@example.invalid",projectId:"verified-project",quota:q};rememberAccount(prior);token();profile(rotated.access);control();const base=globalThis.fetch;globalThis.fetch=(async(url,init)=>String(url).endsWith("retrieveUserQuotaSummary")?json({},401):base(url,init)) as typeof fetch;
      const result=await refreshAntigravityToken(prior);assert.deepEqual(result.quota?.groups,q.groups);assert.equal(quotaGate(result.quota,"claude-fixture").blocked,true);
    });
    await test("cancelled identity validation retains pending tuple for bounded subsequent recovery",async()=>{
      root();const credentials={access:"abort-fixture-access",refresh:"abort-fixture-refresh",expires:Date.now()+3500_000};const controller=new AbortController();mock.get("https://www.googleapis.com").intercept({path:"/oauth2/v2/userinfo",method:"GET",headers:{authorization:`Bearer ${credentials.access}`}}).reply(200,{id:"verified-google-subject",email:"verified@example.invalid",verified_email:true}).delay(30);
      const pending=synchronizeAntigravityCredential(credentials,{freshLogin:true,signal:controller.signal});const rejected=assert.rejects(pending,/fixture-abort/);await new Promise(resolve=>setImmediate(resolve));controller.abort(new Error("fixture-abort"));await rejected;assert.equal(entry().state,"pending");
      profile(credentials.access);control();await refreshAntigravityToken(credentials);assert.equal(entry().state,"verified");
    });
    await test("refresh and explicit one-shot validation share a single family flight",async()=>{
      root();seed();token();profile(rotated.access);control();const first=refreshAntigravityToken(old),second=synchronizeAntigravityCredential(old);assert.equal(first,second);const values=await Promise.all([first,second]);assert.equal(values[0],values[1]);assert.equal(entry().state,"verified");
    });
    await test("corrupt account projection and malformed journal aliases fail closed rather than dropping health",()=>{
      const dir=root();seed();writeFileSync(join(dir,"antigravity-accounts.json"),"{broken fixture");assert.throws(()=>accountAvailable(old.access,"gemini-fixture"),/unreadable/);
      beginCredentialFlight(old);const value=journal();value.accessAliases={fixture:"malformed"};writeFileSync(join(dir,"antigravity-checkpoints.json"),JSON.stringify(value));assert.throws(()=>getApiKey(old),/corrupt/);
    });
    await test("verified stable Google subject permits an email rename without false principal replacement",async()=>{
      root();const prior={...old,email:"previous-address@example.invalid",subject:"verified-google-subject"};rememberAccount(prior);token();profile(rotated.access);control();const result=await refreshAntigravityToken(prior);assert.equal(result.subject,prior.subject);assert.equal(result.email,"verified@example.invalid");assert.equal(entry().state,"verified");
    });
    await test("verified but different Google subject stays quarantined until fresh consent",async()=>{
      root();const prior={...old,subject:"prior-google-subject"};rememberAccount(prior);token();profile(rotated.access);control();await assert.rejects(refreshAntigravityToken(prior),/principal changed/);assert.equal(entry().state,"permanent");assert.equal(entry().credentials.refresh,rotated.refresh);assert.equal(accountAvailable(rotated.access,"gemini-fixture"),false);assert.throws(()=>getApiKey(prior),/permanent/);
      profile("reconsent-access");const result=await synchronizeAntigravityCredential({access:"reconsent-access",refresh:rotated.refresh,expires:Date.now()+3500_000},{freshLogin:true});assert.equal(result.subject,"verified-google-subject");assert.equal(entry().state,"verified");
    });
    await test("legacy protocol comparison cannot bypass a pending credential quarantine",async()=>{
      root();seed();await failAfterRotation();process.env.ANTIGRAVITY_COMPAT_PROFILE="pi";
      try {assert.throws(()=>getApiKey(old),/pending/);assert.throws(()=>parseApiKey(JSON.stringify({token:rotated.access,projectId:"unverified-project"})),/Invalid/);await assert.rejects(refreshAntigravityToken(old),/pending/);}
      finally {process.env.ANTIGRAVITY_COMPAT_PROFILE="codex";}
    });
    mock.assertNoPendingInterceptors();console.log(`PASS ${count} durable checkpoint/restart groups`);
  }
} finally {globalThis.fetch=originalFetch;setGlobalDispatcher(dispatcher);await mock.close();}
