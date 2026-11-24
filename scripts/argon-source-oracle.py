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
