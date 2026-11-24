import {
  groupNativeToolResults,
  normalizeNativeRoles,
  sanitizeNativeSignatures,
  renameAllowedFunctions,
} from "./gemini-parts.js";
import { originalJSON, rawJSONAt, compactRawJSON } from "./json-raw.js";
/** Pinned c2a proxy/antigravity_gemini.go native path. Shared kernels remain in
 * request/schema/scaffolding; Pi-specific shape adaptations do not run here. */
import { isRecord } from "../utils/util.js";
import { functionNameMap, sanitizeFunctionName } from "./request.js";
import { codexToolSchema, codexResponseSchema } from "./schema.js";
import {
  normalizeSystem,
  normalizeConversation,
  normalizeToolValue,
  obfuscateDescription,
  trimCodexWhitespace as trim,
} from "./scaffolding.js";
import { codexThinking } from "./catalog.js";
import { codexSessionId } from "./profile.js";
type Obj = Record<string, unknown>;
const rows = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isRecord) : []);
const values = (v: unknown): unknown[] => (Array.isArray(v) ? (v as unknown[]) : []);
const text = (v: unknown) => (typeof v === "string" ? v : "");
const nested = (o: Obj, key: string) => (isRecord(o[key]) ? o[key] : undefined);

function thinkingConfig(request: Obj): Obj | undefined {
  for (const key of ["generationConfig", "generation_config"]) {
    const gen = nested(request, key);
    const thinking = gen && (nested(gen, "thinkingConfig") ?? nested(gen, "thinking_config"));
    if (thinking) return thinking;
  }
}

export function nativeThinkingLevel(request: Obj): string {
  const thinking = thinkingConfig(request);
  const level = text(thinking?.thinkingLevel ?? thinking?.thinking_level)
    .trim()
    .toLowerCase();
  return level === "thinking_level_unspecified" ? "" : level;
}

function describe(v: unknown, properties = false): void {
  if (Array.isArray(v)) {
    for (const x of v) describe(x, properties);
    return;
  }
  if (!isRecord(v)) return;
  for (const [k, x] of Object.entries(v)) {
    if (properties) {
      describe(x);
      continue;
    }
    const normalized = trim(k).toLowerCase();
    if (["enum", "const", "default", "examples", "example"].includes(normalized)) continue;
    if (normalized === "description" && typeof x === "string") v[k] = obfuscateDescription(x);
    else describe(x, normalized === "properties");
  }
}
function allNames(tools: Obj[]): string[] {
  return tools.flatMap((tool) => {
    if (Array.isArray(tool.tools)) return allNames(rows(tool.tools));
    let found = false;
    const names: string[] = [];
    for (const key of ["functionDeclarations", "function_declarations"])
      if (Array.isArray(tool[key])) {
        found = true;
        names.push(
          ...rows(tool[key])
            .map((d) => text(d.name))
            .filter(Boolean),
        );
      }
    return found ? names : [text(nested(tool, "function")?.name)].filter(Boolean);
  });
}
export function normalizeNativeGeminiRequest(
  request: Obj,
  publicModel: string,
  wire: string,
  forceTier = false,
): Record<string, string> {
  const map = functionNameMap(allNames(rows(request.tools))),
    reverse: Record<string, string> = {};
  for (const [original, mapped] of Object.entries(map))
    if (original !== mapped) reverse[mapped] = original;
  const rename = (name: unknown) => map[text(name)] ?? sanitizeFunctionName(text(name));
  delete request.model;
  if (Object.hasOwn(request, "system_instruction")) {
    request.systemInstruction = request.system_instruction;
    delete request.system_instruction;
  }
  const si = nested(request, "systemInstruction");
  if (si && Array.isArray(si.parts)) {
    si.parts = values(si.parts).flatMap((p) => {
      if (!isRecord(p) || typeof p.text !== "string") return [p];
      const t = trim(normalizeSystem(p.text));
      return t ? [{ ...p, text: t }] : [];
    });
    if (!(si.parts as unknown[]).length) delete request.systemInstruction;
  }
  groupNativeToolResults(request);
  normalizeNativeRoles(request);
  if (Array.isArray(request.tools) && request.tools.length) {
    request.tools = rows(request.tools).filter((tool) => {
      for (const key of ["functionDeclarations", "function_declarations"]) {
        if (!Array.isArray(tool[key]) || !tool[key].length) continue;
        const seen = new Set<string>();
        const declarations = rows(tool[key]).filter((d) => {
          const name = trim(text(d.name));
          if (!name) return false;
          const mapped = rename(name);
          if (seen.has(mapped)) return false;
          seen.add(mapped);
          d.name = mapped;
          d.parametersJsonSchema = codexToolSchema(
            d.parameters ?? d.parametersJsonSchema ?? d.parameters_json_schema,
          );
          delete d.parameters;
          delete d.parameters_json_schema;
          return true;
        });
        if (declarations.length) tool[key] = declarations;
        else delete tool[key];
      }
      describe(tool);
      return !!Object.keys(tool).length;
    });
    if (!(request.tools as unknown[]).length) delete request.tools;
  }
  if (Object.keys(map).length) {
    for (const c of rows(request.contents))
      for (const p of rows(c.parts))
        for (const key of [
          "functionCall",
          "function_call",
          "functionResponse",
          "function_response",
        ]) {
          const value = nested(p, key);
          if (value && trim(text(value.name))) value.name = rename(value.name);
        }
    renameAllowedFunctions(request, rename);
  }
  let gen = nested(request, "generationConfig");
  if (!gen) {
    gen = {};
    request.generationConfig = gen;
  }
  if (wire.startsWith("gemini-")) delete gen.maxOutputTokens;
  if (forceTier) {
    const original = thinkingConfig(request);
    const includeThoughts = original?.includeThoughts ?? original?.include_thoughts;
    for (const key of ["generationConfig", "generation_config"]) {
      const cfg = nested(request, key);
      if (!cfg) continue;
      delete cfg.thinkingConfig;
      delete cfg.thinking_config;
    }
    const thinking = codexThinking(publicModel, wire);
    if (thinking) {
      if (typeof includeThoughts === "boolean") thinking.includeThoughts = includeThoughts;
      gen.thinkingConfig = thinking;
    }
  } else if (!isRecord(gen.thinkingConfig) || !Object.keys(gen.thinkingConfig).length) {
    const thinking = codexThinking(publicModel, wire);
    if (thinking) gen.thinkingConfig = thinking;
  }
  for (const key of ["generationConfig", "generation_config"]) {
    const cfg = nested(request, key);
    if (!cfg) continue;
    for (const k of ["responseJsonSchema", "response_json_schema"]) {
      if (!Object.hasOwn(cfg, k)) continue;
      const schema = cfg[k];
      delete cfg[k];
      if (!Object.hasOwn(cfg, "responseSchema") && schema !== null)
        cfg.responseSchema = codexResponseSchema(schema);
    }
  }
  sanitizeNativeSignatures(request, wire);
  for (const c of rows(request.contents))
    for (const p of rows(c.parts)) {
      if (typeof p.text === "string") p.text = normalizeConversation(p.text);
      const r = nested(p, "functionResponse");
      if (r) {
        if (Object.hasOwn(r, "response")) r.response = normalizeToolValue(r.response);
        if (Object.hasOwn(r, "parts")) r.parts = normalizeToolValue(r.parts);
      }
    }
  request.sessionId = codexSessionId(values(request.contents));
  return reverse;
}
export function nativeTerminal(payload: Obj): boolean {
  const candidate = values(payload.candidates)[0];
  const first = isRecord(candidate) ? candidate : undefined;
  const reason = trim(text(first?.finishReason) || text(first?.finish_reason)).toUpperCase();
  const blocked = trim(text(nested(payload, "promptFeedback")?.blockReason)).toUpperCase();
  return (
    (!!reason && !["NONE", "FINISH_REASON_UNSPECIFIED"].includes(reason)) ||
    (!!blocked && !["NONE", "BLOCK_REASON_UNSPECIFIED"].includes(blocked))
  );
}
export function unwrapNative(
  payload: Obj,
  reverse: Record<string, string>,
  nonstream = false,
): Obj {
  const out = nested(payload, "response") ?? payload;
  if (isRecord(out.cpaUsageMetadata)) {
    out.usageMetadata = out.cpaUsageMetadata;
    delete out.cpaUsageMetadata;
  }
  for (const c of rows(out.candidates)) {
    if (nonstream && !trim(text(c.finishReason))) c.finishReason = "STOP";
    for (const p of rows(nested(c, "content")?.parts))
      for (const key of [
        "functionCall",
        "function_call",
        "functionResponse",
        "function_response",
      ]) {
        const r = nested(p, key);
        if (r && typeof r.name === "string" && reverse[r.name]) r.name = reverse[r.name];
      }
  }
  return out;
}

export function claudeJSONMode(request: Obj, wire: string): boolean {
  return (
    /claude/i.test(wire) &&
    ["generationConfig", "generation_config"].some((k) => {
      const cfg = nested(request, k);
      return (
        cfg &&
        ["responseSchema", "response_schema"].some(
          (key) => Object.hasOwn(cfg, key) && cfg[key] !== null,
        )
      );
    }) &&
    !rows(request.tools).some((tool) =>
      ["functionDeclarations", "function_declarations"].some((k) =>
        rows(tool[k]).some((d) => trim(text(d.name)) === "json_mode"),
      ),
    )
  );
}
export function rewriteJSONModeFrame(frame: Obj, state: { toolCalled: boolean }): void {
  let response = frame;
  const prefix: (string | number)[] = [];
  while (isRecord(response.response)) {
    response = response.response;
    prefix.push("response");
  }
  const raw = originalJSON(frame);
  for (const [ci, candidate] of values(response.candidates).entries()) {
    if (!isRecord(candidate)) continue;
    const content = nested(candidate, "content"),
      parts = Array.isArray(content?.parts) ? content.parts : [],
      answers = new Set<number>();
    for (const [pi, part] of parts.entries()) {
      if (!isRecord(part)) continue;
      const key = isRecord(part.functionCall) ? "functionCall" : "function_call",
        call = nested(part, key);
      if (!call) continue;
      state.toolCalled = true;
      if (trim(text(call.name)) !== "json_mode") continue;
      const rawArgs = raw
        ? rawJSONAt(raw, [...prefix, "candidates", ci, "content", "parts", pi, key, "args"])
        : undefined;
      const rendered =
        call.args == null
          ? "{}"
          : typeof call.args === "string"
            ? call.args
            : rawArgs
              ? compactRawJSON(rawArgs)
              : JSON.stringify(call.args);
      parts[pi] = { text: rendered };
      answers.add(pi);
    }
    if (content && answers.size)
      content.parts = parts.filter(
        (p, i) =>
          !isRecord(p) || typeof p.text !== "string" || p.thought === true || answers.has(i),
      );
    for (const key of ["finishReason", "finish_reason"])
      if (state.toolCalled && trim(text(candidate[key])).toUpperCase() === "OTHER")
        candidate[key] = "STOP";
  }
}

export function nativeCountTokensRequest(request: Obj, wire: string): { request: Obj } {
  for (const key of ["safetySettings", "toolConfig", "labels", "sessionId"]) delete request[key];
  if (
    !wire.toLowerCase().includes("claude") &&
    isRecord(values(request.contents)[0]) &&
    (values(request.contents)[0] as Obj).role === "model"
  )
    request.contents = [{ role: "user", parts: [{ text: "" }] }, ...values(request.contents)];
  return { request };
}
export function unwrapNativeCountTokens(document: unknown): unknown {
  if (
    isRecord(document) &&
    isRecord(document.response) &&
    Object.hasOwn(document.response, "totalTokens")
  )
    return document.response;
  return document;
}

export function nativeJSONModeRejection(body: string, model: string): Obj | undefined {
  let message = "";
  try {
    const document: unknown = JSON.parse(body);
    if (
      isRecord(document) &&
      isRecord(document.error) &&
      typeof document.error.message === "string"
    )
      message = trim(document.error.message);
  } catch {
    return;
  }
  try {
    const inner: unknown = JSON.parse(message);
    if (
      isRecord(inner) &&
      isRecord(inner.error) &&
      typeof inner.error.message === "string" &&
      trim(inner.error.message)
    )
      message = trim(inner.error.message);
  } catch {
    /* Plain upstream message, as in source gjson.Valid. */
  }
  if (!message.toLowerCase().includes("tool_choice")) return;
  return {
    code: "antigravity_feature_unsupported",
    type: "invalid_request_error",
    message: `Antigravity model ${trim(model)} does not support json_schema structured output: the upstream implements it as a forced tool call, which this model rejects (upstream: ${message})`,
  };
}
