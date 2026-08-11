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
    Game.state.TIERS = Game.config.buildTiers(names);
    Game.state.unlockedSet = new Set([0]);
    Composite.clear(engine.world, true);
    Game.state.currentTier = 0;
    Game.state.nextTier = 0;
    Game.state.aimX = Game.physics.clampAimX(Game.physics.WIDTH / 2, Game.state.TIERS[Game.state.currentTier].radius);
    Game.state.dropCount = 0;
    Game.state.mergeCount = 0;
    Game.state.currentScore = 0;
    Game.state.gameStartTime = performance.now();
    updateNextCard();
    Game.chart.renderChart();
    Game.scoring.updateScoreDisplay();
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

      Composite.clear(engine.world, true);
      (state.marbles || []).forEach(m => {
        if (!Number.isInteger(m.tier) || m.tier < 0 || m.tier >= Game.state.TIERS.length) return;
        const body = Game.physics.spawnMarble(m.x, m.y, m.tier, m.scale || 1);
        Body.setVelocity(body, { x: m.vx || 0, y: m.vy || 0 });
        Body.setAngle(body, m.angle || 0);
        Composite.add(engine.world, body);
      });

      Game.state.currentTier = Number.isInteger(state.currentTier) && state.currentTier < Game.state.TIERS.length ? state.currentTier : 0;
      Game.state.nextTier = Number.isInteger(state.nextTier) && state.nextTier < Game.state.TIERS.length ? state.nextTier : 0;
      Game.state.aimX = Game.physics.clampAimX(Game.physics.WIDTH / 2, Game.state.TIERS[Game.state.currentTier].radius);

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

    const radius = Game.state.TIERS[Game.state.currentTier].radius;
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

    Game.state.aimX = Game.physics.clampAimX(Game.state.aimX, Game.state.TIERS[Game.state.currentTier].radius);

    Game.state.isCooldown = true;
    setTimeout(() => { Game.state.isCooldown = false; }, Game.input.currentDropCooldown());

    saveGameState();
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
    resetGame(Game.config.MASTER_STATE_NAMES.filter(name => Game.state.selectedStateNames.has(name)));
  }

  document.getElementById('restart-btn').addEventListener('click', function() {
    restartGame();
    this.blur();
  });

  // Collision & Merge Logic
  Events.on(engine, 'collisionStart', (event) => {
    const pairs = event.pairs;
    const toRemove = new Set();

    pairs.forEach(pair => {
      const { bodyA, bodyB } = pair;
      const speed = Vector.magnitude(Vector.sub(bodyA.velocity, bodyB.velocity));

      if (speed > 1.2) {
        const avgTier = ((bodyA.gameTier ?? 0) + (bodyB.gameTier ?? 0)) / 2;
        Game.audio.playZenTone(Math.floor(avgTier), speed, false);
      }

      if (
        bodyA.gameTier !== undefined &&
        bodyA.gameTier === bodyB.gameTier &&
        !toRemove.has(bodyA) &&
        !toRemove.has(bodyB)
      ) {
        const isMaxTier = bodyA.gameTier === Game.state.TIERS.length - 1;
        const nextTierIndex = bodyA.gameTier + 1;

        if (isMaxTier || nextTierIndex < Game.state.TIERS.length) {
          toRemove.add(bodyA);
          toRemove.add(bodyB);
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
  });

  return {
    pickWeightedTier,
    resetGame,
    saveGameState,
    loadGameState,
    updateNextCard,
    dropMarble,
    triggerShake,
    restartGame
  };
})();
