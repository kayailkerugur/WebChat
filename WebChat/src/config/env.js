require("dotenv").config();

const required = (key) => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required env variable: ${key}`);
  }
  return value;
};

const env = {
  port: parseInt(process.env.PORT) || 3000,
  jwtSecret: required("JWT_SECRET"),
  corsOrigin: process.env.CORS_ORIGIN || "*",
  messageHistoryLimit: parseInt(process.env.MESSAGE_HISTORY_LIMIT) || 50,
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 10000,
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX) || 20,
};

module.exports = env;