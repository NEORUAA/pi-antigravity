import assert from "node:assert/strict";
import {spawn,execFileSync} from "node:child_process";
import {writeFileSync,mkdirSync,mkdtempSync,readFileSync} from "node:fs";
import {resolve,join} from "node:path";
import {createInterface} from "node:readline";
const root=process.cwd();mkdirSync(resolve(".cache"),{recursive:true});const temp=mkdtempSync(resolve(".cache/native-quota-"));
mkdirSync(temp,{recursive:true});const home=join(temp,"home");mkdirSync(home,{recursive:true});
const authPath=join(temp,"plugin-auth.json"),calls=join(temp,"calls.jsonl");
writeFileSync(authPath,JSON.stringify(Object.fromEntries(["A","B","C"].map(t=>[t==="A"?"antigravity":"antigravity#"+t,{type:"oauth",access:"fixture-"+t,refresh:"fixture-"+t+"-refresh",expires:Date.now()+3600000}]))));
const syntheticEnv={...Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith("ANTIGRAVITY_")&&!k.startsWith("NOAGY_"))),ANTIGRAVITY_CLIENT_ID:"fixture-client.apps.googleusercontent.com",ANTIGRAVITY_CLIENT_SECRET:"fixture-public-client"};
const bun=execFileSync("bun",["-p","process.execPath"],{encoding:"utf8"}).trim();
function start(){
 const child=spawn(bun,["--preload",resolve("scripts/native-quota-preload.mjs"),resolve("scripts/fixtures/magpie-host/host.js")],{cwd:root,env:{...syntheticEnv,NODE_OPTIONS:"",HOME:home,PI_CODING_AGENT_DIR:join(home,"pi"),ANTIGRAVITY_COMPAT_PROFILE:"codex",NOAGY_COMPAT_PROFILE:"codex",MAGPIE_FIXTURE_CALLS:calls,MAGPIE_FIXTURE_RECOVER:join(temp,"recover-T")},stdio:["pipe","pipe","pipe"]});
 const pending=new Map<number,{resolve:(x:any)=>void;reject:(e:Error)=>void;events:any[];abortOnChunk?:boolean}>();let id=0,err="";
 child.stderr.on("data",b=>{err+=String(b)});
 createInterface({input:child.stdout}).on("line",line=>{const m=JSON.parse(line),p=pending.get(m.id);if(!p)return;if(m.event){p.events.push(m);if(m.event==="chunk"&&p.abortOnChunk){child.stdin.write(JSON.stringify({method:"abort",params:{id:m.id}})+"\n");pending.delete(m.id);p.resolve({events:p.events,aborted:true});}return;}if(m.error){pending.delete(m.id);if(p.events.length)p.resolve({events:p.events,error:m.error.message});else p.reject(new Error(m.error.message+"; host stderr: "+err));}else if("result" in m){pending.delete(m.id);p.resolve(p.events.length?{events:p.events,result:m.result}:m.result);}});
 child.on("exit",code=>{for(const p of pending.values())p.reject(new Error("host exited "+code+": "+err));});
 const call=(method:string,params:unknown,abortOnChunk=false)=>new Promise<any>((res,rej)=>{const n=++id;const timer=setTimeout(()=>{pending.delete(n);rej(new Error("host RPC timeout: "+method+" "+err));},20000);pending.set(n,{events:[],abortOnChunk,resolve:x=>{clearTimeout(timer);res(x)},reject:e=>{clearTimeout(timer);rej(e)}});child.stdin.write(JSON.stringify({id:n,method,params})+"\n");});
 return{child,call,async init(){const r=await call("init",{authPath,directory:temp,piPath:resolve("scripts/fixtures/magpie-host/pi.js"),plugins:[{spec:"fixture-installed-root",target:root}]});assert(!r.plugins[0].error,JSON.stringify(r));},async close(){if(child.exitCode!==null||child.signalCode!==null)return;await new Promise<void>(resolve=>{const timer=setTimeout(()=>{child.kill();resolve()},2000);child.once("exit",()=>{clearTimeout(timer);resolve();});child.stdin.end();});}};
}

import {createHash}from "node:crypto";
import {runInNewContext}from "node:vm";
const ui=readFileSync("scripts/fixtures/magpie-host/ui-quota.js","utf8"),provenance=JSON.parse(readFileSync("scripts/fixtures/magpie-host/ui-provenance.json","utf8"));assert.equal(createHash("sha256").update(ui).digest("hex"),provenance.extractSHA256);
const el=(tag,cls="",text="")=>({tag,cls,text,children:[],style:{},classList:{add(){}},append(...v){this.children.push(...v)}});
const sandbox={el,t:(text,vars={})=>text.replace(/\{(\w+)\}/g,(_,k)=>vars[k]??k),quotaLeft:true,quotaCount:()=>"",capMark:()=>{},intlLang:()=>"en",resetText:()=>"",resetInText:()=>"",runsOutText:()=>"",shortWindow:x=>x,quotaError:x=>x};
const render=runInNewContext(ui+"\n({accountQuota,familyWindows})",sandbox);
const visible=(node)=>[node?.text??"",...(node?.children??[]).flatMap(visible)].filter(Boolean);
const host=start();try{await host.init();const output:any={};for(const tag of ["A","B","C"]){const result=await host.call("check",{provider:"antigravity",...(tag==="A"?{}:{account:"antigravity#"+tag})});output[tag]=result;assert(!result.usage.error);const card=render.accountQuota({account:result.usage},"account");const words=visible(card);const rendered=words.join(" | ");assert(rendered.includes("Gemini"));assert(rendered.includes("claude")||rendered.includes("Claude"),"actual compact card must show Claude, not only tooltip");assert(rendered.includes("GPT")||rendered.includes("gpt"));if(tag==="A"){const windows=render.familyWindows(result.usage.windows);assert.equal(windows.filter(w=>w.window==="5 hours").length,2);assert.equal(windows.filter(w=>w.window==="1 week").length,2);assert.equal(words.filter(w=>w==="5 hours").length,2);assert.equal(words.filter(w=>w==="1 week").length,2);}else{const claude=result.usage.windows.find(w=>w.models?.includes("claude-sonnet-4-6"));assert(claude);assert.equal(claude.pool,"claude-sonnet-4-6");assert.equal(claude.name,"Reported quota");if(tag==="C"){assert.equal(claude.used,null);assert(rendered.includes("Unknown"));}else assert(Math.abs(claude.used-60)<0.0001);const gpt=result.usage.windows.find(w=>w.models?.includes("gpt-oss-120b-medium"));assert.equal(gpt.used,70);}}
 const bad=render.accountQuota({a:{windows:[],error:"Synthetic quota unavailable"}},"a");assert(visible(bad).join().includes("Synthetic quota unavailable"));
 console.log("PASS actual Magpie host→compact UI: both pools/four windows, partial summary backing values, Unknown, account isolation and unavailable");
}finally{await host.close();}
