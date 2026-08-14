// --- Canvas Renderer (aim ghost + dropped marbles, flag art clipped into a shape) ---
Game.render = (function() {
  const render = Game.physics.render;

  // --- Marble shape preference ---
  // Lives on Game.state (not a local var) because physics.js reads it too —
  // spawnMarble() creates an actual hexagon collision body in "hexagon" mode,
  // not just a hexagon-shaped drawing over a circular one.
  const SHAPE_STORAGE_KEY = 'smm-marble-shape';
  const SHAPES = ['sphere', 'hexagon', 'star'];
  const SHAPE_LABELS = { sphere: '🔵 Shape: Marble', hexagon: '⬡ Shape: Hexagon', star: '⭐ Shape: Star' };
  const savedShape = localStorage.getItem(SHAPE_STORAGE_KEY);
  Game.state.marbleShape = SHAPES.includes(savedShape) ? savedShape : 'sphere';

  const shapeToggleBtn = document.getElementById('shape-toggle');

  function updateShapeToggleLabel() {
    shapeToggleBtn.textContent = SHAPE_LABELS[Game.state.marbleShape];
  }

  shapeToggleBtn.addEventListener('click', () => {
    const nextIndex = (SHAPES.indexOf(Game.state.marbleShape) + 1) % SHAPES.length;
    Game.state.marbleShape = SHAPES[nextIndex];
    try { localStorage.setItem(SHAPE_STORAGE_KEY, Game.state.marbleShape); } catch (e) { /* ignore */ }
    updateShapeToggleLabel();
    // Matter.js bodies can't change shape in place — rebuild every marble
    // on the board so the switch takes effect immediately, not just on drop.
    Game.physics.rebuildBodies();
  });

  updateShapeToggleLabel();

  // --- Marble mode preference (classic gravity-and-container vs. floating space) ---
  // Space mode only makes physical sense for the round marble (attraction +
  // zero-g read as "planets", not as a hexagon or star), so switching into it
  // forces the shape to sphere and locks the shape toggle until switching
  // back out.
  const MODE_STORAGE_KEY = 'smm-marble-mode';
  const MODES = ['classic', 'space'];
  const MODE_LABELS = { classic: '📦 Mode: Classic', space: '🪐 Mode: Space' };
  const savedMode = localStorage.getItem(MODE_STORAGE_KEY);
  Game.state.marbleMode = MODES.includes(savedMode) ? savedMode : 'classic';

  const modeToggleBtn = document.getElementById('mode-toggle');

  function updateModeToggleLabel() {
    modeToggleBtn.textContent = MODE_LABELS[Game.state.marbleMode];
    shapeToggleBtn.disabled = Game.state.marbleMode === 'space';
  }

  modeToggleBtn.addEventListener('click', () => {
    const nextIndex = (MODES.indexOf(Game.state.marbleMode) + 1) % MODES.length;
    Game.state.marbleMode = MODES[nextIndex];
    try { localStorage.setItem(MODE_STORAGE_KEY, Game.state.marbleMode); } catch (e) { /* ignore */ }

    Game.input.cancelHold();
    Game.physics.setPhysicsMode(Game.state.marbleMode);

    if (Game.state.marbleMode === 'space' && Game.state.marbleShape !== 'sphere') {
      Game.state.marbleShape = 'sphere';
      try { localStorage.setItem(SHAPE_STORAGE_KEY, Game.state.marbleShape); } catch (e) { /* ignore */ }
      updateShapeToggleLabel();
      Game.physics.rebuildBodies();
    }

    updateModeToggleLabel();
  });

  updateModeToggleLabel();
  Game.physics.setPhysicsMode(Game.state.marbleMode);

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
    } else if (Game.state.marbleShape === 'star') {
      // Same vertex list physics.js builds the collision body from — see
      // Game.physics.starVertices for why this is shared rather than
      // re-derived here the way the hexagon's simpler angle formula is.
      const points = Game.physics.starVertices(radius);
      points.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      });
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

  // Tight bounding box of the current marble shape at a given radius. The
  // hexagon and (especially) the star occupy noticeably less of their own
  // radius*2 circumscribing square than a circle does — a hexagon's flat
  // top/bottom sit at ~87% of that square's height, and the star's points
  // reach it in only 5 narrow directions — so cover-fitting the flag image
  // against the full square (as if every shape were a circle) left most of
  // the flag clipped away outside the visible hexagon/star outline. Sizing
  // against the shape's actual footprint instead shows much more of it.
  function shapeBounds(radius) {
    if (Game.state.marbleShape === 'hexagon') {
      // Vertices at 0°,60°,...,300° (see tracePath): spans the full 2*radius
      // width at 0°/180°, but only radius*sqrt(3) of height at the rest.
      return { width: radius * 2, height: radius * Math.sqrt(3) };
    }
    if (Game.state.marbleShape === 'star') {
      const points = Game.physics.starVertices(radius);
      const xs = points.map(p => p.x);
      const ys = points.map(p => p.y);
      return { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    }
    return { width: radius * 2, height: radius * 2 };
  }

  function drawMarbleImage(ctx, tier, radius) {
    if (tier.imgObj.complete && tier.imgObj.naturalWidth !== 0) {
      tracePath(ctx, radius);
      ctx.clip();

      const { width: boxW, height: boxH } = shapeBounds(radius);
      const aspect = tier.imgObj.naturalWidth / tier.imgObj.naturalHeight;
      const boxAspect = boxW / boxH;
      const isPointy = Game.state.marbleShape === 'hexagon' || Game.state.marbleShape === 'star';
      let drawW, drawH;

      if (isPointy) {
        // Hexagon corners and (especially) the star's concave notches cut
        // deep into the shape's own bounding box, so even cover-fitting
        // against that box still clips whatever art sits near those edges —
        // including centered seals that fall in the star's narrow notches.
        // Contain-fit the whole image so nothing gets cropped, then instead
        // of a single flat backdrop color, stretch a 1px strip of the
        // image's own top/bottom (or left/right) edge to fill the leftover
        // gap. For a plain-field flag that strip is one solid color anyway,
        // so it looks identical to a flat fill; for color-blocked flags like
        // Texas it carries the actual canton/stripe boundary out to the
        // shape's points, so the block pattern keeps going instead of
        // getting capped by an unrelated solid color.
        ctx.fillStyle = tier.edgeColor;
        ctx.fill();

        const natW = tier.imgObj.naturalWidth;
        const natH = tier.imgObj.naturalHeight;

        if (aspect > boxAspect) {
          drawW = boxW;
          drawH = boxW / aspect;
          const gap = (boxH - drawH) / 2;
          if (gap > 0.5) {
            ctx.drawImage(tier.imgObj, 0, 0, natW, 1, -boxW / 2, -boxH / 2, boxW, gap);
            ctx.drawImage(tier.imgObj, 0, natH - 1, natW, 1, -boxW / 2, drawH / 2, boxW, gap);
          }
        } else {
          drawH = boxH;
          drawW = boxH * aspect;
          const gap = (boxW - drawW) / 2;
          if (gap > 0.5) {
            ctx.drawImage(tier.imgObj, 0, 0, 1, natH, -boxW / 2, -boxH / 2, gap, boxH);
            ctx.drawImage(tier.imgObj, natW - 1, 0, 1, natH, drawW / 2, -boxH / 2, gap, boxH);
          }
        }
      } else {
        // Circle: cover-fill the shape's own bounding box.
        if (aspect > boxAspect) {
          drawH = boxH;
          drawW = boxH * aspect;
        } else {
          drawW = boxW;
          drawH = boxW / aspect;
        }
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

    if (!Game.state.isCooldown) {
      // 1. Ghost Marble — classic mode drops straight down from a fixed
      // top chute (aimX slides, Y is fixed, so a vertical dashed lane shows
      // the drop path); space mode places freely wherever aimX/aimY point,
      // so the ghost just follows the cursor with no lane to draw.
      const currentData = Game.state.TIERS[Game.state.currentTier];
      const radius = currentData.radius;
      const isSpace = Game.state.marbleMode === 'space';
      const ghostX = Game.state.aimX;
      const ghostY = isSpace ? Game.state.aimY : 48;

      if (!isSpace) {
        ctx.save();
        ctx.beginPath();
        ctx.setLineDash([6, 6]);
        ctx.moveTo(ghostX, ghostY + radius);
        ctx.lineTo(ghostX, Game.physics.HEIGHT - 20);
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      }

      ctx.save();
      ctx.translate(ghostX, ghostY);
      drawMarbleImage(ctx, currentData, radius);
      drawGlassHighlight(ctx, radius);
      ctx.restore();

      ctx.save();
      ctx.translate(ghostX, ghostY);
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
