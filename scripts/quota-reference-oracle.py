#!/usr/bin/env python3
"""Offline pinned Go quota-gate oracle; development only, no service/network."""
import hashlib,json,os,random,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
SOURCE=Path(sys.argv[1]).resolve();PIN='d8e1981f1cc13d0b00fb4d4354e9c8777392319e'
assert subprocess.check_output(['git','-C',str(SOURCE),'rev-parse','HEAD'],text=True).strip()==PIN
os.chdir(ROOT);cache=ROOT/'.cache/quota-oracle';cache.mkdir(parents=True,exist_ok=True)
files=['antigravity_client.go','antigravity_types.go','antigravity_quota_gate.go','antigravity_quota_family.go']
sources={name:(SOURCE/'auth'/name).read_text() for name in files}
def extract(file,decl):
 s=sources[file];start=s.index(decl);return s[start:s.index('\n}',start)+2]
parts=[]
for name in ['SourceMeta','AntigravityModelQuota','AntigravityQuotaBucket','AntigravityQuotaGroup','AntigravityAICredits','AntigravityQuotaSnapshot']:
 parts.append(extract('antigravity_types.go','type '+name+' struct'))
for name in ['NormalizeAntigravityWindow','ValidateResetTime']:
 parts.append(extract('antigravity_client.go','func '+name+'('))
for name in ['antigravityQuotaSnapshotGateBlock','antigravityQuotaSnapshotGateBlockForModel','antigravityQuotaGateApplicable','antigravityQuotaGroupsMetaTrusted','antigravityQuotaScopeGateBlock','antigravityQuotaBucketGateBlock','antigravityQuotaBucketPauseBlock']:
 parts.append(extract('antigravity_quota_gate.go','func '+name+'('))
(cache/'gate.go').write_text('package main\nimport("time";"strings")\ntype antigravityQuotaPause struct{fiveHour,weekly float64}\ntype settings struct{}\nfunc ConfiguredAntigravitySettings()settings{return settings{}}\nfunc (settings)GetQuotaGateEnabled()bool{return true}\n'+'\n'.join(parts))
(cache/'family.go').write_text(sources['antigravity_quota_family.go'].replace('package auth','package main',1))
(cache/'main.go').write_text('''package main
import("encoding/json";"os";"bufio";"time";"strings")
func main(){s:=bufio.NewScanner(os.Stdin);w:=json.NewEncoder(os.Stdout);for s.Scan(){var in struct{Snapshot *AntigravityQuotaSnapshot `json:"snapshot"`;Now string `json:"now"`;Model string `json:"model"`};if err:=json.Unmarshal(s.Bytes(),&in);err!=nil{panic(err)};now,err:=time.Parse(time.RFC3339,in.Now);if err!=nil{panic(err)};blocked,reason,reset:=false,"",time.Time{};if strings.TrimSpace(in.Model)!=""{blocked,reason,reset=antigravityQuotaSnapshotGateBlockForModel(in.Snapshot,in.Model,now,antigravityQuotaPause{})};if !blocked{blocked,reason,reset=antigravityQuotaSnapshotGateBlock(in.Snapshot,now,antigravityQuotaPause{})};resetAt:=int64(0);if !reset.IsZero(){resetAt=reset.UnixMilli()};w.Encode(map[string]any{"blocked":blocked,"reason":reason,"resetAt":resetAt})};if err:=s.Err();err!=nil{panic(err)}}
''')
env={**os.environ,'GOCACHE':str(ROOT/'.cache/go-build'),'GOPATH':str(ROOT/'.cache/go-path'),'GOPROXY':'off','GOSUMDB':'off','GOTOOLCHAIN':'local','GO111MODULE':'off','CGO_ENABLED':'0'}
subprocess.run(['go','build','-o',str(cache/'oracle'),'./.cache/quota-oracle'],env=env,check=True)
random.seed(20261123);inputs=[]
models=['','gemini-a','claude-a','models/GPT-fixture','gemini-argon','unrecognized']
for n in range(90):
 groups=[]
 for _ in range(random.randrange(1,5)):
  b={'bucket_id':random.choice(['3p-weekly','gemini-5h','gemini-argon-weekly','unknown','']),'window':random.choice(['5h','weekly','five_hour','week','daily','UNKNOWN']),'observed_at':random.choice(['2026-11-22T08:00:00Z','2026-11-22T01:00:00Z']),'ttl_seconds':random.choice([0,3600,7200]),'fraction_present':random.choice([True,True,False]),'remaining_fraction':random.choice([None,0,.001,.5,1,-1,2]),'reset_time':random.choice(['','2026-11-22T10:00:00Z','2026-11-24T10:00:00Z','2026-12-30T10:00:00Z','2026-11-21T10:00:00Z','2026-11-31T10:00:00Z'])}
  groups.append({'buckets':[b]})
 meta={'applied_seq':1,'observed_at':random.choice(['2026-11-22T08:00:00Z','2026-11-22T10:00:00Z']),'summary_integrity':True}
 snap={'schema_version':random.choice([2,2,2,0]),'quota_groups':groups,'source_metadata':{'groups':meta}}
 for model in models:inputs.append({'snapshot':snap,'model':model,'now':'2026-11-22T09:00:00Z'})
for model in models:
 for snap in [None,{}, {'schema_version':2,'source_metadata':{'groups':{'applied_seq':0,'observed_at':'2026-11-22T08:00:00Z'}}}]:inputs.append({'snapshot':snap,'model':model,'now':'2026-11-22T09:00:00Z'})
raw=''.join(json.dumps(x)+'\n' for x in inputs)
result=subprocess.run([str(cache/'oracle')],input=raw,text=True,capture_output=True,check=True)
outputs=[json.loads(line) for line in result.stdout.splitlines()];assert len(inputs)==len(outputs)
Path('scripts/fixtures/codex-parity/quota-reference.json').write_text(json.dumps({'sourceCommit':PIN,'sourceSha256':{name:hashlib.sha256((SOURCE/'auth'/name).read_bytes()).hexdigest() for name in files},'cases':[{'input':i,'expected':o} for i,o in zip(inputs,outputs)]},indent=2)+'\n')
subprocess.run(['node_modules/.bin/prettier','--write','scripts/fixtures/codex-parity/quota-reference.json'],check=True)
print(len(inputs),'independent pinned Go quota-gate vectors')
