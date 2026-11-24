// Synthetic endpoints only. Loaded before the unmodified MIT host fixture.
import fs from "node:fs";
import { mock } from "bun:test";
import * as undici from "undici";

const tag=(value)=>/fixture-([A-Z])/.exec(String(value))?.[1]??"A";
globalThis.fetch=async(input,init={})=>{
 const url=new URL(typeof input==="string"?input:input.url??String(input));
 if(url.hostname==="www.googleapis.com" && url.pathname==="/oauth2/v2/userinfo") {const t=tag(JSON.stringify(init.headers));if(t==="D")await new Promise(r=>setTimeout(r,200));return Response.json({id:"subject:"+t,email:t+"@example.invalid",verified_email:t!=="I"},{status:t==="T"&&!fs.existsSync(process.env.MAGPIE_FIXTURE_RECOVER)?503:200});}
 if(url.hostname==="oauth2.googleapis.com" && url.pathname==="/token"){fs.writeFileSync(process.env.AUDIT_RACE+"/token-started","");for(let i=0;!fs.existsSync(process.env.AUDIT_RACE+"/token-release");i++){if(i>1000)throw Error("fixture timeout");await new Promise(r=>setTimeout(r,5));}const t=tag(init.body);return Response.json({access_token:"fixture-"+t+"-new",refresh_token:"fixture-"+t+"-rotated",expires_in:3600});}
 const allowed=new Set(["cloudcode-pa.googleapis.com","daily-cloudcode-pa.googleapis.com","daily-cloudcode-pa.sandbox.googleapis.com"]);
 if(!allowed.has(url.hostname))throw new Error("Offline fixture rejected unmocked host");
 const t=tag(new Headers(init.headers).get("authorization"));
 const method=url.pathname.split(":").pop();
 const payload=JSON.parse(init.body??"{}");
 const scenario=JSON.stringify(payload.request?.contents??[]);
 if(process.env.MAGPIE_FIXTURE_CALLS)fs.appendFileSync(process.env.MAGPIE_FIXTURE_CALLS,JSON.stringify({tag:t,method})+"\n");
 const json=(x,status=200)=>Response.json(x,{status});
 if(method==="loadCodeAssist")return json({cloudaicompanionProject:"project-"+t,currentTier:{id:"test-plan"},paidTier:{id:"test-plan",availableCredits:[{creditAmount:"12"}]}});
 if(method==="fetchAvailableModels")return json({models:{"gemini-3.7-flash-tiered":{quotaInfo:{remainingFraction:1}},"claude-sonnet-4-6":{quotaInfo:t==="C"?{}:{remainingFraction:0.4}},"gpt-oss-120b-medium":{quotaInfo:{remainingFraction:0.3}}}});
 if(method==="retrieveUserQuotaSummary"){
 const bucket=(id,fraction)=>({bucketId:id,window:"5h",remainingFraction:fraction,resetTime:new Date(Date.now()+3600000).toISOString()});
 return json({groups:[{displayName:"Gemini Models",buckets:[bucket("gemini",1)]},...(t==="A"?[{displayName:"Claude and GPT Models",buckets:[bucket("thirdparty",0.25)]}]:[])]});
 }
 if(["generateContent","streamGenerateContent"].includes(method)) {
 const event={response:{candidates:[{content:{role:"model",parts:[scenario.includes("fixture-tool")?{functionCall:{name:payload.request.tools[0].functionDeclarations[0].name,args:{value:1}}}:{text:"fixture"}]},finishReason:"STOP"}]}};
 const failure={error:{code:429,status:"RESOURCE_EXHAUSTED",message:"quota exhausted"}};
 if(method==="generateContent")return json(event);
 if(scenario.includes("audit-health-race"))return new Response(new ReadableStream({async start(c){c.enqueue(new TextEncoder().encode('data: '+JSON.stringify(event)+'\n\n'));fs.writeFileSync(process.env.AUDIT_RACE+"/sse-started","");for(let i=0;!fs.existsSync(process.env.AUDIT_RACE+"/sse-release");i++){if(i>1000)throw Error("fixture timeout");await new Promise(r=>setTimeout(r,5));}c.enqueue(new TextEncoder().encode('data: '+JSON.stringify(process.env.NATIVE_RACE_KIND==="cooldown"?{error:{code:429,status:"RESOURCE_EXHAUSTED",message:"quota exhausted"}}:{error:{code:403,status:"PERMISSION_DENIED",message:"VALIDATION_REQUIRED"}})+'\n\n'));c.close();}}),{headers:{"Content-Type":"text/event-stream"}});
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
