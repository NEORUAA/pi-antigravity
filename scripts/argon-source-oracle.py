#!/usr/bin/env python3
"""Offline original-Go quota coverage oracle, not a TS-derived UI expectation."""
import hashlib,json,os,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
SOURCE=Path(sys.argv[1]).resolve();PIN="d8e1981f1cc13d0b00fb4d4354e9c8777392319e"
assert subprocess.check_output(["git","-C",str(SOURCE),"rev-parse","HEAD"],text=True).strip()==PIN
cache=ROOT/".cache/argon-oracle";cache.mkdir(parents=True,exist_ok=True)
files={n:(SOURCE/"auth"/n).read_text() for n in ["antigravity_types.go","antigravity_client.go","antigravity_quota_family.go"]}
def extract(file,decl):
 s=files[file];start=s.index(decl);return s[start:s.index("\n}",start)+2]
types=[extract("antigravity_types.go","type "+n+" struct")for n in ["SourceMeta","AntigravityModelQuota","AntigravityQuotaBucket","AntigravityQuotaGroup","AntigravityAICredits","AntigravityQuotaSnapshot"]]
(cache/"types.go").write_text('package main\nimport("time";"strings")\n'+"\n".join(types)+"\n"+extract("antigravity_client.go","func NormalizeAntigravityWindow("))
(cache/"family.go").write_text(files["antigravity_quota_family.go"].replace("package auth","package main",1))
(cache/"main.go").write_text('''package main
import("encoding/json";"os";"bufio")
func main(){s:=bufio.NewScanner(os.Stdin);w:=json.NewEncoder(os.Stdout);for s.Scan(){var in struct{Snapshot *AntigravityQuotaSnapshot `json:"snapshot"`;Model string `json:"model"`};if e:=json.Unmarshal(s.Bytes(),&in);e!=nil{panic(e)};scope,known:=antigravityQuotaScopeForModel(in.Snapshot,in.Model,false);out:=[]bool{};for _,g:=range in.Snapshot.Groups{for _,b:=range g.Buckets{out=append(out,known&&scope(b))}};w.Encode(out)}}
''')
env={**os.environ,"GOCACHE":str(ROOT/".cache/go-cache"),"GOPROXY":"off","GOSUMDB":"off","GOTOOLCHAIN":"local","GO111MODULE":"off","CGO_ENABLED":"0"}
subprocess.run(["go","build","-o",str(cache/"oracle"),str(cache/"main.go"),str(cache/"types.go"),str(cache/"family.go")],env=env,check=True)
inputs=[]
for buckets in [[("gemini-5h","5h"),("3p-weekly","weekly")],[("gemini-5h","5h"),("gemini-argon-weekly","weekly"),("3p-5h","5h")],[("gemini-5h","5h"),("gemini-argon-daily","daily")],[("3p-5h","5h"),("unknown","weekly")],[]]:
 for model in ["gemini-4-argon-low","models/GEMINI-4-ARGON-HIGH","gemini-3.7-flash-low","claude-sonnet-4-6","gpt-oss-120b-medium","unknown"]:
  inputs.append({"snapshot":{"quota_groups":[{"display_name":"Unrelated translated label","buckets":[{"bucket_id":id,"window":window}for id,window in buckets]}]},"model":model})
result=subprocess.run([str(cache/"oracle")],input="".join(json.dumps(x)+"\n"for x in inputs),text=True,capture_output=True,check=True)
outputs=[json.loads(x)for x in result.stdout.splitlines()];assert len(inputs)==len(outputs)
(ROOT/"scripts/fixtures/argon-coverage-oracle.json").write_text(json.dumps({"commit":PIN,"sha256":{k:hashlib.sha256(v.encode()).hexdigest()for k,v in files.items()},"vectors":[{"input":i,"expected":o}for i,o in zip(inputs,outputs)]},indent=2)+"\n")
print("PASS original-Go quota coverage vectors:",len(inputs))
# Exercise the projection consumer with real original-Go per-bucket masks.
def group(name,*buckets):return {"displayName":name,"buckets":[{"bucketId":i,"window":w,"remainingFraction":f}for i,w,f in buckets]}
g=("gemini-5h","5h",.8);a=("gemini-argon-weekly","weekly",.7);w=("gemini-weekly","weekly",.6);t=("3p-weekly","weekly",.4);u=("unknown-weekly","weekly",.3)
layouts=[
 ("mixed",[group("Translated shared pool",g,a)]),
 ("same-name-distinct-members",[group("Shared name",g),group("Shared name",a)]),
 ("same-family-multiwindow",[group("Gemini Models",g,w)]),
 ("empty-groups",[group("Gemini Argon Models"),group("Empty"),group("Gemini Models",g)]),
 ("unknown-scope",[group("Gemini Models",u),group("Real summary",g,a)]),
 ("partial",[group("Gemini Models",g)]),
 ("missing-gemini",[group("Claude and GPT Models",t)]),
 ("unrecognized-argon-window",[group("Mixed",g,("gemini-argon-daily","daily",.5))]),
 ("unrecognized-gemini-window",[group("Gemini Models",("gemini-daily","daily",.5))]),
 ("same-name-same-members",[group("Repeated",g),group("Repeated",w)]),
 ("fallback-name-collision",[group("future-model",g)]),
 ("interleaved-same-family",[group("Interleaved",g,a,w)]),
 ("three-families",[group("Mixed three",g,a,t)]),
 ("name-suffix-collision",[group("Shared name",g),group("Shared name",a),group("Shared name · Gemini",t)]),
 ("empty-label",[group("",g,a)]),
 ("repeated-unknown",[group("Unknown",u,u)]),
 ("missing-fraction",[group("Mixed",("gemini-5h","5h",None),a)]),
 ("empty",[]),
]
models=["gemini-3.7-flash-"+x for x in ["low","medium","high"]]+["gemini-4-argon-"+x for x in ["low","medium","high"]]+["claude-sonnet-4-6","future-model"]
queries=[]
for _,groups in layouts:
 snapshot={"quota_groups":[{"display_name":g["displayName"],"buckets":[{"bucket_id":b["bucketId"],"window":b["window"]}for b in g["buckets"]]}for g in groups]}
 for model in models:queries.append({"snapshot":snapshot,"model":model})
r=subprocess.run([str(cache/"oracle")],input="".join(json.dumps(x)+"\n"for x in queries),text=True,capture_output=True,check=True)
masks=[json.loads(x)for x in r.stdout.splitlines()];assert len(masks)==len(queries)
cases=[{"name":name,"groups":groups,"expected":dict(zip(models,masks[i*len(models):(i+1)*len(models)]))}for i,(name,groups)in enumerate(layouts)]
(ROOT/"scripts/fixtures/quota-host-oracle.json").write_text(json.dumps({"commit":PIN,"generator":"scripts/argon-source-oracle.py","uiCoverageAdapter":"known && scope(bucket): unknown model families retain independent Unknown fallback; this is not the gate conservative ScopeAll policy","sourceSHA256":{k:hashlib.sha256(v.encode()).hexdigest()for k,v in files.items()},"cases":cases},indent=2)+"\n")
print("PASS original-Go host projection masks:",len(queries),"across",len(cases),"layouts")
