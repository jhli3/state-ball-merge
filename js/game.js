// --- Core Game Logic ---
// Drop/merge/reset/save-load: the actual rules of the game. Everything here
// reads and writes Game.state directly since this is the module that owns
// the game's lifecycle.
Game.core = (function() {
  const { Composite, Events, Body, Vector } = Matter;
  const engine = Game.physics.engine;

  // Weighted pick among unlocked (discovered) tiers. Weight follows a narrow bell
  // curve centered on the FRONTIER — the largest tier you've unlocked so far —
  // so states close to whatever you just discovered show up often, and anything
  // further away (in either direction) drops off sharply. The center moves with
  // you as you unlock more, which is what keeps a big state-set (e.g. all 50)
  // from dragging on forever: you always get a steady supply of marbles near
  // your current progress to merge upward with, instead of drifting back toward
  // tiers you've already outgrown.
  const FRONTIER_BIAS_SPREAD = 0.08; // fraction of the tier range treated as the "sweet spot" width — smaller = steeper
  const FRONTIER_BIAS_FLOOR = 0.02;  // minimum relative weight so far-off tiers can still rarely appear

  function pickWeightedTier() {
    const candidates = [...Game.state.unlockedSet];
    if (candidates.length === 1) return candidates[0];

    const maxIndex = Math.max(1, Game.state.TIERS.length - 1);
    const frontier = Math.max(...candidates);
    const spread = Math.max(1.5, maxIndex * FRONTIER_BIAS_SPREAD);

    const weights = candidates.map(i => {
      const distance = (i - frontier) / spread;
      return Math.exp(-0.5 * distance * distance) + FRONTIER_BIAS_FLOOR;
    });

    const total = weights.reduce((sum, w) => sum + w, 0);
    let roll = Math.random() * total;

    for (let i = 0; i < candidates.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return candidates[i];
    }
    return candidates[candidates.length - 1];
  }

  function resetGame(names) {
    Game.scoring.recordLeaderboardEntry(Game.state.currentScore);

    Game.state.TIERS = Game.config.buildTiers(names);
    Game.state.unlockedSet = new Set([0]);
    Composite.clear(engine.world, true);
    Game.state.currentTier = 0;
    Game.state.nextTier = 0;
    Game.state.aimX = Game.physics.clampAimX(Game.physics.WIDTH / 2, Game.physics.marbleRadius(Game.state.TIERS[Game.state.currentTier]));
    Game.state.dropCount = 0;
    Game.state.mergeCount = 0;
    Game.state.currentScore = 0;
    Game.state.gameStartTime = performance.now();
    updateNextCard();
    Game.chart.renderChart();
    Game.scoring.updateScoreDisplay();
    Game.scoring.renderLeaderboard();
    saveGameState();
  }

  // --- Save / restore progress (so the container survives page reloads) ---
  const GAME_STATE_STORAGE_KEY = 'smm-game-progress';

  function saveGameState() {
    try {
      const marbles = Composite.allBodies(engine.world)
        .filter(b => b.gameTier !== undefined)
        .map(b => ({
          x: b.position.x,
          y: b.position.y,
          vx: b.velocity.x,
          vy: b.velocity.y,
          angle: b.angle,
          tier: b.gameTier,
          scale: b.megaScale || 1
        }));

      const state = {
        version: 1,
        canvasWidth: Game.physics.WIDTH,
        canvasHeight: Game.physics.HEIGHT,
        stateNames: Game.state.TIERS.map(t => t.name),
        marbles,
        unlocked: [...Game.state.unlockedSet],
        currentTier: Game.state.currentTier,
        nextTier: Game.state.nextTier,
        dropCount: Game.state.dropCount,
        mergeCount: Game.state.mergeCount,
        score: Game.state.currentScore,
        elapsedMs: performance.now() - Game.state.gameStartTime
      };

      localStorage.setItem(GAME_STATE_STORAGE_KEY, JSON.stringify(state));
    } catch (e) { /* storage unavailable or full — ignore */ }
  }

  // Returns true if a saved game was found and restored
  function loadGameState() {
    try {
      const raw = localStorage.getItem(GAME_STATE_STORAGE_KEY);
      if (!raw) return false;

      const state = JSON.parse(raw);
      const names = Game.config.MASTER_STATE_NAMES.filter(n => (state.stateNames || []).includes(n));
      if (names.length < Game.config.MIN_SELECTED_STATES) return false;

      Game.state.TIERS = Game.config.buildTiers(names);
      Game.state.selectedStateNames = new Set(names);
      Game.config.saveSelectedStateNames(Game.state.selectedStateNames);

      const validUnlocked = (state.unlocked || []).filter(i => Number.isInteger(i) && i >= 0 && i < Game.state.TIERS.length);
      Game.state.unlockedSet = new Set(validUnlocked.length ? validUnlocked : [0]);

      // The canvas is sized from the viewport at load (see config.js), so a
      // save from a different-sized screen/window needs its marble
      // positions rescaled to the current box — otherwise a pile saved on a
      // big monitor could restore outside a smaller one's walls.
      const scaleX = state.canvasWidth ? Game.physics.WIDTH / state.canvasWidth : 1;
      const scaleY = state.canvasHeight ? Game.physics.HEIGHT / state.canvasHeight : 1;

      Composite.clear(engine.world, true);
      (state.marbles || []).forEach(m => {
        if (!Number.isInteger(m.tier) || m.tier < 0 || m.tier >= Game.state.TIERS.length) return;
        const body = Game.physics.spawnMarble(m.x * scaleX, m.y * scaleY, m.tier, m.scale || 1);
        Body.setVelocity(body, { x: m.vx || 0, y: m.vy || 0 });
        Body.setAngle(body, m.angle || 0);
        Composite.add(engine.world, body);
      });

      Game.state.currentTier = Number.isInteger(state.currentTier) && state.currentTier < Game.state.TIERS.length ? state.currentTier : 0;
      Game.state.nextTier = Number.isInteger(state.nextTier) && state.nextTier < Game.state.TIERS.length ? state.nextTier : 0;
      Game.state.aimX = Game.physics.clampAimX(Game.physics.WIDTH / 2, Game.physics.marbleRadius(Game.state.TIERS[Game.state.currentTier]));

      Game.state.dropCount = state.dropCount || 0;
      Game.state.mergeCount = state.mergeCount || 0;
      Game.state.currentScore = state.score || 0;
      if (Game.state.currentScore > Game.state.highScore) {
        Game.state.highScore = Game.state.currentScore;
        try { localStorage.setItem(Game.scoring.HIGH_SCORE_STORAGE_KEY, String(Game.state.highScore)); } catch (e) { /* ignore */ }
      }
      Game.state.gameStartTime = performance.now() - (state.elapsedMs || 0);

      updateNextCard();
      Game.chart.renderChart();
      Game.scoring.updateScoreDisplay();
      Game.scoring.renderLeaderboard();
      return true;
    } catch (e) {
      return false;
    }
  }

  function updateNextCard() {
    const tierData = Game.state.TIERS[Game.state.nextTier];
    document.getElementById('next-name').textContent = tierData.name;
    const nextFlag = document.getElementById('next-flag');
    nextFlag.style.backgroundImage = `url('assets/${tierData.fileName}')`;
    nextFlag.style.backgroundColor = tierData.color;
  }

  function dropMarble() {
    Game.audio.initAudio();
    if (Game.state.isCooldown) return;

    const radius = Game.physics.marbleRadius(Game.state.TIERS[Game.state.currentTier]);
    const dropX = Game.physics.clampAimX(Game.state.aimX, radius);
    const dropY = 48;

    // Chute's still occupied — silently skip this attempt (without touching
    // isCooldown, or the aim/ghost marble would flicker) and let the next
    // scheduled attempt try again.
    if (!Game.physics.isDropZoneClear(dropX, dropY, radius)) return;

    const marble = Game.physics.spawnMarble(dropX, dropY, Game.state.currentTier);
    Composite.add(engine.world, marble);
    Game.state.dropCount++;

    Game.audio.playZenTone(Game.state.currentTier, 2);

    Game.state.currentTier = Game.state.nextTier;
    Game.state.nextTier = pickWeightedTier();
    updateNextCard();

    Game.state.aimX = Game.physics.clampAimX(Game.state.aimX, Game.physics.marbleRadius(Game.state.TIERS[Game.state.currentTier]));

    Game.state.isCooldown = true;
    setTimeout(() => { Game.state.isCooldown = false; }, Game.input.currentDropCooldown());

    saveGameState();
  }

  // Space/particle-mode counterpart to dropMarble: spawns the current-tier
  // marble at rest wherever you're pointing, instead of letting gravity
  // carry it down from a fixed top chute — the attraction/repulsion/
  // center-pull forces (physics.js) are what move it from there. Shares
  // dropMarble's cooldown, drop-zone check, and tier-progression/scoring/save
  // flow — input.js's fireCurrent() is what decides which of the two gets
  // called, so all modes end up with identical click/hold-to-stream/Shift/
  // gamepad controls.
  function placeMarble(x, y) {
    Game.audio.initAudio();
    if (Game.state.isCooldown) return;

    const radius = Game.physics.marbleRadius(Game.state.TIERS[Game.state.currentTier]);
    const clampedX = Game.physics.clampAimX(x, radius);
    const clampedY = Game.physics.clampAimY(y, radius);

    if (!Game.physics.isDropZoneClear(clampedX, clampedY, radius)) return;

    const marble = Game.physics.spawnMarble(clampedX, clampedY, Game.state.currentTier);
    Composite.add(engine.world, marble);
    Game.state.dropCount++;

    Game.audio.playZenTone(Game.state.currentTier, 2);

    Game.state.currentTier = Game.state.nextTier;
    Game.state.nextTier = pickWeightedTier();
    updateNextCard();

    Game.state.isCooldown = true;
    setTimeout(() => { Game.state.isCooldown = false; }, Game.input.currentDropCooldown());

    saveGameState();
  }

  // Sweeps every marble at the smallest tier currently on the board — bound
  // to the gamepad's D-pad left and the keyboard's Backspace/Delete
  // (input.js) as a quick way to clear clutter without hunting for the
  // right state in the sidebar. Reuses chart.js's clearStateFromBoard so
  // the removal/pop-sound/save behavior is identical to clicking that state
  // there.
  function deleteSmallestMarbles() {
    const bodies = Composite.allBodies(engine.world).filter(b => b.gameTier !== undefined);
    if (bodies.length === 0) return;
    const smallestTier = Math.min(...bodies.map(b => b.gameTier));
    Game.chart.clearStateFromBoard(smallestTier);
  }

  let isShakeCooldown = false;
  const SHAKE_COOLDOWN = 260;

  function triggerShake() {
    if (isShakeCooldown) return;
    isShakeCooldown = true;
    setTimeout(() => { isShakeCooldown = false; }, SHAKE_COOLDOWN);

    Game.audio.initAudio();
    Game.audio.setShaking(true);

    const containerEl = Game.physics.containerEl;
    containerEl.classList.remove('shaking');
    void containerEl.offsetWidth;
    containerEl.classList.add('shaking');

    const bodies = Composite.allBodies(engine.world);
    bodies.forEach(b => {
      if (!b.isStatic) {
        const forceX = (Math.random() - 0.5) * 0.018 * b.mass;
        const forceY = -0.022 * b.mass;
        Body.applyForce(b, b.position, { x: forceX, y: forceY });
      }
    });

    Game.audio.playZenTone(1, 1.2);
    setTimeout(() => { Game.audio.setShaking(false); }, 380);
  }

  document.getElementById('shake-btn').addEventListener('click', function() {
    triggerShake();
    this.blur();
  });

  function restartGame() {
    Game.ui.closeStateModal();
    Game.ui.closeSuccessScreen();
    Game.ui.closeHowToModal();
    Game.ui.closeSettingsModal();
    resetGame(Game.config.MASTER_STATE_NAMES.filter(name => Game.state.selectedStateNames.has(name)));
  }

  document.getElementById('restart-btn').addEventListener('click', function() {
    restartGame();
    this.blur();
  });

  // A steady stream of same-tier marbles dropped at (near-)identical spawn
  // points can spawn already slightly overlapping — isDropZoneClear allows
  // up to 30% closer than their combined radii so the chute doesn't feel
  // blocked during a fast hold-to-drop stream. Without this grace period,
  // that overlap fires collisionStart immediately, merging two marbles that
  // never actually fell anywhere. Blocking merges for a brief window after
  // spawn lets Matter's normal (non-merge) collision resolution push them
  // apart first, like it would for any other overlapping pair.
  const MERGE_GRACE_MS = 200;

  // Collision & Merge Logic
  //
  // A concave body (the star shape) isn't simulated as one convex piece —
  // Matter.js decomposes it into several convex sub-parts under one parent,
  // and collision pairs report whichever two PARTS actually touched, not the
  // parent bodies. Only the parent carries gameTier/spawnTime/isMerging, so
  // every pair gets resolved to `.parent` first (a no-op for plain bodies
  // like the sphere/hexagon, where a body is its own parent). Skipping this
  // would make star merges fire only when the one part that happens to equal
  // the parent is what collides — i.e. rarely and unpredictably.
  Events.on(engine, 'collisionStart', (event) => {
    event.pairs.forEach(pair => {
      const bodyA = pair.bodyA.parent;
      const bodyB = pair.bodyB.parent;
      const speed = Vector.magnitude(Vector.sub(bodyA.velocity, bodyB.velocity));

      if (speed > 1.2) {
        const avgTier = ((bodyA.gameTier ?? 0) + (bodyB.gameTier ?? 0)) / 2;
        Game.audio.playZenTone(Math.floor(avgTier), speed, false);
      }
    });

    processMergeCollisions(event.pairs);
  });

  // Pairs still touching after collisionStart skipped them for being within
  // the spawn grace period (above) wouldn't fire collisionStart again once
  // that period lapses — they're still in continuous contact, not a fresh
  // collision — so this catches them once they become eligible.
  Events.on(engine, 'collisionActive', (event) => {
    processMergeCollisions(event.pairs);
  });

  function processMergeCollisions(pairs) {
    const toRemove = new Set();
    const now = engine.timing.timestamp;

    pairs.forEach(pair => {
      const bodyA = pair.bodyA.parent;
      const bodyB = pair.bodyB.parent;

      if (
        bodyA.gameTier !== undefined &&
        bodyA.gameTier === bodyB.gameTier &&
        !toRemove.has(bodyA) &&
        !toRemove.has(bodyB) &&
        !bodyA.isMerging &&
        !bodyB.isMerging &&
        now - bodyA.spawnTime >= MERGE_GRACE_MS &&
        now - bodyB.spawnTime >= MERGE_GRACE_MS
      ) {
        const isMaxTier = bodyA.gameTier === Game.state.TIERS.length - 1;
        const nextTierIndex = bodyA.gameTier + 1;

        if (isMaxTier || nextTierIndex < Game.state.TIERS.length) {
          toRemove.add(bodyA);
          toRemove.add(bodyB);
          // toRemove only guards against processing the same pair twice
          // within THIS collision event. Bodies whose removal is
          // deferred (below) can still fire a brand-new collision event
          // if they separate and re-touch before that removal runs — flat
          // hexagon edges bouncing off each other's corners makes this a
          // real occurrence, not just a theoretical race. This flag persists
          // on the body itself so a later event for the same still-alive
          // pair is ignored instead of double-merging it.
          bodyA.isMerging = true;
          bodyB.isMerging = true;
          Game.state.mergeCount++;

          const midX = (bodyA.position.x + bodyB.position.x) / 2;
          const midY = (bodyA.position.y + bodyB.position.y) / 2;

          setTimeout(() => {
            Composite.remove(engine.world, [bodyA, bodyB]);

            if (isMaxTier) {
              // Already the biggest state — merging makes a bigger version of itself instead
              const combinedScale = Math.max(bodyA.megaScale || 1, bodyB.megaScale || 1) * Game.physics.MEGA_GROWTH;
              const megaScale = Math.min(Game.physics.MAX_MEGA_SCALE, combinedScale);
              const upgraded = Game.physics.spawnMarble(midX, midY, bodyA.gameTier, megaScale);
              Composite.add(engine.world, upgraded);
              Game.audio.playZenTone(bodyA.gameTier + 2, 5, true);
              Game.scoring.addScore(Game.scoring.pointsForMegaMerge(megaScale));
              saveGameState();
              return;
            }

            const upgraded = Game.physics.spawnMarble(midX, midY, nextTierIndex);
            Composite.add(engine.world, upgraded);
            Game.scoring.addScore(Game.scoring.pointsForTier(nextTierIndex));

            if (!Game.state.unlockedSet.has(nextTierIndex)) {
              Game.state.unlockedSet.add(nextTierIndex);
              Game.chart.renderChart();

              const unlockedElem = document.getElementById(`chart-item-${nextTierIndex}`);
              if (unlockedElem) {
                unlockedElem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
              }

              if (nextTierIndex === Game.state.TIERS.length - 1) {
                Game.ui.showSuccessScreen();
              }
            }

            Game.audio.playZenTone(nextTierIndex + 2, 5, true);
            saveGameState();
          }, 0);
        }
      }
    });
  }

  return {
    pickWeightedTier,
    resetGame,
    saveGameState,
    loadGameState,
    updateNextCard,
    dropMarble,
    placeMarble,
    triggerShake,
    restartGame,
    deleteSmallestMarbles
  };
})();
