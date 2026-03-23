/* ============================================================
   Raja Rani — Client Game Logic
   ============================================================ */

const socket = io();

// ── STATE ────────────────────────────────────────────────────
let state = {
  myId: null,
  myName: '',
  roomCode: null,
  isHost: false,
  myRole: null,
  myRoleEmoji: null,
  phase: 'lobby',
  players: [],
  scores: {},
  round: 0,
  policeId: null,
  countdownInterval: null,
};

// ── SCREEN MANAGEMENT ────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── TABS ─────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  document.getElementById('panel-' + name).classList.add('active');
}

// ── TOAST ────────────────────────────────────────────────────
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2800);
}

// ── LOBBY ────────────────────────────────────────────────────
function createRoom() {
  const name = document.getElementById('player-name').value.trim();
  if (!name) { showLobbyError('Please enter your name.'); return; }
  state.myName = name;
  hideLobbyError();
  socket.emit('create_room', { playerName: name });
}

function joinRoom() {
  const name = document.getElementById('player-name').value.trim();
  const code = document.getElementById('room-code-input').value.trim().toUpperCase();
  if (!name) { showLobbyError('Please enter your name.'); return; }
  if (!code) { showLobbyError('Please enter a room code.'); return; }
  state.myName = name;
  hideLobbyError();
  socket.emit('join_room', { playerName: name, roomCode: code });
}

function showLobbyError(msg) {
  const el = document.getElementById('lobby-error');
  el.textContent = msg; el.style.display = 'block';
}
function hideLobbyError() {
  document.getElementById('lobby-error').style.display = 'none';
}

// ── WAITING ROOM ─────────────────────────────────────────────
function copyRoomCode() {
  navigator.clipboard.writeText(state.roomCode)
    .then(() => toast('Room code copied! 📋'))
    .catch(() => toast(state.roomCode));
}

function startGame() {
  socket.emit('start_game');
}

function nextRound() {
  socket.emit('next_round');
}

function resetGame() {
  socket.emit('reset_game');
}

function renderWaitingRoom(roomState) {
  document.getElementById('display-room-code').textContent = state.roomCode;
  document.getElementById('header-round').textContent = roomState.round;

  // Players
  const playerList = document.getElementById('player-list');
  playerList.innerHTML = '';
  roomState.players.forEach(p => {
    const li = document.createElement('li');
    const initials = p.name.substring(0, 2).toUpperCase();
    li.innerHTML = `
      <div class="avatar">${initials}</div>
      <span>${escHtml(p.name)}${p.id === state.myId ? ' <em style="color:var(--gold);font-size:0.7rem">(you)</em>' : ''}</span>
      ${p.isHost ? '<span class="host-badge">HOST</span>' : ''}
    `;
    playerList.appendChild(li);
  });
  document.getElementById('player-count').textContent = `(${roomState.players.length})`;

  // Scores
  renderScoreList('score-list', roomState.players);

  // Host controls
  const me = roomState.players.find(p => p.id === state.myId);
  state.isHost = me?.isHost || false;
  if (state.isHost) {
    document.getElementById('host-controls').style.display = 'flex';
    document.getElementById('waiting-msg').style.display = 'none';
    const btnStart = document.getElementById('btn-start');
    btnStart.disabled = roomState.players.length < 4;
    btnStart.style.opacity = roomState.players.length < 4 ? '0.5' : '1';
    document.getElementById('min-players-hint').style.display =
      roomState.players.length < 4 ? 'block' : 'none';
  } else {
    document.getElementById('host-controls').style.display = 'none';
    document.getElementById('waiting-msg').style.display = 'block';
  }
}

function renderScoreList(listId, players) {
  const list = document.getElementById(listId);
  if (!list) return;
  list.innerHTML = '';
  const sorted = [...players].sort((a, b) => (b.score || 0) - (a.score || 0));
  const topScore = sorted[0]?.score || 0;
  sorted.forEach(p => {
    const li = document.createElement('li');
    if (topScore > 0 && p.score === topScore) li.classList.add('top-player');
    li.innerHTML = `
      <span class="score-name">${escHtml(p.name)}${p.id === state.myId ? ' <em style="color:var(--gold);font-size:0.7rem">(you)</em>' : ''}</span>
      <span class="score-val">${p.score ?? 0}</span>
    `;
    list.appendChild(li);
  });
}

// ── ROLE REVEAL ──────────────────────────────────────────────
function showRoleReveal(data, round) {
  showScreen('screen-role');
  document.getElementById('role-round-num').textContent = round;
  document.getElementById('role-emoji').textContent = data.emoji;
  document.getElementById('role-name').textContent = data.role;

  const policeReveal = document.getElementById('police-reveal');
  if (data.role === 'Police') {
    policeReveal.innerHTML = `You are the Police. It's your duty to catch the Thief!`;
  } else {
    policeReveal.innerHTML = `The Police this round is <span>${escHtml(data.policeName)}</span>`;
  }

  state.myRole = data.role;
  state.myRoleEmoji = data.emoji;
  state.policeId = data.policeId;

  // Flip card after short delay
  setTimeout(() => {
    document.getElementById('role-card').classList.add('flipped');
  }, 600);

  // Countdown
  clearInterval(state.countdownInterval);
  let secs = 5;
  document.getElementById('countdown').textContent = secs;
  state.countdownInterval = setInterval(() => {
    secs--;
    document.getElementById('countdown').textContent = secs;
    if (secs <= 0) {
      clearInterval(state.countdownInterval);
      document.getElementById('role-card').classList.remove('flipped');
    }
  }, 1000);
}

// ── POLICE PICK ───────────────────────────────────────────────
function showPolicePick(data) {
  showScreen('screen-police');
  const isPolice = state.myId === data.policeId;

  document.getElementById('police-instruction').textContent =
    isPolice ? '🚔 You are the Police — Accuse the Thief!' : `🚔 ${escHtml(data.policeName)} is choosing…`;
  document.getElementById('police-subtext').textContent =
    isPolice ? 'Pick who you think is the Thief.' : 'Waiting for the Police to make a move…';

  const list = document.getElementById('suspect-list');
  list.innerHTML = '';

  // Exclude the police themselves
  const suspects = data.players.filter(p => p.id !== data.policeId);
  suspects.forEach(p => {
    const li = document.createElement('li');
    if (!isPolice) li.classList.add('disabled');
    li.innerHTML = `
      <div class="suspect-avatar">${p.name.substring(0,2).toUpperCase()}</div>
      <span class="suspect-name">${escHtml(p.name)}</span>
      ${isPolice ? '<span class="suspect-arrow">→</span>' : ''}
    `;
    if (isPolice) {
      li.addEventListener('click', () => accuse(p.id, p.name));
    }
    list.appendChild(li);
  });
}

function accuse(playerId, playerName) {
  if (!confirm(`Accuse ${playerName} of being the Thief?`)) return;
  socket.emit('police_accuse', { accusedId: playerId });
  // Disable all buttons
  document.querySelectorAll('.suspect-list li').forEach(li => li.classList.add('disabled'));
}

// ── RESULT ────────────────────────────────────────────────────
function showResult(data) {
  showScreen('screen-result');
  const { policeCorrect, thiefId, accusedId, roles, roundScores, totalScores, players } = data;

  document.getElementById('result-verdict').textContent = policeCorrect ? '🎯' : '🤦';
  document.getElementById('result-title').textContent =
    policeCorrect ? 'Thief Caught!' : 'Thief Escaped!';

  const accusedName = players.find(p => p.id === accusedId)?.name || '?';
  const thiefName   = players.find(p => p.id === thiefId)?.name || '?';
  document.getElementById('result-subtitle').textContent = policeCorrect
    ? `Police correctly identified ${escHtml(thiefName)} as the Thief.`
    : `Police accused ${escHtml(accusedName)}, but the Thief was ${escHtml(thiefName)}!`;

  const roleEmojis = { Raja: '👑', Rani: '👸', Police: '🚔', Thief: '🦹' };

  // Result grid
  const grid = document.getElementById('result-grid');
  grid.innerHTML = '';
  players.forEach(p => {
    const role  = roles[p.id];
    const delta = roundScores[p.id] ?? 0;
    let cardClass = 'royal';
    if (role === 'Thief') cardClass = policeCorrect ? 'caught' : 'escaped';
    if (role === 'Police') cardClass = policeCorrect ? 'correct' : 'incorrect';

    const deltaClass = delta > 0 ? 'pos' : delta < 0 ? 'neg' : 'zero';
    const deltaText  = delta > 0 ? `+${delta}` : delta === 0 ? '0' : `${delta}`;
    const you = p.id === state.myId ? ' <em style="color:var(--gold);font-size:0.65rem">(you)</em>' : '';

    const card = document.createElement('div');
    card.className = `result-card ${cardClass}`;
    card.innerHTML = `
      <span class="rc-emoji">${roleEmojis[role]}</span>
      <span class="rc-name">${escHtml(p.name)}${you}</span>
      <span class="rc-role">${role}</span>
      <span class="rc-delta ${deltaClass}">${deltaText} pts</span>
    `;
    grid.appendChild(card);
  });

  // Total scores — rebuild players array with updated totals
  const updatedPlayers = players.map(p => ({ ...p, score: totalScores[p.id] ?? 0 }));
  renderScoreList('result-score-list', updatedPlayers);

  // Host controls
  if (state.isHost) {
    document.getElementById('result-host-controls').style.display = 'block';
    document.getElementById('result-guest-msg').style.display = 'none';
  } else {
    document.getElementById('result-host-controls').style.display = 'none';
    document.getElementById('result-guest-msg').style.display = 'block';
  }
}

// ── SOCKET EVENTS ─────────────────────────────────────────────
socket.on('connect', () => {
  state.myId = socket.id;
});

socket.on('room_created', ({ roomCode }) => {
  state.roomCode = roomCode;
  showScreen('screen-waiting');
});

socket.on('room_joined', ({ roomCode }) => {
  state.roomCode = roomCode;
  showScreen('screen-waiting');
});

socket.on('room_state', (roomState) => {
  state.players = roomState.players;
  state.round   = roomState.round;
  state.phase   = roomState.phase;
  state.policeId = roomState.policeId;

  // Update isHost
  const me = roomState.players.find(p => p.id === state.myId);
  state.isHost = me?.isHost || false;

  if (roomState.phase === 'lobby') {
    renderWaitingRoom(roomState);
    // If we're not on the waiting screen, go there
    const activeScreen = document.querySelector('.screen.active');
    if (activeScreen && activeScreen.id !== 'screen-waiting') {
      showScreen('screen-waiting');
      renderWaitingRoom(roomState);
    } else if (!activeScreen || activeScreen.id === 'screen-waiting') {
      renderWaitingRoom(roomState);
    }
  } else if (roomState.phase === 'police_pick' || roomState.phase === 'role_reveal') {
    // Keep scores in sync
    state.players = roomState.players;
  }
});

socket.on('your_role', (data) => {
  showRoleReveal(data, state.round);
});

socket.on('police_pick_phase', (data) => {
  showPolicePick(data);
});

socket.on('round_result', (data) => {
  showResult(data);
});

socket.on('game_reset', () => {
  showScreen('screen-waiting');
});

socket.on('player_left', ({ message }) => {
  toast(`⚠ ${message}`);
});

socket.on('error', ({ message }) => {
  const activeScreen = document.querySelector('.screen.active');
  if (activeScreen?.id === 'screen-lobby') {
    showLobbyError(message);
  } else {
    toast(`❌ ${message}`);
    const errEls = ['room-error', 'police-error'];
    errEls.forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.textContent = message; el.style.display = 'block'; setTimeout(() => el.style.display='none', 3000); }
    });
  }
});

// Allow pressing Enter in inputs
document.getElementById('player-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    if (document.getElementById('panel-create').classList.contains('active')) createRoom();
    else joinRoom();
  }
});
document.getElementById('room-code-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') joinRoom();
});

// ── UTILS ─────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
