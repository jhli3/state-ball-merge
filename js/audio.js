// --- Audio System ---
// Everything the game makes noise with (drop/merge plinks, the ambient pad,
// the wandering melody, and the clear-board pop) draws from the same D minor
// pentatonic scale so it all stays in tune with itself.
Game.audio = (function() {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  let audioCtx;
  let filterNode;
  let isAmbientPlaying = false;
  let ambientBus = null;          // master gain for the whole ambient music layer
  let ambientChordTimer = null;
  let ambientMelodyTimer = null;
  let activeChordVoices = [];     // currently-sounding pad chord oscillators, so we can fade them on change/stop
  let chordIndex = 0;
  let lastMelodyDegree = 7;       // random-walk position in the scale, in scale-degree steps (not semitones)

  // A couple of simple pentatonic triads (as semitone offsets from BASE_FREQ) to
  // vamp between slowly, plus a random-walk melody over the same scale — this is
  // what actually makes it feel like light music instead of a held drone.
  const AMBIENT_CHORDS = [
    [0, 3, 7],   // D minor  (D F A)
    [3, 7, 10],  // F major  (F A C)
    [5, 7, 12],  // sus/open (G A D)
  ];

  let activeVoices = 0;
  const MAX_VOICES = 4;
  let lastSoundTime = 0;
  const SOUND_COOLDOWN = 30;
  let isShakingActive = false;

  const BASE_FREQ = 146.83; // D3
  const PENTATONIC_OFFSETS = [0, 3, 5, 7, 10];

  function noteFreq(semitones) {
    return BASE_FREQ * Math.pow(2, semitones / 12);
  }

  // Updates the toggle button's icon glyph and label text in place rather
  // than overwriting textContent wholesale — the button also carries a
  // Material Symbols icon span that a plain textContent assignment would
  // clobber.
  function setAmbientButtonState(isOn) {
    const btn = document.getElementById('audio-toggle');
    btn.querySelector('.material-symbols-outlined').textContent = isOn ? 'music_note' : 'music_off';
    btn.querySelector('.btn-label').textContent = isOn ? 'Ambient: On' : 'Ambient: Off';
    btn.classList.toggle('active', isOn);
  }

  function initAudio() {
    if (!audioCtx) {
      audioCtx = new AudioContextCtor();
      filterNode = audioCtx.createBiquadFilter();
      filterNode.type = 'lowpass';
      filterNode.frequency.setValueAtTime(1400, audioCtx.currentTime);
      filterNode.connect(audioCtx.destination);
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }

  function startAmbientDrone() {
    initAudio();
    if (isAmbientPlaying) return;
    isAmbientPlaying = true;

    ambientBus = audioCtx.createGain();
    ambientBus.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    ambientBus.gain.linearRampToValueAtTime(1, audioCtx.currentTime + 2);
    ambientBus.connect(audioCtx.destination);

    chordIndex = 0;
    playNextAmbientChord();
    scheduleAmbientMelody();

    setAmbientButtonState(true);
  }

  // Soft pentatonic chord pad, one octave below the melody register — slowly
  // vamps between a small set of chords instead of holding a single drone.
  function playNextAmbientChord() {
    if (!isAmbientPlaying) return;
    const now = audioCtx.currentTime;

    activeChordVoices.forEach(({ osc, gain }) => {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0.0001, now + 2.5);
      osc.stop(now + 2.6);
    });
    activeChordVoices = [];

    const chord = AMBIENT_CHORDS[chordIndex % AMBIENT_CHORDS.length];
    chordIndex++;

    chord.forEach(semitones => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(noteFreq(semitones - 12), now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.022, now + 3);
      osc.connect(gain);
      gain.connect(ambientBus);
      osc.start(now);
      activeChordVoices.push({ osc, gain });
    });

    ambientChordTimer = setTimeout(playNextAmbientChord, 9000 + Math.random() * 2500);
  }

  // Wandering bell/music-box melody over the same pentatonic scale — a random
  // walk (rather than pure random notes) so it reads as an actual gentle tune.
  function scheduleAmbientMelody() {
    if (!isAmbientPlaying) return;
    const delay = 550 + Math.random() * 500;
    ambientMelodyTimer = setTimeout(() => {
      playAmbientMelodyNote();
      scheduleAmbientMelody();
    }, delay);
  }

  function playAmbientMelodyNote() {
    if (!isAmbientPlaying || Math.random() < 0.35) return; // leave rests so it breathes

    const step = Math.floor(Math.random() * 5) - 2; // -2..+2 scale degrees
    lastMelodyDegree = Math.max(0, Math.min(14, lastMelodyDegree + step));
    const octave = Math.floor(lastMelodyDegree / PENTATONIC_OFFSETS.length);
    const noteInOctave = lastMelodyDegree % PENTATONIC_OFFSETS.length;
    const freq = noteFreq(octave * 12 + PENTATONIC_OFFSETS[noteInOctave]);

    const now = audioCtx.currentTime;
    const peak = 0.035 + Math.random() * 0.025;

    // Fundamental + a quiet octave-up partial for a bell/music-box character
    const osc = audioCtx.createOscillator();
    const overtone = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const overtoneGain = audioCtx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now);
    overtone.type = 'sine';
    overtone.frequency.setValueAtTime(freq * 2, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.4);

    overtoneGain.gain.setValueAtTime(0.0001, now);
    overtoneGain.gain.exponentialRampToValueAtTime(peak * 0.18, now + 0.012);
    overtoneGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);

    osc.connect(gain);
    overtone.connect(overtoneGain);
    gain.connect(ambientBus);
    overtoneGain.connect(ambientBus);

    osc.start(now);
    osc.stop(now + 1.5);
    overtone.start(now);
    overtone.stop(now + 0.8);
  }

  function stopAmbientDrone() {
    isAmbientPlaying = false;

    if (ambientChordTimer) { clearTimeout(ambientChordTimer); ambientChordTimer = null; }
    if (ambientMelodyTimer) { clearTimeout(ambientMelodyTimer); ambientMelodyTimer = null; }

    const now = audioCtx.currentTime;
    activeChordVoices.forEach(({ osc, gain }) => {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0.0001, now + 1);
      try { osc.stop(now + 1.1); } catch (e) { /* already stopped */ }
    });
    activeChordVoices = [];

    if (ambientBus) {
      const bus = ambientBus;
      bus.gain.cancelScheduledValues(now);
      bus.gain.setValueAtTime(bus.gain.value, now);
      bus.gain.linearRampToValueAtTime(0.0001, now + 1);
      setTimeout(() => bus.disconnect(), 1100);
      ambientBus = null;
    }

    setAmbientButtonState(false);
  }

  document.getElementById('audio-toggle').addEventListener('click', () => {
    if (isAmbientPlaying) stopAmbientDrone();
    else startAmbientDrone();
  });

  function playZenTone(tier, velocity = 1, isMerge = false) {
    initAudio();
    const now = performance.now();

    if (!isMerge) {
      if (now - lastSoundTime < SOUND_COOLDOWN) return;
      if (activeVoices >= MAX_VOICES) return;
    }

    lastSoundTime = now;
    activeVoices++;

    const octave = Math.floor(tier / 5);
    const noteInOctave = tier % 5;
    const semitones = octave * 12 + PENTATONIC_OFFSETS[noteInOctave];
    const frequency = noteFreq(semitones);

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.frequency.setValueAtTime(frequency, audioCtx.currentTime);
    osc.type = 'sine';

    const shakeFactor = isShakingActive ? 0.35 : 1.0;
    const baseVol = isMerge ? 0.22 : Math.min(Math.max(velocity / 12, 0.03), 0.14);
    const finalVol = baseVol * shakeFactor;

    const startTime = audioCtx.currentTime;
    gain.gain.setValueAtTime(0.001, startTime);
    gain.gain.exponentialRampToValueAtTime(finalVol, startTime + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.85);

    osc.connect(gain);
    gain.connect(filterNode);

    osc.onended = () => { activeVoices = Math.max(0, activeVoices - 1); };

    osc.start(startTime);
    osc.stop(startTime + 0.9);
  }

  // A quick upward-pitched "bloop" for clearing marbles off the board — reads
  // as an actual bubble pop rather than a percussive thud.
  function createNoiseBuffer(duration) {
    const length = Math.max(1, Math.floor(audioCtx.sampleRate * duration));
    const buffer = audioCtx.createBuffer(1, length, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function playPopSound(pitch = 1) {
    initAudio();
    const now = audioCtx.currentTime;

    // The "bloop": a sine that rises quickly in pitch under a very fast
    // attack/decay envelope — the core of a bubble-pop sound.
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(500 * pitch, now);
    osc.frequency.exponentialRampToValueAtTime(1500 * pitch, now + 0.035);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.28, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);

    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.1);

    // A tiny high-frequency click right at the onset for a bit of "snap"
    const clickSource = audioCtx.createBufferSource();
    clickSource.buffer = createNoiseBuffer(0.012);
    const clickFilter = audioCtx.createBiquadFilter();
    clickFilter.type = 'highpass';
    clickFilter.frequency.setValueAtTime(4500, now);
    const clickGain = audioCtx.createGain();
    clickGain.gain.setValueAtTime(0.06, now);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.015);

    clickSource.connect(clickFilter);
    clickFilter.connect(clickGain);
    clickGain.connect(audioCtx.destination);
    clickSource.start(now);
    clickSource.stop(now + 0.02);
  }

  function setShaking(value) {
    isShakingActive = value;
  }

  return { initAudio, playZenTone, playPopSound, setShaking };
})();
