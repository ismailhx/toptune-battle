const express = require('express');
const http = require('http');
const https = require('https');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files with proper MIME types
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css');
    } else if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript');
    }
  }
}));

// iTunes Search API proxy (avoids CORS issues)
app.get('/api/search', (req, res) => {
  const term = encodeURIComponent(req.query.term || '');
  if (!term) return res.json({ results: [] });

  const url = `https://itunes.apple.com/search?term=${term}&media=music&entity=song&limit=20`;

  https.get(url, (apiRes) => {
    let data = '';
    apiRes.on('data', chunk => data += chunk);
    apiRes.on('end', () => {
      try {
        res.json(JSON.parse(data));
      } catch (e) {
        res.status(500).json({ error: 'Failed to parse response' });
      }
    });
  }).on('error', () => {
    res.status(500).json({ error: 'Failed to fetch from iTunes' });
  });
});

// Game state
const gameState = {
  players: {},
  disconnectedPlayers: {},
  gameMaster: null,
  currentRound: 0,
  maxRounds: 10,
  phase: 'waiting', // waiting, prompt, submitting, voting, results, commenting, ended
  currentPrompt: '',
  songs: {}, // playerId -> { title, artist, thumbnailUrl, previewUrl }
  votes: {},
  comments: {},
  timer: null,
  timerEndTime: null,
  gameHistory: [],
  gmDisconnectedPhase: null,
  gmReconnectTimer: null
};

// Helper functions
function getPlayersList() {
  return Object.values(gameState.players).map(p => ({
    id: p.id,
    name: p.name,
    emoji: p.emoji,
    points: p.points,
    isGM: p.isGM
  }));
}

function broadcastGameState() {
  io.emit('game:state', {
    phase: gameState.phase,
    currentRound: gameState.currentRound,
    maxRounds: gameState.maxRounds,
    currentPrompt: gameState.currentPrompt,
    players: getPlayersList(),
    gameMaster: gameState.gameMaster
  });
}

function startSubmittingPhase() {
  gameState.phase = 'submitting';
  gameState.songs = {};
  gameState.votes = {};
  const duration = 100000;
  gameState.timerEndTime = Date.now() + duration;

  io.emit('phase:submitting', {
    prompt: gameState.currentPrompt,
    duration: duration
  });

  if (gameState.timer) clearTimeout(gameState.timer);
  gameState.timer = setTimeout(() => {
    if (gameState.phase === 'submitting') {
      startVotingPhase();
    }
  }, duration);
}

function startVotingPhase() {
  if (gameState.timer) clearTimeout(gameState.timer);

  const songsList = Object.entries(gameState.songs).map(([playerId, songData]) => ({
    id: playerId,
    title: songData.title,
    artist: songData.artist,
    thumbnailUrl: songData.thumbnailUrl,
    previewUrl: songData.previewUrl
  }));

  if (songsList.length === 0) {
    endRound();
    return;
  }

  gameState.phase = 'voting';

  // Shuffle songs
  for (let i = songsList.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [songsList[i], songsList[j]] = [songsList[j], songsList[i]];
  }

  const duration = 100000;
  gameState.timerEndTime = Date.now() + duration;

  io.emit('phase:voting', {
    songs: songsList,
    prompt: gameState.currentPrompt,
    duration: duration
  });

  if (gameState.timer) clearTimeout(gameState.timer);
  gameState.timer = setTimeout(() => {
    if (gameState.phase === 'voting') {
      endRound();
    }
  }, duration);
}

function endRound() {
  if (gameState.timer) clearTimeout(gameState.timer);
  gameState.phase = 'results';

  const results = {};
  Object.entries(gameState.votes).forEach(([songId, voters]) => {
    const points = voters.length;
    if (gameState.players[songId]) {
      gameState.players[songId].points += points;
      results[songId] = {
        playerId: songId,
        playerName: gameState.players[songId].name,
        playerEmoji: gameState.players[songId].emoji,
        title: gameState.songs[songId]?.title,
        artist: gameState.songs[songId]?.artist,
        thumbnailUrl: gameState.songs[songId]?.thumbnailUrl,
        previewUrl: gameState.songs[songId]?.previewUrl,
        votes: points
      };
    }
  });

  // Include players who submitted but got 0 votes
  Object.keys(gameState.songs).forEach(playerId => {
    if (!results[playerId] && gameState.players[playerId]) {
      results[playerId] = {
        playerId: playerId,
        playerName: gameState.players[playerId].name,
        playerEmoji: gameState.players[playerId].emoji,
        title: gameState.songs[playerId]?.title,
        artist: gameState.songs[playerId]?.artist,
        thumbnailUrl: gameState.songs[playerId]?.thumbnailUrl,
        previewUrl: gameState.songs[playerId]?.previewUrl,
        votes: 0
      };
    }
  });

  const isLastRound = gameState.currentRound >= gameState.maxRounds;

  let timerEndTime = null;
  if (isLastRound) {
    timerEndTime = Date.now() + 45000;
    if (gameState.timer) clearTimeout(gameState.timer);
    gameState.timer = setTimeout(() => {
      if (gameState.phase === 'results') {
        endGame();
      }
    }, 45000);
  }

  io.emit('phase:results', {
    results: Object.values(results),
    leaderboard: getPlayersList().sort((a, b) => b.points - a.points),
    isLastRound: isLastRound,
    timerEndTime: timerEndTime,
    hasSongs: Object.keys(gameState.songs).length > 0
  });
}

function startCommentingPhase() {
  if (gameState.timer) clearTimeout(gameState.timer);
  gameState.phase = 'commenting';
  gameState.comments = {};
  const duration = 90000;
  gameState.timerEndTime = Date.now() + duration;

  const songsList = Object.entries(gameState.songs).map(([playerId, songData]) => ({
    id: playerId,
    playerName: gameState.players[playerId]?.name || '😀',
    playerEmoji: gameState.players[playerId]?.emoji || '😀',
    title: songData.title,
    artist: songData.artist,
    thumbnailUrl: songData.thumbnailUrl,
    previewUrl: songData.previewUrl
  }));

  const playerVotes = {};
  Object.entries(gameState.votes).forEach(([songId, voters]) => {
    voters.forEach(voterId => {
      playerVotes[voterId] = songId;
    });
  });

  io.emit('phase:commenting', {
    songs: songsList,
    playerVotes: playerVotes,
    duration: duration
  });

  gameState.timer = setTimeout(() => {
    if (gameState.phase === 'commenting') {
      saveRoundAndAdvance();
    }
  }, duration);
}

function saveRoundAndAdvance() {
  if (gameState.timer) clearTimeout(gameState.timer);

  const roundData = {
    round: gameState.currentRound,
    prompt: gameState.currentPrompt,
    songs: []
  };

  Object.entries(gameState.songs).forEach(([playerId, songData]) => {
    const songEntry = {
      playerId: playerId,
      playerName: gameState.players[playerId]?.name || 'Unknown',
      playerEmoji: gameState.players[playerId]?.emoji || '😀',
      title: songData.title,
      artist: songData.artist,
      thumbnailUrl: songData.thumbnailUrl,
      previewUrl: songData.previewUrl,
      votes: gameState.votes[playerId]?.length || 0,
      comments: []
    };

    Object.entries(gameState.comments).forEach(([oderId, commentData]) => {
      if (commentData.votedSongId === playerId && commentData.voteComment) {
        songEntry.comments.push({
          oderId: oderId,
          voterName: gameState.players[oderId]?.name || 'Anonymous',
          comment: commentData.voteComment,
          type: 'vote'
        });
      }
      if (commentData.ownSongId === playerId && commentData.ownComment) {
        songEntry.comments.push({
          oderId: oderId,
          voterName: gameState.players[oderId]?.name || 'Anonymous',
          comment: commentData.ownComment,
          type: 'own'
        });
      }
    });

    roundData.songs.push(songEntry);
  });

  roundData.songs.sort((a, b) => b.votes - a.votes);
  gameState.gameHistory.push(roundData);

  if (gameState.currentRound >= gameState.maxRounds) {
    endGame();
  } else {
    gameState.currentRound++;
    gameState.phase = 'prompt';
    broadcastGameState();
  }
}

function endGame() {
  if (gameState.timer) clearTimeout(gameState.timer);
  gameState.phase = 'ended';
  const leaderboard = getPlayersList().sort((a, b) => b.points - a.points);

  const topScore = leaderboard.length > 0 ? leaderboard[0].points : 0;
  const topWinners = leaderboard.filter(p => p.points === topScore && topScore > 0);
  const winner = topWinners.length > 1 ? topWinners : (topWinners.length === 1 ? topWinners[0] : null);

  io.emit('game:ended', {
    leaderboard: leaderboard,
    winner: winner,
    history: gameState.gameHistory
  });

  setTimeout(() => {
    resetGame();
    io.emit('game:reset', { message: 'Game over! Returning to lobby...' });
  }, 8000);
}

function resetGame() {
  if (gameState.timer) clearTimeout(gameState.timer);
  gameState.players = {};
  gameState.disconnectedPlayers = {};
  gameState.gameMaster = null;
  gameState.currentRound = 0;
  gameState.maxRounds = 10;
  gameState.phase = 'waiting';
  gameState.currentPrompt = '';
  gameState.songs = {};
  gameState.votes = {};
  gameState.comments = {};
  gameState.timer = null;
  gameState.timerEndTime = null;
  gameState.gameHistory = [];
  gameState.gmDisconnectedPhase = null;
  if (gameState.gmReconnectTimer) {
    clearTimeout(gameState.gmReconnectTimer);
    gameState.gmReconnectTimer = null;
  }
}

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('New connection:', socket.id);

  socket.on('gm:check', () => {
    socket.emit('gm:status', { hasGM: gameState.gameMaster !== null || gameState.gmDisconnectedPhase !== null });
  });

  // Player joins
  socket.on('player:join', (data) => {
    const playerKey = `${data.name}-${data.emoji}`;
    let points = 0;
    let wasGM = false;

    if (gameState.disconnectedPlayers[playerKey]) {
      points = gameState.disconnectedPlayers[playerKey].points;
      wasGM = gameState.disconnectedPlayers[playerKey].wasGM;
      delete gameState.disconnectedPlayers[playerKey];
      console.log(`Player ${data.name} rejoined with ${points} points`);
    }

    gameState.players[socket.id] = {
      id: socket.id,
      name: data.name,
      emoji: data.emoji,
      points: points,
      isGM: data.isGM || wasGM || false
    };

    if (data.isGM || wasGM) {
      // Block new GM claims while waiting for the real GM to reconnect
      if (gameState.gmDisconnectedPhase && !wasGM) {
        gameState.players[socket.id].isGM = false;
      } else if (gameState.gameMaster === null || wasGM) {
        gameState.gameMaster = socket.id;
        gameState.players[socket.id].isGM = true;
        console.log(`GM set to ${socket.id} (${data.name})`);

        // If GM is reconnecting during an active game, resume it
        if (wasGM && gameState.gmDisconnectedPhase) {
          if (gameState.gmReconnectTimer) {
            clearTimeout(gameState.gmReconnectTimer);
            gameState.gmReconnectTimer = null;
          }
          console.log(`GM reconnected! Resuming game at phase: ${gameState.gmDisconnectedPhase}`);
          gameState.phase = gameState.gmDisconnectedPhase;
          gameState.gmDisconnectedPhase = null;
          io.emit('gm:reconnected');
          broadcastGameState();
        }
      } else if (gameState.gameMaster !== null && !wasGM) {
        gameState.players[socket.id].isGM = false;
      }
    }

    socket.emit('player:joined', {
      playerId: socket.id,
      isGM: gameState.players[socket.id].isGM
    });

    io.emit('gm:status', { hasGM: gameState.gameMaster !== null || gameState.gmDisconnectedPhase !== null });
    io.emit('players:update', getPlayersList());
    broadcastGameState();

    // Sync new player to current phase
    if (gameState.phase === 'submitting') {
      const remainingTime = Math.max(0, gameState.timerEndTime - Date.now());
      socket.emit('phase:submitting', {
        prompt: gameState.currentPrompt,
        duration: remainingTime
      });
    } else if (gameState.phase === 'voting') {
      const songsList = Object.entries(gameState.songs).map(([playerId, songData]) => ({
        id: playerId,
        title: songData.title,
        artist: songData.artist,
        thumbnailUrl: songData.thumbnailUrl,
        previewUrl: songData.previewUrl
      }));
      for (let i = songsList.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [songsList[i], songsList[j]] = [songsList[j], songsList[i]];
      }
      const remainingTime = Math.max(0, gameState.timerEndTime - Date.now());
      socket.emit('phase:voting', { songs: songsList, prompt: gameState.currentPrompt, duration: remainingTime });

      const voteCounts = {};
      Object.entries(gameState.votes).forEach(([songId, voters]) => {
        voteCounts[songId] = voters.length;
      });
      socket.emit('votes:update', voteCounts);
    } else if (gameState.phase === 'results') {
      const results = {};
      Object.entries(gameState.votes).forEach(([songId, voters]) => {
        const points = voters.length;
        if (gameState.players[songId]) {
          results[songId] = {
            playerId: songId,
            playerName: gameState.players[songId].name,
            playerEmoji: gameState.players[songId].emoji,
            title: gameState.songs[songId]?.title,
            artist: gameState.songs[songId]?.artist,
            thumbnailUrl: gameState.songs[songId]?.thumbnailUrl,
            previewUrl: gameState.songs[songId]?.previewUrl,
            votes: points
          };
        }
      });
      socket.emit('phase:results', {
        results: Object.values(results),
        leaderboard: getPlayersList().sort((a, b) => b.points - a.points)
      });
    }
  });

  // GM starts game
  socket.on('game:start', (data) => {
    if (socket.id === gameState.gameMaster && gameState.phase === 'waiting') {
      const nonGMPlayers = Object.keys(gameState.players).filter(id => id !== gameState.gameMaster);
      if (nonGMPlayers.length < 2) {
        socket.emit('game:error', { message: 'Need at least 2 players (not including Game Master) to start!' });
        return;
      }

      if (data && data.maxRounds) {
        gameState.maxRounds = Math.min(50, Math.max(1, parseInt(data.maxRounds) || 10));
      }

      gameState.currentRound = 1;
      gameState.phase = 'prompt';
      broadcastGameState();
    }
  });

  // GM submits prompt
  socket.on('prompt:submit', (data) => {
    if (socket.id === gameState.gameMaster && gameState.phase === 'prompt') {
      gameState.currentPrompt = data.prompt;
      startSubmittingPhase();
    }
  });

  // Player submits song
  socket.on('song:submit', (data) => {
    if (gameState.phase === 'submitting' && socket.id !== gameState.gameMaster) {
      gameState.songs[socket.id] = {
        title: data.title,
        artist: data.artist,
        thumbnailUrl: data.thumbnailUrl,
        previewUrl: data.previewUrl
      };

      const nonGMPlayers = Object.keys(gameState.players).filter(id => id !== gameState.gameMaster);
      const submittedCount = Object.keys(gameState.songs).length;

      io.emit('songs:submitted', {
        count: submittedCount,
        total: nonGMPlayers.length
      });

      if (submittedCount === nonGMPlayers.length) {
        startVotingPhase();
      }
    }
  });

  // Player votes
  socket.on('vote:cast', (data) => {
    if (gameState.phase === 'voting' && data.songId !== socket.id && socket.id !== gameState.gameMaster) {
      Object.keys(gameState.votes).forEach(songId => {
        if (gameState.votes[songId]) {
          gameState.votes[songId] = gameState.votes[songId].filter(voterId => voterId !== socket.id);
        }
      });

      if (!gameState.votes[data.songId]) {
        gameState.votes[data.songId] = [];
      }
      gameState.votes[data.songId].push(socket.id);

      const voteCounts = {};
      Object.entries(gameState.votes).forEach(([songId, voters]) => {
        voteCounts[songId] = voters.length;
      });

      io.emit('votes:update', voteCounts);

      const nonGMPlayers = Object.keys(gameState.players).filter(id => id !== gameState.gameMaster);
      const totalVotes = Object.values(gameState.votes).flat().length;

      if (totalVotes === nonGMPlayers.length) {
        endRound();
      }
    }
  });

  // GM starts commenting phase
  socket.on('start:commenting', () => {
    if (socket.id === gameState.gameMaster && gameState.phase === 'results') {
      startCommentingPhase();
    }
  });

  // GM skips commenting
  socket.on('round:next', () => {
    if (socket.id === gameState.gameMaster && gameState.phase === 'results') {
      const roundData = {
        round: gameState.currentRound,
        prompt: gameState.currentPrompt,
        songs: Object.entries(gameState.songs).map(([playerId, songData]) => ({
          playerId,
          playerName: gameState.players[playerId]?.name || 'Unknown',
          playerEmoji: gameState.players[playerId]?.emoji || '😀',
          title: songData.title,
          artist: songData.artist,
          thumbnailUrl: songData.thumbnailUrl,
          previewUrl: songData.previewUrl,
          votes: gameState.votes[playerId]?.length || 0,
          comments: []
        })).sort((a, b) => b.votes - a.votes)
      };
      gameState.gameHistory.push(roundData);

      if (gameState.currentRound >= gameState.maxRounds) {
        endGame();
      } else {
        gameState.currentRound++;
        gameState.phase = 'prompt';
        broadcastGameState();
      }
    }
  });

  // Player submits comments
  socket.on('comment:submit', (data) => {
    if (gameState.phase === 'commenting' && socket.id !== gameState.gameMaster) {
      gameState.comments[socket.id] = {
        votedSongId: data.votedSongId,
        voteComment: data.voteComment,
        ownSongId: data.ownSongId,
        ownComment: data.ownComment
      };

      const nonGMPlayers = Object.keys(gameState.players).filter(id => id !== gameState.gameMaster);
      const submittedCount = Object.keys(gameState.comments).length;

      io.emit('comments:submitted', {
        count: submittedCount,
        total: nonGMPlayers.length
      });

      if (submittedCount === nonGMPlayers.length) {
        saveRoundAndAdvance();
      }
    }
  });

  // Player disconnects
  socket.on('disconnect', () => {
    console.log('Disconnected:', socket.id);

    if (gameState.players[socket.id]) {
      const wasGM = gameState.players[socket.id].isGM;

      if (wasGM) {
        if (gameState.phase !== 'waiting' && gameState.phase !== 'ended') {
          // Save GM state for reconnection
          const gmPlayer = gameState.players[socket.id];
          const gmKey = `${gmPlayer.name}-${gmPlayer.emoji}`;
          gameState.disconnectedPlayers[gmKey] = {
            points: gmPlayer.points,
            wasGM: true,
            disconnectedAt: Date.now()
          };

          // Pause active timers
          gameState.gmDisconnectedPhase = gameState.phase;
          if (gameState.timer) clearTimeout(gameState.timer);

          delete gameState.players[socket.id];
          gameState.gameMaster = null;

          // Tell everyone the GM is reconnecting
          io.emit('gm:wifi_dying');
          console.log(`GM disconnected during active game, waiting for reconnect...`);

          // Give GM 60 seconds to reconnect
          gameState.gmReconnectTimer = setTimeout(() => {
            if (!gameState.gameMaster) {
              console.log('GM did not reconnect in time, ending game');
              const leaderboard = getPlayersList().sort((a, b) => b.points - a.points);
              const topScore = leaderboard.length > 0 ? leaderboard[0].points : 0;
              const topWinners = leaderboard.filter(p => p.points === topScore && topScore > 0);
              const winner = topWinners.length > 1 ? topWinners : (topWinners.length === 1 ? topWinners[0] : null);

              io.emit('game:ended', {
                leaderboard: leaderboard,
                winner: winner,
                history: gameState.gameHistory,
                reason: 'Game Master did not reconnect'
              });

              resetGame();
              io.emit('game:reset', { message: 'Game Master left. Returning to lobby...' });
            }
          }, 60000);
        } else {
          // GM left in waiting or ended phase — just reset
          delete gameState.players[socket.id];
          gameState.gameMaster = null;
          resetGame();
          io.emit('game:reset', { message: 'Game Master left. Returning to lobby...' });
        }
      } else {
        const player = gameState.players[socket.id];
        const playerKey = `${player.name}-${player.emoji}`;

        gameState.disconnectedPlayers[playerKey] = {
          points: player.points,
          wasGM: player.isGM || false,
          disconnectedAt: Date.now()
        };

        if (player.isGM) {
          gameState.gameMaster = null;
        }

        const fiveMinutesAgo = Date.now() - 300000;
        Object.keys(gameState.disconnectedPlayers).forEach(key => {
          if (gameState.disconnectedPlayers[key].disconnectedAt < fiveMinutesAgo) {
            delete gameState.disconnectedPlayers[key];
          }
        });

        delete gameState.players[socket.id];
        delete gameState.songs[socket.id];
        delete gameState.comments[socket.id];
        Object.keys(gameState.votes).forEach(songId => {
          if (gameState.votes[songId]) {
            gameState.votes[songId] = gameState.votes[songId].filter(v => v !== socket.id);
          }
        });
        io.emit('players:update', getPlayersList());
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`TopTune Battle server running on http://localhost:${PORT}`);
});
