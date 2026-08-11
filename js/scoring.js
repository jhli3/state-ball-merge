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

  return { HIGH_SCORE_STORAGE_KEY, pointsForTier, pointsForMegaMerge, addScore, updateScoreDisplay };
})();

Game.state.currentScore = 0;
Game.state.highScore = Number(localStorage.getItem(Game.scoring.HIGH_SCORE_STORAGE_KEY)) || 0;
