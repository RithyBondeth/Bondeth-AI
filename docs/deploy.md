# Deploying to production

One Docker host runs everything: Caddy (HTTPS), the Next.js studio, the FastAPI backend,
PostgreSQL and Redis. Caddy is the only service reachable from the internet. For splitting
workers or adding API replicas, see [operations](operations.md).

## 1. Server

| | CPU-only | GPU (recommended) |
| --- | --- | --- |
| Machine | 8+ cores, 16 GB RAM | NVIDIA GPU with 16 GB VRAM (e.g. T4, L4), 16 GB RAM |
| Disk | 60 GB SSD (models ~6 GB, images, audio library, backups) | same |
| Expect | One transcription at a time; live dictation shows text after each pause | Near real-time dictation; VoxCPM2 available |

- Ubuntu 24.04 LTS (or any Linux with Docker Engine and Compose 2.24.4+).
- GPU servers also need the NVIDIA driver and the NVIDIA Container Toolkit.
- Firewall: allow only SSH, 80 and 443 (`ufw allow OpenSSH 80/tcp 443/tcp 443/udp`).
  PostgreSQL and Redis listen on 127.0.0.1 only; the backend and frontend are not published at all.

## 2. DNS and email

1. Point an `A` (and `AAAA`, if the server has IPv6) record for your domain at the server.
   Caddy gets the certificate on first start, so DNS must resolve before step 4.
2. Pick an SMTP relay (Resend, Amazon SES, Postmark…) and verify your sending domain.
   Add the SPF and DKIM records the provider gives you, plus a DMARC record
   (`_dmarc` TXT `v=DMARC1; p=none; rua=mailto:you@yourdomain`). Without them,
   verification and password-reset emails land in spam and users can't finish sign-up.

## 3. Configuration

```bash
git clone https://github.com/RithyBondeth/Bondeth-AI.git /srv/bondeth-ai
cd /srv/bondeth-ai
cp .env.production.example .env
chmod 600 .env
```

Fill in every `REQUIRED` value. Generate secrets with
`python3 -c "import secrets; print(secrets.token_urlsafe(48))"`. Set `POSTGRES_PASSWORD`
before the first start: PostgreSQL only reads it when its volume is created.

With `BONDETH_ENV=production`, the backend refuses to start (and says why) while the
JWT secret, database password, public URL, CORS origin or SMTP settings are still
development values.

## 4. Start

```bash
# CPU
docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile app up -d --build
# GPU
docker compose -f docker-compose.yml -f docker-compose.gpu.yml -f docker-compose.prod.yml --profile app up -d --build
```

`docker-compose.prod.yml` must be the last file. The first start downloads about 6 GB of
models; follow it with `docker compose logs -f backend` until `Application startup complete`.
Migrations run automatically (`migrate` service) on every start.

## 5. Verify

From your own computer (with the backend's virtualenv, see the README):

```bash
cd backend && .venv/bin/python -m scripts.smoke_prod https://your-domain
```

It checks health, production mode, security headers, HTTPS redirect, English and Khmer
speech, and a transcription round trip. Then, in a browser: register, confirm the email
(check it arrives in the inbox, not spam), record a short clip, and read
`/privacy` and `/terms` once more.

## 6. Backups

```bash
COMPOSE_FILES="-f docker-compose.yml -f docker-compose.prod.yml" deploy/backup.sh
```

Writes `backups/<timestamp>/` with a PostgreSQL dump, the data volume (voices, audio
library, recordings) and Redis, plus checksums, and keeps the newest 14. Schedule it
daily with `crontab -e`:

```cron
15 3 * * * cd /srv/bondeth-ai && COMPOSE_FILES="-f docker-compose.yml -f docker-compose.prod.yml" deploy/backup.sh >> backups/backup.log 2>&1
```

Copy `backups/` off the server too (e.g. `rclone sync backups remote:bondeth-backups`
in the same cron line): a backup on the same disk doesn't survive losing the server.

**Restore drill:** before launch, and every few months, restore the latest backup on a
spare machine with the same `.env`:

```bash
COMPOSE_FILES="-f docker-compose.yml -f docker-compose.prod.yml" deploy/restore.sh backups/<timestamp>
```

It verifies checksums, asks for confirmation, stops the app, replaces the database, data
volume and Redis, and leaves you to start the app again.

## 7. Monitoring

- **Uptime:** point an external monitor (UptimeRobot, Better Stack…) at
  `https://your-domain/api/v1/health` and alert unless it returns 200 with `"status":"ok"`.
- **Errors:** set `BONDETH_SENTRY_DSN` (sentry.io or self-hosted) and restart. API and worker
  exceptions are reported without request bodies, local variables or user details.
- **Disk:** the audio library and backups grow; alert at 80% (`df -h`).

## 8. Capacity

On a GPU, measure before launch: `deploy/gpu/run-eval.sh` reports dictation latency and
generation speed (see [deploy/gpu/README.md](../deploy/gpu/README.md)). On CPU, set
`BONDETH_STT_LIVE_PARTIALS=false`. The default limits (10 requests/min per tool
signed out, daily allowances) protect the server; lower `BONDETH_QUOTA_*` if it falls behind.

## 9. Updates

```bash
cd /srv/bondeth-ai
COMPOSE_FILES="-f docker-compose.yml -f docker-compose.prod.yml" deploy/backup.sh
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile app up -d --build
```

Then run the smoke test again. To roll back, check out the previous commit and run the same
`up` command; restore a backup only if a migration damaged data.

## Before you charge money

- Switch both engines to VoxCPM2 (`BONDETH_TTS_ENGINE=voxcpm`, `BONDETH_CLONE_ENGINE=voxcpm`,
  GPU image). MMS and OmniVoice weights are non-commercial; billing refuses to start without this.
- Have the privacy policy and terms reviewed for paid service, and set up
  [Stripe](billing.md).
