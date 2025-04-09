const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const os = require('os'); // Importing the OS module to get IP addresses

const http = require('http');
const server = http.createServer();

const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

console.clear();
console.log('\n========================================');
console.log('         ✅ GAME LAUNCHED ✅           ');
console.log('----------------------------------------');
console.log(` [SERVER ID]   : x932xfwwxcfsj24524`);
console.log(` [SERVER PORT] : 8080`);

// Display server IP addresses
const networkInterfaces = os.networkInterfaces();
for (const interface in networkInterfaces) {
  networkInterfaces[interface].forEach((details) => {
    if (details.family === 'IPv4' && !details.internal) {
      console.log(` [SERVER IP]    : ${details.address}`);
    }
  });
}
console.log('========================================\n');

let lobbies = {};

function generateLobbyCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

function spawnCoin(canvasWidth = 800, canvasHeight = 600) {
  return {
    x: Math.random() * (canvasWidth - 60) + 30,
    y: Math.random() * (canvasHeight - 60) + 30
  };
}

function spawnEnemies(difficulty) {
  const enemyCount = { normal: 1, hard: 2, impossible: 5 }[difficulty] || 1;
  let enemies = [];
  for (let i = 0; i < enemyCount; i++) {
    enemies.push({
      x: Math.random() * 800,
      y: Math.random() * 600,
      speed: 1 + Math.random(),
      lastUpdate: null,
      target: null,
      targetCooldown: null
    });
  }
  return enemies;
}

wss.on('connection', (ws, req) => {
  ws.id = uuidv4();
  ws.send(JSON.stringify({ type: 'welcome', id: ws.id }));

  // Get the IP address of the client using ws._socket
  const clientIp = ws._socket.remoteAddress; // Use _socket to get remote address
  console.log(`Player connected: ${clientIp}, ID: ${ws.id}`);

  ws.on('message', (msg) => {
    let data;
    try {
      data = JSON.parse(msg);
    } catch (e) {
      return;
    }

    switch (data.type) {
      case 'create_lobby': {
        const code = generateLobbyCode();
        lobbies[code] = {
          host: ws,
          hostId: ws.id,
          players: [ws],
          playerStates: {},
          coins: [spawnCoin(), spawnCoin()],
          enemies: [],
          map: data.map,
          difficulty: data.difficulty,
          started: false
        };
        ws.lobbyCode = code;
        lobbies[code].playerStates[ws.id] = { x: 100, y: 100, width: 40, height: 40, speed: 4, score: 0 };
        console.log(`Lobby created: ${code}, Host ID: ${ws.id}, IP: ${clientIp}`);
        ws.send(JSON.stringify({ type: 'lobby_created', code, hostId: ws.id, playerId: ws.id }));
        break;
      }
      case 'join_lobby': {
        const lobby = lobbies[data.code];
        if (lobby && !lobby.started && lobby.players.length < 4) {
          lobby.players.push(ws);
          ws.lobbyCode = data.code;
          lobby.playerStates[ws.id] = { x: 100, y: 100, width: 40, height: 40, speed: 4, score: 0 };
          console.log(`Player joined: ${ws.id}, Lobby: ${data.code}, IP: ${clientIp}`);
          ws.send(JSON.stringify({ type: 'lobby_joined', code: data.code, hostId: lobby.hostId, playerId: ws.id }));
          lobby.players.forEach(p => p.send(JSON.stringify({ type: 'player_joined', count: lobby.players.length })));
        } else {
          ws.send(JSON.stringify({ type: 'error', message: 'Lobby not found, full, or already started' }));
        }
        break;
      }
      case 'start_game': {
        const lobby = lobbies[ws.lobbyCode];
        if (lobby && ws.id === lobby.hostId) {
          lobby.started = true;
          lobby.enemies = spawnEnemies(lobby.difficulty);
          lobby.players.forEach(p => {
            p.send(JSON.stringify({
              type: 'start_game',
              map: lobby.map,
              difficulty: lobby.difficulty,
              players: lobby.playerStates,
              coins: lobby.coins,
              enemies: lobby.enemies
            }));
          });
        }
        break;
      }
      case 'player_state': {
        const lobby = lobbies[ws.lobbyCode];
        if (!lobby) break;
        lobby.playerStates[ws.id] = { ...lobby.playerStates[ws.id], ...data.state };

        // Check for coin collisions across all players
        let coinCollected = false;
        for (let i = lobby.coins.length - 1; i >= 0; i--) {
          const coin = lobby.coins[i];
          for (let pid in lobby.playerStates) {
            const pState = lobby.playerStates[pid];
            const dx = pState.x - coin.x;
            const dy = pState.y - coin.y;
            if (Math.hypot(dx, dy) < 30) {
              lobby.coins.splice(i, 1);
              coinCollected = true;
              break;
            }
          }
        }
        if (coinCollected) {
          lobby.coins.push(spawnCoin(), spawnCoin());
          const newEnemies = spawnEnemies(lobby.difficulty);
          lobby.enemies.push(...newEnemies);
        }
        break;
      }
    }
  });

  ws.on('close', () => {
    if (ws.lobbyCode && lobbies[ws.lobbyCode]) {
      const lobby = lobbies[ws.lobbyCode];
      lobby.players = lobby.players.filter(p => p !== ws);
      delete lobby.playerStates[ws.id];
      console.log(`Player disconnected: ${ws.id}, from Lobby: ${ws.lobbyCode}, IP: ${clientIp}`);
      if (lobby.players.length === 0) {
        delete lobbies[ws.lobbyCode];
        console.log(`Lobby ${ws.lobbyCode} has been deleted`);
      } else {
        lobby.players.forEach(p =>
          p.send(JSON.stringify({ type: 'player_left', playerId: ws.id }))
        );
      }
    }
  });
});

// === SERVER-SIDE GAME LOOP ===
setInterval(() => {
  const now = Date.now();

  for (let code in lobbies) {
    const lobby = lobbies[code];
    if (!lobby.started) continue;

    for (let enemy of lobby.enemies) {
      if (!enemy.lastUpdate) enemy.lastUpdate = now;
      const deltaTime = (now - enemy.lastUpdate) / 16.67;
      enemy.lastUpdate = now;

      if (!enemy.targetCooldown || now > enemy.targetCooldown) {
        let closestDist = Infinity;
        let target = null;
        for (let pid in lobby.playerStates) {
          const p = lobby.playerStates[pid];
          const dx = p.x - enemy.x;
          const dy = p.y - enemy.y;
          const dist = Math.hypot(dx, dy);
          if (dist < closestDist) {
            closestDist = dist;
            target = { dx, dy, dist };
          }
        }
        if (target) {
          enemy.target = target;
          enemy.targetCooldown = now + 500;
        }
      }

      if (enemy.target && enemy.target.dist > 0) {
        const dx = enemy.target.dx;
        const dy = enemy.target.dy;
        const dist = enemy.target.dist;
        const moveX = (dx / dist) * enemy.speed * deltaTime;
        const moveY = (dy / dist) * enemy.speed * deltaTime;
        enemy.x += moveX;
        enemy.y += moveY;
      }
    }

    const gameState = {
      type: 'update_state',
      players: lobby.playerStates,
      coins: lobby.coins,
      enemies: lobby.enemies
    };

    lobby.players.forEach(p => {
      if (p.readyState === WebSocket.OPEN) {
        p.send(JSON.stringify(gameState));
      }
    });
  }
}, 1000 / 60); // 60 FPS update rate
