const router = require("express").Router();
const jwt = require("jsonwebtoken");
const env = require("../config/env");
const { pool } = require("../db/db");

router.post("/dev-login", async (req, res) => {
  try {
    const { username, sUserID } = req.body;

    if (!username || !username.trim()) {
      return res.status(400).json({ message: "username required" });
    }

    const clean = username.trim();

    const up = await pool.query(
  `insert into users (username, s_user_id)
   values ($1, $2)
   on conflict (username)
   do update set 
     username = excluded.username,
     s_user_id = excluded.s_user_id
   returning id, username, s_user_id`,
  [clean, sUserID]
);

    const user = up.rows[0];

    const token = jwt.sign(
      { userId: user.id, username: user.username },
      env.jwtSecret,
      { expiresIn: "7d" }
    );

    return res.json({ token, user });
  } catch (e) {
    console.error("dev-login error:", e);
    return res.status(500).json({ message: "server error" });
  }
});

module.exports = router;