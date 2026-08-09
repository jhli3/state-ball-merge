const fs = require('fs');
const path = require('path');
const https = require('https');

// Array of all 50 states in order from smallest to largest
const STATES = [
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

// Direct clean SVG source mapping from Wikimedia Commons
const WIKI_SLUGS = {
  "Rhode Island": "Flag_of_Rhode_Island.svg",
  "Delaware": "Flag_of_Delaware.svg",
  "Connecticut": "Flag_of_Connecticut.svg",
  "New Jersey": "Flag_of_New_Jersey.svg",
  "New Hampshire": "Flag_of_New_Hampshire.svg",
  "Vermont": "Flag_of_Vermont.svg",
  "Massachusetts": "Flag_of_Massachusetts.svg",
  "Hawaii": "Flag_of_Hawaii.svg",
  "Maryland": "Flag_of_Maryland.svg",
  "West Virginia": "Flag_of_West_Virginia.svg",
  "South Carolina": "Flag_of_South_Carolina.svg",
  "Maine": "Flag_of_Maine.svg",
  "Indiana": "Flag_of_Indiana.svg",
  "Kentucky": "Flag_of_Kentucky.svg",
  "Tennessee": "Flag_of_Tennessee.svg",
  "Virginia": "Flag_of_Virginia.svg",
  "Ohio": "Flag_of_Ohio.svg",
  "Pennsylvania": "Flag_of_Pennsylvania.svg",
  "Mississippi": "Flag_of_Mississippi.svg",
  "Louisiana": "Flag_of_Louisiana.svg",
  "Alabama": "Flag_of_Alabama.svg",
  "Arkansas": "Flag_of_Arkansas.svg",
  "North Carolina": "Flag_of_North_Carolina.svg",
  "New York": "Flag_of_New_York_%28state%29.svg",
  "Iowa": "Flag_of_Iowa.svg",
  "Illinois": "Flag_of_Illinois.svg",
  "Wisconsin": "Flag_of_Wisconsin.svg",
  "Florida": "Flag_of_Florida.svg",
  "Missouri": "Flag_of_Missouri.svg",
  "Oklahoma": "Flag_of_Oklahoma.svg",
  "Washington": "Flag_of_Washington_%28state%29.svg",
  "Georgia": "Flag_of_Georgia_%28U.S._state%29.svg",
  "Michigan": "Flag_of_Michigan.svg",
  "North Dakota": "Flag_of_North_Dakota.svg",
  "South Dakota": "Flag_of_South_Dakota.svg",
  "Nebraska": "Flag_of_Nebraska.svg",
  "Kansas": "Flag_of_Kansas.svg",
  "Idaho": "Flag_of_Idaho.svg",
  "Utah": "Flag_of_Utah.svg",
  "Minnesota": "Flag_of_Minnesota.svg",
  "Wyoming": "Flag_of_Wyoming.svg",
  "Oregon": "Flag_of_Oregon.svg",
  "Colorado": "Flag_of_Colorado.svg",
  "Nevada": "Flag_of_Nevada.svg",
  "Arizona": "Flag_of_Arizona.svg",
  "New Mexico": "Flag_of_New_Mexico.svg",
  "Montana": "Flag_of_Montana.svg",
  "California": "Flag_of_California.svg",
  "Texas": "Flag_of_Texas.svg",
  "Alaska": "Flag_of_Alaska.svg"
};

const assetsDir = path.join(__dirname, 'assets');
const TOTAL = STATES.length;
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 400; // delay between requests, to stay polite to Wikimedia
const RETRY_BASE_MS = 1000; // backoff base for retries after a 429/5xx

// Create /assets directory if it doesn't exist
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir);
}

function normalizeName(state) {
  return state.toLowerCase().replace(/ /g, '_');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Fetches a URL following redirects, resolving with { statusCode, body } or rejecting on network error.
function fetch(targetUrl, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 5) return reject(new Error('Too many redirects'));

    https.get(targetUrl, { headers: { 'User-Agent': 'ZenMarbleMerger/1.0 (educational project; contact: n/a)' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(fetch(res.headers.location, depth + 1));
      }

      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ statusCode: res.statusCode, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

// Downloads one state's flag, retrying with backoff on rate limits / transient errors.
async function downloadSVG(state) {
  const slug = WIKI_SLUGS[state];
  const fileName = `${normalizeName(state)}.svg`;
  const filePath = path.join(assetsDir, fileName);
  const url = `https://commons.wikimedia.org/wiki/Special:FilePath/${slug}`;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { statusCode, body } = await fetch(url);

      if (statusCode === 429 || statusCode === 503) {
        if (attempt === MAX_RETRIES) {
          return { state, ok: false, reason: `rate limited (HTTP ${statusCode}) after ${MAX_RETRIES} retries` };
        }
        const backoff = RETRY_BASE_MS * Math.pow(2, attempt) + Math.floor(Math.random() * 300);
        console.log(`   ⏳ ${state}: HTTP ${statusCode}, retrying in ${(backoff / 1000).toFixed(1)}s (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await sleep(backoff);
        continue;
      }

      if (statusCode !== 200) {
        return { state, ok: false, reason: `HTTP ${statusCode}` };
      }

      const text = body.slice(0, 200).toString('utf8').trimStart();
      if (!text.startsWith('<?xml') && !text.startsWith('<svg')) {
        return { state, ok: false, reason: 'response was not an SVG (unexpected content)' };
      }

      fs.writeFileSync(filePath, body);
      return { state, ok: true, fileName };
    } catch (err) {
      if (attempt === MAX_RETRIES) {
        return { state, ok: false, reason: err.message };
      }
      const backoff = RETRY_BASE_MS * Math.pow(2, attempt);
      console.log(`   ⏳ ${state}: ${err.message}, retrying in ${(backoff / 1000).toFixed(1)}s (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await sleep(backoff);
    }
  }
}

async function run() {
  const alreadyDownloaded = new Set(
    fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir).filter((f) => f.endsWith('.svg')) : []
  );

  const skipped = [];
  const toFetch = STATES.filter((state) => {
    const fileName = `${normalizeName(state)}.svg`;
    if (alreadyDownloaded.has(fileName)) {
      skipped.push(state);
      return false;
    }
    return true;
  });

  console.log(`Found ${skipped.length}/${TOTAL} flags already in /assets — skipping those.`);
  console.log(`Downloading ${toFetch.length} remaining flag(s)...\n`);

  const succeeded = [];
  const failed = [];

  for (let i = 0; i < toFetch.length; i++) {
    const state = toFetch[i];
    const progress = `(${i + 1}/${toFetch.length})`;
    const result = await downloadSVG(state);

    if (result.ok) {
      succeeded.push(result.state);
      console.log(`✅ ${progress} ${result.fileName}`);
    } else {
      failed.push({ state: result.state, reason: result.reason });
      console.error(`❌ ${progress} ${state}: ${result.reason}`);
    }

    if (i < toFetch.length - 1) {
      await sleep(BASE_DELAY_MS);
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Already had: ${skipped.length}`);
  console.log(`Downloaded:  ${succeeded.length}`);
  console.log(`Failed:      ${failed.length}`);
  if (failed.length) {
    console.log('\nFailed states (re-run this script to retry just these):');
    failed.forEach((f) => console.log(`  - ${f.state}: ${f.reason}`));
  }

  const totalHave = skipped.length + succeeded.length;
  if (totalHave === TOTAL) {
    console.log(`\n🎉 All ${TOTAL} state flag SVGs are present in /assets.`);
  } else {
    console.log(`\n${totalHave}/${TOTAL} flags in /assets. Run again to retry the ${TOTAL - totalHave} missing.`);
  }
}

run();
