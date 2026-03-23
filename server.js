const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.use(express.static(path.join(__dirname, 'public')));

// rooms: { [roomCode]: { players: [], round: 0, phase: 'lobby'|'role_reveal'|'police_pick'|'result', scores: {}, roles: {} } }
const rooms = {};

const ROLES = ['Raja', 'Rani', 'Police', 'Thief'];
const ROLE_SCORES = { Raja: 5, Rani: 3, Police: 0, Thief: 0 };

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function shuffleRoles(count) {
  // Always include Raja, Rani, Police, Thief; extras get random non-Police roles
  const base = ['Raja', 'Rani', 'Police', 'Thief'];
  const extras = ['Raja', 'Rani', 'Thief'];
  const pool = [...base];
  for (let i = 4; i < count; i++) {
    pool.push(extras[Math.floor(Math.random() * extras.length)]);
  }
  // Fisher-Yates shuffle
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

function getRoomPublicState(room) {
  return {
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      score: room.scores[p.id] || 0,
      isHost: p.isHost
    })),
    round: room.round,
    phase: room.phase,
    policeId: room.policeId || null,
    accusedId: room.accusedId || null,
    roundResult: room.roundResult || null
  };
}

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  // Create a room
  socket.on('create_room', ({ playerName }) => {
    const code = generateRoomCode();
    rooms[code] = {
      code,
      players: [{ id: socket.id, name: playerName, isHost: true }],
      round: 0,
      phase: 'lobby',
      scores: { [socket.id]: 0 },
      roles: {},
      policeId: null,
      accusedId: null,
      roundResult: null
    };
    socket.join(code);
    socket.roomCode = code;
    socket.emit('room_created', { roomCode: code });
    io.to(code).emit('room_state', getRoomPublicState(rooms[code]));
  });

  // Join a room
  socket.on('join_room', ({ playerName, roomCode }) => {
    const code = roomCode.toUpperCase();
    const room = rooms[code];
    if (!room) {
      socket.emit('error', { message: 'Room not found. Check the room code.' });
      return;
    }
    if (room.phase !== 'lobby') {
      socket.emit('error', { message: 'Game already in progress.' });
      return;
    }
    if (room.players.find(p => p.id === socket.id)) {
      socket.emit('error', { message: 'You are already in this room.' });
      return;
    }
    room.players.push({ id: socket.id, name: playerName, isHost: false });
    room.scores[socket.id] = 0;
    socket.join(code);
    socket.roomCode = code;
    socket.emit('room_joined', { roomCode: code });
    io.to(code).emit('room_state', getRoomPublicState(room));
  });

  // Start the game (host only)
  socket.on('start_game', () => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player || !player.isHost) {
      socket.emit('error', { message: 'Only the host can start the game.' });
      return;
    }
    if (room.players.length < 4) {
      socket.emit('error', { message: 'Need at least 4 players to start.' });
      return;
    }
    startRound(code);
  });

  // Police picks a player as Thief
  socket.on('police_accuse', ({ accusedId }) => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room || room.phase !== 'police_pick') return;
    if (socket.id !== room.policeId) {
      socket.emit('error', { message: 'Only the Police can accuse.' });
      return;
    }
    room.accusedId = accusedId;
    resolveRound(code);
  });

  // Next round
  socket.on('next_round', () => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player || !player.isHost) return;
    startRound(code);
  });

  // Back to lobby (reset game)
  socket.on('reset_game', () => {
    const code = socket.roomCode;
    const room = rooms[code];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (!player || !player.isHost) return;
    room.round = 0;
    room.phase = 'lobby';
    room.roles = {};
    room.policeId = null;
    room.accusedId = null;
    room.roundResult = null;
    Object.keys(room.scores).forEach(id => { room.scores[id] = 0; });
    io.to(code).emit('room_state', getRoomPublicState(room));
    io.to(code).emit('game_reset');
  });

  socket.on('disconnect', () => {
    const code = socket.roomCode;
    if (!code || !rooms[code]) return;
    const room = rooms[code];
    room.players = room.players.filter(p => p.id !== socket.id);
    delete room.scores[socket.id];

    if (room.players.length === 0) {
      delete rooms[code];
      return;
    }

    // If host left, assign new host
    if (!room.players.find(p => p.isHost)) {
      room.players[0].isHost = true;
    }

    io.to(code).emit('room_state', getRoomPublicState(room));
    io.to(code).emit('player_left', { message: 'A player has left the room.' });

    // If game was in progress and not enough players, go back to lobby
    if (room.phase !== 'lobby' && room.players.length < 4) {
      room.phase = 'lobby';
      room.roles = {};
      room.policeId = null;
      room.accusedId = null;
      room.roundResult = null;
      io.to(code).emit('room_state', getRoomPublicState(room));
      io.to(code).emit('error', { message: 'Not enough players. Game paused.' });
    }
  });
});

function startRound(code) {
  const room = rooms[code];
  room.round += 1;
  room.phase = 'role_reveal';
  room.accusedId = null;
  room.roundResult = null;

  const rolePool = shuffleRoles(room.players.length);
  room.roles = {};
  room.policeId = null;

  room.players.forEach((p, i) => {
    room.roles[p.id] = rolePool[i];
    if (rolePool[i] === 'Police') room.policeId = p.id;
  });

  // Broadcast public state
  io.to(code).emit('room_state', getRoomPublicState(room));

  // Send each player their private role
  room.players.forEach(p => {
    const roleEmoji = { Raja: '👑', Rani: '👸', Police: '🚔', Thief: '🦹' };
    io.to(p.id).emit('your_role', {
      role: room.roles[p.id],
      emoji: roleEmoji[room.roles[p.id]],
      policeId: room.policeId,
      policeName: room.players.find(pl => pl.id === room.policeId)?.name || ''
    });
  });

  // After 4 seconds reveal phase ends → police_pick phase
  setTimeout(() => {
    if (!rooms[code] || rooms[code].round !== room.round) return;
    room.phase = 'police_pick';
    io.to(code).emit('room_state', getRoomPublicState(room));
    io.to(code).emit('police_pick_phase', {
      policeId: room.policeId,
      policeName: room.players.find(p => p.id === room.policeId)?.name || '',
      players: room.players.map(p => ({ id: p.id, name: p.name }))
    });
  }, 5000);
}

function resolveRound(code) {
  const room = rooms[code];
  room.phase = 'result';

  const thiefId = Object.keys(room.roles).find(id => room.roles[id] === 'Thief');
  const policeCorrect = room.accusedId === thiefId;

  const roundScores = {};
  room.players.forEach(p => {
    const role = room.roles[p.id];
    let delta = 0;
    if (role === 'Raja') delta = 5;
    else if (role === 'Rani') delta = 3;
    else if (role === 'Police') delta = policeCorrect ? 10 : -5;
    else if (role === 'Thief') delta = policeCorrect ? 0 : 10;
    roundScores[p.id] = delta;
    room.scores[p.id] = (room.scores[p.id] || 0) + delta;
  });

  room.roundResult = {
    policeCorrect,
    thiefId,
    accusedId: room.accusedId,
    roles: { ...room.roles },
    roundScores
  };

  io.to(code).emit('room_state', getRoomPublicState(room));
  io.to(code).emit('round_result', {
    policeCorrect,
    thiefId,
    accusedId: room.accusedId,
    roles: room.roles,
    roundScores,
    totalScores: { ...room.scores },
    players: room.players.map(p => ({ id: p.id, name: p.name }))
  });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎮 Raja Rani server running at http://localhost:${PORT}`);
});
