// Bigger merges are worth disproportionately more; mega-merges (past the
// largest state) keep paying out too, scaled by how big they've grown.
Game.scoring = (function() {
  const HIGH_SCORE_STORAGE_KEY = 'smm-high-score';

  function pointsForTier(tierIndex) {
    return (tierIndex + 1) * (tierIndex + 1) * 10;
  }

  function pointsForMegaMerge(megaScale) {
    return Math.round(megaScale * 500);
  }

  function addScore(points) {
    Game.state.currentScore += points;
    if (Game.state.currentScore > Game.state.highScore) {
      Game.state.highScore = Game.state.currentScore;
      try { localStorage.setItem(HIGH_SCORE_STORAGE_KEY, String(Game.state.highScore)); } catch (e) { /* ignore */ }
    }
    updateScoreDisplay();
  }

  function updateScoreDisplay() {
    document.getElementById('score-value').textContent = Game.state.currentScore.toLocaleString();
    document.getElementById('best-score').textContent = `Best: ${Game.state.highScore.toLocaleString()}`;
  }

  // --- Leaderboard: top 5 scores from completed runs, kept in localStorage ---
  const LEADERBOARD_STORAGE_KEY = 'smm-leaderboard';
  const LEADERBOARD_SIZE = 5;

  function loadLeaderboard() {
    try {
      const raw = localStorage.getItem(LEADERBOARD_STORAGE_KEY);
      if (!raw) return [];
      const scores = JSON.parse(raw);
      if (!Array.isArray(scores)) return [];
      return scores.filter(n => Number.isFinite(n)).sort((a, b) => b - a).slice(0, LEADERBOARD_SIZE);
    } catch (e) {
      return [];
    }
  }

  // Called when a run ends (restart) so the board reflects finished runs
  // rather than whatever the live in-progress score happens to be.
  function recordLeaderboardEntry(score) {
    if (!Number.isFinite(score) || score <= 0) return;
    const scores = loadLeaderboard();
    scores.push(score);
    scores.sort((a, b) => b - a);
    const top = scores.slice(0, LEADERBOARD_SIZE);
    try { localStorage.setItem(LEADERBOARD_STORAGE_KEY, JSON.stringify(top)); } catch (e) { /* ignore */ }
  }

  function renderLeaderboard() {
    const list = document.getElementById('leaderboard-list');
    const scores = loadLeaderboard();

    if (scores.length === 0) {
      list.innerHTML = '<li class="leaderboard-empty">No scores yet — play a round!</li>';
      return;
    }

    list.innerHTML = scores.map((score, i) => `
      <li class="leaderboard-row">
        <span class="leaderboard-rank">#${i + 1}</span>
        <span class="leaderboard-score">${score.toLocaleString()}</span>
      </li>
    `).join('');
  }

  return {
    HIGH_SCORE_STORAGE_KEY,
    pointsForTier,
    pointsForMegaMerge,
    addScore,
    updateScoreDisplay,
    recordLeaderboardEntry,
    renderLeaderboard
  };
})();

Game.state.currentScore = 0;
Game.state.highScore = Number(localStorage.getItem(Game.scoring.HIGH_SCORE_STORAGE_KEY)) || 0;
