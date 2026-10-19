// Tiny wish API, no dependencies. Caddy forwards /api/* here (after the family login).
//   POST /api/me    {name, code}        -> own wish, plus the drawn person's wish after the deadline
//   POST /api/wish  {name, code, wish}  -> save own wish (only before the deadline)
// /data/people.json comes from generate.mjs; /data/wishes.json is written here.
import { createServer } from 'node:http';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { createHash, timingSafeEqual } from 'node:crypto';

const DATA = process.env.DATA_DIR || '/data';
const PEOPLE = `${DATA}/people.json`;
const WISHES = `${DATA}/wishes.json`;
// Wishes can be edited until this moment; afterwards each Wichtel sees their person's wish.
const DEADLINE = new Date(`${process.env.WISH_DEADLINE || `${new Date().getFullYear()}-12-01`}T00:00:00`);
const MAX_WISH = 1000;

const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {});
// Must match normalize() in index.html and generate.mjs, and the hash in writePeople().
const normalize = (code) => String(code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const hash = (salt, code) => createHash('sha256').update(salt + normalize(code)).digest();

function verify(name, code) {
  const people = readJson(PEOPLE);
  if (typeof name !== 'string' || !Object.hasOwn(people, name)) return null;
  const person = people[name];
  return timingSafeEqual(hash(person.salt, code), Buffer.from(person.codeHash, 'hex')) ? person : null;
}

function saveWishes(wishes) {
  writeFileSync(`${WISHES}.tmp`, JSON.stringify(wishes, null, 2) + '\n');
  renameSync(`${WISHES}.tmp`, WISHES);
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16_000) throw new Error('body too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

createServer(async (req, res) => {
  try {
    if (req.method !== 'POST' || !['/api/me', '/api/wish'].includes(req.url)) return send(res, 404, { error: 'not found' });
    const body = await readBody(req);
    const person = verify(body.name, body.code);
    if (!person) {
      await new Promise((resolve) => setTimeout(resolve, 500)); // slow down guessing
      return send(res, 401, { error: 'wrong code' });
    }
    const open = Date.now() < DEADLINE;
    const wishes = readJson(WISHES);
    if (req.url === '/api/wish') {
      if (!open) return send(res, 403, { error: 'closed' });
      wishes[body.name] = String(body.wish ?? '').trim().slice(0, MAX_WISH);
      saveWishes(wishes);
    }
    send(res, 200, {
      deadline: DEADLINE.toISOString(),
      open,
      wish: wishes[body.name] || '',
      recipientWish: open ? null : wishes[person.recipient] || '',
    });
  } catch (err) {
    console.error(err);
    send(res, 400, { error: 'bad request' });
  }
}).listen(3000, () => console.log(`Wish API on :3000, deadline ${DEADLINE.toString()}`));
