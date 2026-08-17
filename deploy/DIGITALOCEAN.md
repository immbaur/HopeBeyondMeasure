# Deploying Hope Beyond Measure on the existing heyimmi.com Droplet

Hope Beyond Measure runs alongside `heyimmi.com` and `Momentum` on the same
DigitalOcean droplet — they share the box, Caddy, and the domain, but stay
fully isolated: this app is a separate app under its own user and systemd
service, reached through a new `hope.heyimmi.com` subdomain. The other two
are never touched.

Why a droplet (and not App Platform): the app keeps its SQLite database and
uploaded child photos as files under `data/`, which App Platform's ephemeral
filesystem would wipe on every deploy.

The stack after this:

```
                          ┌─> /var/www/heyimmi.com        (static, unchanged)
phone/browser ─HTTPS─> Caddy ─> 127.0.0.1:3000  node server.js (momentum)
  (via Cloudflare)        └─> 127.0.0.1:3002  node server.js (systemd: hopebeyondmeasure)
```

## 0. Prerequisites

- SSH access to the droplet as `root` (IP and key are in
  `heyimmi.com/PRIVATE_INFRA.md` — the same key used for the landing page
  and Momentum can be reused here).
- Two passwords decided in advance: one for visitors to view the children
  dashboard (`SITE_PASSWORD`), one for organizers to manage profiles
  (`ADMIN_PASSWORD`).

All commands below are run as `root` on the droplet unless noted.

## 1. DNS: add the subdomain

In Cloudflare (the domain's DNS host), add a record so `hope.heyimmi.com`
resolves to the droplet:

```text
Type: A
Name: hope
IPv4 address: 178.128.150.117
Proxy status: Proxied   (orange cloud — matches the root domain)
TTL: Auto
```

Proxied is fine: Cloudflare exempts the `/.well-known/acme-challenge/` path
from its HTTPS redirect, so Caddy's HTTP-01 certificate challenge still
works, exactly as it did for the root domain and for `momentum.heyimmi.com`.

## 2. Confirm the port is free

This app binds to `127.0.0.1:3002` (Momentum already uses `:3000`). Check
nothing else is already listening there:

```bash
ss -ltnp | grep 3002 || echo "free"
```

If it's taken, change the port in `deploy/hopebeyondmeasure.service` and
`deploy/hopebeyondmeasure.caddy` before continuing (and in `remote-deploy.sh`'s
health check).

## 3. Install Node and create the app user

Node is already on the box from the Momentum install; skip this if so.

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

adduser --disabled-password --gecos "" hopebeyondmeasure
```

## 4. Install the app

As the `hopebeyondmeasure` user:

```bash
su - hopebeyondmeasure
git clone https://github.com/immbaur/HopeBeyondMeasure.git
cd HopeBeyondMeasure
npm install --omit=dev
exit
```

If the GitHub repo is private, make it public or add a read-only deploy key
on the droplet first.

## 5. Configure secrets

Back as `root`, create `/etc/hopebeyondmeasure.env`:

```bash
cat > /etc/hopebeyondmeasure.env <<'EOF'
SITE_PASSWORD=pick-a-visitor-password
ADMIN_PASSWORD=pick-a-different-organizer-password
EOF
chmod 600 /etc/hopebeyondmeasure.env
```

## 6. Start the service

The systemd unit binds the app to `127.0.0.1:3002`, so it's reachable only
through Caddy — never directly from the internet.

```bash
cp /home/hopebeyondmeasure/HopeBeyondMeasure/deploy/hopebeyondmeasure.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now hopebeyondmeasure
systemctl status hopebeyondmeasure        # should be active (running)
```

## 7. Add the Caddy site block

Caddy already serves the landing page and Momentum from
`/etc/caddy/Caddyfile`. **Append** this app's block — don't replace the
file, or you'll drop the other two sites:

```bash
cat /home/hopebeyondmeasure/HopeBeyondMeasure/deploy/hopebeyondmeasure.caddy >> /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
```

Once DNS has propagated, open `https://hope.heyimmi.com` — Caddy fetches the
certificate on the first request. You'll land on the visitor password gate;
confirm `SITE_PASSWORD` unlocks it, then confirm `/admin/login` accepts
`ADMIN_PASSWORD` and you can reach `/admin/profiles`. Confirm
`https://heyimmi.com` and `https://momentum.heyimmi.com` still load.

## 8. Automated deploys (GitHub Actions)

After the one-time bootstrap above, every push to `main` redeploys
automatically via `.github/workflows/deploy.yml`. Each run SSHes to the
droplet, writes `/etc/hopebeyondmeasure.env` from your GitHub secrets, then
updates the code (`git reset --hard origin/main` + `npm ci --omit=dev`),
refreshes the systemd unit, restarts the service, and health-checks it on
`:3002`. Your `data/` directory is gitignored, so deploys never touch the
database, uploaded photos, or session secret.

### Secrets vs. Variables

Set both passwords in GitHub under **Secrets**, not Variables: repo →
**Settings → Secrets and variables → Actions → Secrets → New repository
secret**. Secrets are encrypted and masked in logs; *Variables* are
plaintext and visible, so they're only for non-sensitive config.

| Secret | Value | Notes |
|---|---|---|
| `DROPLET_HOST` | `178.128.150.117` | Same droplet as the landing page and Momentum |
| `DROPLET_USER` | `root` | Deploy needs root to write `/etc` + restart the service |
| `DROPLET_SSH_KEY` | private deploy key | Reuse the landing-page/Momentum key (`~/.ssh/heyimmi_github_actions_ed25519`) — its public half is already in the droplet's `root` authorized_keys |
| `SITE_PASSWORD` | visitor password | Optional — if unset, the visitor gate is disabled and the dashboard is open to anyone with the link |
| `ADMIN_PASSWORD` | organizer password | Required — the deploy fails without it, and `/admin` is unreachable without it |

Because the workflow rewrites `/etc/hopebeyondmeasure.env` on every deploy,
**GitHub is the single source of truth** for these values — don't hand-edit
the file on the droplet, it'll be overwritten. To rotate a password, change
the GitHub secret and re-run the workflow (Actions → Deploy Hope Beyond
Measure → Run workflow); the restart logs out all existing sessions.

If you'd rather keep secrets only on the droplet, delete the "Sync secrets"
step from the workflow and manage `/etc/hopebeyondmeasure.env` by hand
(step 5).

## 9. Day-to-day

**Logs**

```bash
journalctl -u hopebeyondmeasure -f
```

**Deploying app updates** — just push to `main`; GitHub Actions (section 8)
does it. To deploy by hand instead (e.g. Actions is down):

```bash
su - hopebeyondmeasure -c 'cd HopeBeyondMeasure && git pull && npm install --omit=dev'
systemctl restart hopebeyondmeasure
```

**Backing up your data** — everything that matters is `data/` (SQLite
database, uploaded photos, session secret). Pull a copy occasionally:

```bash
rsync -a hopebeyondmeasure@178.128.150.117:HopeBeyondMeasure/data/ ~/hopebeyondmeasure-data-backup/
```

Or run `npm run backup` on the droplet itself to produce a
`backups/hbm-backup-*.tar.gz` (see `scripts/backup.sh`) and pull that
instead.

**Changing a password** — update the `SITE_PASSWORD` or `ADMIN_PASSWORD`
GitHub secret and re-run the Deploy workflow (this rewrites
`/etc/hopebeyondmeasure.env` and restarts, logging out all sessions). Only
hand-edit `/etc/hopebeyondmeasure.env` if you removed the secrets step from
the workflow.
