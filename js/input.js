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

  window.addEventListener('gamepadconnected', (e) => {
    activeGamepadIndex = e.gamepad.index;
  });

  window.addEventListener('gamepaddisconnected', (e) => {
    if (e.gamepad.index === activeGamepadIndex) {
      activeGamepadIndex = null;
      stopHold('gamepad');
    }
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

    if (Game.state.isModalOpen) return;

    const prev = gamepadPrevButtons;
    const isPressed = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
    const justPressed = (i) => isPressed(i) && !prev[i];

    const radius = Game.state.TIERS[Game.state.currentTier].radius;

    // Aim: left stick X-axis (analog) plus D-pad left/right (digital step)
    const stickX = pad.axes[0] || 0;
    if (Math.abs(stickX) > GAMEPAD_STICK_DEADZONE) {
      Game.state.aimX = Game.physics.clampAimX(Game.state.aimX + stickX * GAMEPAD_AIM_SPEED, radius);
    }
    if (isPressed(14)) Game.state.aimX = Game.physics.clampAimX(Game.state.aimX - GAMEPAD_AIM_SPEED, radius); // D-pad left
    if (isPressed(15)) Game.state.aimX = Game.physics.clampAimX(Game.state.aimX + GAMEPAD_AIM_SPEED, radius); // D-pad right

    // Drop: A button (standard mapping button 1) — hold for a stream, same as Shift/mouse
    if (justPressed(1)) startHold('gamepad');
    if (!isPressed(1) && prev[1]) stopHold('gamepad');

    // Shake: X button (standard mapping button 3)
    if (justPressed(3)) Game.core.triggerShake();

    // Restart: + / Start button (standard mapping button 9)
    if (justPressed(9)) Game.core.restartGame();

    gamepadPrevButtons = pad.buttons.map(b => b.pressed);
  }

  requestAnimationFrame(pollGamepad);

  return { currentDropCooldown, cancelHold };
})();
