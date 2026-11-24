import {
  groupNativeToolResults,
  normalizeNativeRoles,
  sanitizeNativeSignatures,
  renameAllowedFunctions,
} from "./gemini-parts.js";
/** Native Gemini-shaped request normalization. See docs/CODEX_PARITY.md for the
 * pinned source, retained Pi adaptations, and explicit unsupported gateway paths. */
import { createHash } from "node:crypto";
import type { GeminiRequestBody } from "../types/types.js";
import { isRecord } from "../utils/util.js";

export { codexToolSchema } from "./schema.js";
import { piToolSchema, codexResponseSchema } from "./schema.js";
import {
  normalizeSystem,
  trimCodexWhitespace,
  normalizeConversation,
  normalizeToolValue,
  obfuscateDescription,
} from "./scaffolding.js";
export function sanitizeFunctionName(name: string): string {
  let clean = trimCodexWhitespace(name).replace(/[^a-zA-Z0-9_.:-]/gu, "_");
  if (!clean) return "";
  if (!/^[a-zA-Z_]/.test(clean)) clean = `_${clean.slice(0, 63)}`;
  return clean.slice(0, 64);
}
export function functionNameMap(names: string[]): Record<string, string> {
  const counts = new Map<string, number>();
  for (const name of new Set(names.filter(Boolean))) {
    const base = sanitizeFunctionName(name);
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  const result: Record<string, string> = {};
  const used = new Set<string>();
  for (const name of [...new Set(names.filter(Boolean))].sort((a, b) =>
    Buffer.compare(Buffer.from(a), Buffer.from(b)),
  )) {
    const base = sanitizeFunctionName(name);
    let mapped = base;
    if ((counts.get(base) ?? 0) > 1 || used.has(base)) {
      for (let attempt = 0; ; attempt++) {
        const suffix = createHash("sha256")
          .update(`${name}\0${attempt}`)
          .digest("hex")
          .slice(0, 12);
        mapped = `${base.slice(0, 51)}_${suffix}`;
        if (!used.has(mapped)) break;
      }
    }
    result[name] = mapped;
    used.add(mapped);
  }
  return result;
}
function descriptions(value: unknown, propertyBag = false): void {
  if (Array.isArray(value)) {
    for (const item of value) descriptions(item, propertyBag);
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, item] of Object.entries(value)) {
    if (propertyBag) {
      descriptions(item);
      continue;
    }
    const normalized = trimCodexWhitespace(key).toLowerCase();
    if (["enum", "const", "default", "examples", "example"].includes(normalized)) continue;
    if (normalized === "description" && typeof item === "string")
      value[key] = obfuscateDescription(item);
    else descriptions(item, normalized === "properties");
  }
}
export function normalizeCodexRequest(
  request: GeminiRequestBody,
  model: string,
): Record<string, string> {
  const names =
    request.tools?.flatMap((tool) =>
      (tool.functionDeclarations ?? []).map((declaration) => declaration.name),
    ) ?? [];
  const map = functionNameMap(names);
  const reverse: Record<string, string> = {};
  for (const [original, mapped] of Object.entries(map))
    if (original !== mapped) reverse[mapped] = original;
  for (const tool of request.tools ?? []) {
    for (const declaration of tool.functionDeclarations ?? []) {
      declaration.name = map[declaration.name] ?? sanitizeFunctionName(declaration.name);
      declaration.parametersJsonSchema = piToolSchema(
        declaration.parameters ?? declaration.parametersJsonSchema,
      );
      delete declaration.parameters;
    }
    descriptions(tool);
  }
  if (request.systemInstruction) {
    request.systemInstruction.parts = request.systemInstruction.parts
      .map((part) => ({ ...part, text: trimCodexWhitespace(normalizeSystem(part.text)) }))
      .filter((part) => part.text);
    if (!request.systemInstruction.parts.length) delete request.systemInstruction;
  }
  if (model.startsWith("gemini-")) delete request.generationConfig?.maxOutputTokens;
  const nativeRequest = request as unknown as Record<string, unknown>;
  for (const key of ["generationConfig", "generation_config"]) {
    const config = nativeRequest[key];
    if (!isRecord(config)) continue;
    for (const schemaKey of ["responseJsonSchema", "response_json_schema"]) {
      if (!Object.hasOwn(config, schemaKey)) continue;
      const schema = config[schemaKey];
      delete config[schemaKey];
      if (!Object.hasOwn(config, "responseSchema") && schema !== null)
        config.responseSchema = codexResponseSchema(schema, true);
    }
  }
  groupNativeToolResults(nativeRequest);
  normalizeNativeRoles(nativeRequest);
  if (Object.keys(map).length)
    renameAllowedFunctions(
      nativeRequest,
      (name) => map[String(name)] ?? sanitizeFunctionName(String(name)),
    );
  for (const turn of request.contents)
    for (const part of turn.parts) {
      if ("text" in part) part.text = normalizeConversation(part.text);
      if ("functionResponse" in part) {
        part.functionResponse.response = normalizeToolValue(
          part.functionResponse.response,
        ) as typeof part.functionResponse.response;
        if (part.functionResponse.parts)
          part.functionResponse.parts = normalizeToolValue(
            part.functionResponse.parts,
          ) as typeof part.functionResponse.parts;
      }
      if ("functionCall" in part) {
        part.functionCall.name =
          map[part.functionCall.name] ?? sanitizeFunctionName(part.functionCall.name);
      }
      if ("functionResponse" in part)
        part.functionResponse.name =
          map[part.functionResponse.name] ?? sanitizeFunctionName(part.functionResponse.name);
    }
  sanitizeNativeSignatures(nativeRequest, model);
  return reverse;
}
