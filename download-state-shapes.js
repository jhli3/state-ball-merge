// One-off script (mirrors download-flags.js) that builds js/state-shapes.js —
// a simplified, normalized outline for each U.S. state, used by the "State"
// marble shape in render.js/physics.js. Not loaded by index.html itself;
// run this manually (`node download-state-shapes.js`) to regenerate the
// data file if the source boundaries or simplification tuning ever change.
const fs = require('fs');
const path = require('path');

const GEOJSON_URL = 'https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json';

const STATES = [
  "Rhode Island", "Delaware", "Connecticut", "New Jersey", "New Hampshire",
  "Vermont", "Massachusetts", "Hawaii", "Maryland", "West Virginia",
  "South Carolina", "Maine", "Indiana", "Kentucky", "Tennessee",
  "Virginia", "Ohio", "Pennsylvania", "Mississippi", "Louisiana",
  "Alabama", "Arkansas", "North Carolina", "New York", "Iowa",
  "Illinois", "Wisconsin", "Florida", "Missouri", "Oklahoma",
  "Washington", "Georgia", "Michigan", "North Dakota", "South Dakota",
  "Nebraska", "Kansas", "Idaho", "Utah", "Minnesota",
  "Wyoming", "Oregon", "Colorado", "Nevada", "Arizona",
  "New Mexico", "Montana", "California", "Texas", "Alaska"
];

// Signed area (shoelace) — positive/negative tells winding direction, and
// its magnitude is used both to pick a MultiPolygon's largest ring (dropping
// offshore islands like Hawaii's smaller islands or Alaska's Aleutians down
// to the single biggest landmass) and to compute an area-weighted centroid
// that stays inside oddly-shaped states (e.g. Oklahoma's panhandle) instead
// of drifting off toward empty bounding-box space.
function signedArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

function centroid(ring, area) {
  let cx = 0, cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    const cross = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  const factor = 1 / (6 * area);
  return { x: cx * factor, y: cy * factor };
}

// Collapses runs of coincident points (within floating-point noise) down to
// one, including the ring's closing duplicate (GeoJSON repeats the first
// coordinate as the last) — some states' source rings have an *extra*
// coincident point beyond just that closing one (Ohio's raw ring repeats its
// start point at both index 45 and the official closing index 46), and any
// leftover duplicate is a zero-length edge that corrupts poly-decomp the
// same way the plain closing duplicate does.
function dedupeConsecutive(points, eps = 1e-9) {
  const out = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (!prev || Math.hypot(p.x - prev.x, p.y - prev.y) > eps) out.push(p);
  }
  if (out.length > 1) {
    const first = out[0], last = out[out.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) <= eps) out.pop();
  }
  return out;
}

function largestRing(geometry) {
  const rings = geometry.type === 'Polygon'
    ? geometry.coordinates
    : geometry.coordinates.flat();
  let best = null;
  let bestArea = -1;
  for (const ring of rings) {
    const area = Math.abs(signedArea(ring));
    if (area > bestArea) { bestArea = area; best = ring; }
  }
  return best;
}

// Classic Douglas-Peucker: keeps the points that matter for the outline's
// silhouette (a panhandle's corners, a coastline's deepest bays) and drops
// the ones that don't, rather than naive fixed-stride decimation which would
// blur sharp features and keep redundant ones equally.
function perpendicularDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  const projX = a.x + t * dx, projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

function douglasPeucker(points, epsilon) {
  if (points.length < 3) return points;
  let maxDist = 0, maxIndex = 0;
  const [first, last] = [points[0], points[points.length - 1]];
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDist(points[i], first, last);
    if (d > maxDist) { maxDist = d; maxIndex = i; }
  }
  if (maxDist > epsilon) {
    const left = douglasPeucker(points.slice(0, maxIndex + 1), epsilon);
    const right = douglasPeucker(points.slice(maxIndex), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
}

// poly-decomp needs a genuinely simple polygon (no self-intersecting edges) —
// Douglas-Peucker only minimizes deviation from the original outline, it
// never checks whether throwing points away makes two non-adjacent edges
// cross. That's rare once the duplicate closing point is gone (see below),
// but coastlines with tight doubling-back stretches can still occasionally
// produce a crossing at a given epsilon. Standard orientation test for
// whether segments a1-a2 and b1-b2 cross.
function segmentsIntersect(a1, a2, b1, b2) {
  function orient(a, b, c) {
    const v = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
    if (Math.abs(v) < 1e-9) return 0;
    return v > 0 ? 1 : 2;
  }
  function onSegment(a, b, c) {
    return Math.min(a.x, c.x) - 1e-9 <= b.x && b.x <= Math.max(a.x, c.x) + 1e-9 &&
           Math.min(a.y, c.y) - 1e-9 <= b.y && b.y <= Math.max(a.y, c.y) + 1e-9;
  }
  const o1 = orient(a1, a2, b1), o2 = orient(a1, a2, b2);
  const o3 = orient(b1, b2, a1), o4 = orient(b1, b2, a2);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a1, b1, a2)) return true;
  if (o2 === 0 && onSegment(a1, b2, a2)) return true;
  if (o3 === 0 && onSegment(b1, a1, b2)) return true;
  if (o4 === 0 && onSegment(b1, a2, b2)) return true;
  return false;
}

// Checks every pair of non-adjacent edges of the closed polygon implied by
// `points` (edge n-1 -> 0 included). O(n^2), fine at these point counts.
function isSimplePolygon(points) {
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a1 = points[i], a2 = points[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue; // adjacent edges share a vertex
      const b1 = points[j], b2 = points[(j + 1) % n];
      if (segmentsIntersect(a1, a2, b1, b2)) return false;
    }
  }
  return true;
}

// Andrew's monotone chain convex hull — last-resort fallback if a state's
// outline still won't simplify down to something simple (poly-decomp needs
// simple input; a convex hull always is one). Should be unreachable in
// practice once the duplicate-closing-point fix below is in place, but a
// safe degraded shape beats a broken game if some coastline is pathological.
function convexHull(points) {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

// Simplify down toward targetMax, backing off (retaining more points) if the
// result isn't a simple polygon, all the way back to the full-detail outline
// if needed — only falling back to a convex hull if even that's not simple
// (a real data glitch, not a simplification artifact).
function simplifySafely(points, targetMax) {
  let epsilon = 0.004;
  let result = douglasPeucker(points, epsilon);
  let guard = 0;
  while (result.length > targetMax && guard < 30) {
    epsilon *= 1.35;
    result = douglasPeucker(points, epsilon);
    guard++;
  }

  guard = 0;
  while (!isSimplePolygon(result) && guard < 40) {
    epsilon *= 0.8;
    result = douglasPeucker(points, epsilon);
    guard++;
  }

  if (!isSimplePolygon(result)) {
    if (isSimplePolygon(points)) return points;
    return convexHull(points);
  }
  return result;
}

async function run() {
  console.log(`Fetching state boundaries from ${GEOJSON_URL} ...`);
  const res = await fetch(GEOJSON_URL);
  if (!res.ok) throw new Error(`GeoJSON fetch failed: ${res.status}`);
  const geojson = await res.json();

  const byName = new Map(geojson.features.map((f) => [f.properties.name, f]));
  const missing = STATES.filter((s) => !byName.has(s));
  if (missing.length) throw new Error(`Missing from source data: ${missing.join(', ')}`);

  const shapes = {};

  for (const name of STATES) {
    const feature = byName.get(name);
    const ring = largestRing(feature.geometry); // [lon, lat] pairs, closed ring

    // Equirectangular projection scaled by this ring's own mean latitude —
    // computed per-state (not once for the whole country) so a compact
    // high-latitude state like Alaska doesn't come out stretched relative to
    // one further south; each shape only has to look right on its own.
    const meanLat = ring.reduce((sum, [, lat]) => sum + lat, 0) / ring.length;
    const latScale = Math.cos((meanLat * Math.PI) / 180);
    const projected = ring.map(([lon, lat]) => [lon * latScale, -lat]); // -lat: north stays up on screen (y grows downward)

    const area = signedArea(projected);
    const c = centroid(projected, area);
    const centered = projected.map(([x, y]) => ({ x: x - c.x, y: y - c.y }));

    // GeoJSON rings are closed (first coord repeats as the last) — strip
    // that and any other coincident-point runs before simplifying. Left in,
    // a duplicate point is a zero-length edge that corrupts poly-decomp's
    // concave decomposition (Bodies.fromVertices silently returns undefined
    // instead of a body) even though it's invisible in a plain canvas fill,
    // which is what let this slip through undetected until physics testing
    // caught it.
    const openRing = dedupeConsecutive(centered);

    const simplified = simplifySafely(openRing, 56);

    const maxDist = Math.max(...simplified.map((p) => Math.hypot(p.x, p.y)));
    const normalized = simplified.map((p) => ({
      x: Math.round((p.x / maxDist) * 10000) / 10000,
      y: Math.round((p.y / maxDist) * 10000) / 10000
    }));

    shapes[name] = normalized;
    console.log(`  ${name}: ${ring.length} -> ${normalized.length} points`);
  }

  const header = `// Simplified, normalized outline for each U.S. state — the "State" marble
// shape in render.js/physics.js traces these directly (scaled by a marble's
// radius, the same way hexagonVertices()/starVertices() in physics.js scale
// their own point lists). Each state's points are centered on that state's
// own area centroid and scaled so its farthest point sits at distance 1 from
// that center. Generated by download-state-shapes.js from public domain
// state boundary data — re-run that script to regenerate this file, never
// hand-edit it.
Game.stateShapes = `;

  const outPath = path.join(__dirname, 'js', 'state-shapes.js');
  fs.writeFileSync(outPath, header + JSON.stringify(shapes) + ';\n');
  console.log(`\nWrote ${outPath}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
