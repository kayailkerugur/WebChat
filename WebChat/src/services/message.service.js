const env = require("../config/env");

const history = new Map();

function getRoomHistory(roomId) {
  return history.get(roomId) ?? [];
}

function appendMessage(roomId, message) {
  const list = history.get(roomId) ?? [];
  list.push(message);

  const limit = env.messageHistoryLimit ?? 50;
  if (list.length > limit) list.splice(0, list.length - limit);

  history.set(roomId, list);
  return list;
}

module.exports = { getRoomHistory, appendMessage };