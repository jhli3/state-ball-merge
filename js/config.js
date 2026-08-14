// Master state list, region presets, and tier construction. Nothing in here
// depends on the game being in progress — it's pure data + data-shaping.
Game.config = (function() {
  const MASTER_STATE_NAMES = [
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

  // Backdrop color for each flag, used by render.js to fill the hexagon's cut
  // corners / star's concave notches when a shape's outline clips outside the
  // flag artwork. Sampled once (the exact pixel at each flag SVG's top-left
  // corner) rather than computed at runtime: doing this with canvas
  // getImageData against a file://-loaded image throws a SecurityError in
  // Chrome (each local file gets its own opaque origin, which taints the
  // canvas), so a live version of this lookup silently fell back to the
  // tier's rainbow hue instead — this static table sidesteps that entirely,
  // the same way it works whether the page is opened from disk or served.
  const FLAG_EDGE_COLORS = {
    "Rhode Island": "#ffffff", "Delaware": "#669ca4", "Connecticut": "#0c2d83",
    "New Jersey": "#f0c568", "New Hampshire": "#002a86", "Vermont": "#003366",
    "Massachusetts": "#ffffff", "Hawaii": "#d54b61", "Maryland": "#000000",
    "West Virginia": "#00205b", "South Carolina": "#041e42", "Maine": "#002664",
    "Indiana": "#000f5d", "Kentucky": "#000066", "Tennessee": "#cc0000",
    "Virginia": "#364f87", "Ohio": "#2f1a50", "Pennsylvania": "#00205b",
    "Mississippi": "#ba0c2f", "Louisiana": "#01447b", "Alabama": "#b10021",
    "Arkansas": "#bf0a30", "North Carolina": "#00205b", "New York": "#002d72",
    "Iowa": "#0a1f62", "Illinois": "#ffffff", "Wisconsin": "#002986",
    "Florida": "#c60013", "Missouri": "#bf0a30", "Oklahoma": "#0073cf",
    "Washington": "#00843d", "Georgia": "#00205b", "Michigan": "#0a3383",
    "North Dakota": "#00386f", "South Dakota": "#0074a8", "Nebraska": "#002a86",
    "Kansas": "#00205b", "Idaho": "#003776", "Utah": "#071d49",
    "Minnesota": "#002d5d", "Wyoming": "#bf0a30", "Oregon": "#01017f",
    "Colorado": "#00205b", "Nevada": "#0033ab", "Arizona": "#bf0a30",
    "New Mexico": "#ffd700", "Montana": "#002a86", "California": "#ffffff",
    "Texas": "#00205b", "Alaska": "#0f204b"
  };

  const STATE_REGIONS = {
    Northeast: ["Connecticut", "Maine", "Massachusetts", "New Hampshire", "New Jersey", "New York", "Pennsylvania", "Rhode Island", "Vermont"],
    Midwest: ["Illinois", "Indiana", "Iowa", "Kansas", "Michigan", "Minnesota", "Missouri", "Nebraska", "North Dakota", "Ohio", "South Dakota", "Wisconsin"],
    South: ["Alabama", "Arkansas", "Delaware", "Florida", "Georgia", "Kentucky", "Louisiana", "Maryland", "Mississippi", "North Carolina", "Oklahoma", "South Carolina", "Tennessee", "Texas", "Virginia", "West Virginia"],
    West: ["Alaska", "Arizona", "California", "Colorado", "Hawaii", "Idaho", "Montana", "Nevada", "New Mexico", "Oregon", "Utah", "Washington", "Wyoming"]
  };

  const STATE_SELECTION_STORAGE_KEY = 'smm-selected-states';
  const MIN_SELECTED_STATES = 3;

  // --- Canvas size: computed once at load from the available viewport, so
  // the box the marbles live in makes full use of the screen instead of
  // always rendering at a fixed 900x720 regardless of monitor size.
  // physics.js reads WIDTH/HEIGHT from here (this module loads first) and
  // uses them as-is; buildTiers() below uses REFERENCE_WIDTH to scale marble
  // radii to match, so the size-to-box ratio stays the same across screens.
  // Clamped to a sane range so it never gets too cramped to read tier art,
  // or so huge that physics tuned for the reference size starts feeling
  // sluggish/floaty.
  const REFERENCE_WIDTH = 900;
  const CHART_PANEL_WIDTH = 300; // .chart-panel: 260 + 32 padding + ~2 border, rounded up
  const SIDE_PANEL_WIDTH = 210;  // .side-panel: 200 + a little slack for its cards' own borders
  const COLUMN_GAP_TOTAL = 48;   // .app-layout gap:24px between its 3 children, twice
  const CONTROLS_HEIGHT = 70;    // .controls margin-top + the button row beneath the canvas
  const SAFETY_MARGIN = 40;      // breathing room so the box isn't flush against the browser edge

  function computeCanvasSize() {
    const availableWidth = window.innerWidth - CHART_PANEL_WIDTH - SIDE_PANEL_WIDTH - COLUMN_GAP_TOTAL - SAFETY_MARGIN;
    const availableHeight = window.innerHeight - CONTROLS_HEIGHT - SAFETY_MARGIN;
    return {
      WIDTH: Math.round(Math.min(1400, Math.max(480, availableWidth))),
      HEIGHT: Math.round(Math.min(1100, Math.max(420, availableHeight)))
    };
  }

  const { WIDTH, HEIGHT } = computeCanvasSize();

  function loadSelectedStateNames() {
    try {
      const raw = localStorage.getItem(STATE_SELECTION_STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw).filter(name => MASTER_STATE_NAMES.includes(name));
        if (saved.length >= MIN_SELECTED_STATES) return new Set(saved);
      }
    } catch (e) { /* ignore malformed storage */ }
    return new Set(MASTER_STATE_NAMES);
  }

  function saveSelectedStateNames(set) {
    localStorage.setItem(STATE_SELECTION_STORAGE_KEY, JSON.stringify([...set]));
  }

  // Growth curve for tier radii: a lower exponent than the original 1.35
  // spreads the size increase more evenly across tiers instead of loading
  // most of it onto the last several merges, which is what made the late
  // game balloon in size so fast it got hard to maneuver around. Dropped
  // further (1.1 -> 0.85) and MAX_RADIUS_ADD trimmed again (110 -> 90) after
  // the first pass still wasn't gentle enough. Both are in REFERENCE_WIDTH-px
  // terms and get scaled by the actual canvas width below, so the curve's
  // *shape* (and therefore difficulty) is the same regardless of screen
  // size — only the absolute pixel sizes change.
  const GROWTH_EXPONENT = 0.85;
  const MAX_RADIUS_ADD = 90;
  const MIN_RADIUS = 20;

  // Build TIERS (small -> large) from whichever states are currently selected
  function buildTiers(names) {
    const maxIndex = Math.max(1, names.length - 1);
    const scale = WIDTH / REFERENCE_WIDTH;
    return names.map((name, index) => {
      const radius = Math.round((MIN_RADIUS + Math.pow(index / maxIndex, GROWTH_EXPONENT) * MAX_RADIUS_ADD) * scale);
      const hue = Math.round((index / maxIndex) * 330);
      const color = `hsl(${hue}, 75%, 55%)`;
      const edgeColor = FLAG_EDGE_COLORS[name] || color;
      const fileName = name.toLowerCase().replace(/ /g, '_') + '.svg';

      const imgObj = new Image();
      imgObj.src = `assets/${fileName}`;

      return { level: index, radius, name, fileName, color, edgeColor, imgObj };
    });
  }

  return {
    MASTER_STATE_NAMES,
    STATE_REGIONS,
    MIN_SELECTED_STATES,
    WIDTH,
    HEIGHT,
    loadSelectedStateNames,
    saveSelectedStateNames,
    buildTiers
  };
})();

Game.state.selectedStateNames = Game.config.loadSelectedStateNames();
