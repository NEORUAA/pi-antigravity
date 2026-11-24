"""Offline fixture generator: python3 scripts/generate-account-model-oracle.py /path/to/pinned/codex2api. Requires Go; normal tests use committed goldens."""
import hashlib,json,pathlib,re,subprocess,sys,tempfile,random
repo=pathlib.Path(sys.argv[1]); pin="d8e1981f1cc13d0b00fb4d4354e9c8777392319e"
assert subprocess.check_output(["git","-C",str(repo),"rev-parse","HEAD"],text=True).strip()==pin
source=(repo/"proxy/antigravity_models.go").read_text()
functions=["antigravityRetiredModel","antigravityPublicModel","antigravityLogicalCompatibilityModel","antigravityPublicModelIDs","antigravityAcceptedModelIDs","AntigravityWireModelIDs","AntigravityPublishedModelIDs","AntigravityAdminModelIDs","AntigravityDisabledModel","antigravityProjectedModelIDs","antigravityRoleBacking","antigravityKnownWireModel","antigravityResponsesTextModel","antigravityTextCompatibleModel"]
starts=list(re.finditer(r"^func ",source,re.M))
def function(name):
 for i,m in enumerate(starts):
  if source[m.start():].startswith("func "+name+"("):
   return source[m.start():starts[i+1].start() if i+1<len(starts) else len(source)].strip()
 raise ValueError(name)
code='package main\nimport("encoding/json";"os";"sort";"strings")\n'+source[source.index("type antigravityReasoningVariant"):source.index("func antigravityRetiredModel")]+"\n"+"\n".join(map(function,functions))
code+='\nfunc main(){var raw [][]string;json.NewDecoder(os.Stdin).Decode(&raw);out:=[]any{};for _,r:=range raw {out=append(out,map[string]any{"raw":r,"published":AntigravityPublishedModelIDs(r),"admin":AntigravityAdminModelIDs(r)})};json.NewEncoder(os.Stdout).Encode(map[string]any{"publicDefinitions":len(antigravityPublicModelIDs()),"acceptedDefinitions":len(antigravityAcceptedModelIDs()),"cases":out})}\n'
pool=sorted(set(re.findall(r'"([a-z0-9][a-z0-9_.-]+)"',source[:source.index("func antigravityRetiredModel")])))+["tab_fixture","chat_20706","chat_23310","gemini-future","gemini-future-disabled","imagen-future","gemini-image-future","gemini-3.7-flash-tiered-high","gemini-4-argon"," A未来 ","\u00a0gemini-future\u00a0","GEMINI-3.7-FLASH-TIERED"]
rng=random.Random(20261124);cases=[[],pool,["gemini-3.7-flash-tiered"],["gemini-future-disabled"],["claude-sonnet-4-6"],["gemini-3.7-flash-tiered","gemini-3.1-flash-lite","gemini-2.5-flash"],["a-disabled","a--disabled","a_disabled","a-disabled-image","a-disabled x","a-disabled"+"x"*200]]
for _ in range(160):cases.append(rng.choices(pool,k=rng.randrange(1,70)))
with tempfile.TemporaryDirectory() as directory:
 path=pathlib.Path(directory)/"main.go";path.write_text(code)
 result=json.loads(subprocess.check_output(["go","run",str(path)],input=json.dumps(cases).encode()))
result["source"]={"repository":"https://github.com/james-6-23/codex2api","commit":pin,"path":"proxy/antigravity_models.go","sha256":hashlib.sha256(source.encode()).hexdigest(),"functions":functions}
pathlib.Path("scripts/fixtures/account-models/go-goldens.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n")
