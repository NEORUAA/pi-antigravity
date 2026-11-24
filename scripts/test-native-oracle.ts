import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {normalizeNativeGeminiRequest,unwrapNative,rewriteJSONModeFrame,nativeTerminal,nativeCountTokensRequest}from "../src/compat/native-gemini.js";
import {resolveCodexModel}from "../src/compat/catalog.js";
import {rememberRawJSON}from "../src/compat/json-raw.js";
import {consumerEvents}from "../src/client/consumer-sse.js";
import {observeConsumerDocument}from "../src/client/codex-transport.js";
process.env.ANTIGRAVITY_EXPOSE_THOUGHTS="1";
const vectors=JSON.parse(readFileSync("scripts/fixtures/native-oracle.json","utf8"));let n=0;const failures=[];
for(const {input:i,expected:e}of vectors){let actual;try{
 if(i.kind==="request"){const request=structuredClone(i.request);const wire=resolveCodexModel(i.model)?.wire??i.model;const reverse=normalizeNativeGeminiRequest(request,i.model,wire);delete request.sessionId;actual={request,wire,reverse:Object.keys(reverse).length?reverse:null};}
 if(i.kind==="count"){const request=structuredClone(i.request),wire=resolveCodexModel(i.model)?.wire??i.model;normalizeNativeGeminiRequest(request,i.model,wire);actual={document:nativeCountTokensRequest(request,wire),wire};}
 if(i.kind==="response")actual=unwrapNative(JSON.parse(i.raw),i.reverse??{},true);
 if(i.kind==="json"){const frame=rememberRawJSON(JSON.parse(i.raw),i.raw),state={toolCalled:i.mode};rewriteJSONModeFrame(frame,state);actual={document:frame,called:state.toolCalled};}
 if(i.kind==="stream"){const events=[];let error="",terminal=false;try{for await(const d of consumerEvents(new Response(i.raw))){let p=d;while(p.response&&typeof p.response==="object")p=p.response;observeConsumerDocument("oracle-synthetic-access","oracle-model",p,false);terminal||=nativeTerminal(p);events.push(unwrapNative(d,{}));}if(!terminal)throw Error("unexpected EOF");}catch(err){error=String(err);}actual={events,error:!!error};assert.equal(actual.error,!!e.error);actual.error=e.error;}
 assert.deepEqual(actual,e);n++;
 }catch(err){failures.push({input:i,error:String(err),actual,expected:e});}}
if(failures.length){await import("node:fs").then(fs=>{fs.mkdirSync(".cache",{recursive:true});fs.writeFileSync(".cache/native-diff.json",JSON.stringify(failures,null,2));});throw Error(`${failures.length} / ${vectors.length} original-Go native vectors differ; .cache/native-diff.json`);}
console.log(`${n} original-Go native request/response/stream vectors passed`);
