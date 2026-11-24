/** Shared c2a native Gemini content grouping/roles/signature semantics. */
import { isRecord } from "../utils/util.js";
import { trimCodexWhitespace as trim } from "./scaffolding.js";
type Obj = Record<string, unknown>;
const rows = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isRecord) : []);
const values = (v: unknown): unknown[] => (Array.isArray(v) ? (v as unknown[]) : []);
const text = (v: unknown) => (typeof v === "string" ? v : "");
const nested = (o: Obj, key: string) => (isRecord(o[key]) ? o[key] : undefined);
const skip = "skip_thought_signature_validator";
export function groupNativeToolResults(request: Obj): void {
  if (!Array.isArray(request.contents)) return;
  const contents = rows(request.contents);
  if (
    !contents.some((c) =>
      rows(c.parts).some(
        (p) => Object.hasOwn(p, "functionResponse") || Object.hasOwn(p, "function_response"),
      ),
    )
  )
    return;
  const rebuilt: Obj[] = [],
    pending: { names: string[]; count: number }[] = [],
    collected: Obj[] = [];
  const flush = (responses: Obj[], names: string[]) => {
    if (!responses.length) return;
    rebuilt.push({
      role: "function",
      parts: responses.map((p, i) => {
        const r = nested(p, "functionResponse") ?? nested(p, "function_response");
        if (!r)
          return { functionResponse: { name: names[i] || "unknown", response: { result: "" } } };
        if (!trim(text(r.name)) && names[i]) r.name = names[i];
        return { functionResponse: r };
      }),
    });
  };
  for (const c of contents) {
    const responses: Obj[] = [],
      leading: Obj[] = [];
    let current: Obj | undefined;
    for (const p of rows(c.parts)) {
      const r = nested(p, "functionResponse") ?? nested(p, "function_response");
      if (Object.hasOwn(p, "functionResponse") || Object.hasOwn(p, "function_response")) {
        responses.push(p);
        current = r;
        if (current && leading.length) {
          current.parts = [...values(current.parts), ...leading];
          leading.length = 0;
        }
        continue;
      }
      const raw = nested(p, "inlineData") ?? nested(p, "inline_data");
      if (!raw || !trim(text(raw.data))) continue;
      const image = {
        inlineData: {
          mimeType: text(raw.mimeType) || text(raw.mime_type) || "image/png",
          data: raw.data,
        },
      };
      if (current) current.parts = [...values(current.parts), image];
      else leading.push(image);
    }
    if (responses.length) {
      collected.push(...responses);
      while (pending.length && collected.length >= pending[0].count) {
        const group = pending.shift()!;
        flush(collected.splice(0, group.count), group.names);
      }
      continue;
    }
    if (c.role === "model") {
      const names = rows(c.parts).flatMap((p) => {
        const name = text(nested(p, "functionCall")?.name);
        return trim(name) ? [name] : [];
      });
      if (names.length) pending.push({ names, count: names.length });
    }
    rebuilt.push(c);
  }
  for (const group of pending)
    if (collected.length >= group.count) flush(collected.splice(0, group.count), group.names);
  request.contents = rebuilt;
}
export function normalizeNativeRoles(request: Obj): void {
  let previous = "";
  for (const c of rows(request.contents)) {
    let role = text(c.role);
    if (role !== "user" && role !== "model") {
      role =
        rows(c.parts).some(
          (p) => Object.hasOwn(p, "functionResponse") || Object.hasOwn(p, "function_response"),
        ) ||
        !previous ||
        previous === "model"
          ? "user"
          : "model";
      c.role = role;
    }
    previous = role;
  }
}
function deleteSignatures(p: Obj): void {
  delete p.thoughtSignature;
  delete p.thought_signature;
  for (const key of ["functionCall", "function_call", "functionResponse", "function_response"]) {
    const n = nested(p, key);
    if (n) {
      delete n.thoughtSignature;
      delete n.thought_signature;
    }
  }
  const google = nested(nested(p, "extra_content") ?? {}, "google");
  if (google) delete google.thought_signature;
}
function hasSignature(p: Obj): boolean {
  for (const path of [
    ["thoughtSignature"],
    ["thought_signature"],
    ["functionCall", "thoughtSignature"],
    ["functionCall", "thought_signature"],
    ["function_call", "thoughtSignature"],
    ["function_call", "thought_signature"],
  ]) {
    let current: unknown = p;
    for (let i = 0; i < path.length; i++) {
      if (!isRecord(current) || !Object.hasOwn(current, path[i])) break;
      current = current[path[i]];
      if (i === path.length - 1) {
        if (typeof current === "string" && trim(current)) return true;
        return false;
      }
    }
  }
  return false;
}
export function sanitizeNativeSignatures(request: Obj, model: string): void {
  if (!trim(model).toLowerCase().startsWith("gemini-")) return;
  for (const c of rows(request.contents))
    for (const p of rows(c.parts)) {
      if (Object.hasOwn(p, "functionResponse")) {
        deleteSignatures(p);
        continue;
      }
      const legacy = nested(p, "function_response");
      if (legacy) {
        deleteSignatures(p);
        delete legacy.thoughtSignature;
        delete legacy.thought_signature;
        continue;
      }
      if (Object.hasOwn(p, "functionCall")) {
        if (!hasSignature(p)) {
          p.thoughtSignature = skip;
          p.thought_signature = skip;
        }
        continue;
      }
      if (c.role !== "model") deleteSignatures(p);
    }
}

export function renameAllowedFunctions(request: Obj, rename: (name: unknown) => string): void {
  for (const [outer, inner, key] of [
    ["toolConfig", "functionCallingConfig", "allowedFunctionNames"],
    ["tool_config", "function_calling_config", "allowed_function_names"],
  ]) {
    const cfg = nested(nested(request, outer) ?? {}, inner);
    if (cfg && Array.isArray(cfg[key]))
      cfg[key] = values(cfg[key]).map((v) => (typeof v === "string" ? rename(v) : v));
  }
}
