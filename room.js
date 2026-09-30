const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
});

const CODE_RE = /^[A-Za-z0-9_-]{6,40}$/;
const PID_RE = /^[A-Za-z0-9_-]{8,40}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function sanitize(doc) {
  const habits = (Array.isArray(doc.habits) ? doc.habits : []).slice(0, 60).map((h) => ({
    id: String(h.id || '').slice(0, 40),
    title: String(h.title || '').slice(0, 60),
    created: DATE_RE.test(h.created || '') ? h.created : '',
  })).filter((h) => h.id && h.title);
  const ids = new Set(habits.map((h) => h.id));
  const log = {};
  const src = doc.log && typeof doc.log === 'object' ? doc.log : {};
  Object.keys(src).slice(0, 500).forEach((d) => {
    if (!DATE_RE.test(d) || !src[d] || typeof src[d] !== 'object') return;
    const day = {};
    Object.keys(src[d]).forEach((hid) => {
      if (ids.has(hid) && typeof src[d][hid] === 'string') day[hid] = src[d][hid].slice(0, 30);
    });
    if (Object.keys(day).length) log[d] = day;
  });
  return { name: String(doc.name || '').slice(0, 24), habits, log };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const code = String((req.method === 'GET' ? req.query.code : (req.body || {}).code) || '');
    if (!CODE_RE.test(code)) return res.status(400).json({ error: 'bad_code' });
    const key = 'hd:room:' + code;

    if (req.method === 'GET') {
      const people = (await redis.hgetall(key)) || {};
      return res.status(200).json({ people });
    }

    if (req.method === 'POST') {
      const { pid, doc } = req.body || {};
      if (!PID_RE.test(pid || '') || !doc || typeof doc !== 'object') {
        return res.status(400).json({ error: 'bad_request' });
      }
      const exists = await redis.hexists(key, pid);
      if (!exists) {
        const n = await redis.hlen(key);
        if (n >= 2) return res.status(403).json({ error: 'room_full' });
      }
      await redis.hset(key, { [pid]: sanitize(doc) });
      await redis.expire(key, 60 * 60 * 24 * 400);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (e) {
    return res.status(500).json({ error: 'server_error' });
  }
};
