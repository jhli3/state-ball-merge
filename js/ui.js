// --- UI: viewport fit, Choose States modal, success screen, how-to modal ---
Game.ui = (function() {
  // --- Fit whole layout inside the viewport ---
  const appLayout = document.querySelector('.app-layout');

  function fitToViewport() {
    appLayout.style.transform = 'scale(1)';
    const rect = appLayout.getBoundingClientRect();
    const scale = Math.min(1, window.innerWidth / rect.width, window.innerHeight / rect.height) * 0.98;
    appLayout.style.transform = `scale(${scale})`;
  }

  window.addEventListener('resize', fitToViewport);
  fitToViewport();

  // --- Choose States Modal ---
  const modalBackdrop = document.getElementById('state-modal-backdrop');
  const modalGrid = document.getElementById('modal-grid');
  const modalSelectedCount = document.getElementById('modal-selected-count');
  const modalWarning = document.getElementById('modal-warning');
  const applyStatesBtn = document.getElementById('apply-states-btn');

  let pendingSelection = new Set(Game.state.selectedStateNames);

  function refreshModalFooter() {
    modalSelectedCount.textContent = `${pendingSelection.size} selected`;
    const tooFew = pendingSelection.size < Game.config.MIN_SELECTED_STATES;
    applyStatesBtn.disabled = tooFew;
    modalWarning.textContent = tooFew ? `Select at least ${Game.config.MIN_SELECTED_STATES} states` : '';
  }

  // Click-and-drag bulk select/deselect: mousedown on an item toggles it and starts
  // a drag "paint" of that same checked value onto every item the pointer enters.
  let isDragSelecting = false;
  let dragSelectValue = true;

  function setItemChecked(item, name, checked) {
    if (checked) pendingSelection.add(name);
    else pendingSelection.delete(name);
    item.classList.toggle('checked', checked);
    item.querySelector('input').checked = checked;
    refreshModalFooter();
  }

  function buildStateModalGrid() {
    modalGrid.innerHTML = '';
    Game.config.MASTER_STATE_NAMES.forEach(name => {
      const fileName = name.toLowerCase().replace(/ /g, '_') + '.svg';
      const isChecked = pendingSelection.has(name);

      const item = document.createElement('div');
      item.className = `modal-state-item ${isChecked ? 'checked' : ''}`;
      item.tabIndex = 0;
      item.innerHTML = `
        <input type="checkbox" tabindex="-1" ${isChecked ? 'checked' : ''} />
        <div class="modal-state-flag" style="background-image: url('assets/${fileName}');"></div>
        <span class="modal-state-name">${name}</span>
      `;

      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        isDragSelecting = true;
        dragSelectValue = !pendingSelection.has(name);
        setItemChecked(item, name, dragSelectValue);
      });

      item.addEventListener('mouseenter', () => {
        if (isDragSelecting) setItemChecked(item, name, dragSelectValue);
      });

      // Keyboard (Enter/Space) support alongside the gamepad's own activation
      // hook below — both toggle the same way a click would.
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setItemChecked(item, name, !pendingSelection.has(name));
        }
      });

      // Consumed by the gamepad focus system (input.js) — these tiles are
      // divs, not buttons, so a plain .click() wouldn't toggle them.
      item._gamepadActivate = () => setItemChecked(item, name, !pendingSelection.has(name));

      modalGrid.appendChild(item);
    });
    refreshModalFooter();
  }

  window.addEventListener('mouseup', () => { isDragSelecting = false; });

  function openStateModal() {
    closeSettingsModal();
    Game.input.cancelHold();
    pendingSelection = new Set(Game.state.selectedStateNames);
    buildStateModalGrid();
    modalBackdrop.classList.add('open');
    Game.state.isModalOpen = true;
  }

  function closeStateModal() {
    modalBackdrop.classList.remove('open');
    Game.state.isModalOpen = false;
  }

  document.getElementById('customize-btn').addEventListener('click', openStateModal);
  document.getElementById('modal-close-btn').addEventListener('click', closeStateModal);

  modalBackdrop.addEventListener('click', (e) => {
    if (e.target === modalBackdrop) closeStateModal();
  });

  document.getElementById('select-all-btn').addEventListener('click', () => {
    pendingSelection = new Set(Game.config.MASTER_STATE_NAMES);
    buildStateModalGrid();
  });

  document.getElementById('select-none-btn').addEventListener('click', () => {
    pendingSelection = new Set();
    buildStateModalGrid();
  });

  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      pendingSelection = new Set(Game.config.STATE_REGIONS[btn.dataset.region]);
      buildStateModalGrid();
    });
  });

  applyStatesBtn.addEventListener('click', () => {
    if (pendingSelection.size < Game.config.MIN_SELECTED_STATES) return;
    Game.state.selectedStateNames = new Set(pendingSelection);
    Game.config.saveSelectedStateNames(Game.state.selectedStateNames);
    const activeNames = Game.config.MASTER_STATE_NAMES.filter(name => Game.state.selectedStateNames.has(name));
    Game.core.resetGame(activeNames);
    closeStateModal();
  });

  // --- Success Screen ---
  const successBackdrop = document.getElementById('success-modal-backdrop');

  function formatElapsed(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  function showSuccessScreen() {
    const finalTier = Game.state.TIERS[Game.state.TIERS.length - 1];

    document.getElementById('success-state-name').textContent = finalTier.name;
    const flagEl = document.getElementById('success-flag');
    flagEl.style.backgroundImage = `url('assets/${finalTier.fileName}')`;
    flagEl.style.backgroundColor = finalTier.color;

    const elapsed = formatElapsed(performance.now() - Game.state.gameStartTime);
    const scoreLine = Game.state.currentScore >= Game.state.highScore
      ? `${Game.state.currentScore.toLocaleString()} pts (new best!)`
      : `${Game.state.currentScore.toLocaleString()} pts`;
    document.getElementById('success-stats').textContent =
      `${scoreLine} · ${Game.state.dropCount} drops · ${Game.state.mergeCount} merges · ${Game.state.unlockedSet.size}/${Game.state.TIERS.length} discovered · ${elapsed}`;

    Game.input.cancelHold();

    successBackdrop.classList.add('open');
    Game.state.isModalOpen = true;
  }

  function closeSuccessScreen() {
    successBackdrop.classList.remove('open');
    Game.state.isModalOpen = false;
  }

  document.getElementById('success-continue-btn').addEventListener('click', closeSuccessScreen);
  document.getElementById('success-restart-btn').addEventListener('click', () => Game.core.restartGame());

  // --- How to Play Modal ---
  const howtoBackdrop = document.getElementById('howto-modal-backdrop');

  function openHowToModal() {
    closeSettingsModal();
    Game.input.cancelHold();
    howtoBackdrop.classList.add('open');
    Game.state.isModalOpen = true;
  }

  function closeHowToModal() {
    howtoBackdrop.classList.remove('open');
    Game.state.isModalOpen = false;
  }

  document.getElementById('howto-btn').addEventListener('click', openHowToModal);
  document.getElementById('howto-close-btn').addEventListener('click', closeHowToModal);

  howtoBackdrop.addEventListener('click', (e) => {
    if (e.target === howtoBackdrop) closeHowToModal();
  });

  // --- Settings Modal (hub for How to Play, Ambient, Shape, Mode, Choose States) ---
  const settingsBackdrop = document.getElementById('settings-modal-backdrop');

  function openSettingsModal() {
    Game.input.cancelHold();
    settingsBackdrop.classList.add('open');
    Game.state.isModalOpen = true;
  }

  function closeSettingsModal() {
    settingsBackdrop.classList.remove('open');
    Game.state.isModalOpen = false;
  }

  document.getElementById('settings-btn').addEventListener('click', openSettingsModal);
  document.getElementById('settings-close-btn').addEventListener('click', closeSettingsModal);

  settingsBackdrop.addEventListener('click', (e) => {
    if (e.target === settingsBackdrop) closeSettingsModal();
  });

  return {
    fitToViewport,
    openStateModal,
    closeStateModal,
    showSuccessScreen,
    closeSuccessScreen,
    openHowToModal,
    closeHowToModal,
    openSettingsModal,
    closeSettingsModal
  };
})();
