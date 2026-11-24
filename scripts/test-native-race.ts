import assert from "node:assert/strict";
import {spawn,execFileSync} from "node:child_process";
import {writeFileSync,mkdirSync,readFileSync,existsSync,mkdtempSync} from "node:fs";
import {resolve,join} from "node:path";
import {createInterface} from "node:readline";
const root=process.cwd();mkdirSync(resolve(".cache"),{recursive:true});const temp=mkdtempSync(resolve(".cache/native-health-"));const kind=process.argv.includes("--scenario")?process.argv.at(-1)!:process.env.NATIVE_RACE_KIND??"validation";
mkdirSync(temp,{recursive:true});const home=join(temp,"home");mkdirSync(home,{recursive:true});
const authPath=join(temp,"plugin-auth.json"),calls=join(temp,"calls.jsonl");
writeFileSync(authPath,JSON.stringify(Object.fromEntries(["A","B","C"].map(t=>[t==="A"?"antigravity":"antigravity#"+t,{type:"oauth",access:"fixture-"+t,refresh:"fixture-"+t+"-refresh",expires:Date.now()+3600000}]))));
const syntheticEnv={...Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith("ANTIGRAVITY_")&&!k.startsWith("NOAGY_"))),NATIVE_RACE_KIND:kind,AUDIT_RACE:temp,ANTIGRAVITY_CLIENT_ID:"fixture-client.apps.googleusercontent.com",ANTIGRAVITY_CLIENT_SECRET:"fixture-public-client"};
const bun=execFileSync("bun",["-p","process.execPath"],{encoding:"utf8"}).trim();
function start(){
 const child=spawn(bun,["--preload",resolve("scripts/native-race-preload.mjs"),resolve("scripts/fixtures/magpie-host/host.js")],{cwd:root,env:{...syntheticEnv,NODE_OPTIONS:"",HOME:home,PI_CODING_AGENT_DIR:join(home,"pi"),ANTIGRAVITY_COMPAT_PROFILE:"codex",NOAGY_COMPAT_PROFILE:"codex",MAGPIE_FIXTURE_CALLS:calls,MAGPIE_FIXTURE_RECOVER:join(temp,"recover-T")},stdio:["pipe","pipe","pipe"]});
 const pending=new Map<number,{resolve:(x:any)=>void;reject:(e:Error)=>void;events:any[];abortOnChunk?:boolean}>();let id=0,err="";
 child.stderr.on("data",b=>{err+=String(b)});
 createInterface({input:child.stdout}).on("line",line=>{const m=JSON.parse(line),p=pending.get(m.id);if(!p)return;if(m.event){p.events.push(m);if(m.event==="chunk"&&p.abortOnChunk){child.stdin.write(JSON.stringify({method:"abort",params:{id:m.id}})+"\n");pending.delete(m.id);p.resolve({events:p.events,aborted:true});}return;}if(m.error){pending.delete(m.id);if(p.events.length)p.resolve({events:p.events,error:m.error.message});else p.reject(new Error(m.error.message+"; host stderr: "+err));}else if("result" in m){pending.delete(m.id);p.resolve(p.events.length?{events:p.events,result:m.result}:m.result);}});
 child.on("exit",code=>{for(const p of pending.values())p.reject(new Error("host exited "+code+": "+err));});
 const call=(method:string,params:unknown,abortOnChunk=false)=>new Promise<any>((res,rej)=>{const n=++id;const timer=setTimeout(()=>{pending.delete(n);rej(new Error("host RPC timeout: "+method+" "+err));},20000);pending.set(n,{events:[],abortOnChunk,resolve:x=>{clearTimeout(timer);res(x)},reject:e=>{clearTimeout(timer);rej(e)}});child.stdin.write(JSON.stringify({id:n,method,params})+"\n");});
 return{child,call,async init(){const r=await call("init",{authPath,directory:temp,piPath:resolve("scripts/fixtures/magpie-host/pi.js"),plugins:[{spec:"fixture-installed-root",target:root}]});assert(!r.plugins[0].error,JSON.stringify(r));},async close(){if(child.exitCode!==null||child.signalCode!==null)return;await new Promise<void>(resolve=>{const timer=setTimeout(()=>{child.kill();resolve()},2000);child.once("exit",()=>{clearTimeout(timer);resolve();});child.stdin.end();});}};
}

const wait=async(name:string)=>{for(let i=0;!existsSync(join(temp,name));i++){if(i>1000)throw Error("fixture wait timeout "+name);await new Promise(r=>setTimeout(r,5));}};
const host=start();try{
 await host.init();await host.call("check",{provider:"antigravity"});
 const request={provider:"antigravity",model:"gemini-3.7-flash-low",npm:"@ai-sdk/google",url:"https://antigravity.invalid/v1beta/models/gemini-3.7-flash-low:streamGenerateContent",method:"POST",body:Buffer.from(JSON.stringify({contents:[{role:"user",parts:[{text:"audit-health-race"}]}]})).toString("base64")};
 const flight=host.call("fetch",request);await wait("sse-started");
 const before=JSON.parse(readFileSync(authPath,"utf8")).antigravity;
 await host.call("import",{provider:"antigravity",key:"antigravity",auth:{...before,expires:1}});
 const renewal=host.call("keepSignedIn",{provider:"antigravity"});await wait("token-started");
 writeFileSync(join(temp,"sse-release"),"");const failed=await flight;
 const fenced=JSON.parse(readFileSync(authPath,"utf8")).antigravity;
 if(kind==="delete")await host.call("signOut",{provider:"antigravity",account:"antigravity"});
 writeFileSync(join(temp,"token-release"),"");const renewed=await renewal;
 const after=JSON.parse(readFileSync(authPath,"utf8")).antigravity;
 if(kind==="delete"){assert.equal(after,undefined,"unmodified host must not resurrect deleted account after refresh");console.log("PASS actual host deletion during renewal");}
 else{
 const status=kind==="cooldown"?429:403;
 const ordinary={...request,body:Buffer.from(JSON.stringify({contents:[{role:"user",parts:[{text:"ordinary after protection fence"}]}]})).toString("base64")};
 const again=await host.call("fetch",ordinary);assert.equal(again.events?.[0]?.status,status);
 // An actual host metadata save can land even later with no consumerHealth.
 const {consumerHealth:_removed,...withoutHealth}=after;
 await host.call("import",{provider:"antigravity",key:"antigravity",auth:withoutHealth});
 assert.equal((await host.call("fetch",ordinary)).events?.[0]?.status,status,"late host metadata save cannot erase canonical health");
 await host.close();const restarted=start();try{await restarted.init();assert.equal((await restarted.call("fetch",ordinary)).events?.[0]?.status,status,"protection survives actual process restart");}finally{await restarted.close();}
 const journal=JSON.parse(readFileSync(join(home,"pi/antigravity-checkpoints.json"),"utf8"));const records=Object.values(journal.families)as any[];assert(records.some(r=>kind==="cooldown"?Object.keys(r.consumerHealth?.cooldowns??{}).length:r.consumerHealth?.blockedReason==="VALIDATION_REQUIRED"));
 console.log(`PASS actual host ${kind}: concurrent refresh, late metadata save, restart (${status})`);
 }
}finally{await host.close();}
