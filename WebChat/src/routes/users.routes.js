const router = require("express").Router();
const httpAuth = require("../middleware/httpAuth");
const { pool } = require("../db/db");

router.get("/me", httpAuth, async (req, res) => {
  res.json({ user: req.user });
});

router.get("/users", httpAuth, async (req, res) => {
  const me = req.user.userId;

  const { rows } = await pool.query(
    `select id, username
     from users
     where id <> $1
     order by username asc`,
    [me]
  );

  res.json({ users: rows });
});

router.get("/users/search", httpAuth, async (req, res) => {
  const me = req.user.userId;
  const q = String(req.query.q || "").trim();

  if (!q || q.length < 2) return res.json({ users: [] });

  const { rows } = await pool.query(
    `
    select id, username
    from users
    where username ilike $1
      and id <> $2
    order by username asc
    limit 10
    `,
    [`%${q}%`, me]
  );

  res.json({ users: rows });
});

router.post("/users/register", async (req, res) => {
  const { userId, username } = req.body || {};

  if (!userId || !username) {
    return res.status(400).json({ error: "userId and username required" });
  }

  try {
    await pool.query(
      `
      insert into users (s_user_id, username)
      values ($1, $2)
      on conflict (s_user_id) do update set username = excluded.username
      `,
      [userId, username]
    );

    const data = await devLogin(username);

    return res.json(data);
  } catch (e) {
    console.error("user register error:", e);
    return res.status(500).json({ error: "SERVER" });
  }
});

async function devLogin(username) {
  const res = await fetch(`http://localhost:3000/auth/dev-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username })
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.message || "dev-login failed");
  }
  return data;
}

module.exports = router;