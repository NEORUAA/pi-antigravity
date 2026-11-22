/** Pinned antigravity_stream_errors.go framing: SSE + bare/array errors and
 * unprefixed JSON continuation lines. Runtime remains Node, not Go transport. */
import { isRecord } from "../utils/util.js";
import { trimCodexWhitespace } from "../compat/scaffolding.js";
async function* lines(response: Response, maxBytes: number): AsyncGenerator<string> {
  if (!response.body) throw new Error("No Antigravity response body");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      let offset = 0,
        newline: number;
      while ((newline = buffer.indexOf("\n", offset)) >= 0) {
        const line = buffer.slice(offset, newline).replace(/\r+$/, "");
        offset = newline + 1;
        if (Buffer.byteLength(line) > maxBytes)
          throw new Error("Antigravity SSE line exceeds its size limit");
        yield line;
      }
      buffer = buffer.slice(offset);
      if (Buffer.byteLength(buffer) > maxBytes)
        throw new Error("Antigravity SSE line exceeds its size limit");
      if (chunk.done) {
        if (buffer) yield buffer;
        return;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export function decodeConsumerEnvelope(raw: string): Record<string, unknown> {
  let document: unknown;
  try {
    document = JSON.parse(raw);
  } catch {
    throw new Error("Invalid Antigravity SSE JSON event");
  }
  if (Array.isArray(document)) {
    const error = (document as unknown[]).find(
      (item) => isRecord(item) && Object.hasOwn(item, "error"),
    );
    if (isRecord(error)) return error;
    throw new Error("Antigravity stream array has no error object");
  }
  if (!isRecord(document)) throw new Error("Antigravity stream payload must be a JSON object");
  return document;
}
export async function* consumerEvents(
  response: Response,
  maxBytes = 8 * 1024 * 1024,
): AsyncGenerator<Record<string, unknown>> {
  let parts: string[] = [],
    bytes = 0,
    bare = false,
    continued = false,
    cachedComplete: boolean | undefined;
  const complete = () => {
    if (cachedComplete === undefined) {
      try {
        JSON.parse(parts.join("\n"));
        cachedComplete = true;
      } catch {
        cachedComplete = false;
      }
    }
    return cachedComplete;
  };
  const append = (line: string) => {
    bytes += Buffer.byteLength(line) + (parts.length ? 1 : 0);
    parts.push(line);
    cachedComplete = undefined;
    if (bytes > (bare ? 1024 * 1024 : maxBytes))
      throw new Error("Antigravity SSE event exceeds its size limit");
  };
  const flush = () => {
    const raw = parts.join("\n");
    parts = [];
    bytes = 0;
    bare = continued = false;
    cachedComplete = undefined;
    return raw;
  };
  const topClosing = (line: string) =>
    !!line && line[0] !== " " && line[0] !== "\t" && /[}\]]$/.test(trimCodexWhitespace(line));
  for await (const line of lines(response, maxBytes)) {
    const trimmed = trimCodexWhitespace(line);
    let payload: string | undefined;
    if (line.startsWith("data:")) {
      if (bare) payload = flush();
      if (payload !== undefined) {
        if (trimCodexWhitespace(payload) === "[DONE]") return;
        yield decodeConsumerEnvelope(payload);
      }
      append(trimCodexWhitespace(line.slice(5)));
      continue;
    } else if (!trimmed) {
      if (parts.length && (!bare || complete())) payload = flush();
    } else if (/^(?:event:|id:|retry:|:)/.test(line)) continue;
    else if (bare) {
      append(trimmed);
      if (topClosing(line) && complete()) payload = flush();
    } else if (continued) append(trimmed);
    else if (parts.length && !complete()) {
      continued = true;
      append(trimmed);
    } else if (/^[{[]/.test(trimmed)) {
      if (parts.length) {
        payload = flush();
        if (trimCodexWhitespace(payload) === "[DONE]") return;
        yield decodeConsumerEnvelope(payload);
        payload = undefined;
      }
      bare = true;
      append(trimmed);
      if (topClosing(line) && complete()) payload = flush();
    }
    if (payload !== undefined) {
      if (trimCodexWhitespace(payload) === "[DONE]") return;
      yield decodeConsumerEnvelope(payload);
    }
  }
  if (parts.length) {
    const raw = flush();
    if (trimCodexWhitespace(raw) !== "[DONE]") yield decodeConsumerEnvelope(raw);
  }
}
