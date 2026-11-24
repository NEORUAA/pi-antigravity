/** Cross-platform fault injection; no real credentials/network. Linux runtime is
 * NOT advertised as a Windows hardware test. Real checkpoint file I/O remains. */
import assert from "node:assert/strict";
import fs from "node:fs";
import {syncBuiltinESMExports}from "node:module";
import {resolve,join,win32}from "node:path";
import {syncCredentialDirectory}from "../src/auth/directory-sync.js";
import {beginCredentialFlight,checkpointRotation,validatedCredential}from "../src/auth/checkpoint.js";
const error=(code:string)=>Object.assign(new Error(`synthetic ${code}`),{code});let n=0;
function unit(platform:NodeJS.Platform,stage:string,code:string,allowed:boolean){let closed=0,warned=0;const ops={open:()=>{if(stage==="open")throw error(code);return 42;},sync:()=>{if(stage==="sync")throw error(code);},close:()=>{closed++;},warn:()=>{warned++;}};if(allowed){assert.equal(syncCredentialDirectory("C:\\fixture\\pi",ops,platform),"unsupported");assert.equal(warned,1);}else{assert.throws(()=>syncCredentialDirectory("/synthetic",ops,platform),e=>e.code===code);assert.equal(warned,0);}assert.equal(closed,stage==="open"?0:1);n++;}
for(const platform of ["win32","linux","darwin"]as const)for(const code of ["EPERM","EACCES","EIO","ENOSPC","EROFS","EBADF","EINVAL","ENOTSUP","ENOSYS"]){unit(platform,"sync",code,["EINVAL","ENOTSUP","ENOSYS"].includes(code)||(platform==="win32"&&code==="EPERM"));unit(platform,"open",code,platform==="win32"&&["EPERM","EINVAL","ENOTSUP","ENOSYS"].includes(code));}
fs.mkdirSync(resolve(".cache"),{recursive:true});const dir=fs.mkdtempSync(resolve(".cache/directory-durability-"));process.env.PI_CODING_AGENT_DIR=dir;
const initial={access:"synthetic-durability-access",refresh:"synthetic-durability-refresh",expires:1};const rotated={access:"synthetic-durability-rotated",refresh:"synthetic-durability-new-refresh",expires:9999999999999};
const original={sync:fs.fsyncSync,rename:fs.renameSync,open:fs.openSync,write:fs.writeFileSync,chmod:fs.chmodSync};const target=join(dir,"antigravity-checkpoints.json");
const flight=beginCredentialFlight(initial);const before=fs.readFileSync(target,"utf8");
try{
 for(const code of ["EPERM","EACCES","ENOSPC","EIO"]){fs.fsyncSync=fd=>{if(!fs.fstatSync(fd).isDirectory())throw error(code);return original.sync(fd);};syncBuiltinESMExports();assert.throws(()=>checkpointRotation(flight,rotated),e=>e.code===code);assert.equal(fs.readFileSync(target,"utf8"),before,"failed file fsync must not replace checkpoint");assert(!fs.readdirSync(dir).some(n=>n.endsWith(".tmp")));n++;}
 fs.fsyncSync=original.sync;
 for(const operation of ["rename","write","open","chmod"]){for(const code of ["EPERM","ENOSPC","EIO"]){let saved:string|undefined;const patch=()=>{if(operation==="rename")fs.renameSync=()=>{throw error(code)};if(operation==="write")fs.writeFileSync=()=>{throw error(code)};if(operation==="open")fs.openSync=()=>{throw error(code)};if(operation==="chmod")fs.chmodSync=()=>{throw error(code)};};patch();syncBuiltinESMExports();assert.throws(()=>checkpointRotation(flight,rotated),e=>e.code===code);Object.assign(fs,{fsyncSync:original.sync,renameSync:original.rename,openSync:original.open,writeFileSync:original.write,chmodSync:original.chmod});syncBuiltinESMExports();if(operation==="chmod"){saved=fs.readFileSync(target,"utf8");assert.equal(Object.values(JSON.parse(saved).families)[0].state,"pending");}else assert.equal(fs.readFileSync(target,"utf8"),before);original.write(target,before,{mode:0o600});n++;}}
 // Unsupported directory fsync only: actual file fsync/rename still run. The
 // durable pending tuple is recoverable, never usable before verification.
 let fileFlushes=0,directoryAttempts=0;fs.fsyncSync=fd=>{if(fs.fstatSync(fd).isDirectory()){directoryAttempts++;throw error("ENOTSUP");}fileFlushes++;original.sync(fd);};syncBuiltinESMExports();checkpointRotation(flight,rotated);assert.equal(fileFlushes,1);assert.equal(directoryAttempts,1);const data=JSON.parse(fs.readFileSync(target,"utf8"));const record=Object.values(data.families)[0];assert.equal(record.state,"pending");assert.equal(record.credentials.refresh,rotated.refresh);assert.throws(()=>validatedCredential(rotated),/pending/);assert.equal(fs.statSync(target).mode&0o777,0o600);n++;
 assert.equal(win32.dirname(win32.join("C:\\Users\\fixture", ".pi", "agent", "antigravity-checkpoints.json")),"C:\\Users\\fixture\\.pi\\agent");
}finally{Object.assign(fs,{fsyncSync:original.sync,renameSync:original.rename,openSync:original.open,writeFileSync:original.write,chmodSync:original.chmod});syncBuiltinESMExports();}
console.log(`PASS ${n} directory/file durability fault cases, mandatory file sync/rename/permissions and recoverable pending rotation`);
