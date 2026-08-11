// Shared namespace for every module in this game. Each file attaches one
// concern to it (Game.audio, Game.physics, Game.core, ...) and exposes only
// the functions other modules need — this is the seam a future feature
// (e.g. a Game.net module for multiplayer) would plug into.
window.Game = window.Game || {};

// Mutable state that more than one module needs to read or write. Anything
// that's only ever touched inside a single module stays local to that
// module's own file instead of living here.
Game.state = {
  TIERS: [],
  unlockedSet: new Set([0]),
  selectedStateNames: null,

  currentTier: 0,
  nextTier: 0,
  aimX: 0,
  isCooldown: false,
  isModalOpen: false,

  dropCount: 0,
  mergeCount: 0,
  gameStartTime: 0,

  currentScore: 0,
  highScore: 0,

  // 'sphere' | 'hexagon' — read by physics.js when spawning a body and by
  // render.js when drawing one, so the two stay in sync.
  marbleShape: 'sphere'
};
