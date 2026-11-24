// Synthetic endpoints only. Loaded before the unmodified MIT host fixture.
import fs from "node:fs";
import { mock } from "bun:test";
import * as undici from "undici";

// Advance only this isolated host fixture clock past the 30s observation cache.
const fixtureNow=Date.now;
if(process.env.MAGPIE_FIXTURE_ARGON)Date.now=()=>fixtureNow()+(fs.existsSync(process.env.MAGPIE_FIXTURE_ARGON)?31000:0);
const tag=(value)=>/fixture-([A-Z])/.exec(String(value))?.[1]??"A";
globalThis.fetch=async(input,init={})=>{
 const url=new URL(typeof input==="string"?input:input.url??String(input));
 if(url.hostname==="www.googleapis.com" && url.pathname==="/oauth2/v2/userinfo") {const t=tag(JSON.stringify(init.headers));if(t==="D")await new Promise(r=>setTimeout(r,200));return Response.json({id:"subject:"+t,email:t+"@example.invalid",verified_email:t!=="I"},{status:t==="T"&&!fs.existsSync(process.env.MAGPIE_FIXTURE_RECOVER)?503:200});}
 if(url.hostname==="oauth2.googleapis.com" && url.pathname==="/token"){const t=tag(init.body);return Response.json({access_token:"fixture-"+t+"-new",refresh_token:"fixture-"+t+"-rotated",expires_in:3600});}
 const allowed=new Set(["cloudcode-pa.googleapis.com","daily-cloudcode-pa.googleapis.com","daily-cloudcode-pa.sandbox.googleapis.com"]);
 if(!allowed.has(url.hostname))throw new Error("Offline fixture rejected unmocked host");
 const t=tag(new Headers(init.headers).get("authorization"));
 const method=url.pathname.split(":").pop();
 const payload=JSON.parse(init.body??"{}");
 const scenario=JSON.stringify(payload.request?.contents??[]);
 if(process.env.MAGPIE_FIXTURE_CALLS)fs.appendFileSync(process.env.MAGPIE_FIXTURE_CALLS,JSON.stringify({tag:t,method,...(process.env.MAGPIE_FIXTURE_ARGON?{request:payload}: {})})+"\n");
 const json=(x,status=200)=>Response.json(x,{status});
 if(method==="loadCodeAssist")return json({cloudaicompanionProject:"project-"+t,currentTier:{id:"test-plan"},paidTier:{id:"test-plan",availableCredits:[{creditAmount:"12"}]}});
 if(process.env.MAGPIE_FIXTURE_ARGON && method==="fetchAvailableModels")return json({models:{"gemini-4-argon-high":{displayName:"Gemini 4 Argon (High)",quotaInfo:{remainingFraction:0.816}},"gemini-3.7-flash-tiered":{displayName:"Gemini 3.7 Flash (High)",quotaInfo:{remainingFraction:0.7}},"claude-sonnet-4-6":{quotaInfo:t==="C"?{}:{remainingFraction:0.4}},"future-model":{displayName:"Future (High)",quotaInfo:{remainingFraction:0.22}}}});
 if(process.env.MAGPIE_FIXTURE_QUOTA_LAYOUT && method==="fetchAvailableModels")return json({models:{"gemini-3.7-flash-tiered":{displayName:"Gemini 3.7 Flash (High)",quotaInfo:{remainingFraction:.6}},"gemini-4-argon-high":{displayName:"Gemini 4 Argon (High)",quotaInfo:{remainingFraction:.42}},"claude-sonnet-4-6":{displayName:"Claude",quotaInfo:{}},"future-model":{}}});
 if(process.env.MAGPIE_FIXTURE_QUOTA_LAYOUT && method==="retrieveUserQuotaSummary")return json({groups:JSON.parse(fs.readFileSync(process.env.MAGPIE_FIXTURE_QUOTA_LAYOUT,"utf8"))});
 if(method==="fetchAvailableModels")return json({models:{"gemini-3.7-flash-tiered":{quotaInfo:{remainingFraction:1}},"claude-sonnet-4-6":{quotaInfo:t==="C"?{}:{remainingFraction:0.4}},"gpt-oss-120b-medium":{quotaInfo:{remainingFraction:0.3}}}});
 if(method==="retrieveUserQuotaSummary"){
 const bucket=(id,fraction)=>({bucketId:id,window:"5h",remainingFraction:fraction,resetTime:new Date(Date.now()+3600000).toISOString()});
 const argon=process.env.MAGPIE_FIXTURE_ARGON && !fs.existsSync(process.env.MAGPIE_FIXTURE_ARGON);
 return json({groups:[...(argon?[{displayName:"Gemini Argon Models",buckets:[{...bucket("gemini-argon-weekly",0.9),window:"weekly"}]}]:[]),{displayName:"Gemini Models",buckets:[bucket("gemini",1),{...bucket("gemini-week",0.7),window:"weekly"}]},...(t==="A"?[{displayName:"Claude and GPT Models",buckets:[bucket("3p-5h",0.25),{...bucket("3p-weekly",0.5),window:"weekly"}]}]:[])]});
 }
 if(["generateContent","streamGenerateContent"].includes(method)) {
 const event={response:{candidates:[{content:{role:"model",parts:[scenario.includes("fixture-tool")?{functionCall:{name:payload.request.tools[0].functionDeclarations[0].name,args:{value:1}}}:{text:"fixture"}]},finishReason:"STOP"}]}};
 const failure={error:{code:429,status:"RESOURCE_EXHAUSTED",message:"quota exhausted"}};
 if(method==="generateContent")return json(event);
 const frame=x=>'data: '+JSON.stringify(x)+'\n\n';
 if(scenario.includes("fixture-before-error"))return new Response(frame(failure),{headers:{"content-type":"text/event-stream"}});
 if(scenario.includes("fixture-after-error"))return new Response(frame(event)+frame(failure),{headers:{"content-type":"text/event-stream"}});
 if(scenario.includes("fixture-hang")) {
  let clean=()=>{};
  return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(frame(event)));const abort=()=>{try{c.error(new DOMException("Aborted","AbortError"));}catch{};fs.appendFileSync(process.env.MAGPIE_FIXTURE_CALLS,JSON.stringify({tag:t,method:"fixture-aborted"})+"\n");clean();};clean=()=>init.signal?.removeEventListener("abort",abort);init.signal?.addEventListener("abort",abort,{once:true});},cancel(){clean();}}),{headers:{"content-type":"text/event-stream"}});
 }
 return new Response(frame(event),{headers:{"content-type":"text/event-stream"}});
 }
 throw new Error("Offline fixture rejected unmocked RPC");
};

mock.module("undici",()=>({...undici,fetch:globalThis.fetch}));
