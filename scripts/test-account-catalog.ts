import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {projectAccountModelIds,accountModelIds,accountSupportsModel} from "../src/compat/account-catalog.js";
import {normalizeQuotaModels} from "../src/auth/quota-snapshot.js";
const fixture=JSON.parse(readFileSync("scripts/fixtures/account-models/go-goldens.json","utf8"));
assert.equal(fixture.publicDefinitions,34);assert.equal(fixture.acceptedDefinitions,44);
for(const c of fixture.cases){assert.deepEqual(projectAccountModelIds(c.raw),c.published);assert.deepEqual(projectAccountModelIds(c.raw,true),c.admin);}
console.log(`PASS ${fixture.cases.length*2} account/admin projections against pinned independent Go source`);
const q=normalizeQuotaModels({models:{"gemini-3.7-flash-tiered":{quotaInfo:{remainingFraction:1}},"gemini-3.8-flash-tiered":{isInternal:true},"gemini-future-disabled":{},"tab_fixture":{},"future-text":{quotaInfo:{}}}},Date.now());
assert.deepEqual(accountModelIds(q),["gemini-3.7-flash-low","gemini-3.7-flash-medium","gemini-3.7-flash-high","future-text"]);
assert(accountSupportsModel(q,"gemini-3.7-flash"));assert(!accountSupportsModel(q,"gemini-3.8-flash"));assert(!accountSupportsModel(q,"gemini-future-disabled"));
assert.deepEqual(accountModelIds({...q,forbidden:true}),[]);
console.log("PASS account internal/disabled filtering, logical backing eligibility and forbidden account isolation");
