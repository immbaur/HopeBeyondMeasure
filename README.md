# Hope Beyond Measure — Web Dashboard

A web dashboard that connects children in need with sponsors. Organizers create and
manage child profiles; visitors browse published profiles — no account needed.
Implements [REQUIREMENTS.md](REQUIREMENTS.md).

## Quick start (local)

Requires Node.js ≥ 22.5 (uses the built-in `node:sqlite`).

```sh
npm install
npm start
```

Open <http://localhost:3000>. On first run you'll be guided to
`/admin/setup` to create the first organizer account. Everything the app stores
(SQLite database + photos) lives in `./data/`.

`npm run dev` starts with auto-reload during development.

## Run with Docker + Cloudflare Tunnel

```sh
docker compose up -d
```

This starts the app on port 3000 **and** a Cloudflare quick tunnel. Find the public
`https://….trycloudflare.com` URL with:

```sh
docker compose logs cloudflared | grep trycloudflare
```

For a **stable URL on your own domain** (e.g. `children.thehopebeyondmeasure.org`),
create a named tunnel in the [Cloudflare Zero Trust dashboard](https://one.dash.cloudflare.com/)
(requires the domain's DNS on Cloudflare), copy its token, and change the
`cloudflared` service in `docker-compose.yml` as noted in the comments there.
HTTPS is provided automatically by Cloudflare.

Without Docker, the same thing works with a locally installed `cloudflared`:

```sh
npm start
cloudflared tunnel --url http://localhost:3000
```

## Organizer guide

- **Create a profile** — “Manage” → “+ New profile”. Only first name and
  region/town are required; a date of birth *or* an age must be given (only the
  age is ever shown publicly).
- **Photos** — upload several at once on the edit page; set a cover photo and
  reorder with the arrow buttons. Photos are resized/compressed automatically and
  **all metadata (EXIF/GPS) is stripped**.
- **Consent & publishing** — a profile can only be published after ticking the
  parent/guardian consent box. New profiles start as **drafts** (invisible to the
  public, previewable by organizers). Unticking consent or clicking
  “Take offline” unpublishes immediately.
- **More organizers** — “Manage” → “Organizers”.
- **Password reset** — via “Forgot your password?” on the login page. If SMTP is
  not configured in `.env`, the reset link is printed to the server console.

## Backups

```sh
npm run backup
```

writes a timestamped `backups/hbm-backup-….tar.gz` containing the database and all
photos. To automate, add a cron entry, e.g. daily at 02:00:
`0 2 * * * cd /path/to/app && sh scripts/backup.sh`. Restoring = extracting the
archive back into `data/`.

## Configuration

All optional — see [.env.example](.env.example) for SMTP (password-reset emails),
`PUBLIC_URL`, `PORT`, and `DATA_DIR`.

## Child safeguarding notes (see REQUIREMENTS.md §6)

Enforced by the app: first-name-only validation, consent required before
publishing, immediate unpublish, EXIF/GPS stripping, age shown instead of date of
birth, and a public privacy page. **Not** automatable: reviewing photos for
identifying background details and keeping locations at region/town level —
the forms remind organizers of both.
