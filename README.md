# Secret Santa 🎅

A one-page Secret Santa site for the family. Each person picks their name, enters their
personal code and sees who they're buying for. The result is encrypted in the browser
with that code, so nobody can see someone else's result.

## 1. Set up

1. Edit `FAMILY` (and optionally `EXCLUDE`) at the top of `generate.mjs`.
2. Photos for the reveal (resize them first, ~1000px is plenty). They are shown one at a time, first
   0.5 s each, then a second, faster round that ends on the drawn person:
   - `images/people/<Name>.jpg`: one portrait per person, named exactly like in `FAMILY`
     (`.jpeg`, `.png` and `.webp` work too). The reveal always ends on the drawn person's portrait.
   - `images/`: any extra photos, mixed in.
3. Edit the rules (budget, date) in `index.html`.

## 2. Draw

```sh
node generate.mjs
```

This writes `data/people.json` (what the server needs), `photos.js`, plus `data.js` and `codes.txt`
(local only) and prints one code per person. Send each person only their own code (WhatsApp, Signal,
etc.). Running it again only refreshes the photo list and `people.json`. `--force` makes a brand-new
draw, and every old code stops working.

The page needs the server, so test it with `docker compose up -d` and http://localhost:8088.

## 3. Deploy (Synology, Container Manager)

The container (Caddy) serves the cloned repo folder on port 8088 behind a password. DSM's reverse
proxy adds HTTPS in front, like the other projects.

Everything happens in the DSM web UI, no SSH needed. The repo must be public on GitHub.

**Once:**

1. Package Center: install **Git Server** (it only provides the `git` command, no setup needed).
2. Control Panel → Task Scheduler → Create → Scheduled Task → User-defined script:
   - General: name `secret-santa update`, user **root**, untick **Enabled** (it runs only when you click Run).
   - Task Settings → Run command:
     ```sh
     export PATH="$PATH:/var/packages/Git/target/bin:/usr/local/bin"
     REPO=/volume1/docker/secret_santa
     LOG=/volume1/docker/secret_santa-update.log
     {
       date
       if [ -d "$REPO/.git" ]; then
         git -C "$REPO" -c safe.directory="$REPO" pull --ff-only
       else
         git clone https://github.com/andrinM/secret_santa.git "$REPO"
       fi
     } > "$LOG" 2>&1
     ```
   - Select the task → **Run**. The first run clones, every later run pulls. Check
     `docker/secret_santa-update.log` in File Station.
3. On the laptop, create `.env`: copy `.env.example`, then paste the output of
   `docker run --rm caddy:2.8.4-alpine caddy hash-password --plaintext 'your-family-password'`
   into `SANTA_HASH`, keeping the single quotes.
4. File Station: upload `.env`, `images/` and `photos.js` from your laptop into
   `docker/secret_santa/`, and `people.json` into `docker/secret_santa/data/`. **Never upload `codes.txt`.**
5. Container Manager → Project → Create: path `/docker/secret_santa`, use the existing
   `docker-compose.yml`, then start it.
6. Control Panel → Login Portal → Advanced → Reverse Proxy → Create:
   - Source: `HTTPS`, host `santa.tomcat77.synology.me`, port `443`
   - Destination: `HTTP`, `localhost`, port `8088`
7. Control Panel → Security → Certificate → Settings: check that `santa.tomcat77.synology.me` uses
   the `*.tomcat77.synology.me` certificate.

**Updates:**

- Code changed: push from the laptop, then Task Scheduler → `secret-santa update` → **Run**.
  If the `Caddyfile` changed, restart the project in Container Manager as well.
- New photos: put them in `images/` on the laptop, run `node generate.mjs` (only the photo list
  changes), then upload the new photos plus `photos.js`.

## Wishes

The site has two phases, switched by `WISH_DEADLINE` (in `.env`, default 1 December, 00:00 Swiss time):

- **Before the deadline:** logging in (name + code) opens the wish page. Everyone writes and edits
  their own wish. Nothing about the draw is shown.
- **From the deadline:** the same login starts the picture reveal, then shows who you drew and their wish.

The draw only leaves the server after the deadline (`data.js` is not served), so nobody can peek early.

- A small Node server (`server.mjs`, second container `secret-santa-api`) stores the wishes in
  `data/wishes.json`. Caddy forwards `/api/*` to it, behind the same family login.
- The server checks codes against `data/people.json`, which `node generate.mjs` writes (code hashes plus
  who drew whom). Upload it to `docker/secret_santa/data/` on the NAS. **Never put it on GitHub.**
- Re-running `node generate.mjs` without `--force` rebuilds `people.json` from `codes.txt` and `data.js`,
  so codes already handed out keep working.
- Changing the deadline: edit `WISH_DEADLINE` in `.env` on the NAS, then restart the project.
- The wishes only work through the server. If you open `index.html` as a local file, the wish box doesn't appear.

## Privacy

- The whole site, including photos, sits behind one shared username and password.
- `images/`, `data/`, `data.js`, `photos.js`, `codes.txt` and `.env` are git-ignored, so they never end up on GitHub.
- The server returns 404 for repo files such as `.git/`, `.env`, `data/`, `codes.txt` and `generate.mjs`.
- `data/people.json` contains who drew whom (in plain text), so you could look it up on the NAS. Like `codes.txt`, don't.
- `noindex` headers and `robots.txt` keep search engines out.
- As the organizer you have every code in `codes.txt`, so you *could* peek. Don't. 🙃
