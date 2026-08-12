// --- Input: mouse, keyboard, hold-to-stream, gamepad ---
Game.input = (function() {
  const render = Game.physics.render;

  render.canvas.addEventListener('mousemove', (e) => {
    const rect = render.canvas.getBoundingClientRect();
    const radius = Game.state.TIERS[Game.state.currentTier].radius;
    const scaleX = Game.physics.WIDTH / rect.width;
    Game.state.aimX = Game.physics.clampAimX((e.clientX - rect.left) * scaleX, radius);
  });

  // --- Press-and-hold streaming drop (Shift key or mouse/pointer held down) ---
  // The longer you hold, the faster it drops — ramping from the normal drop
  // cooldown down to a capped minimum, so it speeds up but never runs away.
  let holdSources = new Set();
  let holdTimer = null;
  let holdStartTime = 0;

  const DROP_COOLDOWN_BASE = 380;
  const DROP_COOLDOWN_MIN = 90;
  const HOLD_ACCEL_RAMP_MS = 3000; // time held before hitting max speed

  function currentDropCooldown() {
    if (holdSources.size === 0) return DROP_COOLDOWN_BASE;
    const held = performance.now() - holdStartTime;
    const t = Math.min(1, held / HOLD_ACCEL_RAMP_MS);
    const eased = t * t; // ease-in so the speed-up feels like it's building momentum
    return DROP_COOLDOWN_BASE - (DROP_COOLDOWN_BASE - DROP_COOLDOWN_MIN) * eased;
  }

  function scheduleNextHoldDrop() {
    if (holdSources.size === 0) return;
    holdTimer = setTimeout(() => {
      Game.core.dropMarble();
      scheduleNextHoldDrop();
    }, currentDropCooldown());
  }

  function startHold(source) {
    const wasIdle = holdSources.size === 0;
    holdSources.add(source);
    if (wasIdle) {
      holdStartTime = performance.now();
      Game.core.dropMarble();
      scheduleNextHoldDrop();
    }
  }

  function stopHold(source) {
    holdSources.delete(source);
    if (holdSources.size === 0 && holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
  }

  // Used by modal-opening code elsewhere so a hold in progress doesn't keep
  // streaming drops in the background while a dialog is up.
  function cancelHold() {
    holdSources.clear();
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
  }

  window.addEventListener('keydown', (e) => {
    if (Game.state.isModalOpen) {
      if (e.key === 'Escape') {
        Game.ui.closeStateModal();
        Game.ui.closeSuccessScreen();
        Game.ui.closeHowToModal();
      }
      return;
    }

    const radius = Game.state.TIERS[Game.state.currentTier].radius;
    const step = 20;

    if (e.key === 'Shift') {
      e.preventDefault();
      if (!e.repeat) startHold('shift');
    } else if (e.code === 'Space') {
      e.preventDefault();
      if (e.repeat) return;
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      Game.core.triggerShake();
    } else if (e.key === 'ArrowLeft') {
      Game.state.aimX = Game.physics.clampAimX(Game.state.aimX - step, radius);
    } else if (e.key === 'ArrowRight') {
      Game.state.aimX = Game.physics.clampAimX(Game.state.aimX + step, radius);
    } else if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      Game.core.restartGame();
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.key === 'Shift') stopHold('shift');
  });

  window.addEventListener('blur', () => {
    cancelHold();
  });

  render.canvas.addEventListener('pointerdown', () => {
    startHold('mouse');
  });

  window.addEventListener('pointerup', () => stopHold('mouse'));
  window.addEventListener('pointercancel', () => stopHold('mouse'));

  // --- Gamepad menu navigation ---
  // Everything a mouse can click also needs to be reachable from a switch
  // controller, so we drive a virtual focus cursor over the same buttons
  // and modal contents a mouse would hit. Navigation is spatial (nearest
  // focusable element in the pressed direction, by on-screen position)
  // rather than assuming any fixed grid/list shape, so it keeps working as
  // the state-picker grid reflows at different widths.
  const FOCUSABLE_SELECTOR = 'button:not(:disabled), [tabindex="0"]';
  let gamepadFocusEl = null;

  function getFocusRoots() {
    const openModal = document.querySelector('.modal-backdrop.open');
    if (openModal) return [openModal];
    return [document.querySelector('.controls'), document.querySelector('.side-panel')];
  }

  function getFocusableEls() {
    const els = [];
    getFocusRoots().filter(Boolean).forEach(root => {
      root.querySelectorAll(FOCUSABLE_SELECTOR).forEach(el => {
        if (el.offsetParent !== null) els.push(el);
      });
    });
    return els;
  }

  function setGamepadFocus(el) {
    if (gamepadFocusEl) gamepadFocusEl.classList.remove('gamepad-focused');
    gamepadFocusEl = el;
    if (el) {
      el.classList.add('gamepad-focused');
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  function clearGamepadFocus() {
    setGamepadFocus(null);
  }

  // Picks the closest focusable element in `dir` from the current focus,
  // scoring candidates by distance along the pressed axis plus a penalty
  // for drifting off-axis — the same weighting a TV/console UI uses so
  // "down" lands on the item visually below rather than just the next one
  // in DOM order.
  function moveGamepadFocus(dir) {
    const els = getFocusableEls();
    if (els.length === 0) return;

    if (!gamepadFocusEl || !els.includes(gamepadFocusEl)) {
      setGamepadFocus(els[0]);
      return;
    }

    const cur = gamepadFocusEl.getBoundingClientRect();
    const cx = cur.left + cur.width / 2;
    const cy = cur.top + cur.height / 2;

    let best = null;
    let bestScore = Infinity;

    els.forEach(el => {
      if (el === gamepadFocusEl) return;
      const r = el.getBoundingClientRect();
      const ex = r.left + r.width / 2;
      const ey = r.top + r.height / 2;
      const dx = ex - cx;
      const dy = ey - cy;

      let primary, perpendicular;
      if (dir === 'right') { primary = dx; perpendicular = dy; }
      else if (dir === 'left') { primary = -dx; perpendicular = dy; }
      else if (dir === 'down') { primary = dy; perpendicular = dx; }
      else { primary = -dy; perpendicular = dx; }

      if (primary <= 4) return;

      const score = primary + Math.abs(perpendicular) * 2.2;
      if (score < bestScore) { bestScore = score; best = el; }
    });

    if (best) setGamepadFocus(best);
  }

  // Activating a focused element normally just clicks it, but the
  // state-picker grid tiles are plain divs with their own toggle logic
  // (see ui.js) — they stash that logic on the element itself so this stays
  // a single, generic entry point.
  function activateGamepadFocus() {
    if (!gamepadFocusEl) return;
    if (typeof gamepadFocusEl._gamepadActivate === 'function') gamepadFocusEl._gamepadActivate();
    else gamepadFocusEl.click();
  }

  function closeAnyOpenModal() {
    Game.ui.closeStateModal();
    Game.ui.closeSuccessScreen();
    Game.ui.closeHowToModal();
  }

  // --- Gamepad support (Switch Pro Controller / paired Joy-Cons) ---
  // Chrome/Edge expose these over Bluetooth or USB as a standard-mapping
  // gamepad once a button is pressed, so no extra library is needed. The
  // Gamepad API only fires connect/disconnect events (no press events), so
  // button state has to be polled every frame and diffed against the last
  // frame to detect edges (just-pressed / just-released).
  let activeGamepadIndex = null;
  let gamepadPrevButtons = [];
  const GAMEPAD_STICK_DEADZONE = 0.25;
  const GAMEPAD_AIM_SPEED = 9; // px/frame at full stick deflection, ~matches held-arrow-key speed

  // Edge-triggered stick-to-direction state for menu navigation, since the
  // stick has no discrete press events of its own — without this a held
  // stick would fire moveGamepadFocus every frame instead of once per push.
  let stickFocusDirX = 0;
  let stickFocusDirY = 0;
  function axisToDir(v) {
    if (v > 0.5) return 1;
    if (v < -0.5) return -1;
    return 0;
  }

  window.addEventListener('gamepadconnected', (e) => {
    activeGamepadIndex = e.gamepad.index;
  });

  window.addEventListener('gamepaddisconnected', (e) => {
    if (e.gamepad.index === activeGamepadIndex) {
      activeGamepadIndex = null;
      stopHold('gamepad');
      clearGamepadFocus();
    }
  });

  window.addEventListener('blur', () => {
    clearGamepadFocus();
  });

  function pollGamepad() {
    requestAnimationFrame(pollGamepad);
    if (!navigator.getGamepads) return;

    const pads = navigator.getGamepads();
    const pad = (activeGamepadIndex !== null && pads[activeGamepadIndex])
      ? pads[activeGamepadIndex]
      : Array.prototype.find.call(pads, p => p);
    if (!pad) return;
    activeGamepadIndex = pad.index;

    const prev = gamepadPrevButtons;
    const isPressed = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
    const justPressed = (i) => isPressed(i) && !prev[i];

    const modalOpen = Game.state.isModalOpen;

    // A modal grabs focus as soon as it's open (however it was opened) so
    // there's always something highlighted to act on, instead of requiring
    // a direction press first.
    if (modalOpen && (!gamepadFocusEl || !getFocusableEls().includes(gamepadFocusEl))) {
      const els = getFocusableEls();
      if (els.length) setGamepadFocus(els[0]);
    }

    // D-pad up/down and the left stick's Y-axis always drive menu focus —
    // they're otherwise unused during aim, so this is free real estate and
    // lets a controller reach every button a mouse could click.
    if (justPressed(12)) moveGamepadFocus('up');
    if (justPressed(13)) moveGamepadFocus('down');

    const stickDirY = axisToDir(pad.axes[1] || 0);
    if (stickDirY !== stickFocusDirY) {
      if (stickDirY === -1) moveGamepadFocus('up');
      if (stickDirY === 1) moveGamepadFocus('down');
      stickFocusDirY = stickDirY;
    }

    // Left/right only drive menu focus once something's already focused (or
    // a modal is open) — otherwise D-pad left/right and the stick's X-axis
    // stay dedicated to aiming, as before.
    const menuActive = modalOpen || !!gamepadFocusEl;
    if (menuActive) {
      if (justPressed(14)) moveGamepadFocus('left');
      if (justPressed(15)) moveGamepadFocus('right');

      const stickDirX = axisToDir(pad.axes[0] || 0);
      if (stickDirX !== stickFocusDirX) {
        if (stickDirX === -1) moveGamepadFocus('left');
        if (stickDirX === 1) moveGamepadFocus('right');
        stickFocusDirX = stickDirX;
      }
    } else {
      stickFocusDirX = axisToDir(pad.axes[0] || 0);
    }

    // A: activate the focused control if there is one, otherwise drop (held
    // for a stream, same as Shift/mouse) like before.
    if (justPressed(1)) {
      if (gamepadFocusEl) activateGamepadFocus();
      else if (!modalOpen) startHold('gamepad');
    }
    if (!isPressed(1) && prev[1] && !gamepadFocusEl && !modalOpen) stopHold('gamepad');

    // B: back out — close the open modal, or drop menu focus and return to aim.
    if (justPressed(0)) {
      if (modalOpen) { closeAnyOpenModal(); clearGamepadFocus(); }
      else if (gamepadFocusEl) clearGamepadFocus();
    }

    if (!modalOpen && !gamepadFocusEl) {
      const radius = Game.state.TIERS[Game.state.currentTier].radius;

      // Aim: left stick X-axis (analog) plus D-pad left/right (digital step)
      const stickX = pad.axes[0] || 0;
      if (Math.abs(stickX) > GAMEPAD_STICK_DEADZONE) {
        Game.state.aimX = Game.physics.clampAimX(Game.state.aimX + stickX * GAMEPAD_AIM_SPEED, radius);
      }
      if (isPressed(14)) Game.state.aimX = Game.physics.clampAimX(Game.state.aimX - GAMEPAD_AIM_SPEED, radius); // D-pad left
      if (isPressed(15)) Game.state.aimX = Game.physics.clampAimX(Game.state.aimX + GAMEPAD_AIM_SPEED, radius); // D-pad right

      // Shake: X button (standard mapping button 3)
      if (justPressed(3)) Game.core.triggerShake();

      // Restart: + / Start button (standard mapping button 9)
      if (justPressed(9)) Game.core.restartGame();
    }

    gamepadPrevButtons = pad.buttons.map(b => b.pressed);
  }

  requestAnimationFrame(pollGamepad);

  return { currentDropCooldown, cancelHold };
})();
