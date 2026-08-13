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
      const fileName = name.toLowerCase().replace(/ /g, '_') + '.svg';

      const imgObj = new Image();
      imgObj.src = `assets/${fileName}`;

      return { level: index, radius, name, fileName, color, imgObj };
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
