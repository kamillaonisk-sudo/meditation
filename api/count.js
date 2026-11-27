// Vercel serverless function: keeps the meditation count in Upstash Redis.
//   GET  /api/count                      -> { count }   (count is null if never saved)
//   POST /api/count { op: "add", by: n } -> { count }   (n may be negative; never goes below 0)
//   POST /api/count { op: "set", value } -> { count }

const KEY = "meditation:count";

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

async function redis(...command) {
  const r = await fetch(REDIS_URL, {
    method: "POST",
    headers: { Authorization: "Bearer " + REDIS_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) throw new Error(data.error || "Redis HTTP " + r.status);
  return data.result;
}

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : NaN;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");

  if (!REDIS_URL || !REDIS_TOKEN) {
    return res.status(503).json({ error: "database_not_connected" });
  }

  try {
    if (req.method === "GET") {
      const v = await redis("GET", KEY);
      return res.status(200).json({ count: v === null ? null : toInt(v) });
    }

    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
      body = body || {};

      if (body.op === "add") {
        const by = toInt(body.by);
        if (!Number.isFinite(by) || Math.abs(by) > 100000) return res.status(400).json({ error: "bad_value" });
        let count = toInt(await redis("INCRBY", KEY, String(by)));
        if (count < 0) { await redis("SET", KEY, "0"); count = 0; }
        return res.status(200).json({ count });
      }

      if (body.op === "set") {
        const value = toInt(body.value);
        if (!Number.isFinite(value) || value < 0 || value > 10000000) return res.status(400).json({ error: "bad_value" });
        await redis("SET", KEY, String(value));
        return res.status(200).json({ count: value });
      }

      return res.status(400).json({ error: "unknown_op" });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  } catch (e) {
    return res.status(502).json({ error: "database_error" });
  }
};
