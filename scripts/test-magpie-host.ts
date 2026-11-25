/** Executes the unmodified pinned Magpie host, not a mocked registerProvider. */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {get} from "node:http";
import {normalizeQuotaModels} from "../src/auth/quota-snapshot.js";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync,writeFileSync,readFileSync,mkdirSync,existsSync } from "node:fs";
import { resolve,join } from "node:path";
import { createInterface } from "node:readline";
import { tmpdir } from "node:os";
import { DefaultPackageManager,SettingsManager,discoverAndLoadExtensions,createEventBus } from "@earendil-works/pi-coding-agent";
const provenance=JSON.parse(readFileSync("scripts/fixtures/magpie-host/provenance.json","utf8"));
for(const [name,sha] of Object.entries(provenance.gitBlobSHA)){const bytes=readFileSync("scripts/fixtures/magpie-host/"+name);assert.equal(createHash("sha1").update("blob "+bytes.length+"\0").update(bytes).digest("hex"),sha,"real host fixture must remain unmodified");}
const root=process.cwd(), temp=mkdtempSync(join(tmpdir(),"magpie-contract-"));
const home=join(temp,"home");mkdirSync(home);process.env.PI_CODING_AGENT_DIR=join(home,"pi");mkdirSync(process.env.PI_CODING_AGENT_DIR);
const settings=SettingsManager.inMemory({packages:[root]});
const pm=new DefaultPackageManager({cwd:temp,agentDir:process.env.PI_CODING_AGENT_DIR,settingsManager:settings,builtinExtensions:[]});
const paths=await pm.resolve();
const own=paths.extensions.filter(x=>x.path.startsWith(join(root,"extensions"))).map(x=>x.path);
assert.equal(own.length,4,"Pi official conventional-directory discovery preserves all four entries");
const loaded=await discoverAndLoadExtensions(own,temp,process.env.PI_CODING_AGENT_DIR,createEventBus());
assert.equal(loaded.errors.length,0,JSON.stringify(loaded.errors));assert(loaded.runtime.pendingProviderRegistrations.some(x=>x.name==="antigravity"));
console.log("PASS real Pi package discovery and extension loader: four conventional entries");
const authPath=join(temp,"plugin-auth.json");
const seed=(t:string)=>({type:"oauth",access:"fixture-"+t,refresh:"fixture-"+t+"-refresh",expires:Date.now()+3600000});
writeFileSync(authPath,JSON.stringify(Object.fromEntries(["A","B","U","E","F","T","R","D","I","X","Y","N","Z"].map((t,i)=>[i===0?"antigravity":"antigravity#"+t,{...seed(t),...(t==="R"?{expires:1}: {}),...(t==="I"?{subject:"forged-subject",quota:normalizeQuotaModels({models:{"gemini-3.7-flash-tiered":{quotaInfo:{remainingFraction:1}}}},Date.now())}:{})}]))));
const calls=join(temp,"calls.jsonl");
const syntheticEnv={...process.env};
for(const key of Object.keys(syntheticEnv))if(/^(ANTIGRAVITY|NOAGY)_(CLIENT_ID|CLIENT_SECRET|OAUTH_CLIENTS|OAUTH_CLIENT_KEY|ACCESS_TOKEN|REFRESH_TOKEN|API_KEY)$/.test(key))delete syntheticEnv[key];
syntheticEnv.ANTIGRAVITY_CLIENT_ID="fixture-client.apps.googleusercontent.com";syntheticEnv.ANTIGRAVITY_CLIENT_SECRET="fixture-public-client";
const bun=execFileSync("bun",["-p","process.execPath"],{encoding:"utf8",env:{...process.env,NODE_OPTIONS:""},timeout:10000}).trim();
function start(){
 const child=spawn(bun,["--preload",resolve("scripts/magpie-offline-preload.mjs"),resolve("scripts/fixtures/magpie-host/host.js")],{cwd:root,env:{...syntheticEnv,NODE_OPTIONS:"",HOME:home,PI_CODING_AGENT_DIR:join(home,"pi"),ANTIGRAVITY_COMPAT_PROFILE:"codex",NOAGY_COMPAT_PROFILE:"codex",MAGPIE_FIXTURE_CALLS:calls,MAGPIE_FIXTURE_RECOVER:join(temp,"recover-T")},stdio:["pipe","pipe","pipe"]});
 const pending=new Map<number,{resolve:(x:any)=>void;reject:(e:Error)=>void;events:any[];abortOnChunk?:boolean}>();let id=0,err="";
 child.stderr.on("data",b=>{err+=String(b)});
 createInterface({input:child.stdout}).on("line",line=>{const m=JSON.parse(line),p=pending.get(m.id);if(!p)return;if(m.event){p.events.push(m);if(m.event==="chunk"&&p.abortOnChunk){child.stdin.write(JSON.stringify({method:"abort",params:{id:m.id}})+"\n");pending.delete(m.id);p.resolve({events:p.events,aborted:true});}return;}if(m.error){pending.delete(m.id);if(p.events.length)p.resolve({events:p.events,error:m.error.message});else p.reject(new Error(m.error.message+"; host stderr: "+err));}else if("result" in m){pending.delete(m.id);p.resolve(p.events.length?{events:p.events,result:m.result}:m.result);}});
 child.on("exit",code=>{for(const p of pending.values())p.reject(new Error("host exited "+code+": "+err));});
 const call=(method:string,params:unknown,abortOnChunk=false)=>new Promise<any>((res,rej)=>{const n=++id;const timer=setTimeout(()=>{pending.delete(n);rej(new Error("host RPC timeout: "+method+" "+err));},20000);pending.set(n,{events:[],abortOnChunk,resolve:x=>{clearTimeout(timer);res(x)},reject:e=>{clearTimeout(timer);rej(e)}});child.stdin.write(JSON.stringify({id:n,method,params})+"\n");});
 return{child,call,async init(){const r=await call("init",{authPath,directory:temp,piPath:resolve("scripts/fixtures/magpie-host/pi.js"),plugins:[{spec:"fixture-installed-root",target:root}]});assert(!r.plugins[0].error,JSON.stringify(r));},async close(){if(child.exitCode!==null||child.signalCode!==null)return;await new Promise<void>(resolve=>{const timer=setTimeout(()=>{child.kill();resolve()},2000);child.once("exit",()=>{clearTimeout(timer);resolve();});child.stdin.end();});}};
}
let host=start();
try {
 await host.init();
 const a=await host.call("check",{provider:"antigravity"});
 assert.deepEqual(a.models,["gemini-3.7-flash","claude-sonnet-4-6"]);
 assert.equal(a.usage.windows[0].used,0);assert.equal(a.usage.balance,"12 AI credits");
 assert.deepEqual(a.usage.windows[0].models, ["gemini-3.7-flash"]);
 console.log("PASS actual Magpie native loader -> account model refresh -> auth.usage dispatcher");
 const b=await host.call("check",{provider:"antigravity",account:"antigravity#B"});
 assert.deepEqual(b.models,["claude-sonnet-4-6"]);assert.equal(b.usage.windows[0].used,100);
 console.log("PASS account isolation: separate model sets and zero-remaining quota");
 const u=await host.call("usage",{provider:"antigravity",account:"antigravity#U"});
 assert.equal(u.windows.length,2,"one exact backing pool plus its model detail; no inferred family window");assert.equal(u.windows.filter(w=>w.pool&&!w.family).length,1);assert.equal(u.windows.filter(w=>w.family).length,1);assert.equal(u.windows[0].used,null);assert.equal(u.windows[0].display,"Unknown");
 const e=await host.call("usage",{provider:"antigravity",account:"antigravity#E"});
 assert.equal(e.windows.length,0); // An observed credit balance is not a fabricated quota.
 const invalid=await host.call("usage",{provider:"antigravity",account:"antigravity#I"});assert(invalid.error);assert.equal(invalid.windows.length,0);
 const f=await host.call("usage",{provider:"antigravity",account:"antigravity#F"});assert.match(f.error,/denied/i);assert.equal(f.windows.length,0);
 const t=await host.call("usage",{provider:"antigravity",account:"antigravity#T"});assert(t.error);assert.equal(t.windows.length,0);
 writeFileSync(join(temp,"recover-T"),"synthetic recovery enabled");
 const recovered=await host.call("usage",{provider:"antigravity",account:"antigravity#T"});assert(!recovered.error,JSON.stringify(recovered));assert.equal(recovered.windows[0].used,0);
 console.log("PASS unknown/missing/forbidden/transient quota never becomes 100% remaining; pending verification recovers without re-login");
 const persisted=JSON.parse(readFileSync(authPath,"utf8"));assert.equal(persisted.antigravity.subject,"subject:A");assert.equal(persisted["antigravity#B"].subject,"subject:B");
 await host.close();host=start();await host.init();
 const restarted=await host.call("usage",{provider:"antigravity"});assert.equal(restarted.windows[0].used,0);
 console.log("PASS host restart recovers the same scoped verified quota and account identity");
 const fetchRequest=(text:string,extra={})=>({provider:"antigravity",model:"gemini-3.7-flash-low",npm:"@ai-sdk/google",url:"https://antigravity.invalid/v1beta/models/gemini-3.7-flash-low:streamGenerateContent",method:"POST",body:Buffer.from(JSON.stringify({contents:[{role:"user",parts:[{text}]}],...extra})).toString("base64")});
 const textOf=(r:any)=>r.events.filter((e:any)=>e.event==="chunk").map((e:any)=>Buffer.from(e.data,"base64").toString()).join("");
 const effortRequest = (model: string, effort?: string, account?: string, extra = {}, operation = "generateContent") => ({
  ...fetchRequest("fixture-effort", extra),
  model,
  url: `https://antigravity.invalid/v1beta/models/${model}:${operation}`,
  account,
  headers: effort ? {"X-Magpie-Effort": effort} : undefined,
 });
 const generationCalls = () =>
  readFileSync(calls, "utf8").trim().split("\n")
   .map(line => JSON.parse(line))
   .filter(({method}) => method === "generateContent" || method === "streamGenerateContent");
 const flashBudgets = [[undefined, 8192], ["low", 4096], ["medium", 8192], ["high", 24576]] as const;
 for (const [effort, budget] of flashBudgets) {
  const extra = {generationConfig: {thinkingConfig: {thinkingBudget: 1024, includeThoughts: false}}};
  const response = await host.call("fetch", effortRequest("gemini-3.7-flash", effort, undefined, extra));
  assert.equal(response.events[0].status, 200);
  const trace = generationCalls().at(-1);
  assert.equal(trace.model, "gemini-3.7-flash-tiered");
  assert.deepEqual(trace.request.generationConfig.thinkingConfig, {thinkingBudget: budget, includeThoughts: false});
 }
 for (const [effort, level] of [[undefined, "low"], ["xhigh", "xhigh"]] as const) {
  const operation = effort ? "streamGenerateContent" : "generateContent";
  const response = await host.call("fetch", effortRequest("gemini-4-neon", effort, "antigravity#N", {}, operation));
  assert.equal(response.events[0].status, 200);
  assert.equal(response.events[0].headers["x-magpie-sent-model"], `gemini-4-neon-${level}`);
  const trace = generationCalls().at(-1);
  assert.equal(trace.method, operation);
  assert.equal(trace.model, `gemini-4-neon-${level}`);
  assert.equal(trace.request.generationConfig.thinkingConfig.thinkingLevel, level.toUpperCase());
 }
 const directNeon = await host.call("fetch", effortRequest("gemini-4-neon", undefined, "antigravity#N", {
  generation_config: {thinking_config: {thinking_level: "XHIGH", include_thoughts: true}},
 }));
 assert.equal(directNeon.events[0].status, 200);
 const directTrace = generationCalls().at(-1);
 assert.equal(directTrace.model, "gemini-4-neon-xhigh");
 assert.deepEqual(directTrace.request.generationConfig.thinkingConfig, {thinkingLevel: "XHIGH", includeThoughts: true});
 assert.equal(directTrace.request.generation_config?.thinking_config, undefined);
 const groupedClaude = await host.call("fetch", effortRequest("claude-opus-5-5", "low", "antigravity#N", {
  generationConfig: {temperature: 0.5, thinkingConfig: {thinkingBudget: 1024}},
 }));
 assert.equal(groupedClaude.events[0].status, 200);
 assert.equal(groupedClaude.events[0].headers["x-magpie-sent-model"], "claude-opus-5-5-low");
 const claudeTrace = generationCalls().at(-1);
 assert.equal(claudeTrace.model, "claude-opus-5-5-low");
 assert.deepEqual(claudeTrace.request.generationConfig, {temperature: 0.5});
 const pinnedNeon = await host.call("fetch", effortRequest("gemini-4-neon-low", "xhigh", "antigravity#N"));
 assert.equal(pinnedNeon.events[0].status, 200);
 assert.equal(generationCalls().at(-1).model, "gemini-4-neon-low");
 const beforeUnavailable = generationCalls().length;
 const unavailable = await host.call("fetch", effortRequest("gemini-4-neon", "high", "antigravity#N"));
 assert.equal(unavailable.events[0].status, 400);
 const refusal = JSON.parse(textOf(unavailable)).error;
 assert.equal(refusal.param, "reasoning_effort");
 assert.match(refusal.message, /Reasoning effort .* not available.*Supported values are: 'low', 'xhigh'/i);
 assert.equal(generationCalls().length, beforeUnavailable);
 console.log("PASS native effort routing, including distinct backing models and partial account support");
 const good=await host.call("fetch",fetchRequest("fixture-tool",{tools:[{functionDeclarations:[{name:"fixture.long tool/name",parameters:{type:"object",properties:{value:{type:"integer"}}}}]}]}));
 assert.equal(good.events[0].status,200);assert.match(textOf(good),/fixture.long tool\/name/);assert(!textOf(good).includes('"response":'));
 const nonstream=await host.call("fetch",{...fetchRequest("fixture"),url:"https://antigravity.invalid/v1beta/models/gemini-3.7-flash-low:generateContent"});assert.equal(JSON.parse(textOf(nonstream)).candidates[0].content.parts[0].text,"fixture");

 const sourceVectors=JSON.parse(readFileSync("scripts/fixtures/native-oracle.json","utf8")).filter(v=>v.input.kind==="request"&&v.input.model==="gemini-3.7-flash-high"&&v.input.request.contents);
 for(const {input,expected}of sourceVectors){const r=await host.call("fetch",{...fetchRequest("unused"),model:input.model,url:`https://antigravity.invalid/v1beta/models/${input.model}:generateContent`,body:Buffer.from(JSON.stringify(input.request)).toString("base64")});assert.equal(r.events[0].status,200);const trace=readFileSync(calls,"utf8").trim().split("\n").map(x=>JSON.parse(x)).filter(x=>x.method==="generateContent").at(-1).request;delete trace.sessionId;assert.deepEqual(trace,expected.request,"actual host native request must match original Go oracle");const doc=JSON.parse(textOf(r));assert.equal(doc.usageMetadata.promptTokenCount,11);assert(!doc.cpaUsageMetadata);}
 const partial=await host.call("fetch",fetchRequest("fixture-partial"));assert.equal(partial.events[0].status,200);assert.match(partial.error,/unexpected EOF/);const nonstreamPartial=await host.call("fetch",{...fetchRequest("fixture-partial"),url:"https://antigravity.invalid/v1beta/models/gemini-3.7-flash-low:generateContent"});assert.equal(JSON.parse(textOf(nonstreamPartial)).candidates[0].finishReason,"STOP");
 const safety=await host.call("fetch",fetchRequest("fixture-prompt-safety"));assert(!safety.error);assert.match(textOf(safety),/SAFETY/);
 const count=await host.call("fetch",{...fetchRequest("fixture-count"),url:"https://antigravity.invalid/v1beta/models/gemini-3.7-flash-low:countTokens"});assert.equal(JSON.parse(textOf(count)).totalTokens,23);
 console.log(`PASS actual host ${sourceVectors.length} original-Go native conversions, missing terminal, legal block, usage and countTokens`);

 const schemaRequest=(marker,tools=[])=>({...fetchRequest(marker),model:"claude-sonnet-4-6",url:"https://antigravity.invalid/v1beta/models/claude-sonnet-4-6:streamGenerateContent",body:Buffer.from(JSON.stringify({contents:[{role:"user",parts:[{text:marker}]}],generationConfig:{responseJsonSchema:{type:"object",properties:{value:{type:"integer"}}}},tools})).toString("base64")});
 const structured=await host.call("fetch",schemaRequest("fixture-json-mode"));assert(!structured.error);const frames=textOf(structured).split("\n").filter(line=>line.startsWith("data: ")).map(line=>JSON.parse(line.slice(6)));assert.equal(frames[0].candidates[0].content.parts.at(-1).text,'{"10":1.00,"2":1e3}');assert(!frames[0].candidates[0].content.parts.some(p=>p.text==="not JSON"));assert.equal(frames[1].candidates[0].finishReason,"STOP");
 const own=await host.call("fetch",schemaRequest("fixture-json-mode",[{functionDeclarations:[{name:"json_mode",parameters:{type:"object"}}]}]));assert.match(textOf(own),/functionCall/);assert.match(textOf(own),/"finishReason":"OTHER"/);
 const refused=await host.call("fetch",schemaRequest("fixture-json-reject"));assert.equal(refused.events[0].status,400);assert.equal(JSON.parse(textOf(refused)).error.code,"antigravity_feature_unsupported");assert.match(textOf(refused),/json_schema structured output/);
 const denied=await host.call("fetch",{...fetchRequest("fixture"),account:"antigravity#B"});assert.equal(denied.events[0].status,404);
 const beforeSummary = generationCalls().length;
 const summaryHold = await host.call("fetch", effortRequest("claude-sonnet-4-6", undefined, "antigravity#B"));
 assert.equal(summaryHold.events[0].status, 429);
 assert.match(JSON.parse(textOf(summaryHold)).error.message, /Individual quota reached/);
 assert.equal(generationCalls().length, beforeSummary);
 const errorSummary = ({code, status, message}) => ({code, status, message});
 const before=await host.call("fetch",{...fetchRequest("fixture-before-error"),account:"antigravity#X"});
 assert.equal(before.events[0].status,429);
 const quotaError = JSON.parse(textOf(before)).error;
 assert.equal(quotaError.code, 429);
 assert.equal(quotaError.status, "RESOURCE_EXHAUSTED");
 const quotaMessage = "Gemini model quota exhausted for this subscription (Bearer [redacted]).";
 assert.equal(quotaError.message, quotaMessage + " Your quota will reset after 120s.");
 assert(quotaError.details.some(detail => detail.retryDelay === "120s"));
 assert.doesNotMatch(textOf(before), /fixture-secret-1234/);
 const retryAfter = (result) => Number(result.events[0].headers["retry-after"]);
 const freshRetry = retryAfter(before);
 assert(freshRetry > 0 && freshRetry <= 120);
 const after=await host.call("fetch",{...fetchRequest("fixture-after-error"),account:"antigravity#Y"});
 assert.equal(after.events[0].status, 200);
 assert.equal(after.error, undefined);
 const streamed = textOf(after).split("\n").filter(line => line.startsWith("data: "))
  .map(line => JSON.parse(line.slice(6)));
 assert.equal(streamed[0].candidates[0].content.parts[0].text, "fixture");
 assert.deepEqual(errorSummary(streamed.at(-1).error), errorSummary(quotaError));
 assert.doesNotMatch(textOf(after), /fixture-secret-1234/);
 const beforeHeld = generationCalls().length;
 const held=await host.call("fetch",{...fetchRequest("fixture"),account:"antigravity#X"});
 assert.equal(held.events[0].status,429,"HTTP200 quota failure persists in the host-owned account");
 assert.deepEqual(errorSummary(JSON.parse(textOf(held)).error), {...errorSummary(quotaError), message: quotaMessage});
 const heldRetry = retryAfter(held);
 assert(heldRetry > 0 && heldRetry <= freshRetry);
 assert.equal(generationCalls().length, beforeHeld);

 const validationRequest = {...fetchRequest("fixture-validation-required"), account: "antigravity#Z",
  url: "https://antigravity.invalid/v1beta/models/gemini-3.7-flash-low:generateContent"};
 const validation = await host.call("fetch", validationRequest);
 assert.equal(validation.events[0].status, 403);
 const validationError = JSON.parse(textOf(validation)).error;
 assert.equal(validationError.code, 403);
 assert.equal(validationError.status, "PERMISSION_DENIED");
 assert.match(validationError.message, /Verify your Google account before continuing/);
 assert(validationError.details.some(detail => detail.reason === "VALIDATION_REQUIRED"));
 assert.doesNotMatch(textOf(validation), /fixture-verification-url/);
 const sentTos = await host.call("fetch", {
  ...effortRequest("gemini-4-neon", "low", "antigravity#N"),
  body: fetchRequest("fixture-tos-violation").body,
 });
 assert.equal(sentTos.events[0].status, 403);
 const tosError = JSON.parse(textOf(sentTos)).error;
 assert.match(tosError.message, /disabled in this account for violation of Terms of Service.*submit an appeal/);
 const beforeBlocked = generationCalls().length;
 const blocked = await host.call("fetch", validationRequest);
 assert.equal(blocked.events[0].status, 403);
 assert.deepEqual(errorSummary(JSON.parse(textOf(blocked)).error), errorSummary(validationError));
 const tosHold = await host.call("fetch", effortRequest("gemini-4-neon", "low", "antigravity#N"));
 assert.equal(tosHold.events[0].status, 403);
 assert.deepEqual(errorSummary(JSON.parse(textOf(tosHold)).error), errorSummary(tosError));
 const otherWireHold = await host.call("fetch", effortRequest("gemini-4-neon", "xhigh", "antigravity#N"));
 assert.equal(otherWireHold.events[0].status, 403);
 assert.match(JSON.parse(textOf(otherWireHold)).error.message, /Terms of Service/);
 assert.doesNotMatch(textOf(otherWireHold), /Please submit an appeal/);
 const forbiddenCatalog = await host.call("fetch", effortRequest("gemini-3.7-flash", undefined, "antigravity#F"));
 assert.equal(forbiddenCatalog.events[0].status, 403);
 assert.match(JSON.parse(textOf(forbiddenCatalog)).error.message, /denied access.*quota catalog/);
 assert.equal(generationCalls().length, beforeBlocked);

 const hostHealth=JSON.parse(readFileSync(join(home,"pi/antigravity-checkpoints.json"),"utf8"));const protections=Object.values(hostHealth.families)as any[];assert(protections.filter(r=>r.consumerHealth?.lastFailure?.kind==="quota").length>=2);assert(protections.some(r=>r.consumerHealth?.lastFailure?.status===429));
 await host.call("usage",{provider:"antigravity",account:"antigravity#X"});
 const upstreamText = /fixture-secret-1234|fixture-verification-url|Gemini model quota exhausted for this subscription|Verify your Google account before continuing|Please submit an appeal/;
 assert.doesNotMatch(readFileSync(join(home, "pi/antigravity-checkpoints.json"), "utf8"), upstreamText);
 assert.doesNotMatch(readFileSync(authPath, "utf8"), upstreamText);
 await host.close();host=start();await host.init();
 const durable=await host.call("fetch",{...fetchRequest("fixture"),account:"antigravity#X"});assert.equal(durable.events[0].status,429,"usage refresh/restart must retain the failure fence");
 const durableError = JSON.parse(textOf(durable)).error;
 assert.equal(durableError.code, 429);
 assert.equal(durableError.status, "RESOURCE_EXHAUSTED");
 assert.match(durableError.message, /quota/i);
 assert(retryAfter(durable) > 0 && retryAfter(durable) <= heldRetry);
 const durableBlocked = await host.call("fetch", validationRequest);
 assert.equal(durableBlocked.events[0].status, 403);
 const durableValidation = JSON.parse(textOf(durableBlocked)).error;
 assert.equal(durableValidation.code, 403);
 assert.equal(durableValidation.status, "PERMISSION_DENIED");
 assert.match(durableValidation.message, /verif|validat/i);
 const durableTos = await host.call("fetch", effortRequest("gemini-4-neon", "xhigh", "antigravity#N"));
 assert.equal(durableTos.events[0].status, 403);
 assert.match(JSON.parse(textOf(durableTos)).error.message, /Terms of Service/);
 assert.equal(generationCalls().length, beforeBlocked);
 assert(!existsSync(join(home,"pi","antigravity-accounts.json")),"native provider must not write Pi's account registry");
 const hanging=await host.call("fetch",fetchRequest("fixture-hang"),true);assert(hanging.aborted);
 await new Promise(resolve=>setTimeout(resolve,100));
 const requests=readFileSync(calls,"utf8").trim().split("\n").map(x=>JSON.parse(x));assert(requests.some(x=>x.method==="fixture-aborted"));
 assert.equal(requests.filter(x=>x.method==="streamGenerateContent").length,10,"ten distinct SSE scenarios must each dispatch exactly once (no replay)");
 console.log("PASS real Magpie Gemini transport: stream/nonstream, tool restoration, account rejection, structured errors without replay and abort");
 const r=await host.call("check",{provider:"antigravity",account:"antigravity#R"});assert(r.models.length>0);assert.equal(JSON.parse(readFileSync(authPath,"utf8"))["antigravity#R"].subject,"subject:R");
 assert.match(JSON.parse(readFileSync(authPath,"utf8"))["antigravity#R"].refresh,/rotated/);
 console.log("PASS real host expired-token refresh retains verified account and rotated credential");
 const login=await host.call("authorize",{provider:"antigravity",method:1,account:"antigravity"});assert(login.ok);assert.equal(login.method,"code");
 const loginUrl=new URL(login.url);const callback=new URL(loginUrl.searchParams.get("redirect_uri")!);callback.searchParams.set("code","fixture-A-code");callback.searchParams.set("state",loginUrl.searchParams.get("state")!);
 const signed=await host.call("callback",{session:login.session,code:callback.toString()});assert(signed.ok,JSON.stringify(signed));
 const relogin=await host.call("check",{provider:"antigravity"});assert.deepEqual(relogin.models,a.models);assert.equal(relogin.usage.windows[0].used,0);
 const automatic=await host.call("authorize",{provider:"antigravity",method:0,account:"antigravity"});assert.equal(automatic.method,"auto");const au=new URL(automatic.url);const loopback=new URL(au.searchParams.get("redirect_uri")!);assert.equal(loopback.hostname,"127.0.0.1");loopback.searchParams.set("code","fixture-A-code");loopback.searchParams.set("state",au.searchParams.get("state")!);const autoResult=host.call("callback",{session:automatic.session});await new Promise<void>((resolve,reject)=>{get(loopback,res=>{assert.equal(res.statusCode,200);res.resume();res.once("end",resolve);}).once("error",reject);});assert((await autoResult).ok);
 const bad=await host.call("authorize",{provider:"antigravity",method:1,account:"antigravity"});const badUrl=new URL(bad.url);const badCallback=new URL(badUrl.searchParams.get("redirect_uri")!);badCallback.searchParams.set("code","fixture-A-code");badCallback.searchParams.set("state","wrong-state");await assert.rejects(host.call("callback",{session:bad.session,code:badCallback.toString()}));
 assert.equal(JSON.parse(readFileSync(authPath,"utf8")).antigravity.subject,"subject:A");
 console.log("PASS real host OAuth re-login -> model/usage refresh, failed state leaves prior verified account intact");
 const simultaneous=await Promise.all([host.call("usage",{provider:"antigravity"}),host.call("usage",{provider:"antigravity",account:"antigravity#B"})]);assert.equal(simultaneous[0].windows[0].used,0);assert.equal(simultaneous[1].windows[0].used,100);
 const removalRace=host.call("usage",{provider:"antigravity",account:"antigravity#D"});await new Promise(r=>setTimeout(r,50));await host.call("take",{provider:"antigravity",accounts:["antigravity#D"]});await removalRace;assert(!JSON.parse(readFileSync(authPath,"utf8"))["antigravity#D"]);
 console.log("PASS concurrent native usage isolation and deletion fence: in-flight synchronization cannot resurrect account");

 const [provider] = await host.call("providers", {});
 const flashModels = provider.models.filter(({id}) => id.startsWith("gemini-3.7-flash"));
 assert.deepEqual(flashModels.map(({id, variants}) => ({id, variants})), [
  {id: "gemini-3.7-flash", variants: ["low", "medium", "high"]},
 ]);
 assert.equal(flashModels[0].reasoning, true);
 const neonModels = provider.models.filter(({id}) => id.startsWith("gemini-4-neon"));
 assert.deepEqual(neonModels.map(({id, name, variants}) => ({id, name, variants})), [
  {id: "gemini-4-neon", name: "Gemini 4 Neon", variants: ["low", "xhigh"]},
 ]);
 const neonAccount = provider.accounts.find(({key}) => key === "antigravity#N");
 assert.deepEqual(new Set(neonAccount?.models), new Set(["gemini-4-neon", "claude-opus-5-5"]));
 console.log("PASS native effort catalog advertises each model once with the account's observed variants");
 console.log("PASS 12 real-host/Pi-loader integration groups (offline, synthetic auth)");
}finally{await host.close();}
