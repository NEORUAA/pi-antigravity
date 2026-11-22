#!/usr/bin/env python3
"""Reproduce golden outputs using reviewed, pinned Go functions (no network).
Usage: python3 scripts/reference-oracle.py /path/to/codex2api-checkout
Go is a development-only oracle, never a provider runtime or sidecar.
All generated/compiled scratch data stays in this private checkout's .cache.
"""
import hashlib,json,os,random,re,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
os.chdir(ROOT)
SOURCE=Path(sys.argv[1]).resolve()
PIN="d8e1981f1cc13d0b00fb4d4354e9c8777392319e"
assert subprocess.check_output(["git","-C",str(SOURCE),"rev-parse","HEAD"],text=True).strip()==PIN,"Reference HEAD must equal the reviewed pin"
PROXY=SOURCE/"proxy"
CACHE=ROOT/".cache/oracle"
CACHE.mkdir(parents=True,exist_ok=True)
files=["client_scaffolding.go","antigravity_gemini_schema.go","antigravity_schema_refs.go","antigravity_schema.go","antigravity_responses.go","antigravity_function_names.go","antigravity_stream_errors.go","sse_line.go","antigravity_gemini.go"]
sources={name:(PROXY/name).read_text() for name in files}
for name in files[:4]: (CACHE/name).write_text(sources[name].replace("package proxy","package main",1))
response=sources["antigravity_responses.go"]
names=["antigravityGeminiParameters","antigravityCleanupGeminiRequiredFields","antigravityFilterRequiredAgainstProperties","antigravityRequiredFieldNames","decodeJSONPointerToken","antigravityCleanGeminiSchema","antigravityGeminiSchemaType","antigravitySensitivePhrases","antigravityObfuscateSystemInstruction","antigravityNormalizeAndObfuscateSystemInstruction"]
parts=[]
for name in names:
 start=response.index("func "+name+"(");end=response.index("\n}",start)+2;parts.append(response[start:end])
marker=re.search(r"var antigravitySensitiveMarkerPattern = .*",response)[0]
start=response.index("var antigravityDefaultSensitivePhrases");end=response.index("\n}",start)+2
(CACHE/"extracted.go").write_text('package main\nimport("strings";"net/url";"os";"sort";"unicode/utf8";"regexp")\nconst antigravitySensitivePhrasesEnv="ANTIGRAVITY_SENSITIVE_PHRASES"\nconst antigravityZeroWidthSpace="\\u200B"\n'+marker+"\n"+response[start:end]+"\n"+"\n".join(parts))
function_source=sources["antigravity_function_names.go"]
function_parts=[]
for name in ["antigravitySanitizeFunctionName","antigravityGeminiFunctionNameMap","antigravityDisambiguateFunctionName"]:
 start=function_source.index("func "+name+"(");end=function_source.index("\n}",start)+2;function_parts.append(function_source[start:end])
# Adapt only the input decoder (gjson -> stdlib []string), not the source name-map algorithm.
(CACHE/"function_names.go").write_text('package main\nimport("crypto/sha256";"encoding/hex";"encoding/json";"fmt";"regexp";"sort";"strings")\n'+re.search(r"var antigravityFunctionNameSanitizer = .*",function_source)[0]+"\n"+"\n".join(function_parts)+'\nfunc antigravityFunctionNamesFromGeminiRequest(raw []byte) []string {var names []string;if err:=json.Unmarshal(raw,&names);err!=nil{panic(err)};return names}\n')
stream_source=sources["antigravity_stream_errors.go"]
stream_parts=[]
for declaration in ["type antigravitySSEReader struct", "func newAntigravitySSEReader(", "func (r *antigravitySSEReader) next(", "func antigravitySSEFieldLine(", "func antigravityTopLevelClosingLine(", "func decodeAntigravityStreamEnvelope(", "func antigravityStreamErrorStatusCode("]:
 start=stream_source.index(declaration);end=stream_source.index("\n}",start)+2;stream_parts.append(stream_source[start:end])
(CACHE/"sse_line.go").write_text(sources["sse_line.go"].replace("package proxy","package main",1))
(CACHE/"stream_reader.go").write_text('package main\nimport("bufio";"bytes";"encoding/json";"errors";"fmt";"io";"net/http";"strconv";"strings")\nconst antigravityResponseBodyLimit=8<<20\nconst antigravityErrorBodyLimit=1<<20\nvar errAntigravityStreamEventTooLarge=errors.New("event too large")\n'+"\n".join(stream_parts)+'''
func referenceSSE(text string) any {r:=newAntigravitySSEReader(bufio.NewReader(strings.NewReader(text)));events:=[]any{};failed:=false;for{raw,err:=r.next();if err==io.EOF{break};if err!=nil{failed=true;break};if strings.TrimSpace(string(raw))=="[DONE]"{break};document,err:=decodeAntigravityStreamEnvelope(raw);if err!=nil{failed=true;break};events=append(events,document)};return map[string]any{"events":events,"error":failed}}
''')
native=sources["antigravity_gemini.go"]
start=native.index("func antigravityResponseSchemaFromJSONSchema(");end=native.index("\n}",start)+2
with (CACHE/"extracted.go").open("a") as output: output.write("\n"+native[start:end]+"\n")
(CACHE/"main.go").write_text('''package main
import("encoding/json";"os";"bufio")
func main(){s:=bufio.NewScanner(os.Stdin);s.Buffer(make([]byte,4096),8<<20);w:=json.NewEncoder(os.Stdout);for s.Scan(){var in struct{Kind string `json:"kind"`;Text string `json:"text"`;Schema any `json:"schema"`;Code any `json:"code"`;RPC string `json:"rpc"`;Names []string `json:"names"`;Env map[string]string `json:"env"`};if err:=json.Unmarshal(s.Bytes(),&in);err!=nil{panic(err)};for _,key:=range []string{"CLIENT_SCAFFOLDING_STRIP","CLIENT_SCAFFOLDING_STRIP_REMINDERS","ANTIGRAVITY_SENSITIVE_PHRASES"}{os.Unsetenv(key)};for key,value:=range in.Env{os.Setenv(key,value)};var out any;switch in.Kind{case "system":out=antigravityNormalizeAndObfuscateSystemInstruction(in.Text);case "conversation":out=normalizeClientScaffolding(in.Text);case "product":out=normalizeProductScaffolding(in.Text);case "responseSchema":out=antigravityResponseSchemaFromJSONSchema(in.Schema);case "sse":out=referenceSSE(in.Text);case "status":out=antigravityStreamErrorStatusCode(in.Code,in.RPC);case "names":raw,_:=json.Marshal(in.Names);out=antigravityGeminiFunctionNameMap(raw);case "schema":out=antigravityGeminiParameters(in.Schema)};w.Encode(out)};if err:=s.Err();err!=nil{panic(err)}}
''')
env={**os.environ,"GOCACHE":str(ROOT/".cache/go-build"),"GOPATH":str(ROOT/".cache/go-path"),"GOPROXY":"off","GOSUMDB":"off","GOTOOLCHAIN":"local","GO111MODULE":"off","CGO_ENABLED":"0"}
subprocess.run(["go","build","-o",str(ROOT/".cache/reference-oracle"),"./.cache/oracle"],env=env,check=True)
random.seed(20261122)
inputs=[]
texts=['  plain text  ','Hermes Agent and Nous Research','You are Codex, an agent based on GPT-5. Help me.','You are opencode, a coding agent. Keep this.','[OpenMausBot: notice]\nactual request','x-anthropic-billing-header: cc_version=2\nactual request','<system-reminder># Environment\nprivate fake environment</system-reminder>\nquestion','<system-reminder>Remember the actual task</system-reminder>\nquestion','Context from OpenMausBot updated since this conversation started; it replaces any earlier copy:\nMausBot Cloud and OpenCode','日本語 OpenCode 中文','Co-Authored-By: Claude Code <noreply@anthropic.com>\nreal content','You are powered by the model example-v1.\nreal content']
for text in texts:
 for value in [text,'```txt\n'+text+'\n```\n'+text, '~~~\r\n'+text+'\r\n~~~\r\n'+text, '`'+text+'`\n'+text,'``'+text.replace('`','')+'``\n'+text]:
  for kind in ['system','conversation','product']:inputs.append(dict(kind=kind,text=value))
for _ in range(180):
 text=random.choice(texts); run=random.choice(['`','``','```','~~~~','````']);indent=random.choice(['',' ','   ','    ','\t','\t\t\t']);end=random.choice(['\n','\r\n']);close=random.choice([run,run[0]*(len(run)+1),'']);gap=random.choice([end,end+end,' ',end+' '+end]);
 inputs.append(dict(kind=random.choice(['system','conversation','product']),text=f'{indent}{run}txt{end}{text}{gap}{indent}{close}{end}{text}'))
schemas=[{},None,[],{'value':{'type':'string','required':True}},{'type':'object','properties':{'type':{'type':'string'},'enum':{'type':'array'},'properties':{'type':'integer'},'description':{'type':'string'}}},{'$defs':{'A':{'type':'object','properties':{'child':{'$ref':'#/$defs/A'}}}},'$ref':'#/$defs/A'},{'properties':{'x':{'$ref':'#/does~1not~0exist'}}},{'$defs':{'a/b':{'type':'string','enum':['a','b']}},'properties':{'x':{'$ref':'#/$defs/a~1b','description':'choice'}}}]
base=[{'type':'STRING','enum':['a','b'],'description':'Choose'},{'type':['null','integer'],'const':2},{'type':'array'},{'type':'boolean','default':False},{'type':'object','properties':{}},{'type':'string','enum':[]},{'enum':[True,False,None,1,1.5]},{'anyOf':[{'type':'string'},{'type':'null'}]}]
for _ in range(190):
 props={key:dict(random.choice(base)) for key in random.sample(['x','y','type','description','enum','properties','items'],random.randint(1,5))}
 for value in props.values():
  if random.random()<.5:value['required']=random.choice([True,False])
 schema=random.choice([{'properties':props,'required':['x','gone',' y ','x']},{'type':random.choice(['object',['OBJECT','null'],'array']),**props},{'allOf':[{'type':'object','properties':props,'required':['x']},{'properties':{'extra':{'type':'string'}},'required':['extra']}]},{'anyOf':[{'type':'null'},{'type':'object','properties':props},{'type':'array','items':{'type':'string'}}]}]);schemas.append(schema)
for schema in schemas:inputs.append(dict(kind='schema',schema=schema))
for text in ['\u0085 plain \u0085','\ufeff OpenCode \ufeff','You are Claude Code.\u00a0Keep this','You are opencode, a coding agent.\u2028Keep this','first\rcch=fixture\rrest']:
 for kind in ['system','conversation','product']:inputs.append(dict(kind=kind,text=text))
for value in ['0','false','no','off','1']:
 for kind in ['system','conversation','product']:
  inputs.append(dict(kind=kind,text=texts[6],env={'CLIENT_SCAFFOLDING_STRIP':value}))
  inputs.append(dict(kind=kind,text=texts[6],env={'CLIENT_SCAFFOLDING_STRIP_REMINDERS':value}))
inputs.append(dict(kind='system',text='ExampleBrand and `ExampleBrand`',env={'ANTIGRAVITY_SENSITIVE_PHRASES':'ExampleBrand'}))
for names in [['a b','a_b','a_b_eebd4769fc73'],['😀tool','漢tool','_tool'],['','valid'],[' spaced ','spaced','1-tool'],['x'*90,'x'*89+'y']]: inputs.append(dict(kind='names',names=names))
payloads=[{'response':{'candidates':[{'content':{'parts':[{'text':'fixture'}]}}]}},{'error':{'code':503,'status':'UNAVAILABLE','message':'fixture'}},[{'x':1},{'error':{'code':'429','status':'RESOURCE_EXHAUSTED'}}],None,[{'not_error':True}]]
for value in payloads:
 compact=json.dumps(value);pretty=json.dumps(value,indent=2)
 for text in ['data: '+compact+'\n\n','data: '+pretty+'\n\n','data: '+pretty.replace('\n','\ndata: ')+'\n\n',pretty,pretty+'\ndata: [DONE]\n\n','event: response\n: comment\nid: 1\ndata: '+compact+'\n\n', 'data: {"response":{}}\n'+pretty+'\n']:
  inputs.append(dict(kind='sse',text=text))
for code in [None,200,401,429.5,' 429 ','503','bad']:
 for rpc in ['','RESOURCE_EXHAUSTED','PERMISSION_DENIED','CANCELLED','ABORTED','FAILED_PRECONDITION','UNIMPLEMENTED','OUT_OF_RANGE','UNKNOWN']:
  inputs.append(dict(kind='status',code=code,rpc=rpc))
for schema in [{}, None, {'type':'string','enum':['a','b']}, {'type':'object','properties':{'choice':{'enum':['a','b']}}}, {'$defs':{'A/B':{'type':'string','enum':['a','b']}},'type':'object','properties':{'x':{'$ref':'#/$defs/A~1B'}}}, {'definitions':{'nested':{'type':'object','properties':{'next':{'$ref':'#/definitions/nested'}}}},'$ref':'#/definitions/nested'}, {'$defs':{'A B':{'type':'integer'}},'$ref':'#/$defs/A%20B'}]:
 inputs.append(dict(kind='responseSchema',schema=schema))
raw=''.join(json.dumps(x,ensure_ascii=False)+'\n' for x in inputs)
# Go ranges maps in unspecified order. Conflicting malformed schema keyword/property
# bags can therefore have more than one real reference result; record actual
# observations explicitly instead of pretending the reference is deterministic.
observed=[{} for _ in inputs]
for _ in range(32):
 result=subprocess.run(['.cache/reference-oracle'],input=raw,text=True,capture_output=True,check=True)
 outputs=[json.loads(line) for line in result.stdout.strip("\n").split("\n")]
 assert len(outputs)==len(inputs)
 for variants,value in zip(observed,outputs): variants[json.dumps(value,sort_keys=True,ensure_ascii=False)]=value
cases=[]
for item,variants in zip(inputs,observed):
 values=[variants[key] for key in sorted(variants)]
 case={'input':item,'expected':values[0]}
 if len(values)>1: case['referenceVariants']=values
 cases.append(case)
Path('scripts/fixtures/codex-parity/reference.json').write_text(json.dumps({'sourceCommit':PIN,'sourceSha256':{name:hashlib.sha256((PROXY/name).read_bytes()).hexdigest() for name in files},'oraclePasses':32,'nondeterministicCases':sum(len(variants)>1 for variants in observed),'cases':cases},ensure_ascii=False,indent=2)+'\n')
print(len(inputs),'reference cases;',sum(len(variants)>1 for variants in observed),'source-nondeterministic cases from 32 independent Go executions')

formatter=ROOT/"node_modules/.bin/prettier"
if formatter.exists(): subprocess.run([str(formatter),"--write","scripts/fixtures/codex-parity/reference.json"],check=True)
