const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout:  60000,
  pingInterval: 25000
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ status: 'ok', rooms: Object.keys(rooms).length }));

const rooms = {};
const ROLE_EMOJIS = { Raja: '👑', Rani: '👸', Police: '🚔', Thief: '🦹' };

function generateCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function shuffleRoles(count) {
  const base  = ['Raja', 'Rani', 'Police', 'Thief'];
  const extra = ['Raja', 'Rani', 'Thief'];
  const pool  = [...base];
  for (let i = 4; i < count; i++) pool.push(extra[Math.floor(Math.random() * extra.length)]);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool;
}

function publicState(room) {
  return {
    players:     room.players.map(p => ({ id: p.id, name: p.name, score: room.scores[p.id] ?? 0, isHost: p.isHost })),
    round:       room.round,
    phase:       room.phase,
    policeId:    room.policeId  ?? null,
    accusedId:   room.accusedId ?? null,
    roundResult: room.roundResult ?? null
  };
}

function broadcast(code) {
  const room = rooms[code];
  if (room) io.to(code).emit('room_state', publicState(room));
}

function clearPhaseTimer(room) {
  if (room.phaseTimer) { clearTimeout(room.phaseTimer); room.phaseTimer = null; }
}

function startRound(code) {
  const room = rooms[code];
  if (!room) return;
  clearPhaseTimer(room);

  room.round      += 1;
  room.phase       = 'role_reveal';
  room.accusedId   = null;
  room.roundResult = null;
  room.policeId    = null;
  room.roles       = {};

  const rolePool = shuffleRoles(room.players.length);
  room.players.forEach((p, i) => {
    room.roles[p.id] = rolePool[i];
    if (rolePool[i] === 'Police') room.policeId = p.id;
  });

  broadcast(code);

  room.players.forEach(p => {
    const role    = room.roles[p.id];
    const policeP = room.players.find(pl => pl.id === room.policeId);
    io.to(p.id).emit('your_role', {
      role, emoji: ROLE_EMOJIS[role],
      policeId: room.policeId,
      policeName: policeP ? policeP.name : ''
    });
  });

  const roundSnapshot = room.round;
  room.phaseTimer = setTimeout(() => {
    const r = rooms[code];
    if (!r || r.round !== roundSnapshot) return;
    r.phase = 'police_pick';
    broadcast(code);
    const policeP = r.players.find(p => p.id === r.policeId);
    io.to(code).emit('police_pick_phase', {
      policeId: r.policeId,
      policeName: policeP ? policeP.name : '',
      players: r.players.map(p => ({ id: p.id, name: p.name }))
    });
  }, 5000);
}

function resolveRound(code) {
  const room = rooms[code];
  if (!room) return;
  clearPhaseTimer(room);
  room.phase = 'result';

  const thiefId      = Object.keys(room.roles).find(id => room.roles[id] === 'Thief');
  const policeCorrect = room.accusedId === thiefId;
  const roundScores  = {};

  room.players.forEach(p => {
    const role  = room.roles[p.id];
    let   delta = 0;
    if      (role === 'Raja')   delta = 5;
    else if (role === 'Rani')   delta = 3;
    else if (role === 'Police') delta = policeCorrect ? 10 : -5;
    else if (role === 'Thief')  delta = policeCorrect ?  0 : 10;
    roundScores[p.id]  = delta;
    room.scores[p.id]  = (room.scores[p.id] ?? 0) + delta;
  });

  room.roundResult = { policeCorrect, thiefId, accusedId: room.accusedId, roles: { ...room.roles }, roundScores };
  broadcast(code);
  io.to(code).emit('round_result', {
    policeCorrect, thiefId, accusedId: room.accusedId,
    roles: room.roles, roundScores,
    totalScores: { ...room.scores },
    players: room.players.map(p => ({ id: p.id, name: p.name }))
  });
}

io.on('connection', socket => {
  console.log(`[+] ${socket.id} connected`);

  socket.on('create_room', ({ playerName } = {}) => {
    if (!playerName?.trim()) return socket.emit('error', { message: 'Player name is required.' });
    const name = playerName.trim().substring(0, 18);
    const code = generateCode();
    rooms[code] = {
      code, players: [{ id: socket.id, name, isHost: true }],
      round: 0, phase: 'lobby',
      scores: { [socket.id]: 0 }, roles: {},
      policeId: null, accusedId: null, roundResult: null, phaseTimer: null
    };
    socket.join(code);
    socket.data.roomCode = code;
    socket.emit('room_created', { roomCode: code });
    broadcast(code);
    console.log(`[R] Room ${code} created by "${name}"`);
  });

  socket.on('join_room', ({ playerName, roomCode } = {}) => {
    if (!playerName?.trim() || !roomCode) return socket.emit('error', { message: 'Name and room code required.' });
    const code = roomCode.toString().trim().toUpperCase();
    const name = playerName.trim().substring(0, 18);
    const room = rooms[code];
    if (!room) return socket.emit('error', { message: 'Room not found. Check the code and try again.' });
    if (room.phase !== 'lobby') return socket.emit('error', { message: 'Game already started in that room.' });
    if (room.players.find(p => p.id === socket.id)) {
      socket.emit('room_joined', { roomCode: code });
      return broadcast(code);
    }
    room.players.push({ id: socket.id, name, isHost: false });
    room.scores[socket.id] = 0;
    socket.join(code);
    socket.data.roomCode = code;
    socket.emit('room_joined', { roomCode: code });
    broadcast(code);
    console.log(`[J] "${name}" joined ${code}`);
  });

  socket.on('start_game', () => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room) return;
    const me = room.players.find(p => p.id === socket.id);
    if (!me?.isHost)             return socket.emit('error', { message: 'Only the host can start.' });
    if (room.players.length < 4) return socket.emit('error', { message: 'Need at least 4 players.' });
    startRound(code);
  });

  socket.on('police_accuse', ({ accusedId } = {}) => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room || room.phase !== 'police_pick') return;
    if (socket.id !== room.policeId)            return socket.emit('error', { message: 'Only the Police can accuse.' });
    if (!room.players.find(p => p.id === accusedId)) return socket.emit('error', { message: 'Invalid player.' });
    if (accusedId === socket.id)                return socket.emit('error', { message: 'You cannot accuse yourself.' });
    room.accusedId = accusedId;
    resolveRound(code);
  });

  socket.on('next_round', () => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room || room.phase !== 'result') return;
    const me = room.players.find(p => p.id === socket.id);
    if (!me?.isHost) return;
    startRound(code);
  });

  socket.on('reset_game', () => {
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room) return;
    const me = room.players.find(p => p.id === socket.id);
    if (!me?.isHost) return;
    clearPhaseTimer(room);
    room.round = 0; room.phase = 'lobby';
    room.roles = {}; room.policeId = null;
    room.accusedId = null; room.roundResult = null;
    room.players.forEach(p => { room.scores[p.id] = 0; });
    broadcast(code);
    io.to(code).emit('game_reset');
    console.log(`[X] Room ${code} reset`);
  });

  socket.on('disconnect', reason => {
    console.log(`[-] ${socket.id} left (${reason})`);
    const code = socket.data.roomCode;
    const room = rooms[code];
    if (!room) return;
    const leaverName = room.players.find(p => p.id === socket.id)?.name || 'A player';
    room.players = room.players.filter(p => p.id !== socket.id);
    delete room.scores[socket.id];

    if (room.players.length === 0) {
      clearPhaseTimer(room);
      delete rooms[code];
      return;
    }
    if (!room.players.find(p => p.isHost)) room.players[0].isHost = true;

    if (room.phase !== 'lobby' && room.players.length < 4) {
      clearPhaseTimer(room);
      room.phase = 'lobby'; room.roles = {};
      room.policeId = null; room.accusedId = null; room.roundResult = null;
      broadcast(code);
      io.to(code).emit('notification', { message: `${leaverName} left. Game paused — need 4 players.` });
    } else {
      broadcast(code);
      io.to(code).emit('notification', { message: `${leaverName} left the game.` });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🎮  Raja Rani — http://localhost:${PORT}`);
  console.log(`    Health:      http://localhost:${PORT}/health\n`);
});
server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌  Port ${PORT} already in use. Run: PORT=3001 node server.js\n`);
  } else console.error('Server error:', err);
  process.exit(1);
});
