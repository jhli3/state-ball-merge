// --- Bootstrap ---
// Everything else just defines behavior; this is what actually starts the
// game once all modules have loaded.
(function() {
  // Restore whatever was in the container last time, if anything was saved.
  if (!Game.core.loadGameState()) {
    Game.core.resetGame(Game.config.MASTER_STATE_NAMES.filter(name => Game.state.selectedStateNames.has(name)));
  }

  Matter.Runner.run(Matter.Runner.create(), Game.physics.engine);
  Matter.Render.run(Game.physics.render);

  // Keep progress saved as you play, so a reload brings the container back as-is
  setInterval(Game.core.saveGameState, 2000);
  window.addEventListener('beforeunload', Game.core.saveGameState);
})();
