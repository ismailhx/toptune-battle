// Get player info from session storage
const playerName = sessionStorage.getItem('playerName');
const playerEmoji = sessionStorage.getItem('playerEmoji');
let isGM = sessionStorage.getItem('isGM') === 'true';

if (!playerName || !playerEmoji) {
    window.location.href = '/';
}

// Initialize socket connection
const socket = io();

// Game state
let myPlayerId = null;
let currentPhase = 'waiting';
let hasSubmittedSong = false;
let selectedSongData = null;
let myVotedSongId = null;
let timerInterval = null;

// Audio management
let currentAudio = null;
let currentlyPlayingElement = null;

function playPreview(previewUrl, triggerElement) {
    // If same song is playing, pause it
    if (currentAudio && currentAudio.src === previewUrl && !currentAudio.paused) {
        stopPreview();
        return;
    }

    stopPreview();

    if (!previewUrl) return;

    currentAudio = new Audio(previewUrl);
    currentAudio.volume = 0.1;
    currentlyPlayingElement = triggerElement;

    // Add playing class to trigger element's parent card
    if (triggerElement) {
        const card = triggerElement.closest('.song-note-display, .song-vote-item, .selected-song-container, .comment-song-card');
        if (card) card.classList.add('playing');
    }

    currentAudio.play().catch(() => {});

    currentAudio.addEventListener('ended', () => {
        stopPreview();
    });
}

function stopPreview() {
    if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
        currentAudio = null;
    }
    // Remove all playing classes
    document.querySelectorAll('.playing').forEach(el => el.classList.remove('playing'));
    currentlyPlayingElement = null;
}

// Sound effects
let audioContext = null;

const playSound = (type) => {
    try {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }

        const now = audioContext.currentTime;

        switch(type) {
            case 'submit': {
                const osc = audioContext.createOscillator();
                const gain = audioContext.createGain();
                osc.connect(gain);
                gain.connect(audioContext.destination);
                osc.type = 'sine';
                osc.frequency.setValueAtTime(200, now);
                osc.frequency.exponentialRampToValueAtTime(800, now + 0.05);
                osc.frequency.exponentialRampToValueAtTime(300, now + 0.15);
                gain.gain.setValueAtTime(0.15, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
                osc.start(now);
                osc.stop(now + 0.2);
                break;
            }
            case 'vote': {
                const osc1 = audioContext.createOscillator();
                const osc2 = audioContext.createOscillator();
                const osc3 = audioContext.createOscillator();
                const gain = audioContext.createGain();
                osc1.connect(gain);
                osc2.connect(gain);
                osc3.connect(gain);
                gain.connect(audioContext.destination);
                osc1.type = 'triangle';
                osc2.type = 'triangle';
                osc3.type = 'triangle';
                osc1.frequency.value = 659;
                osc2.frequency.value = 784;
                osc3.frequency.value = 988;
                gain.gain.setValueAtTime(0.12, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
                osc1.start(now);
                osc2.start(now + 0.05);
                osc3.start(now + 0.1);
                osc1.stop(now + 0.4);
                osc2.stop(now + 0.45);
                osc3.stop(now + 0.5);
                break;
            }
            case 'win': {
                const frequencies = [330, 392, 494, 587];
                frequencies.forEach((freq, i) => {
                    const osc = audioContext.createOscillator();
                    const gain = audioContext.createGain();
                    osc.connect(gain);
                    gain.connect(audioContext.destination);
                    osc.type = 'sine';
                    osc.frequency.value = freq;
                    const startTime = now + (i * 0.15);
                    gain.gain.setValueAtTime(0.08, startTime);
                    gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.4);
                    osc.start(startTime);
                    osc.stop(startTime + 0.4);
                });
                break;
            }
            case 'click': {
                const osc = audioContext.createOscillator();
                const gain = audioContext.createGain();
                osc.connect(gain);
                gain.connect(audioContext.destination);
                osc.type = 'sine';
                osc.frequency.setValueAtTime(800, now);
                osc.frequency.exponentialRampToValueAtTime(600, now + 0.1);
                gain.gain.setValueAtTime(0.1, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
                osc.start(now);
                osc.stop(now + 0.1);
                break;
            }
            case 'select': {
                const osc = audioContext.createOscillator();
                const gain = audioContext.createGain();
                osc.connect(gain);
                gain.connect(audioContext.destination);
                osc.type = 'sine';
                osc.frequency.setValueAtTime(400, now);
                osc.frequency.exponentialRampToValueAtTime(800, now + 0.15);
                gain.gain.setValueAtTime(0.12, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
                osc.start(now);
                osc.stop(now + 0.2);
                break;
            }
            case 'drumroll': {
                for (let i = 0; i < 20; i++) {
                    const osc = audioContext.createOscillator();
                    const gain = audioContext.createGain();
                    osc.connect(gain);
                    gain.connect(audioContext.destination);
                    osc.type = 'triangle';
                    osc.frequency.value = 150 + Math.random() * 50;
                    const startTime = now + (i * 0.08);
                    gain.gain.setValueAtTime(0.05, startTime);
                    gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.05);
                    osc.start(startTime);
                    osc.stop(startTime + 0.05);
                }
                break;
            }
        }
    } catch (e) {
        console.log('Audio not supported');
    }
};

const showNotification = (message, type = 'info') => {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: linear-gradient(135deg, #667eea, #764ba2);
        color: white;
        padding: 15px 25px;
        border-radius: 10px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.3);
        z-index: 10000;
        animation: slideInRight 0.5s ease, fadeOut 0.5s ease 2.5s;
        font-weight: 600;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
};

// Song Search using iTunes API (proxied through server)
async function searchSongs(query) {
    if (!query.trim()) return;

    const resultsContainer = document.getElementById('song-results');
    resultsContainer.innerHTML = '<p class="loading">🔍 Searching for songs...</p>';

    try {
        const response = await fetch(`/api/search?term=${encodeURIComponent(query)}`);
        const data = await response.json();

        if (data.results && data.results.length > 0) {
            displaySongResults(data.results);
        } else {
            resultsContainer.innerHTML = '<p class="no-results">No songs found. Try a different search!</p>';
        }
    } catch (error) {
        console.error('Error fetching songs:', error);
        resultsContainer.innerHTML = '<p class="error">Error loading songs. Please try again.</p>';
    }
}

function displaySongResults(songs) {
    const resultsContainer = document.getElementById('song-results');
    resultsContainer.innerHTML = '';

    songs.forEach(song => {
        if (!song.previewUrl) return; // Skip songs without previews

        const thumbnailUrl = song.artworkUrl100 ? song.artworkUrl100.replace('100x100', '200x200') : '';
        const songItem = document.createElement('div');
        songItem.className = 'song-result-item';

        songItem.innerHTML = `
            <img src="${thumbnailUrl}" alt="Album Art" class="song-result-art">
            <div class="song-result-info">
                <div class="song-result-title">${escapeHtml(song.trackName)}</div>
                <div class="song-result-artist">${escapeHtml(song.artistName)}</div>
            </div>
            <button class="preview-btn-small" data-preview="${song.previewUrl}">▶</button>
        `;

        // Click card to select
        songItem.addEventListener('click', (e) => {
            if (e.target.classList.contains('preview-btn-small')) return;
            selectSong({
                title: song.trackName,
                artist: song.artistName,
                thumbnailUrl: thumbnailUrl,
                previewUrl: song.previewUrl
            });
        });

        // Preview button
        const previewBtn = songItem.querySelector('.preview-btn-small');
        previewBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            playPreview(song.previewUrl, previewBtn);
        });

        resultsContainer.appendChild(songItem);
    });
}

function selectSong(songData) {
    selectedSongData = songData;
    stopPreview();

    const selectedContainer = document.getElementById('selected-song-container');
    document.getElementById('selected-song-thumbnail').src = songData.thumbnailUrl;
    document.getElementById('selected-song-title').textContent = songData.title;
    document.getElementById('selected-song-artist').textContent = songData.artist;
    selectedContainer.style.display = 'block';

    playSound('select');
    selectedContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function clearSongSelection() {
    selectedSongData = null;
    stopPreview();
    document.getElementById('selected-song-container').style.display = 'none';
    document.getElementById('selected-song-thumbnail').src = '';
    document.getElementById('selected-song-title').textContent = '';
    document.getElementById('selected-song-artist').textContent = '';
}

// Join the game
socket.emit('player:join', {
    name: playerName,
    emoji: playerEmoji,
    isGM: isGM
});

// Socket event handlers
socket.on('player:joined', (data) => {
    myPlayerId = data.playerId;

    // Server is the source of truth for GM status
    isGM = data.isGM;
    sessionStorage.setItem('isGM', isGM);

    if (data.isGM) {
        document.getElementById('start-game-btn').style.display = 'block';
        document.getElementById('gm-settings').style.display = 'block';
    }
});

socket.on('players:update', (players) => {
    updatePlayersList(players);
    updateLeaderboard(players);
});

socket.on('game:state', (state) => {
    currentPhase = state.phase;

    if (state.phase === 'prompt' || state.phase === 'waiting' || state.phase === 'ended') {
        stopTimer();
        stopPreview();
    }

    showPhase(state.phase);

    if (state.phase !== 'waiting' && isGM) {
        document.getElementById('start-game-btn').style.display = 'none';
        document.getElementById('gm-settings').style.display = 'none';
    }

    if (state.phase === 'prompt' && state.gameMaster === myPlayerId) {
        document.getElementById('prompt-round').textContent = state.currentRound;
    }

    if (state.currentRound > 0) {
        document.getElementById('round-display').textContent =
            `Round ${state.currentRound} / ${state.maxRounds}`;
    }
});

socket.on('phase:submitting', (data) => {
    currentPhase = 'submitting';
    hasSubmittedSong = false;
    selectedSongData = null;
    stopPreview();

    const timerEndTime = Date.now() + (data.duration || 100000);
    startTimer(timerEndTime);

    const promptDisplay = document.getElementById('submitting-prompt-display');
    const searchInput = document.getElementById('song-search-input');
    const songResults = document.getElementById('song-results');
    const selectedContainer = document.getElementById('selected-song-container');
    const submitBtn = document.getElementById('submit-song-btn');
    const submissionStatus = document.getElementById('submission-status');

    if (promptDisplay) promptDisplay.textContent = data.prompt;
    if (searchInput) searchInput.value = '';
    if (songResults) songResults.innerHTML = '<p class="song-hint">Start typing to search for songs!</p>';
    if (selectedContainer) selectedContainer.style.display = 'none';
    if (submitBtn) submitBtn.disabled = false;
    if (submissionStatus) submissionStatus.textContent = '';

    showPhase('submitting');
});

socket.on('songs:submitted', (data) => {
    document.getElementById('submission-status').textContent =
        `${data.count} / ${data.total} players have submitted`;
});

socket.on('phase:voting', (data) => {
    // Auto-submit selected song if player didn't submit manually
    if (selectedSongData && !hasSubmittedSong && !isGM) {
        socket.emit('song:submit', selectedSongData);
        hasSubmittedSong = true;
        showNotification('✅ Your selected song was auto-submitted!');
    }

    currentPhase = 'voting';
    myVotedSongId = null;
    stopTimer();
    stopPreview();
    showPhase('voting');

    if (data.prompt) {
        document.getElementById('voting-prompt-display').textContent = `"${data.prompt}"`;
    }

    if (!data.songs || data.songs.length === 0) {
        document.getElementById('songs-grid').innerHTML =
            '<p style="text-align: center; color: #666; font-size: 1.2em; grid-column: 1/-1;">⏰ No songs were submitted this round!</p>';
    } else {
        const timerEndTime = Date.now() + (data.duration || 100000);
        displayVotingSongs(data.songs);
        startTimer(timerEndTime);
    }
});

socket.on('votes:update', (voteCounts) => {
    updateVoteCounts(voteCounts);
});

socket.on('phase:results', (data) => {
    currentPhase = 'results';
    stopTimer();
    stopPreview();

    showResultsAnnouncement(() => {
        showPhase('results');
        displayResults(data.results);
        updateLeaderboard(data.leaderboard);

        if (isGM) {
            document.getElementById('gm-results-buttons').style.display = 'block';

            if (data.hasSongs === false) {
                document.getElementById('start-commenting-btn').style.display = 'none';
            } else {
                document.getElementById('start-commenting-btn').style.display = 'inline-block';
            }

            if (data.isLastRound) {
                document.getElementById('next-round-btn').textContent = 'Skip → End Game';
            } else {
                document.getElementById('next-round-btn').textContent = 'Next Round';
            }
        }
    });
});

// Commenting phase state
let hasSubmittedComment = false;
let commentingSongs = [];
let myOwnSongId = null;

socket.on('phase:commenting', (data) => {
    currentPhase = 'commenting';
    hasSubmittedComment = false;
    commentingSongs = data.songs;
    stopPreview();

    const myVotedSong = data.playerVotes ? data.playerVotes[myPlayerId] : myVotedSongId;
    myOwnSongId = myPlayerId;

    showPhase('commenting');
    displayCommentingSongs(data.songs, myVotedSong, myOwnSongId);

    const timerEndTime = Date.now() + (data.duration || 90000);
    startTimer(timerEndTime);

    document.getElementById('comment-status').textContent = '';
    document.getElementById('vote-comment-input').value = '';
    document.getElementById('own-comment-input').value = '';
    document.getElementById('comment-input-area').style.display = 'block';
    document.getElementById('comments-container').style.opacity = '1';
});

socket.on('comments:submitted', (data) => {
    document.getElementById('comment-status').textContent =
        `${data.count} / ${data.total} players have commented`;
});

socket.on('game:ended', (data) => {
    currentPhase = 'ended';
    stopTimer();
    stopPreview();
    showPhase('ended');
    displayWinner(data.winner);
    displayFinalLeaderboard(data.leaderboard);

    playSound('win');
    createConfetti();
    setTimeout(() => createConfetti(), 500);
    setTimeout(() => createConfetti(), 1000);

    if (data.history && data.history.length > 0) {
        setTimeout(() => {
            generateAndDownloadHTML(data.history);
        }, 2000);
    }

    if (data.reason) {
        setTimeout(() => {
            showNotification('⚠️ ' + data.reason);
        }, 1000);
    }
});

socket.on('game:reset', (data) => {
    stopPreview();
    showNotification(data.message);
    setTimeout(() => {
        socket.disconnect();
        sessionStorage.clear();
        window.location.href = '/';
    }, 1500);
});

socket.on('game:error', (data) => {
    showNotification('⚠️ ' + data.message);
});

// GM disconnect handling
let gmDisconnectOverlay = null;

socket.on('gm:wifi_dying', () => {
    // Show overlay telling players to wait
    if (gmDisconnectOverlay) return;
    gmDisconnectOverlay = document.createElement('div');
    gmDisconnectOverlay.id = 'gm-disconnect-overlay';
    gmDisconnectOverlay.style.cssText = `
        position: fixed;
        top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0, 0, 0, 0.85);
        display: flex; justify-content: center; align-items: center;
        z-index: 10000;
        animation: fadeIn 0.3s ease;
    `;
    gmDisconnectOverlay.innerHTML = `
        <div style="text-align: center; padding: 40px;">
            <div style="font-size: 5em; margin-bottom: 20px; animation: pulse 1.5s ease infinite;">📡</div>
            <div style="font-size: 2em; font-weight: 800; color: white; margin-bottom: 15px;">gamemaster's wifi is dying</div>
            <div style="font-size: 1.4em; color: #ccc;">hold on a moment</div>
            <div style="margin-top: 30px; font-size: 1em; color: #999;">waiting for them to reconnect...</div>
        </div>
    `;
    document.body.appendChild(gmDisconnectOverlay);
});

socket.on('gm:reconnected', () => {
    if (gmDisconnectOverlay) {
        gmDisconnectOverlay.remove();
        gmDisconnectOverlay = null;
    }
    showNotification('✅ Game Master reconnected!');
});

// Results announcement popup
const showResultsAnnouncement = (callback) => {
    const announcements = [
        { emoji: '🎵', text: 'THE VOTES ARE IN!' },
        { emoji: '🎸', text: 'RESULTS TIME!' },
        { emoji: '🎤', text: 'AND THE WINNER IS...' },
        { emoji: '🥁', text: 'DRUMROLL PLEASE...' },
        { emoji: '🎧', text: 'MOMENT OF TRUTH!' },
        { emoji: '🎶', text: 'THE CROWD HAS SPOKEN!' }
    ];

    const announcement = announcements[Math.floor(Math.random() * announcements.length)];

    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed;
        top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0, 0, 0, 0.9);
        display: flex; justify-content: center; align-items: center;
        z-index: 10000;
        animation: fadeIn 0.3s ease;
    `;

    const content = document.createElement('div');
    content.style.cssText = `text-align: center; animation: bounceIn 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55);`;
    content.innerHTML = `
        <div style="font-size: 8em; animation: pulse 0.5s ease infinite;">${announcement.emoji}</div>
        <div style="font-size: 3em; font-weight: 800; color: white; text-shadow: 0 0 20px #ffd700, 0 0 40px #ffd700; margin-top: 20px; animation: textGlow 0.5s ease infinite alternate;">${announcement.text}</div>
        <div style="margin-top: 40px; display: flex; justify-content: center; align-items: flex-end; gap: 15px; height: 100px;">
            <div style="width: 30px; background: linear-gradient(to top, #667eea, #764ba2); border-radius: 5px; animation: barGrow 0.5s ease forwards; animation-delay: 0.2s; height: 0;"></div>
            <div style="width: 30px; background: linear-gradient(to top, #f093fb, #f5576c); border-radius: 5px; animation: barGrow 0.6s ease forwards; animation-delay: 0.4s; height: 0;"></div>
            <div style="width: 30px; background: linear-gradient(to top, #4facfe, #00f2fe); border-radius: 5px; animation: barGrow 0.7s ease forwards; animation-delay: 0.6s; height: 0;"></div>
            <div style="width: 30px; background: linear-gradient(to top, #ffd700, #ffed4e); border-radius: 5px; animation: barGrow 0.8s ease forwards; animation-delay: 0.8s; height: 0;"></div>
            <div style="width: 30px; background: linear-gradient(to top, #11998e, #38ef7d); border-radius: 5px; animation: barGrow 0.9s ease forwards; animation-delay: 1.0s; height: 0;"></div>
        </div>
        <div style="margin-top: 30px; display: flex; justify-content: center; gap: 10px;">
            <span style="font-size: 2em; animation: bounce 0.3s ease infinite; animation-delay: 0s;">🎵</span>
            <span style="font-size: 2em; animation: bounce 0.3s ease infinite; animation-delay: 0.1s;">🎶</span>
            <span style="font-size: 2em; animation: bounce 0.3s ease infinite; animation-delay: 0.2s;">🎵</span>
        </div>
    `;

    overlay.appendChild(content);
    document.body.appendChild(overlay);
    playSound('drumroll');

    setTimeout(() => {
        overlay.style.animation = 'fadeOut 0.3s ease forwards';
        setTimeout(() => {
            overlay.remove();
            callback();
        }, 300);
    }, 3000);
};

const createConfetti = () => {
    const colors = ['#667eea', '#764ba2', '#f093fb', '#ffd700', '#ff6b6b', '#4ecdc4'];

    for (let i = 0; i < 50; i++) {
        setTimeout(() => {
            const confetti = document.createElement('div');
            confetti.style.cssText = `
                position: fixed; width: 10px; height: 10px;
                background: ${colors[Math.floor(Math.random() * colors.length)]};
                top: -10px; left: ${Math.random() * 100}%;
                z-index: 9999; border-radius: 50%;
                animation: confettiFall ${2 + Math.random() * 2}s linear;
            `;
            document.body.appendChild(confetti);
            setTimeout(() => confetti.remove(), 4000);
        }, i * 30);
    }
};

// Button handlers
document.getElementById('start-game-btn').addEventListener('click', () => {
    playSound('click');
    const roundCount = parseInt(document.getElementById('round-count').value) || 10;
    socket.emit('game:start', { maxRounds: roundCount });
});

document.getElementById('submit-prompt-btn').addEventListener('click', () => {
    playSound('click');
    const prompt = document.getElementById('prompt-input').value.trim();
    if (prompt) {
        socket.emit('prompt:submit', { prompt });
        document.getElementById('prompt-input').value = '';
    }
});

// Song search - auto-search with debounce
let searchTimeout = null;
document.getElementById('song-search-input').addEventListener('input', (e) => {
    const query = e.target.value;
    if (searchTimeout) clearTimeout(searchTimeout);
    if (query.trim().length >= 2) {
        searchTimeout = setTimeout(() => {
            searchSongs(query);
        }, 400);
    }
});

document.getElementById('preview-selected-btn').addEventListener('click', () => {
    if (selectedSongData) {
        playPreview(selectedSongData.previewUrl, document.getElementById('preview-selected-btn'));
    }
});

document.getElementById('submit-song-btn').addEventListener('click', () => {
    if (selectedSongData && !hasSubmittedSong) {
        socket.emit('song:submit', selectedSongData);
        hasSubmittedSong = true;
        stopPreview();
        document.getElementById('submit-song-btn').disabled = true;
        document.getElementById('song-search-input').disabled = true;
        document.getElementById('submission-status').textContent =
            'Song submitted! Waiting for other players...';

        playSound('submit');
        showNotification('✅ Song submitted!');
    }
});

document.getElementById('clear-selection-btn').addEventListener('click', () => {
    clearSongSelection();
});

document.getElementById('start-commenting-btn').addEventListener('click', () => {
    playSound('click');
    stopPreview();
    socket.emit('start:commenting');
    document.getElementById('gm-results-buttons').style.display = 'none';
});

document.getElementById('next-round-btn').addEventListener('click', () => {
    playSound('click');
    stopPreview();
    socket.emit('round:next');
    document.getElementById('gm-results-buttons').style.display = 'none';
});

document.getElementById('submit-comment-btn').addEventListener('click', () => {
    if (!hasSubmittedComment) {
        const voteComment = document.getElementById('vote-comment-input').value.trim();
        const ownComment = document.getElementById('own-comment-input').value.trim();

        socket.emit('comment:submit', {
            votedSongId: myVotedSongId,
            voteComment: voteComment,
            ownSongId: myOwnSongId,
            ownComment: ownComment
        });
        hasSubmittedComment = true;

        document.getElementById('comment-input-area').style.display = 'none';
        document.getElementById('comment-status').textContent = '✅ Comments submitted! Waiting for others...';
        document.getElementById('comments-container').style.opacity = '0.5';

        playSound('submit');
        showNotification('✅ Comments submitted!');
    }
});

document.getElementById('exit-game-btn').addEventListener('click', () => {
    playSound('click');
    if (confirm('Are you sure you want to exit the game?')) {
        stopPreview();
        socket.disconnect();
        sessionStorage.clear();
        window.location.href = '/';
    }
});

document.getElementById('play-again-btn').addEventListener('click', () => {
    playSound('click');
    stopPreview();
    socket.disconnect();
    sessionStorage.clear();
    window.location.href = '/';
});

// UI update functions
function showPhase(phase) {
    const phases = ['waiting', 'prompt', 'submitting', 'voting', 'results', 'commenting', 'ended'];
    phases.forEach(p => {
        const elem = document.getElementById(`${p}-phase`);
        if (elem) elem.style.display = 'none';
    });

    document.getElementById('gm-results-buttons').style.display = 'none';

    if (phase === 'prompt' && isGM) {
        document.getElementById('prompt-phase').style.display = 'flex';
    } else if (phase === 'submitting' && !isGM) {
        document.getElementById('submitting-phase').style.display = 'flex';
        document.getElementById('song-search-input').disabled = false;
    } else if (phase === 'submitting' && isGM) {
        document.getElementById('waiting-phase').style.display = 'flex';
        document.querySelector('#waiting-phase h2').textContent =
            'Waiting for players to find their songs...';
    } else if (phase === 'voting') {
        document.getElementById('voting-phase').style.display = 'flex';
    } else if (phase === 'commenting' && isGM) {
        document.getElementById('waiting-phase').style.display = 'flex';
        document.querySelector('#waiting-phase h2').textContent =
            'Players are commenting on songs...';
    } else if (phase === 'commenting' && !isGM) {
        document.getElementById('commenting-phase').style.display = 'flex';
    } else if (phase === 'prompt' && !isGM) {
        document.getElementById('waiting-phase').style.display = 'flex';
        document.querySelector('#waiting-phase h2').textContent =
            'Waiting for Game Master to write a prompt...';
    } else {
        const phaseElem = document.getElementById(`${phase}-phase`);
        if (phaseElem) phaseElem.style.display = 'flex';
    }
}

function updatePlayersList(players) {
    const container = document.getElementById('players-list');
    container.innerHTML = '';

    players.forEach(player => {
        const div = document.createElement('div');
        div.className = 'player-item';
        div.innerHTML = `
            <span class="player-emoji">${player.emoji}</span>
            <span class="player-name">${player.name}</span>
            ${player.isGM ? '<span class="player-badge">GM</span>' : ''}
        `;
        container.appendChild(div);
    });
}

function updateLeaderboard(players) {
    const container = document.getElementById('leaderboard');
    container.innerHTML = '';

    const sorted = [...players].sort((a, b) => b.points - a.points);
    const topScore = sorted.length > 0 ? sorted[0].points : 0;

    sorted.forEach((player) => {
        const div = document.createElement('div');
        div.className = 'leaderboard-item';
        div.innerHTML = `
            <span class="leaderboard-emoji">${player.emoji}</span>
            <span class="leaderboard-name">${player.name}</span>
            <span class="leaderboard-points">${player.points}</span>
        `;
        if (player.points === topScore && player.points > 0) {
            div.style.background = 'linear-gradient(135deg, #ffd700 0%, #ffed4e 100%)';
        }
        container.appendChild(div);
    });
}

// Display voting songs
function displayVotingSongs(songs) {
    const container = document.getElementById('songs-grid');
    container.innerHTML = '';

    if (isGM) {
        const gmNote = document.createElement('p');
        gmNote.className = 'gm-spectator-note';
        gmNote.textContent = '👀 You are spectating - players are voting now!';
        gmNote.style.cssText = 'text-align: center; color: #667eea; font-weight: 600; margin-bottom: 20px; grid-column: 1 / -1;';
        container.appendChild(gmNote);
    }

    songs.forEach(song => {
        const div = document.createElement('div');
        div.className = 'song-vote-item';
        div.dataset.songId = song.id;

        const isMySong = song.id === myPlayerId;
        if (isMySong) {
            div.style.cursor = 'not-allowed';
            div.style.border = '4px solid #ffd700';
        }
        if (isGM) {
            div.style.cursor = 'default';
        }

        div.innerHTML = `
            ${isMySong ? '<div class="your-song-badge">🎵 YOUR SONG 🎵</div>' : ''}
            <div class="song-vote-art-wrapper">
                <img src="${song.thumbnailUrl}" alt="Album Art" class="song-vote-art">
                <button class="preview-btn-vote" data-preview="${song.previewUrl}">▶</button>
            </div>
            <div class="song-vote-meta">
                <div class="song-vote-title">${escapeHtml(song.title)}</div>
                <div class="song-vote-artist">${escapeHtml(song.artist)}</div>
            </div>
            <div class="song-votes">
                <span class="vote-count" data-song-id="${song.id}">0 votes</span>
            </div>
        `;

        // Preview button
        const previewBtn = div.querySelector('.preview-btn-vote');
        previewBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            playPreview(song.previewUrl, previewBtn);
        });

        // Click to vote (not on preview button, not on own song, not GM)
        if (!isMySong && !isGM) {
            div.addEventListener('click', (e) => {
                if (e.target.classList.contains('preview-btn-vote')) return;
                voteForSong(song.id);
            });
        }

        container.appendChild(div);
    });
}

function voteForSong(songId) {
    if (songId === myPlayerId) return;

    socket.emit('vote:cast', { songId });
    myVotedSongId = songId;

    document.querySelectorAll('.song-vote-item').forEach(item => {
        item.classList.remove('voted');
    });
    const votedItem = document.querySelector(`[data-song-id="${songId}"]`);
    if (votedItem) votedItem.classList.add('voted');

    playSound('vote');
    showNotification('🎵 Vote cast!');
}

function updateVoteCounts(voteCounts) {
    Object.entries(voteCounts).forEach(([songId, count]) => {
        const voteElem = document.querySelector(`.vote-count[data-song-id="${songId}"]`);
        if (voteElem) {
            voteElem.textContent = `${count} vote${count !== 1 ? 's' : ''}`;
        }
    });
}

// Display results - Instagram Note style
function displayResults(results) {
    const container = document.getElementById('results-display');
    container.innerHTML = '';

    if (!results || results.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #666; font-size: 1.2em;">No songs were submitted this round.</p>';
        return;
    }

    const totalVotes = results.reduce((sum, r) => sum + r.votes, 0);
    if (totalVotes === 0) {
        container.innerHTML = '<p style="text-align: center; color: #666; font-size: 1.2em; margin-bottom: 20px;">⏰ No votes were cast this round!</p>';
    }

    const sorted = [...results].sort((a, b) => b.votes - a.votes);
    const topVotes = sorted[0]?.votes || 0;

    sorted.forEach((result, index) => {
        const isWinner = result.votes === topVotes && topVotes > 0;
        const div = document.createElement('div');
        div.className = 'result-card song-result';

        div.innerHTML = `
            <div class="song-note-display ${isWinner ? 'winner' : ''}">
                <div class="album-art-wrapper ${isWinner ? 'playing' : ''}">
                    <div class="album-art-ring"></div>
                    <img src="${result.thumbnailUrl}" alt="Album Art" class="album-art-circle">
                    ${isWinner ? '<div class="music-notes-float"><span>🎵</span><span>🎶</span><span>🎵</span></div>' : ''}
                </div>
                <div class="song-note-info">
                    <div class="song-note-title">${escapeHtml(result.title || 'Unknown')}</div>
                    <div class="song-note-artist">${escapeHtml(result.artist || 'Unknown')}</div>
                </div>
            </div>
            <div class="result-info">
                <div class="result-player">
                    <span class="result-emoji">${result.playerEmoji}</span>
                    <span class="result-name">${result.playerName}</span>
                </div>
                <div class="result-votes">+${result.votes} pts</div>
            </div>
        `;

        // Click to play preview
        const noteDisplay = div.querySelector('.song-note-display');
        noteDisplay.style.cursor = 'pointer';
        noteDisplay.addEventListener('click', () => {
            playPreview(result.previewUrl, noteDisplay);
        });

        container.appendChild(div);
    });

    // Auto-play winning song(s) - if tied, play sequentially
    if (topVotes > 0) {
        const winners = sorted.filter(r => r.votes === topVotes && r.previewUrl);
        if (winners.length > 0) {
            setTimeout(() => {
                playWinnersSequentially(winners, container, 0);
            }, 500);
        }
    }
}

// Play tied winners one after the other
function playWinnersSequentially(winners, container, index) {
    if (index >= winners.length) return;
    if (currentPhase !== 'results') return;

    stopPreview();

    const winner = winners[index];
    const winnerNotes = container.querySelectorAll('.song-note-display.winner');
    const currentNote = winnerNotes[index];

    currentAudio = new Audio(winner.previewUrl);
    currentAudio.volume = 0.1;
    currentlyPlayingElement = currentNote;

    if (currentNote) {
        currentNote.classList.add('playing');
        const artWrapper = currentNote.querySelector('.album-art-wrapper');
        if (artWrapper) artWrapper.classList.add('playing');
    }

    currentAudio.play().catch(() => {});

    currentAudio.addEventListener('ended', () => {
        if (currentNote) {
            currentNote.classList.remove('playing');
            const artWrapper = currentNote.querySelector('.album-art-wrapper');
            if (artWrapper) artWrapper.classList.remove('playing');
        }
        currentAudio = null;
        currentlyPlayingElement = null;
        playWinnersSequentially(winners, container, index + 1);
    });
}

function displayWinner(winner) {
    const container = document.getElementById('winner-display');
    container.style.cssText = `
        text-align: center;
        padding: 40px 20px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        border-radius: 20px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        margin: 20px;
    `;

    if (Array.isArray(winner)) {
        const winnersHTML = winner.map(w =>
            `<div style="font-size: 4em; margin: 10px 0; animation: spinGrow 2s ease-in-out infinite;">${w.emoji}</div>
             <div style="font-size: 2em; font-weight: 700; color: white; text-shadow: 2px 2px 4px rgba(0,0,0,0.3);">${w.name}</div>`
        ).join('<div style="font-size: 2em; color: #ffd700; margin: 10px 0;">&</div>');

        container.innerHTML = `
            <div style="font-size: 5em; margin-bottom: 20px; animation: bounce 1s ease-in-out infinite;">🏆</div>
            <div style="font-size: 3em; font-weight: 800; color: #ffd700; text-shadow: 3px 3px 6px rgba(0,0,0,0.3); margin-bottom: 20px;">It's a Tie!</div>
            ${winnersHTML}
            <div style="font-size: 2.5em; font-weight: 700; background: linear-gradient(135deg, #ffd700, #ffed4e); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-top: 25px;">🎵 Tune Masters! 🎵</div>
            <div style="font-size: 1.5em; color: white; margin-top: 20px; font-weight: 600;">${winner[0].points} points each</div>
        `;
    } else if (!winner) {
        container.innerHTML = `
            <div style="font-size: 5em; margin-bottom: 20px; animation: bounce 1s ease-in-out infinite;">🏆</div>
            <div style="font-size: 2em; font-weight: 700; color: white;">🎵 No Winner 🎵</div>
        `;
    } else {
        container.innerHTML = `
            <div style="font-size: 5em; margin-bottom: 20px; animation: bounce 1s ease-in-out infinite;">🏆</div>
            <div style="font-size: 6em; margin: 20px 0; animation: spinGrow 2s ease-in-out infinite;">${winner.emoji}</div>
            <div style="font-size: 3em; font-weight: 800; color: white; text-shadow: 3px 3px 6px rgba(0,0,0,0.3); margin-bottom: 15px;">${winner.name}</div>
            <div style="font-size: 2.5em; font-weight: 700; background: linear-gradient(135deg, #ffd700, #ffed4e); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-top: 15px;">🎵 The Tune Master! 🎵</div>
            <div style="font-size: 1.5em; color: white; margin-top: 20px; font-weight: 600;">${winner.points} points</div>
        `;
    }
}

function displayFinalLeaderboard(players) {
    const container = document.getElementById('final-leaderboard');
    container.innerHTML = '<h3 style="margin-bottom: 25px; font-size: 1.8em; text-align: center; color: #667eea;">🎵 Final Leaderboard 🎵</h3>';

    const topScore = players.length > 0 ? players[0].points : 0;
    const topWinners = players.filter(p => p.points === topScore && topScore > 0);

    players.forEach((player, index) => {
        const div = document.createElement('div');
        div.className = 'result-card';

        const isTiedWinner = player.points === topScore && topScore > 0;

        if (isTiedWinner) {
            div.style.background = 'linear-gradient(135deg, #ffd700 0%, #ffed4e 100%)';
            div.style.border = '3px solid #ffa500';
            div.style.transform = 'scale(1.05)';
        } else if (index === topWinners.length) {
            div.style.background = 'linear-gradient(135deg, #c0c0c0 0%, #e8e8e8 100%)';
            div.style.border = '3px solid #a0a0a0';
        } else if (index === topWinners.length + 1) {
            div.style.background = 'linear-gradient(135deg, #cd7f32 0%, #e8a87c 100%)';
            div.style.border = '3px solid #b87333';
        } else {
            div.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
        }

        let medal = '';
        if (isTiedWinner) medal = '🥇';
        else if (index === topWinners.length) medal = '🥈';
        else if (index === topWinners.length + 1) medal = '🥉';

        div.innerHTML = `
            <div class="result-player">
                <span style="font-size: 2em; min-width: 50px;">${medal || `${index + 1}.`}</span>
                <span class="result-emoji" style="font-size: 2em;">${player.emoji}</span>
                <span style="font-size: 1.2em; font-weight: 600;">${player.name}</span>
            </div>
            <div class="result-votes" style="font-size: 1.5em;">${player.points} pts</div>
        `;
        container.appendChild(div);
    });
}

// Timer
let lastSpokenSecond = -1;

function startTimer(endTime) {
    stopTimer();
    lastSpokenSecond = -1;

    timerInterval = setInterval(() => {
        const remaining = Math.max(0, endTime - Date.now());
        const minutes = Math.floor(remaining / 60000);
        const seconds = Math.floor((remaining % 60000) / 1000);
        const totalSeconds = Math.floor(remaining / 1000);

        const timerEl = document.getElementById('timer');
        timerEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;

        if (totalSeconds <= 10 && totalSeconds > 0 && totalSeconds !== lastSpokenSecond) {
            lastSpokenSecond = totalSeconds;
            timerEl.style.color = '#ff4444';
            timerEl.style.fontSize = '2em';
            speakNumber(totalSeconds);
        }

        if (remaining <= 0) {
            stopTimer();
            timerEl.style.color = '';
            timerEl.style.fontSize = '';
        }
    }, 100);
}

function speakNumber(num) {
    if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(num.toString());
        utterance.rate = 1.2;
        utterance.pitch = 1;
        utterance.volume = 0.8;
        speechSynthesis.speak(utterance);
    }
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    document.getElementById('timer').textContent = '';
}

// Commenting phase - show songs they voted for and their own
function displayCommentingSongs(songs, votedSongId, ownSongId) {
    const voteContainer = document.getElementById('your-voted-song');
    const ownContainer = document.getElementById('your-own-song');
    const voteSection = document.getElementById('vote-comment-section');
    const ownSection = document.getElementById('own-comment-section');

    voteContainer.innerHTML = '';
    ownContainer.innerHTML = '';
    document.getElementById('comments-container').style.opacity = '1';

    const votedSong = songs.find(s => s.id === votedSongId);
    if (votedSong) {
        voteContainer.innerHTML = `
            <div class="comment-song-card" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 15px; border-radius: 12px; cursor: pointer;">
                <p style="color: white; margin-bottom: 8px; font-size: 0.9em;">${votedSong.playerEmoji} ${votedSong.playerName}'s Song</p>
                <img src="${votedSong.thumbnailUrl}" alt="Album Art" style="width: 80px; height: 80px; border-radius: 50%; border: 3px solid #ffd700; object-fit: cover;">
                <p style="color: white; font-weight: 600; margin-top: 8px;">${escapeHtml(votedSong.title)}</p>
                <p style="color: rgba(255,255,255,0.8); font-size: 0.85em;">${escapeHtml(votedSong.artist)}</p>
            </div>
        `;
        voteContainer.querySelector('.comment-song-card').addEventListener('click', () => {
            playPreview(votedSong.previewUrl, voteContainer.querySelector('.comment-song-card'));
        });
        voteSection.style.display = 'block';
    } else {
        voteContainer.innerHTML = `
            <div style="background: #f0f0f0; padding: 15px; border-radius: 12px; color: #666;">
                <p>You didn't vote this round</p>
            </div>
        `;
        document.getElementById('vote-comment-input').placeholder = 'Optional: Leave a general comment...';
    }

    const ownSong = songs.find(s => s.id === ownSongId);
    if (ownSong) {
        ownContainer.innerHTML = `
            <div class="comment-song-card" style="background: linear-gradient(135deg, #ffa500 0%, #ffcc00 100%); padding: 15px; border-radius: 12px; cursor: pointer;">
                <p style="color: white; margin-bottom: 8px; font-size: 0.9em;">Your submission</p>
                <img src="${ownSong.thumbnailUrl}" alt="Album Art" style="width: 80px; height: 80px; border-radius: 50%; border: 3px solid white; object-fit: cover;">
                <p style="color: white; font-weight: 600; margin-top: 8px;">${escapeHtml(ownSong.title)}</p>
                <p style="color: rgba(255,255,255,0.8); font-size: 0.85em;">${escapeHtml(ownSong.artist)}</p>
            </div>
        `;
        ownContainer.querySelector('.comment-song-card').addEventListener('click', () => {
            playPreview(ownSong.previewUrl, ownContainer.querySelector('.comment-song-card'));
        });
        ownSection.style.display = 'block';
    } else {
        ownContainer.innerHTML = `
            <div style="background: #f0f0f0; padding: 15px; border-radius: 12px; color: #666;">
                <p>You didn't submit a song this round</p>
            </div>
        `;
        document.getElementById('own-comment-input').placeholder = 'Optional: Leave a thought...';
    }
}

// HTML Export
function generateAndDownloadHTML(history) {
    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TopTune Battle - Game Summary</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 40px 20px;
        }
        .container { max-width: 900px; margin: 0 auto; }
        h1 {
            text-align: center; color: white; font-size: 3em;
            margin-bottom: 40px; text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
        }
        .round {
            background: white; border-radius: 20px; padding: 30px;
            margin-bottom: 30px; box-shadow: 0 10px 40px rgba(0,0,0,0.2);
        }
        .round-header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white; padding: 15px 20px; border-radius: 10px; margin-bottom: 20px;
        }
        .round-number { font-size: 0.9em; opacity: 0.8; }
        .prompt { font-size: 1.4em; font-weight: 600; }
        .songs-grid {
            display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 20px;
        }
        .song-card {
            background: #f8f9fa; border-radius: 15px; padding: 15px; text-align: center;
        }
        .song-card img {
            width: 100px; height: 100px; border-radius: 50%; object-fit: cover;
            margin-bottom: 10px; border: 3px solid #667eea;
        }
        .song-title { font-weight: 700; color: #333; font-size: 0.95em; }
        .song-artist { color: #666; font-size: 0.85em; margin-bottom: 5px; }
        .player-info { font-weight: 600; color: #333; margin-bottom: 5px; }
        .votes { color: #764ba2; font-weight: 700; margin-bottom: 10px; }
        .comments { text-align: left; border-top: 1px solid #e0e0e0; padding-top: 10px; margin-top: 10px; }
        .comment { background: #e8f4f8; padding: 10px; border-radius: 8px; margin-bottom: 8px; font-size: 0.9em; }
        .comment.vote-comment { border-left: 3px solid #667eea; }
        .comment.own-comment { border-left: 3px solid #ffa500; }
        .no-comments { color: #999; font-style: italic; font-size: 0.9em; }
        audio { width: 100%; margin-top: 8px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🎵 TopTune Battle Summary 🎵</h1>
        ${history.map(round => `
            <div class="round">
                <div class="round-header">
                    <div class="round-number">Round ${round.round}</div>
                    <div class="prompt">${escapeHtml(round.prompt)}</div>
                </div>
                <div class="songs-grid">
                    ${round.songs.map(song => `
                        <div class="song-card">
                            <img src="${song.thumbnailUrl}" alt="Album Art">
                            <div class="song-title">${escapeHtml(song.title || 'Unknown')}</div>
                            <div class="song-artist">${escapeHtml(song.artist || 'Unknown')}</div>
                            <div class="player-info">${song.playerEmoji} ${escapeHtml(song.playerName)}</div>
                            <div class="votes">🎵 ${song.votes} vote${song.votes !== 1 ? 's' : ''}</div>
                            ${song.previewUrl ? `<audio controls src="${song.previewUrl}"></audio>` : ''}
                            <div class="comments">
                                ${song.comments && song.comments.length > 0
                                    ? song.comments.map(c => `
                                        <div class="comment ${c.type === 'vote' ? 'vote-comment' : 'own-comment'}">
                                            <span style="font-size: 0.75em; color: #999;">${c.type === 'vote' ? '🎧 Voter' : '🎤 Creator'}:</span>
                                            ${escapeHtml(c.comment)}
                                        </div>
                                    `).join('')
                                    : '<div class="no-comments">No comments</div>'
                                }
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `).join('')}
    </div>
</body>
</html>
    `;

    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `toptune-battle-summary-${new Date().toISOString().split('T')[0]}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showNotification('📄 Game summary downloaded!');
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
