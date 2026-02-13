const jwt = require("jsonwebtoken");
const env = require("../config/env");

module.exports = function httpAuth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;

  if (!token) return res.status(401).json({ message: "missing token" });

  try {
    req.user = jwt.verify(token, env.jwtSecret); 
    next();
  } catch {
    return res.status(401).json({ message: "invalid token" });
  }
};