import {mock} from "bun:test";
import * as undici from "undici";
import {execFileSync} from "node:child_process";
import {mkdirSync,mkdtempSync,readFileSync} from "node:fs";
import {resolve,join}from "node:path";
import assert from "node:assert/strict";
mkdirSync(resolve(".cache"),{recursive:true});const root=mkdtempSync(resolve(".cache/native-cancel-"));
for(const key of Object.keys(process.env))if(/^(ANTIGRAVITY|NOAGY)_/.test(key))delete process.env[key];
process.env.PI_CODING_AGENT_DIR=join(root,"pi");
process.env.HOME=join(root,"home");
process.env.ANTIGRAVITY_CLIENT_ID="fixture-client.apps.googleusercontent.com";
process.env.ANTIGRAVITY_CLIENT_SECRET="fixture-public-client";
process.env.ANTIGRAVITY_COMPAT_PROFILE="codex";
let captured:any, responseMode="normal",calls:string[]=[],upstreamCancelled=false;
const records:any[]=[];const unhandled:unknown[]=[];const onUnhandled=(e:unknown)=>unhandled.push(e);process.on("unhandledRejection",onUnhandled);
globalThis.fetch=async (input:any,init:any={})=>{
 const u=new URL(typeof input==="string"?input:input.url);calls.push(u.pathname);
 if(u.hostname==="www.googleapis.com"&&u.pathname==="/oauth2/v2/userinfo")return Response.json({id:"audit-subject",email:"audit@example.invalid",verified_email:true});
 if(!new Set(["cloudcode-pa.googleapis.com","daily-cloudcode-pa.googleapis.com","daily-cloudcode-pa.sandbox.googleapis.com"]).has(u.hostname))throw Error("OFFLINE: unexpected endpoint");
 const rpc=u.pathname.split(":").pop();
 if(rpc==="loadCodeAssist")return Response.json({cloudaicompanionProject:"audit-project",currentTier:{id:"test-plan"}});
 if(rpc==="fetchAvailableModels")return Response.json({models:{"gemini-3.7-flash-tiered":{quotaInfo:{remainingFraction:1}}}});
 if(rpc==="retrieveUserQuotaSummary")return Response.json({groups:[{displayName:"Gemini Models",buckets:[{bucketId:"fixture-5h",window:"5h",remainingFraction:1,resetTime:new Date(Date.now()+3600000).toISOString()}]}]});
 if(rpc==="generateContent"||rpc==="streamGenerateContent"){
  captured=JSON.parse(init.body);
  const chunk={response:{candidates:[{content:{role:"model",parts:[{text:"partial answer"} ]},...(responseMode==="truncated"?{}:{finishReason:"STOP"})}],cpaUsageMetadata:{promptTokenCount:11,candidatesTokenCount:7,totalTokenCount:18}}};
  if(responseMode==="hanging"||responseMode==="silent"||responseMode==="network-before"){
   const mode=responseMode,entry:any={signal:init.signal,cancelled:0,mode};
   const body=new ReadableStream({start(c){entry.controller=c;if(mode==="network-before")c.error(Error("synthetic network failure"));else if(mode!=="silent")c.enqueue(new TextEncoder().encode("data: "+JSON.stringify(chunk)+"\n\n"));},cancel(){upstreamCancelled=true;entry.cancelled++;}});
   entry.body=body;records.push(entry);return new Response(body,{headers:{"Content-Type":"text/event-stream"}});
  }
  if(rpc==="generateContent")return Response.json(chunk);
  const response=new Response(responseMode==="empty"?"":"data: "+JSON.stringify(chunk)+"\n\n",{headers:{"Content-Type":"text/event-stream"}});records.push({body:response.body,signal:init.signal,mode:responseMode});return response;
 }
 throw Error("OFFLINE: unexpected RPC "+rpc);
};
mock.module("undici",()=>({...undici,fetch:globalThis.fetch}));
const {default:plugin}=await import("../src/magpie.ts");
let stored:any={type:"oauth",access:"audit-synthetic-access",refresh:"audit-synthetic-refresh",expires:Date.now()+3600000};
const hooks=await plugin({client:{auth:{set:async({body}:any)=>{stored=structuredClone(body);}}}});
const loader=await hooks.auth.loader(async()=>structuredClone(stored));
async function run(request:any,stream=false){const r=await loader.fetch(`https://antigravity.invalid/v1beta/models/gemini-3.7-flash-high:${stream?"streamGenerateContent":"generateContent"}`,{method:"POST",body:JSON.stringify(request)});let output:any,failed=false;try{output=await r.text()}catch(e){failed=true;output=String(e)};return {status:r.status,request:structuredClone(captured.request),output,failed};}


const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function within<T>(promise:Promise<T>,message:string):Promise<T>{let timer;try{return await Promise.race([promise,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error(message)),500);})]);}finally{clearTimeout(timer);}}
const req=(signal?:AbortSignal)=>loader.fetch("https://antigravity.invalid/v1beta/models/gemini-3.7-flash-high:streamGenerateContent",{method:"POST",signal,body:JSON.stringify({contents:[{role:"user",parts:[{text:"cancel-test"}]}]})});
const watch=()=>{const controller=new AbortController();let listeners=0;const signal=controller.signal,add=signal.addEventListener.bind(signal),remove=signal.removeEventListener.bind(signal);signal.addEventListener=((type,...args)=>{if(type==="abort")listeners++;return add(type,...args);})as typeof signal.addEventListener;signal.removeEventListener=((type,...args)=>{if(type==="abort")listeners--;return remove(type,...args);})as typeof signal.removeEventListener;return{controller,signal,count:()=>listeners};};
const generations=()=>calls.filter(p=>/:(?:generateContent|streamGenerateContent)$/.test(p)).length;
let cases=0;
try{
 for(const watchdog of ["on","off"]){process.env.ANTIGRAVITY_STREAM_HEADER_TIMEOUT_MS=watchdog==="off"?"0":"180000";process.env.ANTIGRAVITY_STREAM_STALL_TIMEOUT_MS=watchdog==="off"?"0":"300000";
  for(const beforeRead of [true,false]){
   responseMode="hanging";upstreamCancelled=false;const external=watch(),before=generations(),r=await req(external.signal),entry=records.at(-1);const reader=r.body!.getReader();if(!beforeRead){await reader.read();await sleep(20);}
   await within(reader.cancel("synthetic body-only stop"),"body.cancel did not interrupt silent pending next");await sleep(0);
   assert(!external.signal.aborted,"do not substitute external abort for body.cancel");assert(entry.signal.aborted);assert.equal(entry.cancelled,1);assert(!entry.body.locked,"upstream reader lock must be released");assert.equal(external.count(),0);assert.equal(generations()-before,1,"no cancellation retry/replay");reader.releaseLock();cases++;
  }
  // No downstream body exists until the initial error/status peek resolves.
  // Before the FIRST UPSTREAM frame the supported cancellation is caller signal.
  responseMode="silent";const external=watch(),start=records.length,before=generations(),pending=req(external.signal);const rejected=assert.rejects(pending,/synthetic first-frame abort/);while(records.length===start)await sleep(1);external.controller.abort(Error("synthetic first-frame abort"));await within(rejected,"initial silent read did not abort");const entry=records.at(-1);assert.equal(entry.cancelled,1);assert(!entry.body.locked);assert.equal(external.count(),0);assert.equal(generations()-before,1);cases++;
 }
 // Original independent counterexample, with watchdogs enabled, no external abort.
 process.env.ANTIGRAVITY_STREAM_HEADER_TIMEOUT_MS="180000";process.env.ANTIGRAVITY_STREAM_STALL_TIMEOUT_MS="300000";responseMode="hanging";const caller=watch(),r=await req(caller.signal),reader=r.body!.getReader();await reader.read();await sleep(20);await within(reader.cancel(),"independent original cancel repro");assert(!caller.signal.aborted);assert.equal(records.at(-1).cancelled,1);assert.equal(caller.count(),0);reader.releaseLock();cases++;
 for(const beforeFirst of [true,false]){
  responseMode=beforeFirst?"network-before":"hanging";const caller=watch(),before=generations(),r=await req(caller.signal),entry=records.at(-1);
  if(beforeFirst){assert.equal(r.status,502);await r.text();}else{const reader=r.body!.getReader();await reader.read();entry.controller.error(Error("synthetic network failure"));await assert.rejects(within(reader.read(),"network failure stalled"),/synthetic network failure/);reader.releaseLock();}
  assert(!entry.body.locked);assert.equal(caller.count(),0);assert.equal(generations()-before,1);cases++;
 }
 responseMode="normal";const finished=watch(),before=generations(),complete=await req(finished.signal);const completedReader=complete.body!.getReader();let completedText="";for(;;){const part=await completedReader.read();if(part.done)break;completedText+=new TextDecoder().decode(part.value);}assert.match(completedText,/STOP/);assert(!records.at(-1).body.locked);assert.equal(finished.count(),0);assert.equal(generations()-before,1);await completedReader.cancel();completedReader.releaseLock();assert(!finished.signal.aborted);cases+=2;
 responseMode="empty";const emptyCaller=watch(),empty=await req(emptyCaller.signal);await assert.rejects(empty.text(),/unexpected EOF/);assert(!records.at(-1).body.locked);assert.equal(emptyCaller.count(),0);cases++;
 responseMode="hanging";const aborted=watch(),abortedResponse=await req(aborted.signal),abortedEntry=records.at(-1),ar=abortedResponse.body!.getReader();await ar.read();aborted.controller.abort(Error("synthetic caller abort"));await assert.rejects(within(ar.read(),"caller abort stalled"),/synthetic caller abort/);assert.equal(aborted.count(),0);assert(!abortedEntry.body.locked);ar.releaseLock();cases++;

 responseMode="hanging";const unreadCaller=watch(),unread=await req(unreadCaller.signal),unreadEntry=records.at(-1);unreadCaller.controller.abort(Error("abort before downstream first read"));const unreadReader=unread.body!.getReader();await assert.rejects(unreadReader.read(),/abort before downstream first read/);await sleep(0);assert(!unreadEntry.body.locked);assert.equal(unreadCaller.count(),0);unreadReader.releaseLock();cases++;
 const already=watch();already.controller.abort(Error("already cancelled"));const prior=generations();await assert.rejects(req(already.signal),/already cancelled/);assert.equal(generations(),prior);assert.equal(already.count(),0);cases++;
 // Two concurrent requests: body.cancel must not abort the other's identity/stream.
 responseMode="hanging";const a=watch(),b=watch(),ra=await req(a.signal),ea=records.at(-1),rb=await req(b.signal),eb=records.at(-1);const readA=ra.body!.getReader();await readA.read();await readA.cancel();assert(ea.signal.aborted);assert(!eb.signal.aborted);eb.controller.close();assert.match(await rb.text(),/partial answer/);assert(!ea.body.locked&&!eb.body.locked);assert.equal(a.count()+b.count(),0);readA.releaseLock();cases++;

 const journal=JSON.parse(readFileSync(join(root,"pi","antigravity-checkpoints.json"),"utf8"));assert(Object.values(journal.families).every((r:any)=>!r.consumerHealth?.lastFailure),"cancellation/network read failures must not become auth/quota penalties");
 const saved=stored;stored=undefined;const noAuthCalls=generations();const signedOut=await req();assert.equal(signedOut.status,502);assert.match(await signedOut.text(),/OAuth sign-in/);assert.equal(generations(),noAuthCalls,"retained checkpoint alone cannot authorize a stale native loader");stored=saved;cases++;
 await sleep(20);assert.deepEqual(unhandled,[],"no unhandled rejection after cancel/finish/error");
 console.log(`PASS ${cases} native cancellation cases: independent body.cancel-only, before downstream read, silent upstream, watchdog on/off, network failure, finish, caller abort, isolation, no replay, locks/listeners`);
}finally{process.removeListener("unhandledRejection",onUnhandled);}
