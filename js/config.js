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

  // Build TIERS (small -> large) from whichever states are currently selected
  function buildTiers(names) {
    const maxIndex = Math.max(1, names.length - 1);
    return names.map((name, index) => {
      // Scaled up ~40% from the original 14-105 range to match the wider
      // (640 -> 900px) canvas — the smallest tier in particular used to be
      // too small to make out its flag art.
      const radius = Math.round(20 + Math.pow(index / maxIndex, 1.35) * 128);
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
    loadSelectedStateNames,
    saveSelectedStateNames,
    buildTiers
  };
})();

Game.state.selectedStateNames = Game.config.loadSelectedStateNames();
