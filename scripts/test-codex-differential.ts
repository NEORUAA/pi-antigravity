import { isDeepStrictEqual } from "node:util";
import { consumerEvents } from "../src/client/consumer-sse.js";
import { consumerErrorStatus } from "../src/client/codex-transport.js";
/** Golden outputs come from the pinned Go implementation, not TypeScript helpers. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { functionNameMap } from "../src/compat/request.js";
import { codexToolSchema, codexResponseSchema } from "../src/compat/schema.js";
import { normalizeConversation, normalizeProduct, normalizeSystem } from "../src/compat/scaffolding.js";
const fixture = JSON.parse(readFileSync(new URL("./fixtures/codex-parity/reference.json", import.meta.url), "utf8")) as { sourceCommit: string; cases: Array<{ input: { kind: string; text: string; code?: unknown; rpc?: string; names?: string[]; schema: unknown; env?: Record<string, string> }; expected: unknown }> };
const normalizers = { system: normalizeSystem, conversation: normalizeConversation, product: normalizeProduct };
delete process.env.CLIENT_SCAFFOLDING_STRIP;
delete process.env.CLIENT_SCAFFOLDING_STRIP_REMINDERS;
delete process.env.ANTIGRAVITY_SENSITIVE_PHRASES;
let failures = 0;
for (const [index, test] of fixture.cases.entries()) {
  for (const key of ["CLIENT_SCAFFOLDING_STRIP", "CLIENT_SCAFFOLDING_STRIP_REMINDERS", "ANTIGRAVITY_SENSITIVE_PHRASES"]) delete process.env[key];
  Object.assign(process.env, test.input.env ?? {});
  let result: unknown;
  if (test.input.kind === "sse") {
    const events: unknown[] = []; let error = false;
    try { for await (const document of consumerEvents(new Response(test.input.text))) events.push(document); } catch { error = true; }
    result = { events, error };
  } else if (test.input.kind === "responseSchema") result = codexResponseSchema(test.input.schema);
  else if (test.input.kind === "status") result = consumerErrorStatus({ code: test.input.code, status: test.input.rpc });
  else if (test.input.kind === "names") result = functionNameMap(test.input.names ?? []);
  else if (test.input.kind === "schema") result = codexToolSchema(test.input.schema);
  else result = normalizers[test.input.kind as keyof typeof normalizers](test.input.text);

  try { if (test.referenceVariants) assert.ok(test.referenceVariants.some((value) => isDeepStrictEqual(result, value)), "Result is not any independently observed Go variant");
    else assert.deepEqual(result, test.expected); }
  catch { failures++; console.error(JSON.stringify({ index, input: test.input, expected: test.expected, actual: result })); }
}
assert.equal(failures, 0, `${failures}/${fixture.cases.length} independent Go reference cases diverged`);
console.log(`PASS ${fixture.cases.length} differential reference cases (${fixture.sourceCommit})`);
