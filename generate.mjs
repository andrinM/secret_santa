// Draws Secret Santa pairs and writes data.js with each result encrypted
// under that person's personal code, plus photos.js listing images/ and
// data/people.json (code hashes + who drew whom) for the wish server.
// Run: node generate.mjs          first run: draw + photos; later: photos + people.json only
//      node generate.mjs --force  new draw (old codes stop working)
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomInt, randomBytes, webcrypto } from 'node:crypto';

// ---- Edit these -----------------------------------------------------------
const FAMILY = ['Andrin', 'Bea', 'Julia', 'Peter', 'Tom'];
// Pairs that must not draw each other (both directions), e.g. couples.
const EXCLUDE = [
  // ['Mom', 'Dad'],
];
// ---------------------------------------------------------------------------

const ITERATIONS = 250_000;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

const blocked = (giver, receiver) =>
  giver === receiver ||
  EXCLUDE.some(([a, b]) => (a === giver && b === receiver) || (a === receiver && b === giver));

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function draw() {
  for (let attempt = 0; attempt < 10_000; attempt++) {
    const receivers = shuffle([...FAMILY]);
    if (FAMILY.every((giver, i) => !blocked(giver, receivers[i]))) {
      return Object.fromEntries(FAMILY.map((giver, i) => [giver, receivers[i]]));
    }
  }
  throw new Error('No valid draw possible with these exclusions.');
}

const makeCode = () => {
  const chars = Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
};

// Must match normalize() in index.html.
const normalize = (code) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');
const b64 = (bytes) => Buffer.from(bytes).toString('base64');

async function encrypt(text, code) {
  const { subtle } = webcrypto;
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const base = await subtle.importKey('raw', new TextEncoder().encode(normalize(code)), 'PBKDF2', false, ['deriveKey']);
  const key = await subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
  return { salt: b64(salt), iv: b64(iv), ct: b64(new Uint8Array(ct)) };
}

async function decrypt(entry, code, iterations) {
  const { subtle } = webcrypto;
  const salt = Buffer.from(entry.salt, 'base64');
  const base = await subtle.importKey('raw', new TextEncoder().encode(normalize(code)), 'PBKDF2', false, ['deriveKey']);
  const key = await subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(entry.iv, 'base64') }, key, Buffer.from(entry.ct, 'base64'));
  return new TextDecoder().decode(pt);
}

// Must match hash() in server.mjs.
function writePeople(codes, pairs) {
  const people = {};
  for (const [name, code] of Object.entries(codes)) {
    const salt = randomBytes(16).toString('hex');
    const codeHash = createHash('sha256').update(salt + normalize(code)).digest('hex');
    people[name] = { salt, codeHash, recipient: pairs[name] };
  }
  if (!existsSync('data')) mkdirSync('data');
  writeFileSync('data/people.json', JSON.stringify(people, null, 2) + '\n');
  console.log('data/people.json written (upload it to the NAS, never to GitHub).');
}

function listPhotos() {
  if (!existsSync('images')) mkdirSync('images');
  return readdirSync('images', { withFileTypes: true })
    .filter((f) => f.isFile() && /\.(jpe?g|png|webp|gif|avif)$/i.test(f.name))
    .map((f) => f.name)
    .sort()
    .map((name) => `images/${encodeURIComponent(name)}`); // spaces etc. in WhatsApp file names
}

const photos = listPhotos();
writeFileSync('photos.js', `window.PHOTOS = ${JSON.stringify(photos, null, 2)};\n`);
console.log(`photos.js updated: ${photos.length} photo(s) found in images/.`);

if (existsSync('data.js') && !process.argv.includes('--force')) {
  console.log('data.js already exists, keeping the current draw. Use --force for a new one.');
  if (existsSync('codes.txt')) {
    // Rebuild people.json from the existing draw so the codes already handed out keep working.
    const data = JSON.parse(readFileSync('data.js', 'utf8').replace(/^window\.SANTA = /, '').replace(/;\s*$/, ''));
    const codes = Object.fromEntries(
      readFileSync('codes.txt', 'utf8').trim().split(/\r?\n/).map((line) => line.match(/^(.*?)\s+(\S+)$/).slice(1)),
    );
    const pairs = {};
    for (const [name, code] of Object.entries(codes)) pairs[name] = await decrypt(data.entries[name], code, data.iterations);
    writePeople(codes, pairs);
  }
  process.exit(0);
}

const pairs = draw();
const codes = {};
const entries = {};
for (const giver of FAMILY) {
  codes[giver] = makeCode();
  entries[giver] = await encrypt(pairs[giver], codes[giver]);
}

const data = { iterations: ITERATIONS, entries };
writeFileSync('data.js', `window.SANTA = ${JSON.stringify(data, null, 2)};\n`);

const lines = FAMILY.map((name) => `${name.padEnd(16)} ${codes[name]}`);
writeFileSync('codes.txt', lines.join('\n') + '\n');
writePeople(codes, pairs);

console.log('\nNew draw done.\n');
console.log('Send each person ONLY their own code:\n');
console.log(lines.join('\n'));
console.log('\n(Also saved to codes.txt. Do not upload that file.)');
