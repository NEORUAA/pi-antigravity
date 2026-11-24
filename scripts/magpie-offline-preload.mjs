// Synthetic endpoints only. Loaded before the unmodified MIT host fixture.
import fs from "node:fs";
import { mock } from "bun:test";
import * as undici from "undici";

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
 if(process.env.MAGPIE_FIXTURE_CALLS)fs.appendFileSync(process.env.MAGPIE_FIXTURE_CALLS,JSON.stringify({tag:t,method,request:payload.request})+"\n");
 const json=(x,status=200)=>Response.json(x,{status});
 if(method==="loadCodeAssist")return json({cloudaicompanionProject:"project-"+t,currentTier:{id:"test-plan"},paidTier:{id:"test-plan",availableCredits:[{creditAmount:"12"}]}});
 if(method==="fetchAvailableModels"){
  if(t==="F")return json({error:{message:"fixture forbidden"}},403);
  if(t==="E")return json({models:{}});
  const models=t==="B"?{"claude-sonnet-4-6":{quotaInfo:{remainingFraction:0}}}:t==="U"?{"gemini-future-fixture":{quotaInfo:{}}}:{"gemini-3.7-flash-tiered":{quotaInfo:{remainingFraction:1}},"claude-sonnet-4-6":{quotaInfo:{remainingFraction:0.5}},"gemini-9-disabled":{},"chat_20706":{},"tab_fixture":{},"gemini-internal-fixture":{isInternal:true,quotaInfo:{remainingFraction:1}}};
  return json({models});
 }
 if(method==="retrieveUserQuotaSummary")return json({groups:["U","E","F"].includes(t)?[]:[{displayName:t==="B"?"Claude and GPT Models":"Gemini Models",buckets:[{bucketId:"fixture-5h",window:"5h",remainingFraction:t==="B"?0:1,resetTime:new Date(Date.now()+3600000).toISOString()}]}]});
 if(method==="countTokens")return json({response:{totalTokens:23}});
 if(["generateContent","streamGenerateContent"].includes(method)) {
 const event={response:{candidates:[{content:{role:"model",parts:[scenario.includes("fixture-tool")?{functionCall:{name:payload.request.tools[0].functionDeclarations[0].name,args:{value:1}}}:{text:"fixture"}]},finishReason:"STOP"}]}};
 event.response.cpaUsageMetadata={promptTokenCount:11,candidatesTokenCount:7,totalTokenCount:18};
 if(scenario.includes("fixture-partial"))delete event.response.candidates[0].finishReason;
 if(scenario.includes("fixture-prompt-safety")){delete event.response.candidates;event.response.promptFeedback={blockReason:"SAFETY"};}
 const failure={error:{code:429,status:"RESOURCE_EXHAUSTED",message:"quota exhausted"}};

 if(scenario.includes("fixture-json-reject"))return json({error:{message:JSON.stringify({error:{message:'tool_choice: forced tool not supported'}})}},400);
 if(scenario.includes("fixture-json-mode")){const raw='{"response":{"candidates":[{"content":{"parts":[{"text":"not JSON"},{"text":"reason","thought":true},{"functionCall":{"name":"json_mode","args":{"10":1.00,"2":1e3}}}]}}]}}';const finish={response:{candidates:[{finishReason:"OTHER"}]}};if(method==="generateContent")return new Response(raw,{headers:{"content-type":"application/json"}});return new Response('data: '+raw+'\n\n'+'data: '+JSON.stringify(finish)+'\n\n',{headers:{"content-type":"text/event-stream"}});}
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
