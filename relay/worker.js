// AnyPS5 compatibility relay (Cloudflare Worker).
// Receives reports from AnyPS5 Console without the user signing in to GitHub and files them as issues.
// Secret: GITHUB_TOKEN = fine-grained token with only "Issues: read and write" on Techx3/AnyPS5-Compat.

const REPO = "Techx3/AnyPS5-Compat";
const STATUSES = { convert: "Does not convert", nothing: "Does not boot", boots: "Boots", ingame: "In game", playable: "Playable" };
const MAX_BODY = 64 * 1024;
const PER_IP_PER_HOUR = 30;
const TITLE_ID = /^[A-Za-z0-9_.-]{1,32}$/;
const SHOTS_BRANCH = "shots";
const SHOT_PATH = /^shots\/[A-Za-z0-9_.-]{1,32}\/[A-Za-z0-9_.-]{1,80}\.jpg$/;
const MAX_SHOT = 400 * 1024;
const SHOTS_PER_IP_PER_HOUR = 12;
const RAW = `https://raw.githubusercontent.com/${REPO}/${SHOTS_BRANCH}/`;

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

async function rateLimited(request, kind = "report", limit = PER_IP_PER_HOUR) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const hour = Math.floor(Date.now() / 3600000);
  const key = new Request(`https://rate.limit/${kind}/${encodeURIComponent(ip)}/${hour}`);
  const cache = caches.default;
  const hit = await cache.match(key);
  const n = hit ? parseInt(await hit.text(), 10) || 0 : 0;
  if (n >= limit) return true;
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
    shots: (Array.isArray(r.shots) ? r.shots : []).slice(0, 4)
      .filter(x => SHOT_PATH.test(String(x?.path || "")))
      .map(x => ({ minute: Math.max(0, Math.min(num(x.minute) || 0, 600)), path: String(x.path) })),
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
  if (r.shots.length) lines.push("", r.shots.map(x => `<img src="${RAW}${x.path}" width="320" alt="${x.minute} min">`).join(" "));
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

async function saveShot(request, env) {
  const len = parseInt(request.headers.get("content-length") || "0", 10);
  if (len > MAX_SHOT * 1.4 + 1024) return json({ error: "too large" }, 413);
  if (await rateLimited(request, "shot", SHOTS_PER_IP_PER_HOUR)) return json({ error: "rate limited" }, 429);
  let d;
  try {
    d = JSON.parse(await request.text());
  } catch {
    return json({ error: "bad json" }, 400);
  }
  if (!TITLE_ID.test(String(d.title_id || ""))) return json({ error: "bad title_id" }, 400);
  const b64 = String(d.image || "");
  let bytes;
  try {
    bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  } catch {
    return json({ error: "bad image" }, 400);
  }
  if (bytes.length > MAX_SHOT || bytes.length < 1000) return json({ error: "bad size" }, 400);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return json({ error: "not a jpeg" }, 400);
  const minute = Math.max(0, Math.min(parseInt(d.minute, 10) || 0, 600));
  const who = str(d.reporter, 16).replace(/[^A-Za-z0-9]/g, "") || "anon";
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "");
  const path = `shots/${d.title_id}/${stamp}-${minute}m-${who}.jpg`;
  const res = await gh(env, `/repos/${REPO}/contents/${path}`, {
    method: "PUT",
    body: JSON.stringify({ message: `shot ${d.title_id} ${minute} min`, content: b64, branch: SHOTS_BRANCH }),
  });
  if (!res.ok) return json({ error: `github ${res.status}` }, 502);
  return json({ ok: true, path });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET") return json({ ok: true, service: "anyps5-compat-relay", shots: true });
    if (request.method === "POST" && url.pathname === "/shot") return saveShot(request, env);
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
