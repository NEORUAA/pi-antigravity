/** Direct algorithm port of pinned codex2api schema/refs/union cleanup.
 * Tested against an independent Go oracle from the reference source. */
import { isRecord } from "../utils/util.js";
const known = new Set([
  "properties",
  "patternProperties",
  "additionalProperties",
  "items",
  "prefixItems",
  "$defs",
  "definitions",
  "dependentSchemas",
  "dependentRequired",
  "dependencies",
  "if",
  "then",
  "else",
  "not",
  "contains",
  "propertyNames",
  "unevaluatedProperties",
  "unevaluatedItems",
  "contentSchema",
  "additionalItems",
  "default",
  "const",
  "example",
  "examples",
  "discriminator",
  "xml",
  "enumDescriptions",
  "enumTitles",
]);
const stringNames = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item: unknown): item is string => typeof item === "string" && !!item.trim())
    : [];
const types = (value: unknown): string[] =>
  (Array.isArray(value) ? (value as unknown[]) : [value])
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().toLowerCase());
const mergeRequired = (a: unknown, b: string[]) => [
  ...new Set([...stringNames(a), ...b].map((item) => item.trim()).filter(Boolean)),
];
const hint = (existing: unknown, text: string): string => {
  const current = typeof existing === "string" ? existing.trim() : "";
  return !current ? text : current.includes(text) ? current : `${current} (${text})`;
};
function repair(node: Record<string, unknown>): Record<string, unknown> {
  const out = { ...node };
  const t = types(out.type);
  // Match source's array-type first-nonempty behavior, including malformed unions.
  const nonObject = !t.includes("object") && !!t.find((item) => item);
  if (!nonObject) {
    const bare = Object.fromEntries(
      Object.entries(out).filter(
        ([key, value]) => isRecord(value) && !known.has(key) && !key.startsWith("x-"),
      ),
    );
    if (Object.keys(bare).length) {
      for (const key of Object.keys(bare)) delete out[key];
      out.properties = { ...(isRecord(out.properties) ? out.properties : {}), ...bare };
      out.type ??= "object";
    }
  }
  if (isRecord(out.properties)) {
    const promoted: string[] = [];
    out.properties = Object.fromEntries(
      Object.entries(out.properties).map(([key, value]) => {
        if (!isRecord(value)) return [key, value];
        const child = { ...value };
        if (typeof child.required === "boolean") {
          if (child.required) promoted.push(key);
          delete child.required;
        }
        return [key, repair(child)];
      }),
    );
    if (promoted.length) out.required = mergeRequired(out.required, promoted.sort());
  }
  if (t.includes("array") && !Object.hasOwn(out, "items")) out.items = { type: "string" };
  for (const key of [
    "items",
    "additionalProperties",
    "if",
    "then",
    "else",
    "not",
    "contains",
    "propertyNames",
  ])
    if (isRecord(out[key])) out[key] = repair(out[key]);
  for (const key of ["anyOf", "oneOf", "allOf", "prefixItems"]) {
    const value = out[key];
    if (Array.isArray(value))
      out[key] = value.map((item: unknown) => (isRecord(item) ? repair(item) : item));
  }
  for (const key of ["$defs", "definitions", "dependentSchemas"]) {
    const value = out[key];
    if (isRecord(value))
      out[key] = Object.fromEntries(
        Object.entries(value).map(([name, item]) => [name, isRecord(item) ? repair(item) : item]),
      );
  }
  return out;
}
const decodeToken = (text: string): string => text.replace(/~1/g, "/").replace(/~0/g, "~");
function pointer(root: unknown, ref: string): unknown {
  let current = root;
  for (const token of ref.slice(2).split("/").filter(Boolean)) {
    const part = decodeToken(token);
    if (isRecord(current) && Object.hasOwn(current, part)) current = current[part];
    else if (Array.isArray(current) && /^\+?\d+$/.test(part) && Number(part) < current.length)
      current = (current as unknown[])[Number(part)];
    else return undefined;
  }
  return current;
}
function refName(ref: string): string {
  const path = ref.replace(/^#\//, "");
  const index = path.lastIndexOf("/");
  return index >= 0 && index + 1 < path.length ? decodeToken(path.slice(index + 1)) : path;
}
function refs(root: unknown, value: unknown, active = new Set<string>()): unknown {
  if (Array.isArray(value)) return value.map((item: unknown) => refs(root, item, active));
  if (!isRecord(value)) return value;
  const ref = typeof value.$ref === "string" ? value.$ref.trim() : "";
  if (ref.startsWith("#/")) {
    const target = pointer(root, ref);
    if (target !== undefined) {
      if (active.has(ref)) {
        const fallback = isRecord(target)
          ? Object.fromEntries(
              Object.entries(target).filter(([key]) =>
                ["type", "nullable", "description"].includes(key),
              ),
            )
          : {};
        for (const [key, item] of Object.entries(value)) if (key !== "$ref") fallback[key] = item;
        fallback.description = hint(fallback.description, `See: ${refName(ref)}`);
        return fallback;
      }
      active.add(ref);
      const resolved = refs(root, target, active);
      active.delete(ref);
      if (isRecord(resolved)) {
        const out = { ...resolved };
        for (const [key, item] of Object.entries(value))
          if (key !== "$ref") out[key] = refs(root, item, active);
        return out;
      }
    }
    const fallback: Record<string, unknown> = {
      type: "object",
      description: hint(value.description, `See: ${refName(ref)}`),
    };
    for (const [key, item] of Object.entries(value))
      if (key !== "$ref" && key !== "description") fallback[key] = item;
    return fallback;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, refs(root, item, active)]),
  );
}
function merge(target: Record<string, unknown>, source: Record<string, unknown>): void {
  if (isRecord(source.properties))
    target.properties = {
      ...source.properties,
      ...(isRecord(target.properties) ? target.properties : {}),
    };
  if (Array.isArray(source.required)) {
    const required = Array.isArray(target.required) ? [...(target.required as unknown[])] : [];
    const seen = new Set(required.filter((name): name is string => typeof name === "string"));
    for (const name of source.required as unknown[])
      if (typeof name === "string" && name && !seen.has(name)) {
        required.push(name);
        seen.add(name);
      }
    if (required.length) target.required = required;
  }
  if (typeof source.type === "string" && !Object.hasOwn(target, "type"))
    target.type = source.type.trim().toLowerCase();
}
function score(value: Record<string, unknown>): number {
  return (isRecord(value.properties) && Object.keys(value.properties).length) ||
    String(value.type).toLowerCase() === "object"
    ? 3
    : Object.hasOwn(value, "items")
      ? 2
      : typeof value.type === "string" && value.type && value.type.toLowerCase() !== "null"
        ? 1
        : 0;
}
function flatten(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item: unknown) => flatten(item));
  if (!isRecord(value)) return value;
  const out = { ...value };
  if (Array.isArray(out.allOf)) {
    for (const branch of out.allOf as unknown[]) {
      const node = flatten(branch);
      if (isRecord(node)) merge(out, node);
    }
    delete out.allOf;
  }
  for (const key of ["anyOf", "oneOf"]) {
    const union = out[key];
    if (!Array.isArray(union) || !union.length) continue;
    const branches = (union as unknown[]).map(flatten).filter(isRecord);
    const hasNull = branches.some(
      (node) => typeof node.type === "string" && node.type.toLowerCase() === "null",
    );
    const valid = branches.filter(
      (node) => !(typeof node.type === "string" && node.type.toLowerCase() === "null"),
    );
    if (isRecord(out.properties) && Object.keys(out.properties).length)
      for (const branch of branches) merge(out, branch);
    else {
      valid.sort((a, b) => score(b) - score(a));
      if (valid[0]) merge(out, valid[0]);
    }
    if (hasNull) out.nullable = true;
    delete out[key];
  }
  return Object.fromEntries(Object.entries(out).map(([key, item]) => [key, flatten(item)]));
}
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
function clean(
  value: unknown,
  depth = 0,
  preservePropertyNames = false,
  definitions: Record<string, unknown> = {},
  resolving = new Set<string>(),
): unknown {
  if (depth > 32 || value === null) return undefined;
  if (Array.isArray(value))
    return (value as unknown[])
      .map((item) => clean(item, depth + 1, preservePropertyNames, definitions, resolving))
      .filter((item) => item !== undefined);
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  if (typeof value.$ref === "string" && value.$ref) {
    let name = value.$ref.replace(/^#\/(?:\$defs|definitions)\//, "");
    if (name === value.$ref) name = "";
    try {
      name = decodeURIComponent(name);
    } catch {
      /* Match Go's PathUnescape failure fallback. */
    }
    name = decodeToken(name);
    if (name && Object.hasOwn(definitions, name) && !resolving.has(name)) {
      resolving.add(name);
      const expanded = clean(
        definitions[name],
        depth + 1,
        preservePropertyNames,
        definitions,
        resolving,
      );
      resolving.delete(name);
      if (isRecord(expanded)) Object.assign(out, expanded);
    }
  }
  for (const [key, item] of Object.entries(value)) {
    if (preservePropertyNames && key === "properties" && isRecord(item)) {
      out.properties = Object.fromEntries(
        Object.entries(item)
          .map(([name, schema]) => [name, clean(schema, depth + 2, true, definitions, resolving)])
          .filter(([, schema]) => schema !== undefined),
      );
      continue;
    }
    if (omitted.has(key)) continue;
    if (key === "type") {
      const list = types(item);
      const type = list.find((entry) => entry !== "null");
      if (type) out.type = type;
      if (type && list.includes("null")) out.nullable = true;
    } else if (key === "const") out.enum = [item];
    else {
      const result = clean(item, depth + 1, preservePropertyNames, definitions, resolving);
      if (result !== undefined) out[key] = result;
    }
  }
  return out;
}
function goText(value: unknown): string {
  if (value === null) return "<nil>";
  if (Array.isArray(value)) return `[${(value as unknown[]).map(goText).join(" ")}]`;
  if (isRecord(value))
    return `map[${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${key}:${goText(item)}`)
      .join(" ")}]`;
  return String(value);
}
function cleanupRequired(value: unknown, preservePropertyNames = false): void {
  if (Array.isArray(value)) {
    for (const item of value as unknown[]) cleanupRequired(item, preservePropertyNames);
    return;
  }
  if (!isRecord(value)) return;
  if (Object.hasOwn(value, "required")) {
    const props = isRecord(value.properties) ? value.properties : {};
    const valid = stringNames(value.required).filter((key) => Object.hasOwn(props, key));
    if (valid.length) value.required = valid;
    else delete value.required;
  }
  for (const [key, item] of Object.entries(value))
    if (preservePropertyNames && key === "properties" && isRecord(item)) {
      for (const schema of Object.values(item)) cleanupRequired(schema, true);
    } else if (key !== "required") cleanupRequired(item, preservePropertyNames);
}
function dropEnums(value: unknown, preservePropertyNames = false): void {
  if (Array.isArray(value)) {
    for (const item of value as unknown[]) dropEnums(item, preservePropertyNames);
    return;
  }
  if (!isRecord(value)) return;
  if (Array.isArray(value.enum) && value.enum.length) {
    value.description = hint(
      value.description,
      `Allowed: ${(value.enum as unknown[]).map(goText).join(", ")}`,
    );
    delete value.enum;
  }
  for (const [key, item] of Object.entries(value))
    if (preservePropertyNames && key === "properties" && isRecord(item)) {
      for (const schema of Object.values(item)) dropEnums(schema, true);
    } else if (key !== "enum") dropEnums(item, preservePropertyNames);
}
function ensureArrays(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value as unknown[]) ensureArrays(item);
    return;
  }
  if (!isRecord(value)) return;
  if (types(value.type).includes("array") && !Object.hasOwn(value, "items"))
    value.items = { type: "string" };
  for (const item of Object.values(value)) ensureArrays(item);
}
export function codexToolSchema(
  raw: unknown,
  preservePropertyNames = false,
): Record<string, unknown> {
  const root = isRecord(raw) ? repair(raw) : { type: "object", properties: {} };
  const result = clean(flatten(refs(root, root)), 0, preservePropertyNames);
  const out = isRecord(result) ? result : {};
  out.type ??= "object";
  if (!Object.hasOwn(out, "properties")) out.properties = {};
  cleanupRequired(out, preservePropertyNames);
  dropEnums(out, preservePropertyNames);
  ensureArrays(out);
  const props = isRecord(out.properties) ? out.properties : {};
  if (
    !Object.keys(props).length &&
    (typeof out.type !== "string" || out.type.toLowerCase() === "object")
  ) {
    out.properties = {
      reason: { type: "string", description: "Brief explanation of why you are calling this tool" },
    };
    out.required = ["reason"];
  }
  return out;
}

/** Preserve Pi/JSON-Schema parameter names; do not reproduce the source's
 * keyword/property-bag confusion. All actual schema nodes use its algorithm. */
export const piToolSchema = (raw: unknown): Record<string, unknown> => codexToolSchema(raw, true);

/** Native generationConfig.responseJsonSchema is not a tool: no placeholder,
 * union repair, enum-to-prose conversion or required-field promotion is added. */
export function codexResponseSchema(raw: unknown, preservePropertyNames = false): unknown {
  if (!isRecord(raw)) return raw;
  const definitions = {
    ...(isRecord(raw.$defs) ? raw.$defs : {}),
    ...(isRecord(raw.definitions) ? raw.definitions : {}),
  };
  const result = clean(raw, 0, preservePropertyNames, definitions);
  return isRecord(result) && Object.keys(result).length ? result : raw;
}
