// --- Input: mouse, keyboard, hold-to-stream, gamepad ---
Game.input = (function() {
  const render = Game.physics.render;

  function toCanvasCoords(e) {
    const rect = render.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (Game.physics.WIDTH / rect.width),
      y: (e.clientY - rect.top) * (Game.physics.HEIGHT / rect.height)
    };
  }

  // Classic mode only needs the X half of this (aimY sits unused at
  // whatever default it started at) — space/particle modes place freely, so
  // it tracks the full pointer position.
  render.canvas.addEventListener('mousemove', (e) => {
    const pos = toCanvasCoords(e);
    const radius = Game.physics.marbleRadius(Game.state.TIERS[Game.state.currentTier]);
    Game.state.aimX = Game.physics.clampAimX(pos.x, radius);
    Game.state.aimY = Game.physics.clampAimY(pos.y, radius);
  });

  // Classic mode drops from the fixed top chute; space/particle modes place
  // the marble at rest wherever aimX/aimY currently point, and let the
  // attraction/repulsion/center-pull forces (physics.js) carry it from
  // there — no velocity involved. Every input path below (click,
  // hold-to-stream, Shift, gamepad) goes through this one dispatcher instead
  // of calling dropMarble directly, so both floating modes get the exact
  // same controls for free.
  function fireCurrent() {
    if (Game.state.marbleMode === 'classic') {
      Game.core.dropMarble();
    } else {
      Game.core.placeMarble(Game.state.aimX, Game.state.aimY);
    }
  }

  // --- Press-and-hold streaming (Shift key or mouse/pointer held down) ---
  // The longer you hold, the faster it fires — ramping from the normal
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
      fireCurrent();
      scheduleNextHoldDrop();
    }, currentDropCooldown());
  }

  function startHold(source) {
    const wasIdle = holdSources.size === 0;
    holdSources.add(source);
    if (wasIdle) {
      holdStartTime = performance.now();
      fireCurrent();
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
  // streaming in the background while a dialog is up.
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
        Game.ui.closeSettingsModal();
      }
      return;
    }

    const radius = Game.physics.marbleRadius(Game.state.TIERS[Game.state.currentTier]);
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
    } else if (e.key === 'ArrowUp') {
      // Only meaningful in space/particle mode's free 2D placement —
      // harmless no-op effect in classic mode, where aimY isn't read for
      // anything.
      Game.state.aimY = Game.physics.clampAimY(Game.state.aimY - step, radius);
    } else if (e.key === 'ArrowDown') {
      Game.state.aimY = Game.physics.clampAimY(Game.state.aimY + step, radius);
    } else if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      Game.core.restartGame();
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      // Keyboard equivalent of the gamepad's D-pad-left binding below —
      // "Backspace" so it works with the key labeled delete on a Mac
      // keyboard (which reports as Backspace, not Delete) as well as a
      // full-size keyboard's forward-delete key.
      e.preventDefault();
      Game.core.deleteSmallestMarbles();
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

  // Shake/Restart/Settings on the main screen are reachable only through
  // their own dedicated gamepad buttons (Y/+/-), never through D-pad/stick
  // focus navigation — so there's nothing to focus outside a modal, and the
  // stick stays exclusively dedicated to aiming.
  function getFocusRoots() {
    const openModal = document.querySelector('.modal-backdrop.open');
    return openModal ? [openModal] : [];
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
    Game.ui.closeSettingsModal();
  }

  // Settings-specific (rather than the shared Game.state.isModalOpen flag)
  // so the "-" button below can tell whether it's toggling Settings itself
  // shut, versus opening it fresh from the main screen.
  function isSettingsOpen() {
    const el = document.getElementById('settings-modal-backdrop');
    return !!el && el.classList.contains('open');
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

    if (!modalOpen) {
      // Nothing to focus on the main screen — Shake/Restart/Settings are
      // reachable only via their own buttons (Y/+/-) below, never via
      // D-pad/stick navigation, so the stick stays exclusively dedicated to
      // aiming. This also drops any focus left over from a modal that closed
      // through a path that didn't clear it (e.g. a mouse click elsewhere).
      if (gamepadFocusEl) clearGamepadFocus();
    } else {
      // A modal grabs focus as soon as it's open (however it was opened) so
      // there's always something highlighted to act on, instead of requiring
      // a direction press first.
      if (!gamepadFocusEl || !getFocusableEls().includes(gamepadFocusEl)) {
        const els = getFocusableEls();
        if (els.length) setGamepadFocus(els[0]);
      }

      // D-pad and the left stick drive menu focus only while a modal is
      // open — this is the sole role the stick plays outside of aiming.
      if (justPressed(12)) moveGamepadFocus('up');
      if (justPressed(13)) moveGamepadFocus('down');
      if (justPressed(14)) moveGamepadFocus('left');
      if (justPressed(15)) moveGamepadFocus('right');

      const stickDirY = axisToDir(pad.axes[1] || 0);
      if (stickDirY !== stickFocusDirY) {
        if (stickDirY === -1) moveGamepadFocus('up');
        if (stickDirY === 1) moveGamepadFocus('down');
        stickFocusDirY = stickDirY;
      }

      const stickDirX = axisToDir(pad.axes[0] || 0);
      if (stickDirX !== stickFocusDirX) {
        if (stickDirX === -1) moveGamepadFocus('left');
        if (stickDirX === 1) moveGamepadFocus('right');
        stickFocusDirX = stickDirX;
      }
    }

    // A: activate the focused control if there is one, otherwise fire (held
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

    // -: toggle Settings — opens it from the main screen, or closes it back
    // out if it's the modal currently open. Leaves How to Play/Choose States
    // alone if one of those is open instead (B backs out of those, as usual).
    if (justPressed(8)) {
      if (isSettingsOpen()) { Game.ui.closeSettingsModal(); clearGamepadFocus(); }
      else if (!modalOpen) Game.ui.openSettingsModal();
    }

    if (!modalOpen) {
      // Aim: left stick only. X-axis steers left/right in all modes;
      // Y-axis additionally steers up/down in space/particle mode's free 2D
      // placement (a harmless no-op in classic mode, where aimY isn't
      // read for anything) — same split the mouse and arrow keys use.
      const radius = Game.physics.marbleRadius(Game.state.TIERS[Game.state.currentTier]);
      const stickX = pad.axes[0] || 0;
      if (Math.abs(stickX) > GAMEPAD_STICK_DEADZONE) {
        Game.state.aimX = Game.physics.clampAimX(Game.state.aimX + stickX * GAMEPAD_AIM_SPEED, radius);
      }
      const stickY = pad.axes[1] || 0;
      if (Math.abs(stickY) > GAMEPAD_STICK_DEADZONE) {
        Game.state.aimY = Game.physics.clampAimY(Game.state.aimY + stickY * GAMEPAD_AIM_SPEED, radius);
      }

      // Shake: Y button (standard mapping button 2)
      if (justPressed(2)) Game.core.triggerShake();

      // Restart: + / Start button (standard mapping button 9)
      if (justPressed(9)) Game.core.restartGame();

      // D-pad left: sweep the smallest tier currently on the board — a
      // quick way to clear clutter, same action as the Backspace/Delete key
      // above. D-pad left/right have no other job while aiming (the stick
      // handles that), so this is free real estate.
      if (justPressed(14)) Game.core.deleteSmallestMarbles();
    }

    gamepadPrevButtons = pad.buttons.map(b => b.pressed);
  }

  requestAnimationFrame(pollGamepad);

  return { currentDropCooldown, cancelHold };
})();
