// roomId -> Map(userId -> { id, username })
const rooms = new Map();

function ensureRoom(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, new Map());
  return rooms.get(roomId);
}

function norm(user) {
  const id = user.userId || user.id;
  return { id, username: user.username };
}

function joinRoom(roomId, user) {
  const roomUsers = ensureRoom(roomId);
  const u = norm(user);
  roomUsers.set(u.id, { id: u.id, username: u.username });
  return Array.from(roomUsers.values());
}

function leaveRoom(roomId, userId) {
  const roomUsers = rooms.get(roomId);
  if (!roomUsers) return [];

  roomUsers.delete(userId);
  const users = Array.from(roomUsers.values());

  if (roomUsers.size === 0) rooms.delete(roomId);
  return users;
}

function listUsers(roomId) {
  const roomUsers = rooms.get(roomId);
  return roomUsers ? Array.from(roomUsers.values()) : [];
}

function removeUserFromAllRooms(userId) {
  const leftRooms = [];
  for (const [roomId, roomUsers] of rooms.entries()) {
    if (roomUsers.delete(userId)) {
      leftRooms.push(roomId);
      if (roomUsers.size === 0) rooms.delete(roomId);
    }
  }
  return leftRooms;
}

module.exports = { joinRoom, leaveRoom, listUsers, removeUserFromAllRooms };