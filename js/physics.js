// --- Matter.js Setup ---
// Owns the engine/renderer/walls and everything that spawns or bounds a
// physics body. Other modules go through this instead of touching Matter
// directly, so this is the one place that knows how a marble is built.
Game.physics = (function() {
  const { Engine, Render, Bodies, Composite, Events, Body, Vector } = Matter;

  // Computed by config.js (which loads first) from the available viewport —
  // see the comment there for why and how it's clamped.
  const WIDTH = Game.config.WIDTH;
  const HEIGHT = Game.config.HEIGHT;

  const GRAVITY_Y = 0.65;

  const engine = Engine.create({ gravity: { x: 0, y: GRAVITY_Y } });
  const containerEl = document.getElementById('game-container');

  const render = Render.create({
    element: containerEl,
    engine: engine,
    options: {
      width: WIDTH,
      height: HEIGHT,
      wireframes: false,
      background: '#1cace0'
    }
  });

  const wallOpts = { isStatic: true, restitution: 0.2, friction: 0.1, render: { fillStyle: '#0e93c4' } };

  // A marble knocked loose by a shake is allowed to pop up above the visible
  // canvas (a fun little peek), but an invisible ceiling + tall side walls
  // above the frame guarantee it always tumbles back down into the box —
  // nothing can fly off and get permanently lost.
  const CEILING_Y = -160;
  const wallTop = CEILING_Y - 20;
  const wallHeight = HEIGHT - wallTop;

  const ground = Bodies.rectangle(WIDTH / 2, HEIGHT + 20, WIDTH, 60, wallOpts);
  const ceiling = Bodies.rectangle(WIDTH / 2, CEILING_Y - 20, WIDTH * 2, 40, wallOpts);
  const leftWall = Bodies.rectangle(-20, wallTop + wallHeight / 2, 60, wallHeight, wallOpts);
  const rightWall = Bodies.rectangle(WIDTH + 20, wallTop + wallHeight / 2, 60, wallHeight, wallOpts);

  Composite.add(engine.world, [ground, ceiling, leftWall, rightWall]);

  // Space mode has no gravity to pull a stray marble back down, so the far-off
  // ceiling above (which is what lets classic mode's shake give a marble a
  // fun little peek above the frame) would otherwise let it drift up past
  // y=0 and sit there forever, invisible and unreachable by the same-tier
  // attraction. This wall sits flush with the actual visible top edge
  // instead, and is only added to the world while in space mode — see
  // setPhysicsMode below.
  const spaceCeiling = Bodies.rectangle(WIDTH / 2, -30, WIDTH * 2, 60, wallOpts);

  // Classic mode falls under normal downward gravity with the far ceiling
  // above; space mode floats (zero gravity), relies on the same-tier
  // attraction below instead of gravity, and swaps in the flush ceiling so
  // nothing can drift out of the visible box. render.js's mode toggle calls
  // this on switch and once at startup.
  function setPhysicsMode(mode) {
    engine.gravity.y = mode === 'space' ? 0 : GRAVITY_Y;
    if (mode === 'space') Composite.add(engine.world, spaceCeiling);
    else Composite.remove(engine.world, spaceCeiling);
  }

  // Once the largest state is reached, merging two of them no longer upgrades
  // to a new tier — instead it grows into a bigger version of the same state,
  // up to a cap so it never outgrows the container. This is intentionally the
  // one place size is still allowed to ramp up a lot — it's the "you've maxed
  // out the board" reward, separate from the regular tier-to-tier climb
  // (config.js), which is what actually needed to be gentler. MEGA_GROWTH
  // stays slow (1.05x per merge, ~19 merges to hit the cap) so it's still a
  // grind to get there, not a jump.
  const MEGA_GROWTH = 1.05;
  const MAX_MEGA_SCALE = 2.5;

  // Belt-and-suspenders: cap top speed so a stacked-up shake force can't send a
  // marble fast enough to tunnel through the ceiling/walls in a single tick,
  // and recover anything that somehow still ends up out of bounds.
  const MAX_BODY_SPEED = 26;

  Events.on(engine, 'afterUpdate', () => {
    Composite.allBodies(engine.world).forEach(b => {
      if (b.isStatic || b.gameTier === undefined) return;

      const speed = Vector.magnitude(b.velocity);
      if (speed > MAX_BODY_SPEED) {
        const scale = MAX_BODY_SPEED / speed;
        Body.setVelocity(b, { x: b.velocity.x * scale, y: b.velocity.y * scale });
      }

      if (b.position.y > HEIGHT + 400 || Math.abs(b.position.x - WIDTH / 2) > WIDTH * 3) {
        Body.setPosition(b, { x: WIDTH / 2, y: 40 });
        Body.setVelocity(b, { x: 0, y: 0 });
      }
    });
  });

  // Space-mode-only attraction: every marble pulls on every other marble,
  // more strongly the closer their sizes are — same-tier pairs pull
  // hardest, wildly different sizes still feel a faint pull rather than
  // nothing, via the floor below. That's what lets the board sort itself
  // into same-size clusters (the near-equal pairs win out and merge) without
  // completely ignoring marbles that don't share an exact tier.
  const ATTRACTION_RANGE = 260; // px — beyond this, no pull at all
  const ATTRACTION_REF_DIST = 80; // px — the pull strength is calibrated at this distance
  const ATTRACTION_ACCEL = 0.0011; // accel at ATTRACTION_REF_DIST for a same-size pair; same order of magnitude as gravity's per-step pull, so clustering reads as gentle drifting rather than a snap
  const ATTRACTION_CONTACT_GAP = 4; // px of clearance past "touching" before the pull kicks back in, so it doesn't fight the collision response of marbles already in contact (or about to merge)
  const SIZE_SIMILARITY_REF = 56; // px of radius difference at which the size-based part of the pull has roughly halved — scaled with config.js's larger tier radii so "how different is different" still means the same thing in relative terms
  const ATTRACTION_SIZE_FLOOR = 0.08; // minimum relative strength even between the most different sizes on the board, so no pair is ever completely unaffected

  // Space-mode-only centering: a gentle, ever-present pull toward the middle
  // of the canvas, independent of size or distance. Its job is to undo
  // whatever classic mode's gravity left behind — a pile at the bottom —
  // so switching modes mid-game isn't a dead stop; everything gradually
  // drifts back toward center on its own.
  const CENTER_PULL_ACCEL = 0.0004;

  Events.on(engine, 'beforeUpdate', () => {
    if (Game.state.marbleMode !== 'space') return;

    const bodies = Composite.allBodies(engine.world).filter(b => b.gameTier !== undefined && !b.isMerging);
    const centerX = WIDTH / 2;
    const centerY = HEIGHT / 2;

    bodies.forEach(b => {
      const dx = centerX - b.position.x;
      const dy = centerY - b.position.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 1) return;
      Body.applyForce(b, b.position, {
        x: (dx / dist) * CENTER_PULL_ACCEL * b.mass,
        y: (dy / dist) * CENTER_PULL_ACCEL * b.mass
      });
    });

    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i];
      const aRadius = Game.state.TIERS[a.gameTier].radius * (a.megaScale || 1);

      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j];

        const dx = b.position.x - a.position.x;
        const dy = b.position.y - a.position.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < 1) continue;

        const dist = Math.sqrt(distSq);
        if (dist > ATTRACTION_RANGE) continue;

        const bRadius = Game.state.TIERS[b.gameTier].radius * (b.megaScale || 1);
        if (dist < aRadius + bRadius + ATTRACTION_CONTACT_GAP) continue;

        // Inverse-square distance falloff, clamped so it can't spike near
        // the contact boundary above.
        const effectiveDist = Math.max(dist, ATTRACTION_REF_DIST * 0.5);
        const distanceAccel = ATTRACTION_ACCEL * (ATTRACTION_REF_DIST * ATTRACTION_REF_DIST) / (effectiveDist * effectiveDist);

        // Size-similarity falloff: 1 for an exact size match, decaying
        // toward (but never below) the floor as the radius gap widens.
        const radiusDiff = Math.abs(aRadius - bRadius);
        const sizeFactor = ATTRACTION_SIZE_FLOOR + (1 - ATTRACTION_SIZE_FLOOR) / (1 + (radiusDiff / SIZE_SIMILARITY_REF) ** 2);

        const accel = distanceAccel * sizeFactor;
        const ux = dx / dist;
        const uy = dy / dist;

        // applyForce takes a force, not an acceleration, so scale by each
        // body's own mass — Matter divides back out by mass during
        // integration, which is what keeps the resulting acceleration equal
        // to `accel` for every tier instead of favoring light/heavy marbles.
        Body.applyForce(a, a.position, { x: ux * accel * a.mass, y: uy * accel * a.mass });
        Body.applyForce(b, b.position, { x: -ux * accel * b.mass, y: -uy * accel * b.mass });
      }
    }
  });

  function clampAimX(x, radius) {
    return Math.max(radius + 12, Math.min(WIDTH - radius - 12, x));
  }

  // Space mode places a marble wherever you point rather than at a fixed
  // chute Y, so it needs the same wall-aware clamp vertically that
  // clampAimX already does horizontally.
  function clampAimY(y, radius) {
    return Math.max(radius + 12, Math.min(HEIGHT - radius - 12, y));
  }

  // Same angle formula as render.js's tracePath() — vertices at 0°,60°,...,300°
  // straddle the bottom (90° in canvas coordinates) instead of landing on it,
  // so the resting shape has a flat edge down, not a corner. Built by hand
  // with Bodies.fromVertices rather than Bodies.polygon (which offsets its
  // vertices by 30° and would put a corner right back at the bottom) so the
  // collision shape matches the drawing exactly.
  function hexagonVertices(radius) {
    const points = [];
    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI / 3) * i;
      points.push({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
    }
    return points;
  }

  // A 5-pointed rounded star: a genuinely concave outline (tip, notch, tip,
  // notch...), not a convex approximation of one. That concavity is the whole
  // point — it's what gives a star its actual physical behavior: points can
  // wedge into neighboring marbles' notches, its moment of inertia is lower
  // than a disc of the same radius (mass sits closer to center between the
  // points), and it can rock unevenly instead of rolling smoothly. Matter.js
  // needs the poly-decomp library (loaded in index.html) to turn a concave
  // vertex list into simulatable convex parts — without it, Bodies.fromVertices
  // silently falls back to a convex hull and all of the above is lost; the
  // "star" would collide exactly like a decagon.
  //
  // Corners are rounded by replacing each sharp vertex with a short
  // quadratic-bezier arc (control point = the original vertex), the same
  // trick used for rounded-corner polygons/icons. That works identically for
  // the outward tips and the inward notches, so both come out smoothed.
  // Angle 0 starts a tip, same straddle-the-bottom convention as
  // hexagonVertices, so the star rests on a flat-ish rounded edge rather than
  // balancing on a point.
  const STAR_POINTS = 5;
  const STAR_INNER_RATIO = 0.5;
  const STAR_CORNER_CUT = 0.28;
  const STAR_CORNER_SEGMENTS = 4;

  function roundPolygonCorners(points, cut, segments) {
    const n = points.length;
    const rounded = [];
    for (let i = 0; i < n; i++) {
      const prev = points[(i - 1 + n) % n];
      const cur = points[i];
      const next = points[(i + 1) % n];

      const a = { x: cur.x + (prev.x - cur.x) * cut, y: cur.y + (prev.y - cur.y) * cut };
      const b = { x: cur.x + (next.x - cur.x) * cut, y: cur.y + (next.y - cur.y) * cut };

      for (let s = 0; s <= segments; s++) {
        const u = s / segments;
        const inv = 1 - u;
        rounded.push({
          x: inv * inv * a.x + 2 * inv * u * cur.x + u * u * b.x,
          y: inv * inv * a.y + 2 * inv * u * cur.y + u * u * b.y
        });
      }
    }
    return rounded;
  }

  function starVertices(radius) {
    const raw = [];
    const step = Math.PI / STAR_POINTS;
    for (let i = 0; i < STAR_POINTS * 2; i++) {
      const angle = step * i;
      const r = (i % 2 === 0) ? radius : radius * STAR_INNER_RATIO;
      raw.push({ x: r * Math.cos(angle), y: r * Math.sin(angle) });
    }
    return roundPolygonCorners(raw, STAR_CORNER_CUT, STAR_CORNER_SEGMENTS);
  }

  // Game.stateShapes (state-shapes.js, loaded before this file) holds each
  // state's outline pre-normalized to a circumradius of 1 — scaling by this
  // marble's actual radius here is the only work left. Falls back to a plain
  // circle for any name missing from that table so a data gap degrades
  // gracefully instead of throwing mid-drop.
  function stateVertices(name, radius) {
    const unit = Game.stateShapes[name];
    if (!unit) return null;
    return unit.map((p) => ({ x: p.x * radius, y: p.y * radius }));
  }

  function spawnMarble(x, y, tierIndex, megaScale = 1) {
    const tier = Game.state.TIERS[tierIndex];
    const radius = tier.radius * megaScale;
    const bodyOptions = {
      restitution: 0.3,
      friction: 0.05,
      frictionAir: 0.01,
      render: { visible: false }
    };

    const isHexagon = Game.state.marbleShape === 'hexagon';
    const isStar = Game.state.marbleShape === 'star';
    const stateShape = Game.state.marbleShape === 'state' ? stateVertices(tier.name, radius) : null;
    const body = isHexagon
      ? Bodies.fromVertices(x, y, [hexagonVertices(radius)], bodyOptions)
      : isStar
      ? Bodies.fromVertices(x, y, [starVertices(radius)], bodyOptions)
      : stateShape
      ? Bodies.fromVertices(x, y, [stateShape], bodyOptions)
      : Bodies.circle(x, y, radius, bodyOptions);

    if (isHexagon || isStar || stateShape) {
      // A symmetric shape dropped dead-center with zero spin onto a flat
      // surface is in a perfectly symmetric, torque-free state — nothing in
      // the sim will ever break that tie, so without this nudge it really
      // can end up sitting flush on a corner (or a star's point) forever.
      // Real objects never fall with exactly zero spin; this just restores
      // that small imperfection so it reliably tips and settles onto a side
      // instead.
      Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.06);
    }

    body.gameTier = tierIndex;
    body.megaScale = megaScale;
    // Matter's own simulation clock rather than wall-clock time, so the merge
    // grace period (game.js) tracks simulated elapsed time consistently even
    // across frame-rate hiccups instead of drifting from real time.
    body.spawnTime = engine.timing.timestamp;
    return body;
  }

  // Swaps every marble's collision shape to match the current
  // Game.state.marbleShape — needed because Matter.js bodies can't change
  // shape in place, so switching the shape toggle mid-game has to tear down
  // and respawn each body rather than just re-rendering it.
  function rebuildBodies() {
    const existing = Composite.allBodies(engine.world).filter(b => b.gameTier !== undefined);
    existing.forEach(b => {
      const fresh = spawnMarble(b.position.x, b.position.y, b.gameTier, b.megaScale || 1);
      Body.setVelocity(fresh, b.velocity);
      Body.setAngle(fresh, b.angle);
      Composite.remove(engine.world, b);
      Composite.add(engine.world, fresh);
    });
  }

  // Checks whether the drop point is still clear of other marbles. Without
  // this, dropping fast enough (the top of the hold-acceleration ramp) can spawn
  // a marble on top of one that hasn't cleared the chute yet — Matter.js then
  // resolves that overlap with a hard shove, which reads as the pile spasming.
  // Only blocks on genuine interpenetration (not mere closeness), so it doesn't
  // fight the acceleration under normal play.
  function isDropZoneClear(x, y, radius) {
    const bodies = Composite.allBodies(engine.world);
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (b.gameTier === undefined) continue;
      const bRadius = Game.state.TIERS[b.gameTier].radius * (b.megaScale || 1);
      const dx = b.position.x - x;
      const dy = b.position.y - y;
      const minDist = (bRadius + radius) * 0.7;
      if (dx * dx + dy * dy < minDist * minDist) return false;
    }
    return true;
  }

  Game.state.aimX = WIDTH / 2;
  Game.state.aimY = HEIGHT / 2;

  return {
    WIDTH, HEIGHT, engine, render, containerEl,
    MEGA_GROWTH, MAX_MEGA_SCALE,
    setPhysicsMode,
    clampAimX, clampAimY, spawnMarble, rebuildBodies, isDropZoneClear,
    // Exported (unlike hexagonVertices, which render.js re-derives by hand)
    // because the corner-rounding math is nontrivial enough that keeping two
    // independent copies in sync isn't worth it — render.js's tracePath()
    // calls this directly so the drawn outline is always the exact collision
    // shape, point for point.
    starVertices,
    // Exported for the same reason — render.js's tracePath() needs the exact
    // same per-state points (just re-scaled) so the drawn silhouette matches
    // the collision shape.
    stateVertices
  };
})();
