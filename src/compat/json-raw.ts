/** Preserve the raw JSON argument spelling/order used by c2a's gjson JSON-mode
 * adapter; metadata is weakly held and never serialized or logged. */
const originals = new WeakMap<object, string>();
export const rememberRawJSON = <T>(value: T, raw: string): T => {
  if (value !== null && typeof value === "object") originals.set(value, raw);
  return value;
};
export const originalJSON = (value: object) => originals.get(value);
export function rawJSONAt(raw: string, path: (string | number)[]): string | undefined {
  const space = (i: number) => {
    while (/[ \r\n\t]/.test(raw[i] ?? "!") && i < raw.length) i++;
    return i;
  };
  const end = (start: number): number => {
    let i = start,
      quoted = false,
      escaped = false,
      depth = 0;
    for (; i < raw.length; i++) {
      const ch = raw[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') {
          quoted = false;
          if (!depth) return i + 1;
        }
        continue;
      }
      if (ch === '"') {
        quoted = true;
        continue;
      }
      if (ch === "{" || ch === "[") {
        depth++;
        if (depth > 1024) throw new Error("JSON nesting exceeds native adapter limit");
      } else if (ch === "}" || ch === "]") {
        if (!depth) return i;
        depth--;
        if (!depth) return i + 1;
      } else if (!depth && (ch === "," || /[ \t\r\n]/.test(ch))) return i;
    }
    return i;
  };
  let start = space(0);
  for (const segment of path) {
    const object = raw[start] === "{";
    if (!object && raw[start] !== "[") return;
    let i = space(start + 1),
      index = 0,
      found = false;
    while (i < raw.length && !/[}\]]/.test(raw[i])) {
      let key: string | number = index++;
      if (object) {
        const keyEnd = end(i);
        key = JSON.parse(raw.slice(i, keyEnd)) as string;
        i = space(keyEnd);
        if (raw[i] !== ":") return;
        i = space(i + 1);
      }
      const valueEnd = end(i);
      if (key === segment) {
        start = i;
        found = true;
        break;
      }
      i = space(valueEnd);
      if (raw[i] !== ",") break;
      i = space(i + 1);
    }
    if (!found) return;
  }
  return raw.slice(start, end(start));
}
export function compactRawJSON(raw: string): string {
  let out = "",
    quoted = false,
    escaped = false;
  for (const ch of raw) {
    if (quoted) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') quoted = false;
    } else if (ch === '"') {
      quoted = true;
      out += ch;
    } else if (!/[ \r\n\t]/.test(ch)) out += ch;
  }
  return out;
}
