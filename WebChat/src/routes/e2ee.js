const express = require("express");
const jwt = require("jsonwebtoken");
const env = require("../config/env");
const { pool } = require("../db/db");

const router = express.Router();

// -------------------------
// Auth middleware (HTTP)
// -------------------------
function requireAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const [type, token] = auth.split(" ");

    if (type !== "Bearer" || !token) {
      return res.status(401).json({ error: "UNAUTHORIZED" });
    }

    const payload = jwt.verify(token, env.jwtSecret); // { userId, username, ... }
    const id = payload.userId || payload.id;

    if (!id) return res.status(401).json({ error: "UNAUTHORIZED" });

    req.user = { id, username: payload.username };
    next();
  } catch (e) {
    return res.status(401).json({ error: "UNAUTHORIZED" });
  }
}

// -------------------------
// Validators
// -------------------------
function isObject(x) {
  return x !== null && typeof x === "object" && !Array.isArray(x);
}

function validateP256Jwk(jwk, expectedUse) {
  if (!isObject(jwk)) return "JWK must be an object";
  if (jwk.kty !== "EC") return "JWK kty must be 'EC'";
  if (jwk.crv !== "P-256") return "JWK crv must be 'P-256'";
  if (typeof jwk.x !== "string" || typeof jwk.y !== "string") return "JWK must include x and y";
  if (typeof jwk.d === "string") return "Public JWK must not include 'd'";
  if (jwk.use && typeof jwk.use !== "string") return "JWK use must be string";
  if (expectedUse && jwk.use && jwk.use !== expectedUse) return `JWK use must be '${expectedUse}' if present`;
  return null;
}

// -------------------------
// POST /api/e2ee/keys/register
// body: { deviceId, signPubJwk, dhPubJwk }
// -------------------------
router.post("/api/e2ee/keys/register", requireAuth, express.json(), async (req, res) => {
  const userId = req.user.id;

  const { deviceId, signPubJwk, dhPubJwk } = req.body ?? {};

  if (typeof deviceId !== "string" || deviceId.length < 1 || deviceId.length > 64) {
    return res.status(400).json({ error: "INVALID_DEVICE_ID" });
  }

  const errSig = validateP256Jwk(signPubJwk, "sig");
  if (errSig) return res.status(400).json({ error: "INVALID_SIGN_PUB_JWK", detail: errSig });

  const errDh = validateP256Jwk(dhPubJwk, null);
  if (errDh) return res.status(400).json({ error: "INVALID_DH_PUB_JWK", detail: errDh });

  try {
    // upsert
    const q = await pool.query(
      `
      insert into e2ee_public_keys (user_id, device_id, sign_pub_jwk, dh_pub_jwk)
      values ($1,$2,$3::jsonb,$4::jsonb)
      on conflict (user_id, device_id)
      do update set
        sign_pub_jwk = excluded.sign_pub_jwk,
        dh_pub_jwk   = excluded.dh_pub_jwk,
        updated_at   = now()
      returning (xmax = 0) as created, updated_at
      `,
      [userId, deviceId, JSON.stringify(signPubJwk), JSON.stringify(dhPubJwk)]
    );

    return res.status(q.rows[0].created ? 201 : 200).json({
      ok: true,
      created: q.rows[0].created,
      userId,
      deviceId,
      updatedAt: q.rows[0].updated_at
    });
  } catch (e) {
    console.error("e2ee register error:", e);
    return res.status(500).json({ error: "SERVER" });
  }
});

// -------------------------
// GET /api/e2ee/keys/:userId?deviceId=...
// -------------------------
router.get("/api/e2ee/keys/:userId", async (req, res) => {
  const targetUserId = req.params.userId;
  const deviceId = req.query.deviceId;

  try {
    let rows;

    if (deviceId) {
      const r = await pool.query(
        `
        select user_id, device_id, sign_pub_jwk, dh_pub_jwk, updated_at
        from e2ee_public_keys
        where user_id = $1 and device_id = $2
        `,
        [targetUserId, deviceId]
      );
      rows = r.rows;
    } else {
      const r = await pool.query(
        `
        select user_id, device_id, sign_pub_jwk, dh_pub_jwk, updated_at
        from e2ee_public_keys
        where user_id = $1
        order by updated_at desc
        `,
        [targetUserId]
      );
      rows = r.rows;
    }

    if (!rows.length) return res.status(404).json({ error: "NO_KEYS_FOUND" });

    return res.json({
      ok: true,
      keys: rows.map(x => ({
        userId: x.user_id,
        deviceId: x.device_id,
        signPubJwk: x.sign_pub_jwk,
        dhPubJwk: x.dh_pub_jwk,
        updatedAt: x.updated_at
      }))
    });
  } catch (e) {
    console.error("e2ee get keys error:", e);
    return res.status(500).json({ error: "SERVER" });
  }
});

module.exports = router;