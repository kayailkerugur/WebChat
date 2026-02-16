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

module.exports = router;