function accountQuota(data, user, capFor = () => 0, settable = null, prov) {
  const line = el("div", "aq");
  if (!data) {
    line.append(el("span", "skeleton sk-aq"), el("span", "skeleton sk-aq"));
    return line;
  }
  const q = data[user];
  if (q?.asOf && !q.error) {
    line.classList.add("stale");
    line.append(el("span", "aq-asof", asOfText(q)));
  }
  if (q?.resets?.count && !q.error) {
    // Codex's are used from here too, as on Usage (roamlog on X)
    const words = resetsWords(q.resets), use = prov == "codex" && !q.resets.byWindow;
    const resets = el("span", "aq-w aq-resets" + (use ? " aq-set" : ""));
    resets.title = tipLines(words.textContent, words.title, use && "\n" + resetUseTitle(q));
    resets.append(words.querySelector(".resets-n"));
    if (use) {
      spanBtn(resets).setAttribute("aria-haspopup", "dialog");
      resets.onclick = (e) => { e.stopPropagation(); askReset({ ...q, provider: prov, user }); };
    }
    line.append(resets);
  }
  // an account on no plan says so, whatever else can be read of it
  const noPlan = q?.plan === "No plan" ? [t("No plan")] : [];
  if (q && !q.error && !q.windows?.length && q.balance) {
    // no rolling limits, only what is left to spend
    line.append(el("span", "aq-none", [...noPlan, t("Balance") + " " + q.balance].join(" · ")));
    return line;
  }
  if (!q || q.error || !q.windows?.length) {
    const none = el("span", "aq-none", [...noPlan, q?.error ? quotaError(q.error, q) : t("No allowance reported")].join(" · "));
    line.append(none);
    if (q?.error) line.title = none.title = q.error;
    return line;
  }
  if (q.balance) {
    const balance = el("span", "aq-w aq-balance");
    balance.title = t("What is left on the account besides its windows");
    balance.append(el("span", "aq-n", t("Balance")), el("b", "", q.balance));
    line.append(balance);
  }
  // the two rolling windows fit a line; the per-model ones go in its
  // tooltip; per-model windows of a family are the family's one
  const counted = q.windows.filter((w) => !w.unlimited);
  const ws = familyWindows(counted);
  if (!ws.length) { line.append(el("span", "aq-none", t("Unlimited"))); return line; }
  if (ws.some((w) => w.members)) return poolLine(line, ws, q, capFor, settable);
  line.title = ws.slice(2).map((w) => w.tiers ? tiersText(w) : t(w.name) + " " + quotaText(w)).join(ws !== counted ? "\n" : " · ");
  if (q.asOf) line.title = tipLines(line.title, asOfText(q));
  for (const w of ws.slice(0, 2)) {
    const used = to100(w.used);
    const m = el("span", "aq-w" + (used >= 90 ? " full" : ""));
    const track = el("span", "aq-track");
    const fill = el("i");
    fill.style.width = quotaFill(w) + "%";
    track.append(fill);
    capMark(track, w, capFor(w));
    m.append(el("span", "aq-n", t(w.name)), ...(quotaNoShare(w) ? [] : [track]), el("b", "", quotaText(w)));
    if (w.resetsAt) {
      const at = new Date(w.resetsAt);
      m.title = resetText(at, at.toLocaleString(intlLang()));
      m.append(el("span", "aq-r", resetInText(at)));
    }
    const out = runsOutText(w, (at) => at.toLocaleString(intlLang()));
    if (out) m.title = tipLines(m.title, out);
    if (w.tiers) m.title = tiersText(w);
    line.append(settable ? settable(m, w) : m);
  }
  return line;
}

function poolLine(line, ws, q, capFor = () => 0, settable = null) {
  const pools = [];
  for (const w of ws) {
    const k = w.members ? w.pool : "\0" + pools.length;
    const p = pools.find((x) => x.k === k);
    if (p) p.ws.push(w); else pools.push({ k, name: w.members ? w.pool : t(w.name), ws: [w] });
  }
  if (q.asOf) line.title = asOfText(q);
  for (const p of pools) {
    const m = el("span", "aq-w aq-pool" + (p.ws.some((w) => w.used >= 90) ? " full" : ""));
    m.append(el("span", "aq-n", p.name));
    for (const w of p.ws) {
      const track = el("span", "aq-track");
      const fill = el("i");
      fill.style.width = quotaFill(w) + "%";
      track.append(fill);
      capMark(track, w, capFor(w));
      const part = el("span", "aq-win");
      part.append(el("span", "aq-k", w.window ? shortWindow(w.window) : ""), ...(quotaNoShare(w) ? [] : [track]), el("b", "", quotaText(w)));
      m.append(settable ? settable(part, w) : part);
    }
    const w = p.ws[0];
    m.title = p.ws.map((x) => t(x.name) + " " + quotaText(x) + (x.resetsAt ? " · " + resetText(new Date(x.resetsAt), new Date(x.resetsAt).toLocaleString(intlLang())) : "")).join("\n")
      + (w.members ? "\n\n" + poolTip(w) : w.tiers ? "\n\n" + tiersText(w) : "");
    line.append(m);
  }
  return line;
}

function familyWindows(ws) {
  if (ws?.some(isPool)) return poolWindows(ws);
  if (!ws?.some((w) => w.family)) return ws;
  const fams = new Map();
  for (const w of ws) {
    const k = w.family ? "f:" + w.family : "w:" + fams.size;
    if (!fams.has(k)) fams.set(k, []);
    fams.get(k).push(w);
  }
  if (fams.size === ws.length) return ws;
  const soon = (w) => (w.resetsAt ? new Date(w.resetsAt).getTime() : Infinity);
  const out = [];
  for (const tiers of fams.values()) {
    if (!tiers[0].family) { out.push(tiers[0]); continue; }
    const top = tiers.reduce((a, b) => (b.used > a.used || (b.used === a.used && soon(b) < soon(a)) ? b : a));
    out.push({ ...top, name: top.family, tiers });
  }
  const rank = (w) => (w.tiers && FAMILY_FIRST.includes(w.name) ? FAMILY_FIRST.indexOf(w.name) : FAMILY_FIRST.length);
  return out.map((w, i) => [w, i]).sort(([a, i], [b, j]) => rank(a) - rank(b) || i - j).map(([w]) => w);
}

function poolWindows(ws) {
  const pools = new Map();
  for (const w of ws.filter(isPool)) {
    if (!pools.has(w.pool)) pools.set(w.pool, []);
    pools.get(w.pool).push(w);
  }
  const hours = (w) => {
    const m = /^(\d+)\s*(hour|day|week)s?$/i.exec(w.name || "");
    return m ? m[1] * { hour: 1, day: 24, week: 168 }[m[2].toLowerCase()] : Infinity;
  };
  // a family's pools first (Gemini, then Claude & GPT), then the rest, and
  // a model's own pool ("Gemini 4 Argon", one with a version) after them
  // all, as agy's /usage lists it (01huadalang on Discord)
  const first = (p) => { const i = FAMILY_FIRST.indexOf(p.split(/[ &]/)[0]); return poolOfModel(p) ? FAMILY_FIRST.length + 1 : i < 0 ? FAMILY_FIRST.length : i; };
  const rest = ws.filter((w) => !isPool(w) && !(w.pool && pools.has(w.pool)));
  let fam = familyWindows(rest);
  const out = [];
  for (const pool of [...pools.keys()].sort((a, b) => first(a) - first(b))) {
    const members = ws.filter((w) => w.family && w.pool === pool);
    const own = pools.get(pool).sort((a, b) => hours(a) - hours(b));
    // a pool read without its 5 hours (#745) keeps its models' own 5-hour
    // windows as families: they go in the pool's place, before its week,
    // so the card reads in the same order whether or not the summary sent
    // the 5 hours this time (#860: 5h and 7d swapped after a refresh)
    // (a model's own pool stands for no family: Gemini 4 Argon's week
    // takes no Gemini model's 5 hours)
    if (!own.some((w) => hours(w) === 5) && !poolOfModel(pool)) {
      const mine = (w) => { const f = w.tiers ? w.name : w.family; return !!f && pool.toLowerCase().includes(f.toLowerCase()); };
      out.push(...fam.filter(mine));
      fam = fam.filter((w) => !mine(w));
    }
    for (const w of own) out.push({ ...w, name: pool + " · " + t(w.name), window: w.name, members });
  }
  return out.concat(fam);
}

function poolTip(w) {
  return t("{pool}: one allowance for these models", { pool: w.pool }) + "\n" + tiersText({ tiers: w.members });
}

function tiersText(w) {
  return (w.tiers || []).map((x) => t(x.name) + " " + quotaText(x)
    + (x.resetsAt && x.used > 0 ? " · " + resetInText(new Date(x.resetsAt)) : "")).join("\n");
}

function quotaNoShare(w) { return !!w.text || w.used == null || w.balance != null; }

function quotaText(w) {
  if (w.unlimited) return t("Unlimited");
  if (w.balance != null) return t("{n} left", { n: (countFormat.format(w.balance) + " " + t(w.unit || "")).trim() });
  // a text row used 100 is Claude's overages (claudeOveragesWindow): "In use", said in the reader's language
  if (w.text && w.used >= 100) return t("In use");
  // a Text row's display is said in the reader's language (the image row's "Used up" and "Unknown", #6160)
  if (quotaNoShare(w)) return t(w.display || "No allowance reported");
  const used = to100(w.used);
  const n = quotaLeft ? 100 - used : used;
  const pct = t(quotaLeft ? "{n} left" : "{n} used", { n: (Number.isInteger(n) ? n : n.toFixed(1)) + "%" });
  const count = quotaCount(w);
  return count ? count + " · " + pct : pct;
}

function quotaFill(w) {
  if (w.used == null) return 0;
  const used = Math.round(to100(w.used));
  return quotaLeft ? 100 - used : used;
}

function to100(v) { return Math.max(0, Math.min(100, v)); }

function tipLines(...a) { return a.filter(Boolean).join("\n"); }

const FAMILY_FIRST = ["Gemini", "Claude"];

const isPool = (w) => w.pool && !w.family;

const poolOfModel = (p) => /\d/.test(p || "");
