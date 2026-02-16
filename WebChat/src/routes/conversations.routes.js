const router = require("express").Router();
const httpAuth = require("../middleware/httpAuth");
const { pool } = require("../db/db");

// GET /conversations  -> inbox list
router.get("/conversations", httpAuth, async (req, res) => {
  const me = req.user.userId; // jwt payload: { userId, username }

  const { rows } = await pool.query(
    `
    select
      c.id as "conversationId",
      u.id as "peerId",
      u.username as "peerUsername",
      lm.body as "lastMessage",
      lm.sent_at as "lastSentAt"
    from conversation_members cm_me
    join conversations c on c.id = cm_me.conversation_id

    -- karşı tarafı bul
    join conversation_members cm_peer
      on cm_peer.conversation_id = c.id
     and cm_peer.user_id <> $1

    join users u on u.id = cm_peer.user_id

    -- son mesajı bul (LATERAL ile)
    left join lateral (
      select m.body, m.sent_at
      from messages m
      where m.conversation_id = c.id
      order by m.sent_at desc
      limit 1
    ) lm on true

    where cm_me.user_id = $1
      and c.type = 'DM'
    order by lm.sent_at desc nulls last, c.created_at desc
    `,
    [me]
  );

  res.json({ conversations: rows });
});

module.exports = router;