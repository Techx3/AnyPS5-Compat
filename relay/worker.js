// AnyPS5 compatibility relay (Cloudflare Worker).
// Receives reports from AnyPS5 Console without the user signing in to GitHub and files them as issues.
// Secret: GITHUB_TOKEN = fine-grained token with only "Issues: read and write" on Techx3/AnyPS5-Compat.

const REPO = "Techx3/AnyPS5-Compat";
const STATUSES = { convert: "Does not convert", nothing: "Does not boot", boots: "Boots", ingame: "In game", playable: "Playable" };
const MAX_BODY = 64 * 1024;
const PER_IP_PER_HOUR = 30;
const TITLE_ID = /^[A-Za-z0-9_.-]{1,32}$/;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

function gh(env, path, init = {}) {
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: "application/vnd.github+json",
      "user-agent": "anyps5-compat-relay",
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
}

async function rateLimited(request) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const hour = Math.floor(Date.now() / 3600000);
  const key = new Request(`https://rate.limit/${encodeURIComponent(ip)}/${hour}`);
  const cache = caches.default;
  const hit = await cache.match(key);
  const n = hit ? parseInt(await hit.text(), 10) || 0 : 0;
  if (n >= PER_IP_PER_HOUR) return true;
  await cache.put(key, new Response(String(n + 1), { headers: { "cache-control": "max-age=3600" } }));
  return false;
}

const str = (v, max) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, "").slice(0, max);
const num = v => (Number.isFinite(Number(v)) ? Number(v) : null);

function clean(r) {
  if (!r || typeof r !== "object" || r.v !== 1) throw new Error("bad report");
  if (!TITLE_ID.test(String(r.title_id || ""))) throw new Error("bad title_id");
  if (!(r.status in STATUSES)) throw new Error("bad status");
  const fn = x => ({ class: str(x?.class, 16), lib: str(x?.lib, 80), name: str(x?.name, 120), nid: str(x?.nid, 32) });
  return {
    v: 1,
    title_id: String(r.title_id),
    name: str(r.name, 120) || String(r.title_id),
    game_version: str(r.game_version, 32),
    status: r.status,
    exit_code: num(r.exit_code),
    seconds: Math.max(0, Math.min(num(r.seconds) || 0, 7 * 86400)),
    window_after: num(r.window_after),
    closed_by_user: !!r.closed_by_user,
    anyps5: { channel: str(r.anyps5?.channel, 60), version: str(r.anyps5?.version, 80) },
    console: str(r.console, 32),
    os: str(r.os, 80),
    gpu: str(r.gpu, 200),
    absent: num(r.absent) || 0,
    stub: num(r.stub) || 0,
    missing_libs: num(r.missing_libs) || 0,
    missing: (Array.isArray(r.missing) ? r.missing : []).slice(0, 80).map(fn),
    stop: r.stop ? { lib: str(r.stop.lib, 80), name: str(r.stop.name, 120), nid: str(r.stop.nid, 32) } : null,
    log_tail: (Array.isArray(r.log_tail) ? r.log_tail : []).slice(-60).map(x => str(x, 300).replace(/```/g, "'''")),
    reporter: str(r.reporter, 40),
    time: str(r.time, 32) || new Date().toISOString(),
  };
}

function body(r) {
  const a = r.anyps5;
  const lines = [
    `**Status:** ${STATUSES[r.status]}`,
    `**AnyPS5:** ${a.channel} ${a.version}  ·  **Console:** ${r.console}`,
    `**Played:** ${Math.floor(r.seconds / 60)} min  ·  **Exit code:** ${r.exit_code}${r.closed_by_user ? "  ·  closed by the user" : ""}`,
    `**System:** ${r.os}  ·  ${r.gpu || "unknown GPU"}`,
    `**Functions:** ${r.absent} missing, ${r.stub} stub, ${r.missing_libs} missing libraries`,
  ];
  if (r.stop) lines.push(`**Stops at:** \`${r.stop.lib}\` ${r.stop.name || r.stop.nid}`);
  if (r.log_tail.length) lines.push("", "<details><summary>Log (last lines)</summary>", "", "```", ...r.log_tail.slice(-40), "```", "</details>");
  lines.push("", "<!-- anyps5-report", JSON.stringify(r).replace(/--/g, "\\u002d\\u002d").replace(/>/g, "\\u003e"), "-->");
  return lines.join("\n");
}

async function findIssue(env, tid) {
  const q = encodeURIComponent(`repo:${REPO} is:issue in:title "[${tid}]"`);
  const res = await gh(env, `/search/issues?q=${q}&per_page=5`);
  if (!res.ok) throw new Error(`search ${res.status}`);
  const data = await res.json();
  const it = (data.items || []).find(i => i.title.startsWith(`[${tid}]`));
  return it ? it.number : null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET") return json({ ok: true, service: "anyps5-compat-relay" });
    if (request.method !== "POST" || url.pathname !== "/report") return json({ error: "not found" }, 404);
    const len = parseInt(request.headers.get("content-length") || "0", 10);
    if (len > MAX_BODY) return json({ error: "too large" }, 413);
    if (await rateLimited(request)) return json({ error: "rate limited" }, 429);
    let report;
    try {
      const text = await request.text();
      if (text.length > MAX_BODY) return json({ error: "too large" }, 413);
      report = clean(JSON.parse(text));
    } catch (e) {
      return json({ error: String(e.message || e) }, 400);
    }
    const text = body(report);
    let number = await findIssue(env, report.title_id);
    let res;
    if (number) {
      res = await gh(env, `/repos/${REPO}/issues/${number}/comments`, { method: "POST", body: JSON.stringify({ body: text }) });
    } else {
      res = await gh(env, `/repos/${REPO}/issues`, {
        method: "POST",
        body: JSON.stringify({ title: `[${report.title_id}] ${report.name}`, body: text }),
      });
      if (res.ok) number = (await res.clone().json()).number;
    }
    if (!res.ok) return json({ error: `github ${res.status}` }, 502);
    return json({ ok: true, issue: number });
  },
};
