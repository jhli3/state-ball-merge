// --- Discovered-states sidebar ---
Game.chart = (function() {
  function renderChart() {
    const container = document.getElementById('chart-list');
    container.innerHTML = '';

    Game.state.TIERS.forEach((tier, index) => {
      const isUnlocked = Game.state.unlockedSet.has(index);
      const item = document.createElement('div');
      item.className = `chart-item ${isUnlocked ? 'unlocked' : 'locked'}`;
      item.id = `chart-item-${index}`;

      item.title = isUnlocked ? `${tier.name} — click to clear from board` : '???';
      item.innerHTML = `
        <div class="chart-flag" style="background-image: url('assets/${tier.fileName}'); background-color: ${tier.color};"></div>
        <span class="tier-badge">${index + 1}</span>
      `;
      container.appendChild(item);
    });

    document.getElementById('unlocked-count').textContent = `${Game.state.unlockedSet.size}/${Game.state.TIERS.length}`;
  }

  // Click a discovered state in the sidebar to sweep every marble of that
  // state off the board. Doesn't affect its "discovered" status in the chart.
  function clearStateFromBoard(tierIndex) {
    const engine = Game.physics.engine;
    const toRemove = Matter.Composite.allBodies(engine.world).filter(b => b.gameTier === tierIndex);
    if (toRemove.length === 0) return;
    Matter.Composite.remove(engine.world, toRemove);

    const popCount = Math.min(toRemove.length, 10);
    for (let i = 0; i < popCount; i++) {
      const delay = i * (30 + Math.random() * 45);
      const pitch = 0.85 + Math.random() * 0.4;
      setTimeout(() => Game.audio.playPopSound(pitch), delay);
    }

    Game.core.saveGameState();
  }

  document.getElementById('chart-list').addEventListener('click', (e) => {
    const item = e.target.closest('.chart-item');
    if (!item || !item.classList.contains('unlocked')) return;
    const index = Number(item.id.replace('chart-item-', ''));
    clearStateFromBoard(index);
  });

  return { renderChart, clearStateFromBoard };
})();
