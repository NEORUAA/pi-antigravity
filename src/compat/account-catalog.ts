/** Account/public/admin projection from pinned proxy/antigravity_models.go:263-431
 * and auth/store.go:12682-12699. Definitions alone never establish eligibility. */
import { CODEX_CATALOG } from "./catalog.js";
import { trimCodexWhitespace as trim } from "./scaffolding.js";
import type { QuotaSnapshot } from "../auth/quota-snapshot.js";
const publicDefinitions = CODEX_CATALOG.filter((d) => d.wire !== undefined);
const logical = new Set(CODEX_CATALOG.filter((d) => d.wire === undefined).map((d) => d.id));
const retired = new Set([
  "gemini-3.5-flash",
  "gemini-3.5-flash-extra-low",
  "gemini-3.5-flash-low",
  "gemini-3.5-flash-medium",
  "gemini-3.5-flash-high",
  "gemini-3-flash-agent",
  "gemini-2.5-pro",
]);
const disabled = (id: string) => /(?:^|[-_])disabled(?:[-_]|$)/.test(id.toLowerCase());
const textCompatible = (id: string) =>
  !!trim(id) &&
  !id.toLowerCase().startsWith("imagen") &&
  !id.toLowerCase().includes("-image") &&
  !id.toLowerCase().includes("image-");
const wires = (id: string) => {
  const d = CODEX_CATALOG.find((d) => d.id === id);
  return d ? [...new Set(d.wire ? [d.wire] : d.variants.map((v) => v.wire))] : [];
};
export function projectAccountModelIds(raw: readonly string[], admin = false): string[] {
  const available = new Set(raw.map((x) => trim(x).toLowerCase()).filter(Boolean));
  const published = publicDefinitions
    .filter((d) => wires(d.id).every((w) => available.has(w)))
    .map((d) => d.id);
  const knownWires = new Set(
    publicDefinitions.flatMap((d) => wires(d.id)).map((x) => x.toLowerCase()),
  );
  const discovered = new Set<string>();
  for (const value of raw) {
    const model = trim(value),
      name = model.toLowerCase();
    if (
      name === "gemini-4-argon" ||
      ["chat_20706", "chat_23310"].includes(name) ||
      name.startsWith("tab_") ||
      retired.has(name)
    )
      continue;
    if (
      ["-tiered", "-sonar"].some((marker) => {
        const i = name.indexOf(marker);
        return (
          i >= 0 &&
          (!name.slice(i + marker.length) || name.slice(i + marker.length).startsWith("-")) &&
          logical.has(name.slice(0, i))
        );
      })
    )
      continue;
    if (
      available.has("gemini-3.1-flash-lite") &&
      ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-flash-thinking"].includes(name)
    )
      continue;
    const placeholder =
      admin &&
      disabled(model) &&
      Buffer.byteLength(model) <= 200 &&
      !/[\r\n\t ]/.test(model) &&
      textCompatible(model);
    if (
      !knownWires.has(name) &&
      ((textCompatible(model) && !disabled(model)) || placeholder) &&
      !publicDefinitions.some((d) => d.id === name)
    )
      discovered.add(model);
  }
  return [
    ...published,
    ...[...discovered].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))),
  ];
}
export function accountRawModelIds(snapshot: QuotaSnapshot): string[] {
  if (snapshot.forbidden) return [];
  const internal = new Set(snapshot.internalModelIds.map((x) => x.toLowerCase()));
  return [
    ...new Set(
      [...snapshot.catalogModelIds, ...snapshot.models.map((x) => x.modelId)]
        .map(trim)
        .filter((x) => x && !internal.has(x.toLowerCase())),
    ),
  ];
}
export function accountModelIds(snapshot: QuotaSnapshot, admin = false): string[] {
  return projectAccountModelIds(accountRawModelIds(snapshot), admin);
}

export function accountSupportsModel(snapshot: QuotaSnapshot, id: string): boolean {
  if (snapshot.forbidden || disabled(id) || retired.has(id.toLowerCase())) return false;
  const raw = accountRawModelIds(snapshot),
    available = new Set(raw.map((x) => x.toLowerCase()));
  const required = wires(id.toLowerCase());
  return required.length
    ? required.every((x) => available.has(x))
    : accountModelIds(snapshot).some((x) => x.toLowerCase() === id.toLowerCase());
}
