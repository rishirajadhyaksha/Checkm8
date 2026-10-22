# Checkm8 — project notes

Online chess web app. React/Vite/Tailwind frontend + Express/Socket.IO backend, dependency-free JSON-file storage (`server/src/db.js`), Stockfish UCI engine with minimax fallback.

## Deployment

- Hosted on AWS Lightsail (Ubuntu 22.04 instance "CheckM8-Server", 54.167.176.166). nginx reverse-proxies/serves static files from `/var/www/html`, pm2 runs the Node backend, Let's Encrypt/Certbot certs cover checkm8.club and api.checkm8.club.
- No SSH key and no file-upload UI are set up for this instance — the only access path is the Lightsail browser-based SSH terminal (console.aws.amazon.com). That terminal opens in a page-triggered popup that browser-automation tools cannot type/click into directly, so commands have to be composed and handed to a human to paste, with output read back via screenshot.
- To get local file changes onto the server: tar + gzip the changed files, base64-encode, split into ~4000-char chunks, and paste each chunk via a plain `echo -n '<chunk>' >> file.b64` (avoid heredocs for the transfer itself — a large single heredoc paste can get stuck on the closing delimiter mid-transfer). Then `base64 -d file.b64 > file.tar.gz` and `tar xzf` on the server, verifying the chunk count/byte size matches before decoding.
- Frontend deploy steps once source is updated on the server: `cd frontend && npm run build`, back up `/var/www/html`, `cp -r dist/* /var/www/html/`, `sudo nginx -t && sudo systemctl reload nginx`, then verify with `curl -o /dev/null -w "%{http_code}" <url>` against a few deep (client-side-routed) URLs.

## Known gotchas

- **SPA routing 404 on refresh**: nginx's `try_files` directive in `/etc/nginx/sites-available/default` must be `try_files $uri $uri/ /index.html;` (fallback to index.html), not `=404`. A Certbot-duplicated default-site config previously had `=404` in three places, causing any client-side route (e.g. `/lobby`, `/game/xyz`) to 404 on a hard refresh. This is a server/nginx config issue, not DNS/Namecheap.
- `frontend/dist` is not auto-served — nginx's root points at `/var/www/html`, so a fresh build must be manually copied there after every frontend change (or nginx's root could be repointed straight at `frontend/dist` to skip this step — not yet done).

## Design system (as of Sept 2026 redesign)

Chess-themed palette applied via `tailwind.config.js`: `ink` (near-black warm background), `brass` (gold accent), `ember` (red, used for danger/loss states), `board`/`parchment` (chessboard tones). Display type is Fraunces (serif) paired with the existing sans/mono UI fonts. Cards use a corner-tick "scorecard" frame (`.tick-frame` in `index.css`) rather than generic drop-shadow cards. Styling lives in `tailwind.config.js`, `src/index.css`, `index.html`, and per-page/component files (`App.jsx`, `AppShell.jsx`, `Landing.jsx`, `Lobby.jsx`, `GameRoom.jsx`, `History.jsx`) — game/auth logic in those files is unrelated to styling and should be left alone when doing visual work.
