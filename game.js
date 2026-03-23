/* ============================================================
   Raja Rani — Client Game Logic
   ============================================================ */

const socket = io({ reconnectionAttempts: 5 });

// ── STATE ────────────────────────────────────────────────────
const state = {
  myId:        null,
  myName:      '',
  roomCode:    null,
  isHost:      false,
  myRole:      null,
  phase:       'lobby',
  players:     [],
  countdownId: null,
};

// ── SCREEN HELPERS ───────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

function activeScreen() {
  return document.querySelector('.screen.active')?.id || null;
}

// ── TOAST / NOTIFICATION ─────────────────────────────────────
let toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

// ── LOBBY ────────────────────────────────────────────────────
function createRoom() {
  const name = document.getElementById('player-name').value.trim();
  if (!name) return showError('lobby-error', 'Please enter your name.');
  clearError('lobby-error');
  state.myName = name;
  socket.emit('create_room', { playerName: name });
}

function joinRoom() {
  const name = document.getElementById('player-name').value.trim();
  const code = document.getElementById('room-code-input').value.trim().toUpperCase();
  if (!name) return showError('lobby-error', 'Please enter your name.');
  if (!code) return showError('lobby-error', 'Please enter a room code.');
  clearError('lobby-error');
  state.myName = name;
  socket.emit('join_room', { playerName: name, roomCode: code });
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  document.getElementById('panel-' + name).classList.add('active');
}

// ── WAITING ROOM ─────────────────────────────────────────────
function copyRoomCode() {
  if (!state.roomCode) return;
  navigator.clipboard.writeText(state.roomCode)
    .then(() => toast('Room code copied! 📋'))
    .catch(() => toast('Code: ' + state.roomCode));
}

function startGame()  { socket.emit('start_game'); }
function nextRound()  { socket.emit('next_round'); }
function resetGame()  { socket.emit('reset_game'); }

function renderWaiting(s) {
  document.getElementById('display-room-code').textContent = state.roomCode || '—';
  document.getElementById('header-round').textContent      = s.round;

  // Player list
  const pList = document.getElementById('player-list');
  pList.innerHTML = '';
  s.players.forEach(p => {
    const li  = document.createElement('li');
    li.innerHTML = `
      <div class="avatar">${esc(p.name.substring(0,2).toUpperCase())}</div>
      <span>${esc(p.name)}${p.id === state.myId ? ' <em style="color:var(--gold);font-size:.7rem">(you)</em>' : ''}</span>
      ${p.isHost ? '<span class="host-badge">HOST</span>' : ''}
    `;
    pList.appendChild(li);
  });
  document.getElementById('player-count').textContent = `(${s.players.length})`;

  // Scores
  renderScores('score-list', s.players);

  // Host controls
  const me = s.players.find(p => p.id === state.myId);
  state.isHost = !!me?.isHost;

  const hc  = document.getElementById('host-controls');
  const wm  = document.getElementById('waiting-msg');
  const btn = document.getElementById('btn-start');
  const hint= document.getElementById('min-players-hint');

  if (state.isHost) {
    hc.style.display  = 'flex';
    wm.style.display  = 'none';
    btn.disabled      = s.players.length < 4;
    btn.style.opacity = s.players.length < 4 ? '0.5' : '1';
    hint.style.display= s.players.length < 4 ? 'block' : 'none';
  } else {
    hc.style.display  = 'none';
    wm.style.display  = 'block';
    hint.style.display= 'none';
  }
}

function renderScores(listId, players) {
  const list = document.getElementById(listId);
  if (!list) return;
  list.innerHTML = '';
  const sorted   = [...players].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const topScore = sorted[0]?.score ?? 0;
  sorted.forEach(p => {
    const li = document.createElement('li');
    if (topScore > 0 && p.score === topScore) li.classList.add('top-player');
    li.innerHTML = `
      <span class="score-name">${esc(p.name)}${p.id === state.myId ? ' <em style="color:var(--gold);font-size:.7rem">(you)</em>' : ''}</span>
      <span class="score-val">${p.score ?? 0}</span>
    `;
    list.appendChild(li);
  });
}

// ── ROLE REVEAL ──────────────────────────────────────────────
function doRoleReveal(data) {
  showScreen('screen-role');
  document.getElementById('role-round-num').textContent = state.round;
  document.getElementById('role-emoji').textContent     = data.emoji;
  document.getElementById('role-name').textContent      = data.role;

  const policeEl = document.getElementById('police-reveal');
  policeEl.innerHTML = data.role === 'Police'
    ? 'You are the Police. Catch the Thief!'
    : `Police this round: <span>${esc(data.policeName)}</span>`;

  document.getElementById('countdown').textContent = 5;

  // Reset card flip
  const card = document.getElementById('role-card');
  card.classList.remove('flipped');
  void card.offsetWidth; // force reflow
  setTimeout(() => card.classList.add('flipped'), 500);

  // Countdown
  clearInterval(state.countdownId);
  let secs = 5;
  state.countdownId = setInterval(() => {
    secs--;
    document.getElementById('countdown').textContent = secs;
    if (secs <= 0) {
      clearInterval(state.countdownId);
      card.classList.remove('flipped');
    }
  }, 1000);
}

// ── POLICE PICK ───────────────────────────────────────────────
function doPolicePick(data) {
  showScreen('screen-police');
  clearError('police-error');
  const isPolice = state.myId === data.policeId;

  document.getElementById('police-instruction').textContent =
    isPolice ? '🚔 You are the Police — Pick the Thief!' : `🚔 ${esc(data.policeName)} is choosing…`;
  document.getElementById('police-subtext').textContent =
    isPolice ? 'Tap who you think is the Thief.' : 'Waiting for Police to make a move…';

  const list = document.getElementById('suspect-list');
  list.innerHTML = '';

  data.players
    .filter(p => p.id !== data.policeId)
    .forEach(p => {
      const li = document.createElement('li');
      if (!isPolice) li.classList.add('disabled');
      li.innerHTML = `
        <div class="suspect-avatar">${esc(p.name.substring(0,2).toUpperCase())}</div>
        <span class="suspect-name">${esc(p.name)}</span>
        ${isPolice ? '<span class="suspect-arrow">→</span>' : ''}
      `;
      if (isPolice) {
        li.addEventListener('click', () => {
          if (!confirm(`Accuse ${p.name} as the Thief?`)) return;
          list.querySelectorAll('li').forEach(el => el.classList.add('disabled'));
          socket.emit('police_accuse', { accusedId: p.id });
        });
      }
      list.appendChild(li);
    });
}

// ── RESULT ────────────────────────────────────────────────────
function doResult(data) {
  showScreen('screen-result');
  const { policeCorrect, thiefId, accusedId, roles, roundScores, totalScores, players } = data;

  document.getElementById('result-verdict').textContent   = policeCorrect ? '🎯' : '🤦';
  document.getElementById('result-title').textContent     = policeCorrect ? 'Thief Caught!' : 'Thief Escaped!';

  const accusedName = players.find(p => p.id === accusedId)?.name || '?';
  const thiefName   = players.find(p => p.id === thiefId)?.name   || '?';
  document.getElementById('result-subtitle').textContent = policeCorrect
    ? `Police correctly identified ${thiefName} as the Thief.`
    : `Police accused ${accusedName}, but the Thief was ${thiefName}!`;

  const emojiMap = { Raja: '👑', Rani: '👸', Police: '🚔', Thief: '🦹' };
  const grid = document.getElementById('result-grid');
  grid.innerHTML = '';

  players.forEach(p => {
    const role  = roles[p.id];
    const delta = roundScores[p.id] ?? 0;
    let cls = 'royal';
    if (role === 'Thief')  cls = policeCorrect ? 'caught'    : 'escaped';
    if (role === 'Police') cls = policeCorrect ? 'correct'   : 'incorrect';
    const you  = p.id === state.myId ? ' <em style="color:var(--gold);font-size:.65rem">(you)</em>' : '';
    const sign = delta > 0 ? '+' : '';
    const dc   = delta > 0 ? 'pos' : delta < 0 ? 'neg' : 'zero';
    const div  = document.createElement('div');
    div.className = `result-card ${cls}`;
    div.innerHTML = `
      <span class="rc-emoji">${emojiMap[role]}</span>
      <span class="rc-name">${esc(p.name)}${you}</span>
      <span class="rc-role">${role}</span>
      <span class="rc-delta ${dc}">${sign}${delta} pts</span>
    `;
    grid.appendChild(div);
  });

  const updatedPlayers = players.map(p => ({ ...p, score: totalScores[p.id] ?? 0 }));
  renderScores('result-score-list', updatedPlayers);

  if (state.isHost) {
    document.getElementById('result-host-controls').style.display = 'block';
    document.getElementById('result-guest-msg').style.display     = 'none';
  } else {
    document.getElementById('result-host-controls').style.display = 'none';
    document.getElementById('result-guest-msg').style.display     = 'block';
  }
}

// ── SOCKET EVENTS ─────────────────────────────────────────────
socket.on('connect', () => {
  state.myId = socket.id;
  console.log('Connected:', socket.id);
});

socket.on('connect_error', err => {
  console.error('Connection error:', err.message);
  toast('⚠ Connection error — retrying…');
});

socket.on('room_created', ({ roomCode }) => {
  state.roomCode = roomCode;
  showScreen('screen-waiting');
});

socket.on('room_joined', ({ roomCode }) => {
  state.roomCode = roomCode;
  showScreen('screen-waiting');
});

socket.on('room_state', (s) => {
  // Always update local state
  state.players = s.players;
  state.round   = s.round;
  state.phase   = s.phase;
  const me = s.players.find(p => p.id === state.myId);
  state.isHost  = !!me?.isHost;

  if (s.phase === 'lobby') {
    // Always go to (or stay on) waiting room for lobby phase
    showScreen('screen-waiting');
    renderWaiting(s);
  }
  // For other phases the dedicated events (your_role, police_pick_phase, round_result) handle rendering
});

socket.on('your_role', (data) => {
  doRoleReveal(data);
});

socket.on('police_pick_phase', (data) => {
  doPolicePick(data);
});

socket.on('round_result', (data) => {
  doResult(data);
});

socket.on('game_reset', () => {
  clearInterval(state.countdownId);
  showScreen('screen-waiting');
});

socket.on('notification', ({ message }) => {
  toast(message);
});

socket.on('error', ({ message }) => {
  const cur = activeScreen();
  if (cur === 'screen-lobby')  return showError('lobby-error', message);
  if (cur === 'screen-police') return showError('police-error', message);
  toast('❌ ' + message);
});

// ── KEY BINDINGS ─────────────────────────────────────────────
document.getElementById('player-name').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  document.getElementById('panel-create').classList.contains('active') ? createRoom() : joinRoom();
});
document.getElementById('room-code-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') joinRoom();
});

// ── UTILS ─────────────────────────────────────────────────────
function showError(id, msg) {
  const el = document.getElementById(id);
  if (!el) return toast('❌ ' + msg);
  el.textContent   = msg;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}
function clearError(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}
function esc(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
