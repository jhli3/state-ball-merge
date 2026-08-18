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
  aimY: 0, // only meaningful in space/particle mode — free 2D placement, not just the container chute's horizontal slide
  isCooldown: false,
  isModalOpen: false,

  dropCount: 0,
  mergeCount: 0,
  gameStartTime: 0,

  currentScore: 0,
  highScore: 0,

  // 'sphere' | 'hexagon' | 'star' — read by physics.js when spawning a body
  // and by render.js when drawing one, so the two stay in sync.
  marbleShape: 'sphere',

  // 'classic' | 'space' | 'particle' | 'orbit' | 'poles' | 'chaos' — read by
  // physics.js (gravity/per-mode forces/walls, and Game.physics.isFloatingMode
  // for which of these count as "floating"), input.js
  // (drop-at-a-fixed-chute vs. place-anywhere), game.js (chaos's
  // collision-triggered duplicate/delete) and render.js (which aim preview
  // to draw). Every floating mode is sphere-only; see render.js's mode
  // toggle for the forced-shape rule.
  marbleMode: 'classic'
};
