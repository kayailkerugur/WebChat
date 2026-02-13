const jwt = require("jsonwebtoken");
const env = require("../config/env");

function socketAuthMiddleware(socket, next) {
  try {
    const token = socket.handshake.auth?.token;

    if (!token) {
      return next(new Error("UNAUTHORIZED: No token provided"));
    }

    const decoded = jwt.verify(token, env.jwtSecret);

    socket.data.user = {
      id: decoded.userId,
      username: decoded.username,
    };

    next();
  } catch (err) {
    next(new Error("UNAUTHORIZED: Invalid token"));
  }
}

module.exports = socketAuthMiddleware;