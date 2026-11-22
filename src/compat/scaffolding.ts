/** Faithful application normalization from codex2api d8e1981f client_scaffolding.go.
 * Code examples are opaque; this is not an official-client or account-risk claim. */
const LIMIT = 1 << 20;
const enabled = () =>
  !/^(0|false|no|off)$/i.test(process.env.CLIENT_SCAFFOLDING_STRIP?.trim() ?? "");
const remindersEnabled = () =>
  enabled() &&
  !/^(0|false|no|off)$/i.test(process.env.CLIENT_SCAFFOLDING_STRIP_REMINDERS?.trim() ?? "");
/** Go regexp uses ASCII \s and dot excludes only LF (not JS's CR/U+2028).
 * Keep these observable normalizer semantics instead of relying on JS defaults. */
function goRegex(source: string): RegExp {
  const flags = source.match(/^\(\?([ims]+)\)/)?.[1] ?? "";
  const raw = source.replace(/^\(\?[ims]+\)/, "");
  let pattern = "",
    inClass = false;
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index];
    if (char === "\\") {
      const next = raw[++index];
      pattern +=
        next === "s" && !inClass
          ? "[\\t\\n\\f\\r ]"
          : next === "S" && !inClass
            ? "[^\\t\\n\\f\\r ]"
            : `\\${next}`;
    } else {
      if (char === "[") inClass = true;
      else if (char === "]") inClass = false;
      if (char === "^" && !inClass && flags.includes("m")) {
        pattern += "(?:^|(?<=\\n))";
        continue;
      }
      pattern += char === "." && !inClass && !flags.includes("s") ? "[^\\n]" : char;
    }
  }
  return new RegExp(pattern, `${flags.replace("m", "")}gu`);
}
export function trimCodexWhitespace(text: string): string {
  return text.replace(
    /^[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\t\n\v\f\r \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g,
    "",
  );
}
const clientScaffoldingProductLinePatterns = [
  "(?im)^[ \\t]*\\[OpenMausBot:[^\\]\\r\\n]*\\][ \\t]*\\r?\\n?",
  "(?im)^[ \\t]*\\[OpenMausBot started this again by itself, once:[^\\]\\r\\n]*\\][ \\t]*\\r?\\n?",
  "(?im)^[ \\t]*\\[(?:Payload|Event) truncated by OpenMausBot\\][ \\t]*\\r?\\n?",
  "(?im)^[ \\t]*⚠️?[ \\t]*(?:TRUNCATED|SHAPED) by OpenMausBot:[^\\r\\n]*\\r?\\n?",
  "(?im)^[ \\t]*\\[(?:Escalation notice from|From) OpenMausBot[^\\]\\r\\n]*\\][ \\t]*\\r?\\n?",
  "(?im)^[ \\t]*\\[From [^\\]\\r\\n]*·[^\\]\\r\\n]*·[^\\]\\r\\n]*\\][ \\t]*\\r?\\n?",
  "(?im)^[ \\t]*\\[Message from @[^\\]\\r\\n]*OpenMausBot[^\\]\\r\\n]*\\][ \\t]*\\r?\\n?",
  "(?im)^[ \\t]*(?:-[ \\t]*)?OpenMausBot (?:already retried this run|did not retry it|cannot trace this work)[^\\r\\n]*\\r?\\n?",
  "(?im)^[ \\t]*Context from OpenMausBot updated since this conversation started; it replaces any earlier copy:[ \\t]*\\r?\\n?",
  "(?im)^[ \\t]*The OpenMausBot context notes from earlier in this conversation have been cleared; the standing instructions still apply\\.[ \\t]*\\r?\\n?",
  "(?im)^[ \\t]*-[ \\t]*\\d{4}-\\d{2}-\\d{2}[ \\t]*·[ \\t]*learned by [^·\\r\\n]*[ \\t]*·.*\\r?\\n?",
  "(?i)[ \\t]*TEST EVENT, started from OpenMausBot:[^\\r\\n]*",
].map(goRegex);
const clientScaffoldingBillingLinePatterns = [
  "(?im)^[ \\t]*x-anthropic-billing-header:.*\\r?\\n?",
  "(?im)^[ \\t]*custom-billing-id:.*\\r?\\n?",
  "(?im)^[ \\t]*cc_version=.*\\r?\\n?",
  "(?im)^[ \\t]*cc_entrypoint=.*\\r?\\n?",
  "(?im)^[ \\t]*cch=.*\\r?\\n?",
].map(goRegex);
const clientScaffoldingThirdPartyIdentityPatterns = [
  "(?i)^You are opencode, [^.\\n]*?\\.\\s*",
  "(?i)^You are [^.\\n]*?, a personal bot in (?:OpenMausBot|MausBot|Maus-Bot)\\.\\s*",
  '(?i)^You are [^.\\n]*?, a bot in the room "[^"\\n]*" in (?:OpenMausBot|MausBot|Maus-Bot)\\.\\s*',
  "(?i)^You are [^.\\n]*?, an AI agent that [^.\\n]*?(?:OpenMausBot|MausBot|Maus-Bot)[^.\\n]*?\\.\\s*",
  "(?i)^You are [^.\\n]*?'s assistant and Chief of Staff: [^.\\n]*?\\.\\s*",
  "(?i)^You are the person's assistant and the Chief of Staff for the [^.\\n]*? department: [^.\\n]*?\\.\\s*",
  "(?i)^You hold a Chief of Staff's tools[^.\\n]*?\\.\\s*",
  "(?i)^You are (?:Claude Code|Codex)\\b[^.\\n]*?\\.\\s*",
].map(goRegex);
const clientScaffoldingLinePatterns = [
  "(?im)^[ \\t]*Co-Authored-By:[ \\t]*Claude Code[ \\t]*<noreply@anthropic\\.com>[ \\t]*\\r?\\n?",
  "(?im)^[ \\t]*🤖[ \\t]*Generated with \\[Claude Code\\]\\(https://claude\\.com/claude-code\\)[ \\t]*\\r?\\n?",
  "(?im)^[ \\t]*You are powered by the model[ \\t]+\\S+\\.?[ \\t]*\\r?\\n?",
].map(goRegex);
const clientScaffoldingReminderMarkers = [
  "# environment",
  "you have been invoked in the following environment",
  "you are powered by the model",
  "available agent types for the agent tool",
  "following skills are available for use with the skill tool",
  "attribution for git commits and pull requests",
  "# session-specific guidance",
  "here is useful information about the environment",
  "this part of your instructions changes from turn to turn",
  "this part of your instructions changed since this session started",
  "the notes that were in your instructions when this session started have been cleared",
  "the openmausbot context notes from earlier in this conversation have been cleared",
];
const clientScaffoldingBrandPhrases = [
  "learned by MausBot",
  "OpenMausBot",
  "OpenMaus",
  "OpenCode",
  "MausBot Cloud",
  "Maus-Bot",
  "MausBot",
  "My Cloud",
  "Chief of Staff",
];
const clientScaffoldingMarkerPattern = goRegex(
  "(?i)(?:openmausbot|mausbot|maus-bot|chief of staff|opencode|learned by |\\[from |<system-reminder>|co-authored-by:|generated with \\[claude code\\]|you are powered by the model|you are claude code|you are codex|x-anthropic-billing-header:|custom-billing-id:|cc_version=|cc_entrypoint=|cch=)",
);
const clientScaffoldingProductMarkerPattern = goRegex(
  "(?i)(?:openmausbot|mausbot|maus-bot|learned by |\\[from |<system-reminder>)",
);

const test = (pattern: RegExp, text: string) => {
  pattern.lastIndex = 0;
  return pattern.test(text);
};
const OFFICIAL_IDENTITY = "You are Antigravity, a large language model built by Google.";
function fenceEnd(text: string, index: number): number | undefined {
  if (index && text[index - 1] !== "\n") return;
  let cursor = index;
  while (cursor < text.length && cursor - index < 3 && /[ \t]/.test(text[cursor])) cursor++;
  const fence = text[cursor];
  if (fence !== "`" && fence !== "~") return;
  const start = cursor;
  while (text[cursor] === fence) cursor++;
  const length = cursor - start;
  if (length < 3) return;
  cursor = text.indexOf("\n", cursor);
  if (cursor < 0) return;
  cursor++;
  while (cursor < text.length) {
    let lineEnd = text.indexOf("\n", cursor);
    if (lineEnd < 0) lineEnd = text.length;
    let close = cursor;
    while (close < lineEnd && close - cursor < 3 && /[ \t]/.test(text[close])) close++;
    const closeStart = close;
    while (close < lineEnd && text[close] === fence) close++;
    if (close - closeStart >= length && trimCodexWhitespace(text.slice(close, lineEnd)) === "")
      return lineEnd < text.length ? lineEnd + 1 : lineEnd;
    if (lineEnd === text.length) break;
    cursor = lineEnd + 1;
  }
}
function startsFence(line: string): boolean {
  const match = line.match(/^[ \t]{0,3}(`{3,}|~{3,})([\s\S]*)$/);
  return !!match && (match[1][0] !== "`" || !match[2].includes("`"));
}
function paragraphEnd(text: string, start: number): number {
  let cursor = start;
  while (cursor < text.length) {
    const end = text.indexOf("\n", cursor);
    if (end < 0) return text.length;
    const line = text.slice(cursor, end);
    if ((/^[ \t]*\r?$/.test(line) && cursor > start) || startsFence(line)) return cursor;
    cursor = end + 1;
  }
  return text.length;
}
function inlineEnd(text: string, index: number, boundary: number): number | undefined {
  if (text[index] !== "`") return;
  let run = index;
  while (text[run] === "`") run++;
  const length = run - index;
  for (let cursor = run; cursor < boundary;) {
    if (text[cursor] !== "`") {
      cursor++;
      continue;
    }
    let close = cursor;
    while (close < boundary && text[close] === "`") close++;
    if (close - cursor === length) return close;
    cursor = close;
  }
}
export function maskCode(text: string, apply: (text: string) => string): string {
  const blocks: string[] = [];
  let masked = "",
    boundary = 0;
  for (let index = 0; index < text.length;) {
    const end = fenceEnd(text, index);
    if (end !== undefined) {
      let block = text.slice(index, end),
        suffix = "";
      if (block.endsWith("\r\n")) {
        suffix = "\r\n";
        block = block.slice(0, -2);
      } else if (block.endsWith("\n")) {
        suffix = "\n";
        block = block.slice(0, -1);
      }
      masked += `\0code${blocks.length}\0${suffix}`;
      blocks.push(block);
      index = end;
      continue;
    }
    if (boundary <= index) boundary = paragraphEnd(text, index);
    const close = inlineEnd(text, index, boundary);
    if (close !== undefined) {
      masked += `\0code${blocks.length}\0`;
      blocks.push(text.slice(index, close));
      index = close;
      continue;
    }
    if (text[index] === "`") {
      while (text[index] === "`") masked += text[index++];
      continue;
    }
    masked += text[index++];
  }
  const output = apply(blocks.length ? masked : text);
  return blocks.length
    ? output.replace(
        /\0code([0-9]+)\0/g,
        (token: string, index: string) => blocks[Number(index)] ?? token,
      )
    : output;
}
function stripReminders(text: string): string {
  return text.replace(
    goRegex("(?is)<system-reminder>\\s*(.*?)\\s*</system-reminder>"),
    (block: string, body: string) =>
      clientScaffoldingReminderMarkers.some((marker) => body.toLowerCase().includes(marker))
        ? ""
        : block,
  );
}
export function obfuscatePhrases(text: string, phrases: string[]): string {
  const values = phrases
    .map((phrase) => phrase.trim())
    .filter((phrase) => Array.from(phrase).length >= 2 && !phrase.includes("\u200b"));
  if (!values.length) return text;
  const pattern = new RegExp(
    values.map((phrase) => phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
    "gi",
  );
  for (let pass = 0; pass < 3; pass++) {
    const next = text.replace(pattern, (match) => {
      const first = Array.from(match)[0];
      return `${first}\u200b${match.slice(first.length)}`;
    });
    if (next === text) break;
    text = next;
  }
  return text;
}
const defaultSensitive = [
  "Hermes Agent",
  "Nous Research",
  "Claude Agent SDK",
  "You are Codex, an agent based on GPT-5",
  "learned by MausBot",
  "OpenMausBot",
  "OpenMaus",
  "OpenCode",
  "MausBot Cloud",
  "Maus-Bot",
  "MausBot",
  "My Cloud",
  "Chief of Staff",
];
function sensitive(): string[] {
  return [
    ...defaultSensitive,
    ...(process.env.ANTIGRAVITY_SENSITIVE_PHRASES ?? "").split(/[,;\r\n]/),
  ]
    .filter((phrase) => phrase.trim())
    .sort((a, b) => Buffer.byteLength(b) - Buffer.byteLength(a));
}
function unmasked(text: string): string {
  const volatile = text
    .trim()
    .toLowerCase()
    .startsWith("context from openmausbot updated since this conversation started");
  let out = remindersEnabled() ? stripReminders(text) : text;
  for (const pattern of [
    ...clientScaffoldingLinePatterns,
    ...clientScaffoldingBillingLinePatterns,
    ...clientScaffoldingProductLinePatterns,
  ])
    out = out.replace(pattern, "");
  return volatile ? obfuscatePhrases(out, clientScaffoldingBrandPhrases) : out;
}
export function normalizeConversation(text: string): string {
  if (!text || Buffer.byteLength(text) > LIMIT || !enabled()) return text;
  return test(clientScaffoldingMarkerPattern, text)
    ? trimCodexWhitespace(maskCode(text, unmasked))
    : trimCodexWhitespace(text);
}
export function normalizeProduct(text: string): string {
  if (
    !text ||
    Buffer.byteLength(text) > LIMIT ||
    !enabled() ||
    !test(clientScaffoldingProductMarkerPattern, text)
  )
    return text;
  const out = maskCode(text, (masked) => {
    let result = remindersEnabled() ? stripReminders(masked) : masked;
    for (const pattern of clientScaffoldingProductLinePatterns)
      result = result.replace(pattern, "");
    return result;
  });
  return trimCodexWhitespace(out) ? out : "";
}
export function obfuscateDescription(text: string): string {
  return maskCode(text, (masked) => obfuscatePhrases(masked, sensitive()));
}
export function normalizeSystem(text: string): string {
  if (!text || Buffer.byteLength(text) > LIMIT || !enabled()) return text;
  if (!test(clientScaffoldingMarkerPattern, text)) return obfuscateDescription(text);
  return maskCode(text, (masked) => {
    let out = unmasked(masked);
    for (const pattern of clientScaffoldingThirdPartyIdentityPatterns) {
      pattern.lastIndex = 0;
      const match = pattern.exec(out);
      if (match?.[0]) {
        out = `${OFFICIAL_IDENTITY} ${out.slice(match[0].length)}`;
        break;
      }
    }
    return obfuscatePhrases(out, sensitive());
  });
}
export function normalizeToolValue(value: unknown): unknown {
  if (typeof value === "string") return normalizeProduct(value);
  if (Array.isArray(value)) return value.map(normalizeToolValue);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeToolValue(item)]),
    );
  return value;
}
