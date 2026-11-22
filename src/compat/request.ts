/** Native Gemini-shaped request normalization. See docs/CODEX_PARITY.md for the
 * pinned source, retained Pi adaptations, and explicit unsupported gateway paths. */
import { createHash } from "node:crypto";
import type { GeminiRequestBody } from "../types/types.js";
import { isRecord } from "../utils/util.js";

const omitted = new Set([
  "$ref",
  "$defs",
  "definitions",
  "$schema",
  "$id",
  "$comment",
  "additionalProperties",
  "unevaluatedProperties",
  "patternProperties",
  "format",
  "default",
  "examples",
  "example",
  "deprecated",
  "readOnly",
  "writeOnly",
  "contentEncoding",
  "contentMediaType",
]);
const annotations = new Set([
  "type",
  "description",
  "title",
  "properties",
  "required",
  "items",
  "anyOf",
  "oneOf",
  "allOf",
  "enum",
  "const",
  "nullable",
  ...omitted,
]);
function requiredNames(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item: unknown): item is string => typeof item === "string")
    : [];
}
function merge(target: Record<string, unknown>, source: Record<string, unknown>) {
  if (isRecord(source.properties))
    target.properties = {
      ...source.properties,
      ...(isRecord(target.properties) ? target.properties : {}),
    };
  if (Array.isArray(source.required))
    target.required = [
      ...new Set([...requiredNames(target.required), ...requiredNames(source.required)]),
    ];
  target.type ??= source.type;
}
function score(schema: Record<string, unknown>) {
  return isRecord(schema.properties) || schema.type === "object"
    ? 3
    : schema.items
      ? 2
      : schema.type && schema.type !== "null"
        ? 1
        : 0;
}
function cleanSchema(value: unknown, depth = 0): unknown {
  if (depth > 32) return undefined;
  if (Array.isArray(value))
    return value.map((item) => cleanSchema(item, depth + 1)).filter((item) => item !== undefined);
  if (!isRecord(value)) return value;
  const node: Record<string, unknown> = { ...value };
  const bare = Object.entries(node).filter(
    ([key, item]) => isRecord(item) && !annotations.has(key) && !key.startsWith("x-"),
  );
  if ((!node.type || node.type === "object") && bare.length) {
    node.properties = {
      ...(isRecord(node.properties) ? node.properties : {}),
      ...Object.fromEntries(bare),
    };
    for (const [key] of bare) delete node[key];
    node.type ??= "object";
  }
  if (Array.isArray(node.allOf)) {
    for (const branch of node.allOf) {
      const cleaned = cleanSchema(branch, depth + 1);
      if (isRecord(cleaned)) merge(node, cleaned);
    }
    delete node.allOf;
  }
  for (const union of ["anyOf", "oneOf"]) {
    if (!Array.isArray(node[union])) continue;
    const branches = node[union].map((branch) => cleanSchema(branch, depth + 1)).filter(isRecord);
    if (branches.some((branch) => branch.nullable === true && !branch.type)) node.nullable = true;
    const valid = branches.filter((branch) => branch.type && branch.type !== "null");
    if (isRecord(node.properties) && Object.keys(node.properties).length)
      for (const branch of valid) merge(node, branch);
    else {
      valid.sort((a, b) => score(b) - score(a));
      if (valid[0]) merge(node, valid[0]);
    }
    delete node[union];
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(node)) {
    if (omitted.has(key)) continue;
    if (key === "properties" && isRecord(item)) {
      out.properties = Object.fromEntries(
        Object.entries(item).map(([name, schema]) => [name, cleanSchema(schema, depth + 1)]),
      );
      continue;
    }
    if (key === "type") {
      const types = (Array.isArray(item) ? item : [item])
        .filter((type): type is string => typeof type === "string")
        .map((type) => type.trim().toLowerCase());
      if (types.includes("null")) out.nullable = true;
      const type = types.find((item) => item !== "null");
      if (type) out.type = type;
      continue;
    }
    if (key === "const") {
      out.enum = [item];
      continue;
    }
    out[key] = cleanSchema(item, depth + 1);
  }
  // Promote malformed boolean required annotations on property schemas.
  if (isRecord(out.properties)) {
    const required = new Set(
      Array.isArray(out.required)
        ? out.required.filter((name): name is string => typeof name === "string")
        : [],
    );
    for (const [key, schema] of Object.entries(out.properties))
      if (isRecord(schema) && typeof schema.required === "boolean") {
        if (schema.required) required.add(key);
        delete schema.required;
      }
    const valid = [...required].filter((key) => Object.hasOwn(out.properties as object, key));
    if (valid.length) out.required = valid;
    else delete out.required;
  } else if (typeof out.required !== "boolean") delete out.required;
  if (out.type === "array" && !out.items) out.items = { type: "string" };
  if (Array.isArray(out.enum) && out.enum.length) {
    out.description = [
      out.description,
      `Allowed: ${out.enum.map((item) => (typeof item === "string" ? item : JSON.stringify(item))).join(", ")}`,
    ]
      .filter(Boolean)
      .join(". ");
    delete out.enum;
  }
  return out;
}
export function codexToolSchema(value: unknown): Record<string, unknown> {
  const cleaned = cleanSchema(value);
  const root = isRecord(cleaned) ? cleaned : {};
  root.type ??= "object";
  const properties = isRecord(root.properties) ? root.properties : {};
  root.properties = properties;
  if (!Object.keys(properties).length && root.type === "object") {
    properties.reason = {
      type: "string",
      description: "Brief explanation of why you are calling this tool",
    };
    root.required = ["reason"];
  }
  return root;
}
export function sanitizeFunctionName(name: string): string {
  let clean = name.trim().replace(/[^a-zA-Z0-9_.:-]/g, "_");
  if (!/^[a-zA-Z_]/.test(clean)) clean = `_${clean.slice(0, 63)}`;
  return clean.slice(0, 64);
}
export function functionNameMap(names: string[]): Record<string, string> {
  const counts = new Map<string, number>();
  for (const name of new Set(names)) {
    const base = sanitizeFunctionName(name);
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  const result: Record<string, string> = {};
  const used = new Set<string>();
  for (const name of [...new Set(names)].sort()) {
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
const sensitive =
  /hermes agent|nous research|claude agent sdk|you are codex, an agent based on gpt-5|openmausbot|openmaus|mausbot cloud|maus-bot|mausbot|opencode|chief of staff|my cloud|learned by/gi;
function obfuscate(text: string): string {
  for (let pass = 0; pass < 3; pass++)
    text = text.replace(sensitive, (match) => `${match[0]}\u200b${match.slice(1)}`);
  return text;
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
    if (["enum", "const", "default", "examples", "example"].includes(key)) continue;
    if (key === "description" && typeof item === "string") value[key] = obfuscate(item);
    else descriptions(item, key === "properties");
  }
}
export function normalizeCodexRequest(
  request: GeminiRequestBody,
  model: string,
): Record<string, string> {
  const names =
    request.tools?.flatMap((tool) =>
      tool.functionDeclarations.map((declaration) => declaration.name),
    ) ?? [];
  const map = functionNameMap(names);
  const reverse: Record<string, string> = {};
  for (const [original, mapped] of Object.entries(map))
    if (original !== mapped) reverse[mapped] = original;
  for (const tool of request.tools ?? []) {
    for (const declaration of tool.functionDeclarations) {
      declaration.name = map[declaration.name] ?? sanitizeFunctionName(declaration.name);
      declaration.parametersJsonSchema = codexToolSchema(
        declaration.parameters ?? declaration.parametersJsonSchema,
      );
      delete declaration.parameters;
    }
    descriptions(tool);
  }
  for (const part of request.systemInstruction?.parts ?? []) part.text = obfuscate(part.text);
  for (const turn of request.contents)
    for (const part of turn.parts) {
      if ("functionCall" in part) {
        part.functionCall.name =
          map[part.functionCall.name] ?? sanitizeFunctionName(part.functionCall.name);
        if (model.startsWith("gemini-") && !part.thoughtSignature?.trim()) {
          part.thoughtSignature = "skip_thought_signature_validator";
          part.thought_signature = "skip_thought_signature_validator";
        }
      }
      if ("functionResponse" in part)
        part.functionResponse.name =
          map[part.functionResponse.name] ?? sanitizeFunctionName(part.functionResponse.name);
      if (model.startsWith("gemini-") && (turn.role !== "model" || "functionResponse" in part)) {
        delete (part as { thoughtSignature?: string }).thoughtSignature;
      }
    }
  return reverse;
}
