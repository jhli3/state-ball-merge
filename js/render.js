// --- Canvas Renderer (aim ghost + dropped marbles, flag art clipped into a shape) ---
Game.render = (function() {
  const render = Game.physics.render;

  // --- Marble shape preference ---
  // Lives on Game.state (not a local var) because physics.js reads it too —
  // spawnMarble() creates an actual hexagon collision body in "hexagon" mode,
  // not just a hexagon-shaped drawing over a circular one.
  const SHAPE_STORAGE_KEY = 'smm-marble-shape';
  Game.state.marbleShape = localStorage.getItem(SHAPE_STORAGE_KEY) === 'hexagon' ? 'hexagon' : 'sphere';

  const shapeToggleBtn = document.getElementById('shape-toggle');

  function updateShapeToggleLabel() {
    shapeToggleBtn.textContent = Game.state.marbleShape === 'hexagon' ? '⬡ Shape: Hexagon' : '🔵 Shape: Marble';
  }

  shapeToggleBtn.addEventListener('click', () => {
    Game.state.marbleShape = Game.state.marbleShape === 'hexagon' ? 'sphere' : 'hexagon';
    try { localStorage.setItem(SHAPE_STORAGE_KEY, Game.state.marbleShape); } catch (e) { /* ignore */ }
    updateShapeToggleLabel();
    // Matter.js bodies can't change shape in place — rebuild every marble
    // on the board so the switch takes effect immediately, not just on drop.
    Game.physics.rebuildBodies();
  });

  updateShapeToggleLabel();

  // Traces the current marble shape as a path centered on the origin, ready
  // for clip/fill/stroke — a circle in "sphere" mode, a flat-bottomed
  // hexagon in "hexagon" mode. Every place that used to draw a bare circle
  // goes through this so the aim ghost, dropped marbles, and the mega-merge
  // ring all switch shape together.
  //
  // Vertex angles start at 0° (not -90°) so the resting/unrotated shape has
  // a flat EDGE at the bottom (angles 0,60,...,300 straddle 90°/270° rather
  // than landing on them) instead of a single point — a hexagon shouldn't be
  // able to balance on its corner. physics.js's hexagon vertices use this
  // exact same formula so the collision shape always matches what's drawn.
  function tracePath(ctx, radius) {
    ctx.beginPath();
    if (Game.state.marbleShape === 'hexagon') {
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i;
        const x = radius * Math.cos(angle);
        const y = radius * Math.sin(angle);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
    } else {
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
    }
  }

  // Glass Sphere Highlight Effect — shared by the aim ghost and dropped
  // marbles so a held marble looks the same as one already on the board,
  // instead of reading as flat until the moment it's dropped. Hexagon mode
  // gets a flat treatment instead (just an edge line, no gradient), since
  // the whole point of that shape is to read as flat, not glossy.
  function drawGlassHighlight(ctx, radius) {
    if (Game.state.marbleShape === 'hexagon') {
      tracePath(ctx, radius);
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.25)';
      ctx.lineWidth = 2;
      ctx.stroke();
      return;
    }

    const grad = ctx.createRadialGradient(-radius * 0.3, -radius * 0.3, radius * 0.1, 0, 0, radius);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.45)');
    grad.addColorStop(0.7, 'rgba(255, 255, 255, 0.0)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0.25)');

    tracePath(ctx, radius);
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function drawMarbleImage(ctx, tier, radius) {
    if (tier.imgObj.complete && tier.imgObj.naturalWidth !== 0) {
      tracePath(ctx, radius);
      ctx.clip();

      // Cover fill cropping logic for aspect ratio fitting
      const aspect = tier.imgObj.naturalWidth / tier.imgObj.naturalHeight;
      let drawW = radius * 2;
      let drawH = radius * 2;
      if (aspect > 1) {
        drawW = radius * 2 * aspect;
      } else {
        drawH = (radius * 2) / aspect;
      }

      ctx.drawImage(tier.imgObj, -drawW / 2, -drawH / 2, drawW, drawH);
    } else {
      // Fallback solid fill if image hasn't finished loading
      tracePath(ctx, radius);
      ctx.fillStyle = tier.color;
      ctx.fill();
    }
  }

  Matter.Events.on(render, 'afterRender', () => {
    const ctx = render.context;

    // 1. Aim Line & Ghost Marble
    if (!Game.state.isCooldown) {
      const currentData = Game.state.TIERS[Game.state.currentTier];
      const radius = currentData.radius;

      ctx.save();
      ctx.beginPath();
      ctx.setLineDash([6, 6]);
      ctx.moveTo(Game.state.aimX, 48 + radius);
      ctx.lineTo(Game.state.aimX, Game.physics.HEIGHT - 20);
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.translate(Game.state.aimX, 48);
      drawMarbleImage(ctx, currentData, radius);
      drawGlassHighlight(ctx, radius);
      ctx.restore();

      ctx.save();
      ctx.translate(Game.state.aimX, 48);
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2;
      tracePath(ctx, radius);
      ctx.stroke();
      ctx.restore();
    }

    // 2. Render Physical Dropped Marbles
    const bodies = Matter.Composite.allBodies(Game.physics.engine.world);
    bodies.forEach(b => {
      if (b.gameTier !== undefined) {
        const tier = Game.state.TIERS[b.gameTier];
        const megaScale = b.megaScale || 1;
        const radius = tier.radius * megaScale;

        ctx.save();
        ctx.translate(b.position.x, b.position.y);
        ctx.rotate(b.angle);

        // Draw Flag SVG
        drawMarbleImage(ctx, tier, radius);
        drawGlassHighlight(ctx, radius);

        // Extra golden ring for a maxed-out state that's been merged into itself
        if (megaScale > 1) {
          ctx.strokeStyle = 'rgba(251, 191, 36, 0.85)';
          ctx.lineWidth = 3;
          tracePath(ctx, radius - 3);
          ctx.stroke();
        }

        ctx.restore();
      }
    });
  });

  return { drawMarbleImage };
})();
