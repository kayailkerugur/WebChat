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

// wrapped private key validator (AES-GCM blob)
function validateWrappedPriv(wrappedPriv) {
  if (!isObject(wrappedPriv)) return "wrappedPriv must be object";
  if (wrappedPriv.alg && wrappedPriv.alg !== "AES-GCM") return "wrappedPriv.alg must be AES-GCM (or omit)";
  if (typeof wrappedPriv.iv_b64 !== "string" || wrappedPriv.iv_b64.length < 8) return "wrappedPriv.iv_b64 required";
  if (typeof wrappedPriv.ct_b64 !== "string" || wrappedPriv.ct_b64.length < 8) return "wrappedPriv.ct_b64 required";
  return null;
}

// KDF validator (PBKDF2 metadata)
function validateKdf(kdf) {
  if (!isObject(kdf)) return "kdf must be object";
  if (kdf.alg && kdf.alg !== "PBKDF2") return "kdf.alg must be PBKDF2 (or omit)";
  if (kdf.hash && kdf.hash !== "SHA-256") return "kdf.hash must be SHA-256 (or omit)";
  if (typeof kdf.iter !== "number" || !Number.isFinite(kdf.iter) || kdf.iter < 10_000) return "kdf.iter must be number >= 10000";
  if (typeof kdf.salt_b64 !== "string" || kdf.salt_b64.length < 8) return "kdf.salt_b64 required";
  return null;
}

// -------------------------
// POST /api/e2ee/keys/register
// body: { deviceId, signPubJwk, dhPubJwk, kdf?, wrappedPriv? }
// -------------------------
router.post("/api/e2ee/keys/register", requireAuth, express.json(), async (req, res) => {
  const userId = req.user.id;

  const { deviceId, signPubJwk, dhPubJwk, kdf, wrappedPriv } = req.body ?? {};

  if (typeof deviceId !== "string" || deviceId.length < 1 || deviceId.length > 64) {
    return res.status(400).json({ error: "INVALID_DEVICE_ID" });
  }

  const errSig = validateP256Jwk(signPubJwk, "sig");
  if (errSig) return res.status(400).json({ error: "INVALID_SIGN_PUB_JWK", detail: errSig });

  const errDh = validateP256Jwk(dhPubJwk, null);
  if (errDh) return res.status(400).json({ error: "INVALID_DH_PUB_JWK", detail: errDh });

  if (wrappedPriv !== undefined) {
    const err = validateWrappedPriv(wrappedPriv);
    if (err) return res.status(400).json({ error: "INVALID_WRAPPED_PRIV", detail: err });
  }
  if (kdf !== undefined) {
    const err = validateKdf(kdf);
    if (err) return res.status(400).json({ error: "INVALID_KDF", detail: err });
  }

  if ((wrappedPriv && !kdf) || (!wrappedPriv && kdf)) {
    return res.status(400).json({ error: "KDF_AND_WRAPPED_PRIV_REQUIRED_TOGETHER" });
  }

  try {
    const q = await pool.query(
      `
  insert into e2ee_public_keys (user_id, device_id, sign_pub_jwk, dh_pub_jwk, wrapped_priv, kdf)
  values ($1,$2,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb)
  on conflict (user_id, device_id)
  do update set
    wrapped_priv = coalesce(excluded.wrapped_priv, e2ee_public_keys.wrapped_priv),
    kdf          = coalesce(excluded.kdf, e2ee_public_keys.kdf),
    updated_at   = now()
  returning (xmax = 0) as created, updated_at
  `,
      [
        userId,
        deviceId,
        JSON.stringify(signPubJwk),
        JSON.stringify(dhPubJwk),
        wrappedPriv ? JSON.stringify(wrappedPriv) : null,
        kdf ? JSON.stringify(kdf) : null
      ]
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
// GET /api/e2ee/keys/me?deviceId=...
// -------------------------
router.get("/api/e2ee/keys/me", requireAuth, async (req, res) => {
  const userId = req.user.id;
  const deviceId = req.query.deviceId;

  if (typeof deviceId !== "string" || deviceId.length < 1 || deviceId.length > 64) {
    return res.status(400).json({ error: "INVALID_DEVICE_ID" });
  }

  try {
    const result = await pool.query(
      `
      select 
        user_id,
        device_id,
        sign_pub_jwk,
        dh_pub_jwk,
        kdf,
        wrapped_priv,
        updated_at
      from e2ee_public_keys
      where user_id = $1 and device_id = $2
      limit 1
      `,
      [userId, deviceId]
    );

    if (!result.rowCount) {
      return res.status(404).json({ error: "NO_KEYS_FOUND" });
    }

    const row = result.rows[0];

    return res.json({
      ok: true,
      key: {
        userId: row.user_id,
        deviceId: row.device_id,
        signPubJwk: row.sign_pub_jwk,
        dhPubJwk: row.dh_pub_jwk,
        kdf: row.kdf,
        wrappedPriv: row.wrapped_priv,
        updatedAt: row.updated_at
      }
    });

  } catch (err) {
    console.error("e2ee get me error:", err);
    return res.status(500).json({ error: "SERVER_ERROR" });
  }
});

// -------------------------
// GET /api/e2ee/keys/:userId?deviceId=...
// (peer public key fetch - wrapped_priv DÖNMEZ)
// -------------------------
router.get("/api/e2ee/keys/:userId", async (req, res) => {
  const targetUserId = String(req.params.userId || "").trim();

  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(targetUserId)) {
    return res.status(400).json({ error: "INVALID_USER_ID" });
  }

  const deviceId = typeof req.query.deviceId === "string" ? req.query.deviceId : null;

  try {
    let r;
    if (deviceId) {
      r = await pool.query(
        `
        select user_id, device_id, sign_pub_jwk, dh_pub_jwk, updated_at
        from e2ee_public_keys
        where user_id = $1 and device_id = $2
        `,
        [targetUserId, deviceId]
      );
    } else {
      r = await pool.query(
        `
        select user_id, device_id, sign_pub_jwk, dh_pub_jwk, updated_at
        from e2ee_public_keys
        where user_id = $1
        order by updated_at desc
        `,
        [targetUserId]
      );
    }

    if (!r.rowCount) return res.status(404).json({ error: "NO_KEYS_FOUND" });

    return res.json({
      ok: true,
      keys: r.rows.map(x => ({
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

// -------------------------
// POST /api/e2ee/keys/change-pin
// body: { deviceId, kdf, wrappedPriv }
// -------------------------
router.post("/api/e2ee/keys/change-pin", requireAuth, express.json(), async (req, res) => {
  const userId = req.user.id;

  const { deviceId, kdf, wrappedPriv } = req.body ?? {};

  // deviceId validate
  if (typeof deviceId !== "string" || deviceId.length < 1 || deviceId.length > 64) {
    return res.status(400).json({ error: "INVALID_DEVICE_ID" });
  }

  // kdf + wrappedPriv basic validate
  const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);

  if (!isObj(kdf)) {
    return res.status(400).json({ error: "INVALID_KDF" });
  }
  if (!isObj(wrappedPriv)) {
    return res.status(400).json({ error: "INVALID_WRAPPED_PRIV" });
  }

  if (!isObj(kdf) || typeof kdf.salt_b64 !== "string" || typeof kdf.iter !== "number") {
    return res.status(400).json({ error: "INVALID_KDF_FORMAT" });
  }
  if (!isObj(wrappedPriv) || typeof wrappedPriv.iv_b64 !== "string" || typeof wrappedPriv.ct_b64 !== "string") {
    return res.status(400).json({ error: "INVALID_WRAPPED_PRIV_FORMAT" });
  }

  try {
    const q = await pool.query(
      `
      update e2ee_public_keys
      set
        kdf = $3::jsonb,
        wrapped_priv = $4::jsonb,
        updated_at = now()
      where user_id = $1 and device_id = $2
      returning updated_at
      `,
      [userId, deviceId, JSON.stringify(kdf), JSON.stringify(wrappedPriv)]
    );

    if (!q.rowCount) {
      return res.status(404).json({ error: "NO_KEYS_FOUND" });
    }

    return res.json({
      ok: true,
      userId,
      deviceId,
      updatedAt: q.rows[0].updated_at
    });
  } catch (e) {
    console.error("e2ee change-pin error:", e);
    return res.status(500).json({ error: "SERVER" });
  }
});

module.exports = router;