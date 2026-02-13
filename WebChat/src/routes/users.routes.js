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

module.exports = router;