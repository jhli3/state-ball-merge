# State Ball Merge

A zen little merge game: drop balls, merge two of the same U.S. state together, and watch them grow into the next-biggest state — all the way up to the largest one you've selected.

Built as a static site (plain HTML/CSS/JS, no build step, no dependencies to install).

## Running it

Play it live: **https://jhli3.github.io/state-ball-merge/**

Or run it locally — it's a static site, so just open `index.html` directly in a browser, or serve the folder however you like.

## How to play

- **Aim**: mouse, or `←` / `→`
- **Drop**: click, or `Shift` — hold either one down to drop in a stream that gradually speeds up
- **Shake**: `Space`, or the Shake Container button — nudges everything to help stuck balls settle
- **Restart**: `R`, or the Restart button

Merge two balls of the same state and they combine into the next-largest state. Reach the largest state in your set and you'll get a success screen — merging two of the biggest ball keeps working past that point too, just growing it a little bigger each time instead of upgrading further.

## Features

- **Choose States** — pick any subset of the 50 states to play with (or use a region preset: Northeast, Midwest, South, West). Click-and-drag across the picker to bulk select/deselect.
- **Discovered chart** — a sidebar grid tracking every state you've unlocked so far. Click a discovered state to clear all of its balls off the board.
- **Scoring** — points for every merge (bigger merges are worth a lot more), with your session score and all-time best both on screen.
- **Leaderboard** — tracks your top 5 scores across completed runs, locally in `localStorage`. A run's score is banked to the board whenever you restart.
- **Progress saves automatically** — your board, score, and discovered states persist in `localStorage`, so a reload picks up right where you left off.
- **Ambient audio** — an optional generative background of soft chord pads and a wandering bell melody, in the same pentatonic scale as the merge/drop sound effects.

## Tech

- [Matter.js](https://brm.io/matter-js/) for the physics
- Canvas 2D for rendering (state flag SVGs clipped into circles)
- Web Audio API for all sound — no audio files, everything is synthesized

## Files

- `index.html` — markup only
- `css/styles.css` — all styles
- `js/` — game logic, one file per concern, loaded in this order:
  - `state.js` — the shared `Game.state` object (the only state modules pass between each other)
  - `config.js` — master state list, region presets, tier construction
  - `scoring.js` — points, high-score, and leaderboard persistence
  - `audio.js` — the synthesized sound effects and ambient music
  - `physics.js` — Matter.js engine/renderer/walls, marble spawning
  - `chart.js` — the "Discovered" sidebar
  - `game.js` — drop/merge rules, save/load, reset
  - `input.js` — mouse, keyboard, hold-to-stream, gamepad
  - `render.js` — canvas drawing (ghost marble, flag art, glass highlight)
  - `ui.js` — Choose States modal, success screen, how-to modal, viewport scaling
  - `main.js` — boots the game once everything above is loaded
- `assets/` — SVG flag/outline images for each state
- `download-flags.js` — one-off script used to fetch the assets

Each `js/` file attaches its public functions to a shared `Game` namespace (e.g. `Game.audio`, `Game.core`) instead of using bare globals, so it's a clear seam to extend — a `Game.net` module for multiplayer, for instance, would slot in the same way. Everything loads as plain `<script>` tags (no ES modules, no bundler), so `index.html` still opens directly from disk.
