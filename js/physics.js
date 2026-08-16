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

  // Every non-classic mode has no gravity to pull a stray marble back down,
  // so the far-off ceiling above (which is what lets classic mode's shake
  // give a marble a fun little peek above the frame) would otherwise let it
  // drift up past y=0 and sit there forever, invisible and unreachable by
  // whatever mode-specific forces are pulling on it below. This wall sits
  // flush with the actual visible top edge instead, and is only added to
  // the world while floating — see setPhysicsMode below.
  const spaceCeiling = Bodies.rectangle(WIDTH / 2, -30, WIDTH * 2, 60, wallOpts);

  // Classic is the only mode with normal downward gravity and a fixed drop
  // chute; every other mode (space, particle, orbit, poles, ...) floats in
  // zero gravity and places marbles freely instead, so this is a blanket
  // "not classic" check rather than an enumerated list — a new floating
  // mode doesn't need to be added here too.
  function isFloatingMode(mode) {
    return mode !== 'classic';
  }

  // Classic mode falls under normal downward gravity with the far ceiling
  // above; every floating mode has zero gravity, relies on its own
  // mode-specific forces below instead of gravity, and swaps in the flush
  // ceiling so nothing can drift out of the visible box. render.js's mode
  // toggle calls this on switch and once at startup. Composite.remove is a
  // no-op if the wall isn't currently in the world, so this is safe to call
  // on every switch (including between two floating modes) without risking
  // a duplicate add.
  function setPhysicsMode(mode) {
    const floating = isFloatingMode(mode);
    engine.gravity.y = floating ? 0 : GRAVITY_Y;
    Composite.remove(engine.world, spaceCeiling);
    if (floating) Composite.add(engine.world, spaceCeiling);
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

  // Space-mode attraction: every marble pulls on every other marble, more
  // strongly the closer their sizes are — same-tier pairs pull hardest,
  // wildly different sizes still feel a faint pull rather than nothing, via
  // the floor below. That's what lets the board sort itself into same-size
  // clusters (the near-equal pairs win out and merge) without completely
  // ignoring marbles that don't share an exact tier.
  const ATTRACTION_RANGE = 260; // px — beyond this, no pull at all
  const ATTRACTION_REF_DIST = 80; // px — the pull strength is calibrated at this distance
  const ATTRACTION_ACCEL = 0.0011; // accel at ATTRACTION_REF_DIST for a same-size pair; same order of magnitude as gravity's per-step pull, so clustering reads as gentle drifting rather than a snap
  const ATTRACTION_CONTACT_GAP = 4; // px of clearance past "touching" before the pull kicks back in, so it doesn't fight the collision response of marbles already in contact (or about to merge)
  const SIZE_SIMILARITY_REF = 56; // px of radius difference at which the size-based part of the pull has roughly halved — scaled with config.js's larger tier radii so "how different is different" still means the same thing in relative terms
  const ATTRACTION_SIZE_FLOOR = 0.08; // minimum relative strength even between the most different sizes on the board, so no pair is ever completely unaffected

  // Particle-mode force: unlike space mode's always-attract, only exact
  // tier matches pull toward each other — anything else pushes apart. That
  // makes the board actively sort itself into same-tier clumps instead of
  // just loosely favoring them, since a stray different-tier marble drifting
  // close gets shoved back out rather than merely feeling a weaker pull.
  const PARTICLE_ATTRACTION_ACCEL = 0.0011; // same magnitude as space mode's same-tier pull, for a matching pair
  const PARTICLE_REPULSION_ACCEL = 0.0009; // slightly gentler than the attraction so clumps still win out over the scatter, rather than the board just fizzing apart

  // Floating-mode-only centering: a gentle, ever-present pull toward the
  // middle of the canvas, independent of size or distance. Its job is to
  // undo whatever classic mode's gravity left behind — a pile at the bottom
  // — so switching modes mid-game isn't a dead stop; everything gradually
  // drifts back toward center on its own. Also keeps particle mode's
  // repulsion from just scattering everything out to the walls forever.
  // Space and particle only — orbit and poles below have their own
  // positioning forces and would just be fighting this one.
  const CENTER_PULL_ACCEL = 0.0004;

  function applySpaceOrParticleForces(mode, bodies) {
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
      const aRadius = marbleRadius(Game.state.TIERS[a.gameTier], a.megaScale || 1);

      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j];

        const dx = b.position.x - a.position.x;
        const dy = b.position.y - a.position.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < 1) continue;

        const dist = Math.sqrt(distSq);
        if (dist > ATTRACTION_RANGE) continue;

        // Uses the actual on-screen radius (marbleRadius, not the raw tier
        // value) so the contact gap lines up with where the marbles visibly
        // touch — particle mode shrinks marbles (see marbleRadius/
        // PARTICLE_SIZE_SCALE further down), and this force would otherwise
        // cut off well before actual contact since the raw tier radius
        // overstates their real size.
        const bRadius = marbleRadius(Game.state.TIERS[b.gameTier], b.megaScale || 1);
        if (dist < aRadius + bRadius + ATTRACTION_CONTACT_GAP) continue;

        // Inverse-square distance falloff, clamped so it can't spike near
        // the contact boundary above.
        const effectiveDist = Math.max(dist, ATTRACTION_REF_DIST * 0.5);
        const distanceFalloff = (ATTRACTION_REF_DIST * ATTRACTION_REF_DIST) / (effectiveDist * effectiveDist);

        let accel;
        if (mode === 'particle') {
          // Positive (pull together) for an exact tier match, negative
          // (push apart) for anything else — see the constants above.
          const matches = a.gameTier === b.gameTier;
          accel = (matches ? PARTICLE_ATTRACTION_ACCEL : -PARTICLE_REPULSION_ACCEL) * distanceFalloff;
        } else {
          // Size-similarity falloff: 1 for an exact size match, decaying
          // toward (but never below) the floor as the radius gap widens.
          const radiusDiff = Math.abs(aRadius - bRadius);
          const sizeFactor = ATTRACTION_SIZE_FLOOR + (1 - ATTRACTION_SIZE_FLOOR) / (1 + (radiusDiff / SIZE_SIMILARITY_REF) ** 2);
          accel = ATTRACTION_ACCEL * distanceFalloff * sizeFactor;
        }

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
  }

  // Orbit-mode motion: no pairwise interaction between marbles at all —
  // each body circles its own tier's target ring radius (smaller tiers
  // orbit tight, larger tiers orbit wide), so the board reads as
  // concentric rings of same-size marbles actively circling rather than
  // drifting to a stop. Same-tier marbles sharing a ring gradually catch up
  // to each other as they go around and merge on contact — this function
  // only supplies the motion; game.js's collision handler does the actual
  // merging, same as every other mode.
  //
  // This sets velocity directly every tick instead of just applying a
  // force. A force-based tangential push plus a force-based radial spring
  // was the first thing tried here, but the two fight each other the way
  // real orbital mechanics do: any tangential speed needs a *precisely*
  // matched centripetal pull to stay circular, and a plain spring isn't
  // it — bodies spiraled outward instead of settling into rings. Directly
  // damping the radial velocity component and easing the tangential
  // component toward a target speed sidesteps that entirely, at the cost
  // of not being "real" physics — which is fine, this mode was never
  // meant to be a Keplerian simulator, just a satisfying carousel.
  const ORBIT_CENTER = { x: WIDTH / 2, y: HEIGHT / 2 };
  const ORBIT_MIN_RADIUS = Math.min(WIDTH, HEIGHT) * 0.16; // ring radius for the smallest tier
  const ORBIT_MAX_RADIUS = Math.min(WIDTH, HEIGHT) * 0.46; // ring radius for the largest tier
  const ORBIT_RADIAL_DAMPING = 0.85; // fraction of radial velocity kept each tick — the rest is what stops a bumped marble from just sailing off its ring
  const ORBIT_RADIAL_SPRING = 0.03; // px of ring error -> px/tick of inward/outward velocity nudge, on top of the damping above
  const ORBIT_TANGENT_SPEED = 2.2; // px/tick every body eases toward along its ring, regardless of ring size (so inner rings complete a lap faster than outer ones, like a carousel with fixed rim speed)
  const ORBIT_TANGENT_EASE = 0.05; // fraction of the gap to ORBIT_TANGENT_SPEED closed per tick — gradual ramp-up/recovery rather than an instant snap to speed
  const ORBIT_DIRECTION = 1; // 1 = clockwise, -1 = counterclockwise — canvas y grows downward, so this is arbitrary but shared by every body

  function orbitTargetRadius(tier) {
    const maxTierIndex = Math.max(1, Game.state.TIERS.length - 1);
    const t = tier / maxTierIndex;
    return ORBIT_MIN_RADIUS + t * (ORBIT_MAX_RADIUS - ORBIT_MIN_RADIUS);
  }

  function applyOrbitForces(bodies) {
    bodies.forEach(b => {
      const dx = b.position.x - ORBIT_CENTER.x;
      const dy = b.position.y - ORBIT_CENTER.y;
      const dist = Math.hypot(dx, dy);

      if (dist < 1) {
        // Dead center is a singularity for both the radial and tangential
        // directions below (there's no "toward the ring" or "sideways"
        // when you're already sitting on the pivot) — nudge it off-center
        // so it picks up an orbit instead of sitting frozen at the one spot
        // no direction here can escape.
        Body.setPosition(b, { x: b.position.x + (Math.random() - 0.5) * 4, y: b.position.y + (Math.random() - 0.5) * 4 });
        return;
      }

      const rx = dx / dist;
      const ry = dy / dist;
      // Perpendicular to the radial vector — the direction "along the ring".
      const tx = -ry * ORBIT_DIRECTION;
      const ty = rx * ORBIT_DIRECTION;

      const target = orbitTargetRadius(b.gameTier);
      const error = target - dist; // positive = currently inside the ring, needs to move outward

      const vRadial = b.velocity.x * rx + b.velocity.y * ry;
      const vTangential = b.velocity.x * tx + b.velocity.y * ty;

      const newVRadial = vRadial * ORBIT_RADIAL_DAMPING + error * ORBIT_RADIAL_SPRING;
      const newVTangential = vTangential + (ORBIT_TANGENT_SPEED - vTangential) * ORBIT_TANGENT_EASE;

      Body.setVelocity(b, {
        x: rx * newVRadial + tx * newVTangential,
        y: ry * newVRadial + ty * newVTangential
      });
    });
  }

  // Poles-mode force: two fixed points, one for whichever tier is currently
  // the smallest on the board and one for whichever is currently the
  // largest, with every tier in between pulled toward a spot linearly
  // interpolated between them. The spread is relative to what's actually in
  // play, not the full 0-49 tier roster — a board that only has Rhode
  // Island and Delaware on it (tiers 0 and 1) still spans the full width
  // between the poles, rather than both bunching up near the "small" end
  // because they're both near the bottom of the full tier list. That means
  // the target for a given tier shifts as the board's own min/max shifts —
  // it's recomputed from `bodies` every tick — but the pull toward
  // wherever that target currently is stays exactly as smooth as before.
  const POLE_SMALL = { x: WIDTH * 0.22, y: HEIGHT / 2 };
  const POLE_LARGE = { x: WIDTH * 0.78, y: HEIGHT / 2 };
  const POLES_PULL_ACCEL = 0.0013; // flat accel (not distance-scaled) — same style as CENTER_PULL_ACCEL, just stronger since it's the only force acting in this mode

  function applyPolesForces(bodies) {
    if (bodies.length === 0) return;

    let minTier = Infinity;
    let maxTier = -Infinity;
    bodies.forEach(b => {
      if (b.gameTier < minTier) minTier = b.gameTier;
      if (b.gameTier > maxTier) maxTier = b.gameTier;
    });
    const tierSpread = maxTier - minTier;

    bodies.forEach(b => {
      // A single tier currently on the board (or every marble tied at the
      // same tier) has no spread to be relative to — park it at the
      // midpoint between the poles rather than dividing by zero.
      const t = tierSpread === 0 ? 0.5 : (b.gameTier - minTier) / tierSpread;
      const targetX = POLE_SMALL.x + (POLE_LARGE.x - POLE_SMALL.x) * t;
      const targetY = POLE_SMALL.y + (POLE_LARGE.y - POLE_SMALL.y) * t;

      const dx = targetX - b.position.x;
      const dy = targetY - b.position.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 1) return;

      Body.applyForce(b, b.position, {
        x: (dx / dist) * POLES_PULL_ACCEL * b.mass,
        y: (dy / dist) * POLES_PULL_ACCEL * b.mass
      });
    });
  }

  Events.on(engine, 'beforeUpdate', () => {
    const mode = Game.state.marbleMode;
    if (!isFloatingMode(mode)) return;

    const bodies = Composite.allBodies(engine.world).filter(b => b.gameTier !== undefined && !b.isMerging);

    if (mode === 'orbit') applyOrbitForces(bodies);
    else if (mode === 'poles') applyPolesForces(bodies);
    else applySpaceOrParticleForces(mode, bodies);
  });

  function clampAimX(x, radius) {
    return Math.max(radius + 12, Math.min(WIDTH - radius - 12, x));
  }

  // Space and particle modes place a marble wherever you point rather than
  // at a fixed chute Y, so they need the same wall-aware clamp vertically
  // that clampAimX already does horizontally.
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

  // Particle mode only: shrinks every marble relative to config.js's normal
  // tier radius. That curve is tuned for classic/space/orbit/poles, where
  // marbles mostly settle or drift gently — particle mode is the one where
  // same-tier attraction and cross-tier repulsion are actively shoving
  // things around at once, so it wants more open water between marbles to
  // read clearly rather than the board being one dense, sticky mass. Kept
  // separate from config.js's curve (rather than just tuning that curve
  // down further) so the other modes' difficulty/feel isn't affected.
  const PARTICLE_SIZE_SCALE = 0.6;

  function marbleRadius(tier, megaScale = 1) {
    const modeScale = Game.state.marbleMode === 'particle' ? PARTICLE_SIZE_SCALE : 1;
    return tier.radius * megaScale * modeScale;
  }

  function spawnMarble(x, y, tierIndex, megaScale = 1) {
    const tier = Game.state.TIERS[tierIndex];
    const radius = marbleRadius(tier, megaScale);
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
      // Bodies.fromVertices only re-centers on (x, y) itself when the
      // concave decomposition path produces more than one part — that
      // branch explicitly calls Body.setPosition at the end. A state
      // outline that's technically concave (by even a hair — real
      // geography rarely lands exactly on a convex hull) but decomposes
      // to a single surviving chunk skips that branch entirely, so the
      // body keeps the chunk's own local centroid as its position —
      // roughly (0, 0), since state-shapes.js pre-normalizes every
      // outline around its own centroid. That is why Wyoming (a near-
      // rectangle whose faint concavity still routes it through
      // poly-decomp) was spawning in the top-left corner instead of at
      // the merge point: nothing here was wrong with Wyoming's data,
      // just this Matter.js edge case. Forcing the position after
      // creation fixes it regardless of which path Matter took.
      Body.setPosition(body, { x, y });

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
      const bRadius = marbleRadius(Game.state.TIERS[b.gameTier], b.megaScale || 1);
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
    // Exported so render.js's drawing code uses the exact same radius
    // (including particle mode's shrink) as the collision body it's drawing
    // on top of, instead of a second copy of the tier*megaScale math that
    // could drift out of sync with this one.
    marbleRadius,
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
