#!/usr/bin/env python3
"""Extract the ORIGINAL native Gemini kernels from pinned c2a; only session/request
IDs and the expose-thoughts environment switch are deterministic adapters. No
Google/credential I/O. Dev-only Go/gjson; ordinary tests use committed goldens.
Usage: python3 scripts/native-oracle.py /path/to/pinned/codex2api
The pinned gjson dependency must already be in the isolated .cache module cache.
"""
import hashlib,json,os,re,subprocess,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
SOURCE=Path(sys.argv[1]).resolve(); PIN="d8e1981f1cc13d0b00fb4d4354e9c8777392319e"
assert subprocess.check_output(["git","-C",str(SOURCE),"rev-parse","HEAD"],text=True).strip()==PIN
CACHE=ROOT/".cache/native-oracle";CACHE.mkdir(parents=True,exist_ok=True)
S={p.name:p.read_text() for p in (SOURCE/"proxy").glob("*.go") if not p.name.endswith("_test.go")}
used={}; chunks=[]
def full(name):
 text=S[name];used[name]=hashlib.sha256(text.encode()).hexdigest()
 return re.sub(r"(?s)^package proxy\s+import(?:\s*\(.*?\)|[^\n]+)\s*","",text,count=1)
def part(name,start,end):
 used[name]=hashlib.sha256(S[name].encode()).hexdigest();text=S[name];return text[text.index(start):text.index(end)]
def fun(name,fn):
 used[name]=hashlib.sha256(S[name].encode()).hexdigest();s=S[name];a=s.index("func "+fn+"(") if "func "+fn+"("in s else (_ for _ in ()).throw(Exception(fn));return s[a:s.index("\n}",a)+2]
for n in ["client_scaffolding.go","antigravity_gemini_schema.go","antigravity_schema_refs.go","antigravity_schema.go","antigravity_function_names.go","sse_line.go"]:chunks.append(full(n))
chunks.append(part("antigravity_gemini.go","func geminiNativeToAntigravityCountTokensEnvelope(","func antigravityOAuthChannelAccountFilter("))
chunks.append(part("antigravity_stream_errors.go","const (","// antigravityStreamErrorOutcome"))
chunks.append(part("antigravity_models.go","type antigravityReasoningVariant struct","func antigravityPublicModelsForAccount("))
for f in ["antigravityTextCompatibleModel","antigravityResponsesTextModel","antigravityVariantForDefinition","antigravityResolvedVariant","antigravityRedirectedModel"]:chunks.append(fun("antigravity_models.go",f))
chunks.append(part("antigravity_json_mode.go","const antigravityJSONModeTool", "// antigravityJSONModeRejection"))
r="antigravity_responses.go"
for f in ["antigravityObfuscateSchemaValue","antigravityObfuscateDeclarations","antigravityGeminiResolvedModel","antigravityGeminiMaxOutputTokens","antigravityGeminiParameters","antigravityCleanupGeminiRequiredFields","antigravityFilterRequiredAgainstProperties","antigravityRequiredFieldNames","decodeJSONPointerToken","antigravityCleanGeminiSchema","antigravityGeminiSchemaType","antigravitySensitivePhrases","antigravityObfuscateSystemInstruction","antigravityNormalizeAndObfuscateSystemInstruction","antigravityGeminiNeedsToolSignature","antigravityGeminiReasoningTier","antigravityGeminiThinkingLevel","antigravityNamedThinkingWire","antigravityGeminiThinkingBudget","antigravityGeminiThinkingBudgetCap","lowerStringField","readBoundedAntigravityBody","geminiFinishReason"]:
 chunks.append(fun(r,f))
a=S[r].index("var antigravityDefaultSensitivePhrases");chunks.append(S[r][a:S[r].index("\n}",a)+2])
chunks.append(re.search(r"var antigravitySensitiveMarkerPattern = .*",S[r])[0])
body="\n".join(chunks).replace("auth.AntigravityExposeThoughts()","true").replace("auth.AntigravityModelRedirect(logical.id)","oracleNoRedirect(logical.id)").replace("auth.AntigravityRedirectOverridesEffort()","false")
adapters='''
const antigravitySensitivePhrasesEnv="ANTIGRAVITY_SENSITIVE_PHRASES"
const antigravityZeroWidthSpace="\u200B"
const antigravityResponseBodyLimit=8<<20
const antigravityErrorBodyLimit=1<<20
const ErrorCodeUpstreamError="upstream_error"
const antigravityOfficialBodyUserAgent="antigravity"
func antigravitySessionID(request map[string]any,contents []any)string{return "oracle-session"}
func oracleNoRedirect(model string)string{return ""}
func antigravityRequestID()string{return "oracle-request"}
'''
main=r'''
func main(){s:=bufio.NewScanner(os.Stdin);s.Buffer(make([]byte,4096),8<<20);w:=json.NewEncoder(os.Stdout);for s.Scan(){var in struct{Kind string `json:"kind"`;Model string `json:"model"`;Request json.RawMessage `json:"request"`;Raw string `json:"raw"`;Reverse map[string]string `json:"reverse"`;Mode bool `json:"mode"`};if e:=json.Unmarshal(s.Bytes(),&in);e!=nil{panic(e)};var out any;switch in.Kind{
case "request":b,wire,names,e:=geminiNativeToAntigravityEnvelope(in.Request,"oracle-project",in.Model);if e!=nil{out=map[string]any{"error":e.Error()}}else{var doc map[string]any;json.Unmarshal(b,&doc);request:=doc["request"].(map[string]any);delete(request,"sessionId");out=map[string]any{"request":request,"wire":wire,"reverse":names}}
case "count":b,wire,e:=geminiNativeToAntigravityCountTokensEnvelope(in.Request,"oracle-project",in.Model);if e!=nil{out=map[string]any{"error":e.Error()}}else{var doc any;json.Unmarshal(b,&doc);out=map[string]any{"document":doc,"wire":wire}}
case "response":raw:=[]byte(in.Raw);if in.Mode{raw,_=antigravityRewriteJSONModeFrame(raw,false)};raw=antigravityRestoreNativeGeminiResponseNames(ensureGeminiFinishReason(unwrapAntigravityNativeGeminiChunk(raw)),in.Reverse);var doc any;json.Unmarshal(raw,&doc);out=doc
case "json":raw,called:=antigravityRewriteJSONModeFrame([]byte(in.Raw),in.Mode);var doc any;json.Unmarshal(raw,&doc);out=map[string]any{"document":doc,"called":called}
case "stream":b:=newAntigravityNativeGeminiSSEResponseBody(io.NopCloser(strings.NewReader(in.Raw)),in.Reverse);b.jsonMode=in.Mode;raw,e:=io.ReadAll(b);var errorText string;if e!=nil{errorText=e.Error()};events:=[]any{};for _,line:=range strings.Split(string(raw),"\n"){if strings.HasPrefix(line,"data: "){var doc any;if json.Unmarshal([]byte(strings.TrimPrefix(line,"data: ")),&doc)==nil{events=append(events,doc)}}};out=map[string]any{"events":events,"error":errorText}
};w.Encode(out)};if e:=s.Err();e!=nil{panic(e)}}
'''
text=body+adapters+main
imports={"math":"math","bufio":"bufio","bytes":"bytes","json":"encoding/json","hex":"encoding/hex","sha256":"crypto/sha256","errors":"errors","fmt":"fmt","io":"io","http":"net/http","os":"os","sort":"sort","strconv":"strconv","strings":"strings","sync":"sync","regexp":"regexp","utf8":"unicode/utf8","url":"net/url","gjson":"github.com/tidwall/gjson"}
active=[v for k,v in imports.items() if re.search(r"\b"+k+r"\.",text)]
(CACHE/"main.go").write_text("package main\nimport("+";".join(json.dumps(i)for i in active)+")\n"+text)
(CACHE/"go.mod").write_text("module native-oracle\ngo 1.23.0\nrequire github.com/tidwall/gjson v1.18.0\n")
(CACHE/"go.sum").write_text((SOURCE/"go.sum").read_text())
env={**{k:v for k,v in os.environ.items() if not k.startswith(("ANTIGRAVITY_","NOAGY_","CLIENT_SCAFFOLDING_"))},"GOCACHE":str(ROOT/".cache/go-cache"),"GOPATH":str(ROOT/".cache/native-oracle-go"),"GOMODCACHE":str(ROOT/".cache/native-oracle-go/pkg/mod"),"GOPROXY":"off","GOSUMDB":"off","GOTOOLCHAIN":"local","CGO_ENABLED":"0"}
subprocess.run(["go","build","-mod=mod","-o",str(CACHE/"oracle"),"."],cwd=CACHE,env=env,check=True)
(ROOT/"scripts/fixtures/native-oracle-provenance.json").write_text(json.dumps({"commit":PIN,"sources":used,"adapters":["session ID and request ID fixed, session excluded from request comparison (existing independent session vectors retained)","administrator model redirects empty and redirect-overrides-effort false; native plugin has no gateway redirect settings","auth.AntigravityExposeThoughts() returns true; no auth package or Google requests"],"gjson":"v1.18.0 (checksum pinned by original go.sum)","generator":"scripts/native-oracle.py"},indent=2)+"\n")
print("Built original native oracle:",CACHE/"oracle")

# Explicit source-derived edge vectors, including every independent-audit counterexample.
inputs=[]
base={"contents":[{"role":"user","parts":[{"text":"hello OpenCode `OpenCode`"}]}]}
requests=[{},base,{"system_instruction":{"parts":[{"text":"You are Codex, an agent based on GPT-5.\n```\nOpenCode\n```"},{"inlineData":{"data":"fixture"}}]},**base},{"generationConfig":{"thinkingConfig":{"thinkingBudget":123,"includeThoughts":False},"maxOutputTokens":32},**base},{"generation_config":{"thinking_config":{"thinking_budget":123},"response_json_schema":{"$defs":{"A":{"type":"string","enum":["OpenCode","x"]}},"type":"object","properties":{"value":{"$ref":"#/$defs/A"}}}},**base}]
requests += [{"contents":[{"role":"user","parts":[{"text":"q"}]},{"role":"model","parts":[{"functionCall":{"name":"one","args":{}}},{"functionCall":{"name":"two","args":{}}}]},{"role":"user","parts":[{"functionResponse":{"name":"one","response":{"result":"ok"}}},{"inlineData":{"mimeType":"image/png","data":"Zg=="}}]},{"role":"user","parts":[{"functionResponse":{"name":"two","response":{"result":"ok"}}}]}]}]
for key in ["thoughtSignature","thought_signature"]:
 for nested in [None,"functionCall","function_call","extra_content"]:
  signature={key:"real-signature"} if nested is None else ({"extra_content":{"google":{"thought_signature":"real-signature"}}} if nested=="extra_content" else {nested:{"name":"one",key:"real-signature"}})
  requests.append({"contents":[{"role":role,"parts":[{"functionCall":{"name":"one"},**signature},{"text":"text",**signature}]}for role in ["model","user"]]})
for declKey in ["functionDeclarations","function_declarations"]:
 for paramsKey in ["parameters","parametersJsonSchema","parameters_json_schema"]:
  requests.append({**base,"tools":[{declKey:[{"name":n,paramsKey:{"type":"object","properties":{"description":{"type":"string"},"x":{"type":"string","description":"OpenCode enum"}},"required":["x","gone"]},"description":"OpenCode tool"}for n in ["tool/name","tool_name","tool/name","","1😀"]]},{"googleSearch":{}}],"toolConfig":{"functionCallingConfig":{"allowedFunctionNames":["tool/name","tool_name"]}},"tool_config":{"function_calling_config":{"allowed_function_names":["tool/name","tool_name"]}}})
requests += [{**base,"tools":[]},{"contents":[{"parts":[{"text":"a"}]},{"parts":[{"text":"b"}]},{"parts":[{"functionResponse":{"name":"x","response":["OpenCode",1]}}]}]}, {**base,"generationConfig":{"responseJsonSchema":{"type":"object","properties":{"type":{"type":"string","enum":["x","y"]}}}}}]
for model in ["gemini-3.7-flash-high","gemini-4-neon-medium","gemini-3.1-pro-low","claude-sonnet-5-5-high","claude-sonnet-4-6","gpt-oss-120b-medium","gemini-3.7-flash"]:
 for request in requests:inputs.append({"kind":"request","model":model,"request":request})
responses=[{}, {"response":{"candidates":[{"content":{"parts":[{"text":"partial"}]}}],"cpaUsageMetadata":{"promptTokenCount":11,"candidatesTokenCount":7}}}, {"response":{"candidates":[{"finish_reason":"MAX_TOKENS","content":{"parts":[{"function_call":{"name":"tool_name","args":{"name":"tool_name"}}}]}}]}}, {"response":{"promptFeedback":{"blockReason":"SAFETY"}}}]
for response in responses:inputs.append({"kind":"response","raw":json.dumps(response),"reverse":{"tool_name":"tool/name"}})
raws=[' {"response":{"candidates":[{"content":{"parts":[{"text":"discard"},{"text":"thought","thought":true},{"function_call":{"name":"json_mode","args":{"10":1.00,"2":1e3,"z":" x "}}}]},"finish_reason":"OTHER"}]}}','{"candidates":[{"content":{"parts":[{"functionCall":{"name":"own_tool","args":{}}}]},"finishReason":"OTHER"}]}','{"candidates":[{"finishReason":"OTHER"}]}']
for args in [None,"{\"answer\":1}",{},1,False]:raws.append(json.dumps({"candidates":[{"content":{"parts":[{"functionCall":{"name":"json_mode","args":args}}]},"finishReason":"OTHER"}]}))
for raw in raws:
 for mode in [False,True]:inputs.append({"kind":"json","raw":raw,"mode":mode})
for response in responses+[{"response":{"candidates":[{"finishReason":"STOP"}]}},{"response":{"promptFeedback":{"blockReason":"BLOCK_REASON_UNSPECIFIED"}}},{"error":{"code":429,"message":"fixture"}}]:
 for ending in ["","data: [DONE]\n\n"]:inputs.append({"kind":"stream","raw":"data: "+json.dumps(response)+"\n\n"+ending})

for model in ["gemini-3.7-flash-high","claude-sonnet-4-6"]:
 for request in [base,{"contents":[{"role":"model","parts":[{"text":"leading assistant"}]}],"safetySettings":[],"toolConfig":{},"labels":{"fixture":"x"}}]:inputs.append({"kind":"count","model":model,"request":request})
for terminal in ["NONE","finish_reason_unspecified","STOP","MAX_TOKENS","OTHER",""]:
 for key in ["finishReason","finish_reason"]:
  inputs.append({"kind":"stream","raw":"data: "+json.dumps({"response":{"candidates":[{key:terminal}]}})+"\n\n"})
inputs.append({"kind":"json","raw":'{"response":{"candidates":[null,{"content":{"parts":[{"functionCall":{"name":"json_mode","args":{"10":1e3,"2":1.00}}}]},"finishReason":"OTHER"}]}}',"mode":False})
result=subprocess.run([str(CACHE/"oracle")],input="".join(json.dumps(i)+"\n"for i in inputs),text=True,capture_output=True,check=True)
outputs=[json.loads(line)for line in result.stdout.splitlines()];assert len(inputs)==len(outputs)
(ROOT/"scripts/fixtures/native-oracle.json").write_text(json.dumps([{"input":i,"expected":e}for i,e in zip(inputs,outputs)],indent=2,ensure_ascii=False)+"\n")
print("Native source vectors:",len(inputs))
