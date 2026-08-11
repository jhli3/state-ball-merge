// --- Canvas Renderer (aim ghost + dropped marbles, flag art clipped into circles) ---
Game.render = (function() {
  const render = Game.physics.render;

  function drawMarbleImage(ctx, tier, radius) {
    if (tier.imgObj.complete && tier.imgObj.naturalWidth !== 0) {
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
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
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
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
      ctx.restore();

      ctx.save();
      ctx.translate(Game.state.aimX, 48);
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
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

        // Glass Sphere Highlight Effect
        const grad = ctx.createRadialGradient(-radius * 0.3, -radius * 0.3, radius * 0.1, 0, 0, radius);
        grad.addColorStop(0, 'rgba(255, 255, 255, 0.45)');
        grad.addColorStop(0.7, 'rgba(255, 255, 255, 0.0)');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0.25)');

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Extra golden ring for a maxed-out state that's been merged into itself
        if (megaScale > 1) {
          ctx.strokeStyle = 'rgba(251, 191, 36, 0.85)';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(0, 0, radius - 3, 0, Math.PI * 2);
          ctx.stroke();
        }

        ctx.restore();
      }
    });
  });

  return { drawMarbleImage };
})();
