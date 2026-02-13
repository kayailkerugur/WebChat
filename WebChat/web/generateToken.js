const jwt = require("jsonwebtoken");

const token = jwt.sign(
  {
    userId: "user-1",
    username: "Kaya",
  },
  "9f3a7c2d1e8b4f6a5c7d9e1f2b3a4c6d8e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b",
  { expiresIn: "1h" }
);

console.log(token);