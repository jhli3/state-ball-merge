// --- Matter.js Setup ---
// Owns the engine/renderer/walls and everything that spawns or bounds a
// physics body. Other modules go through this instead of touching Matter
// directly, so this is the one place that knows how a marble is built.
Game.physics = (function() {
  const { Engine, Render, Bodies, Composite, Events, Body, Vector } = Matter;

  const WIDTH = 640;
  const HEIGHT = 720;

  const engine = Engine.create({ gravity: { x: 0, y: 0.65 } });
  const containerEl = document.getElementById('game-container');

  const render = Render.create({
    element: containerEl,
    engine: engine,
    options: {
      width: WIDTH,
      height: HEIGHT,
      wireframes: false,
      background: '#ffffff'
    }
  });

  const wallOpts = { isStatic: true, restitution: 0.2, friction: 0.1, render: { fillStyle: '#e2e8f0' } };

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

  // Once the largest state is reached, merging two of them no longer upgrades
  // to a new tier — instead it grows into a bigger version of the same state,
  // up to a cap so it never outgrows the container.
  const MEGA_GROWTH = 1.12;
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

  function clampAimX(x, radius) {
    return Math.max(radius + 12, Math.min(WIDTH - radius - 12, x));
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
    const body = isHexagon
      ? Bodies.fromVertices(x, y, [hexagonVertices(radius)], bodyOptions)
      : Bodies.circle(x, y, radius, bodyOptions);

    if (isHexagon) {
      // A hexagon dropped dead-center with zero spin onto a flat surface is
      // in a perfectly symmetric, torque-free state — nothing in the sim
      // will ever break that tie, so without this nudge it really can end
      // up sitting flush on a corner forever. Real objects never fall with
      // exactly zero spin; this just restores that small imperfection so it
      // reliably tips and settles onto a side instead.
      Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.06);
    }

    body.gameTier = tierIndex;
    body.megaScale = megaScale;
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

  return {
    WIDTH, HEIGHT, engine, render, containerEl,
    MEGA_GROWTH, MAX_MEGA_SCALE,
    clampAimX, spawnMarble, rebuildBodies, isDropZoneClear
  };
})();
