# Production operations

## Deployment choices

The original single-process Compose deployment remains supported. To run queues in
a separate process on the same Docker host, use Docker Compose 2.24.4+:

```sh
docker compose -f docker-compose.yml -f docker-compose.workers.yml --profile app up -d --build
```

The API disables embedded workers and queue-model preloading; the worker owns both
queues. All share `backend-data:/app/data` and the model cache. The split API publishes
an allocated localhost port to avoid conflicts when adding replicas. Use
`docker compose -f docker-compose.yml -f docker-compose.workers.yml port backend 8000`
to discover it. Set `PUBLIC_API_URL` to the address exposed by your reverse proxy.

To add an API replica, append `--scale backend=2` to the `up` command. Configure your
reverse proxy/service discovery to target both instances. There is deliberately one
worker per queue: a second worker fails its ownership lock before recovering jobs.
Do not unlink `.clone_jobs.worker.lock` or `.stt_jobs.worker.lock` while workers run.

GPU split deployment needs the worker-specific override last:

```sh
docker compose -f docker-compose.yml -f docker-compose.gpu.yml \
  -f docker-compose.workers.yml -f docker-compose.workers.gpu.yml \
  --profile app up -d --build
```

Both API inference and workers can use the GPU. Measure total VRAM before increasing
replicas; worker separation does not make direct inference memory-free. Cross-host
storage, object storage, and multiple queue consumers need further architecture work.

## Release procedure

1. Back up PostgreSQL and the persistent voice data volume. Check free disk space and
   the configured speech engines before enabling billing.
2. Stop the previous release's queue workers and let in-flight jobs finish where
   possible. This release changes queue ownership; do not overlap legacy workers
   that do not participate in the file lock with the new workers.
3. Run `alembic upgrade head` in a one-shot migration container before starting APIs
   and workers. Compose's `migrate` service does this automatically for fresh startup;
   for a subsequent release explicitly rerun it if the old container already exited.
4. Start the new API/worker services. Verify `/api/v1/health` returns HTTP 200, worker
   health is ready, and a fake/test audio job completes and saves history.
5. Verify SMTP sends to the intended host and public email/Stripe return links use
   the HTTPS frontend URL. Configure proxy timeouts for SSE and WebSockets, disable
   buffering for STT events, and trust forwarded IPs only from your proxy.
6. For billing, complete the test-mode procedure in [billing.md](billing.md).

Health returns HTTP 503 when PostgreSQL or Redis is unavailable. The standalone
worker refreshes a Redis heartbeat while its queue threads are alive; its container
health check fails after the heartbeat expires. Health is process/dependency
readiness, not proof a GPU inference call has completed successfully. Docker does
not automatically restart an otherwise running container solely because it is unhealthy.

The worker gets a two-minute stop grace period. Slow inference keeps ownership until
it exits; a forced kill leaves the job in Redis processing for restart recovery.
Do not run another owner with a different, unshared data directory against the same
Redis queue. Redis AOF, job/audio volumes, and matching paths are all required for recovery.

## Backups and rollback

PostgreSQL is the durable account/history/subscription/metering store. Back it up and
test restores. Back up saved voice WAV files with their database metadata and consent
timestamps. Model caches are replaceable; saved reference voices are not. Preserve
Redis AOF for queue/auth/quota recovery. Losing Redis can invalidate sessions and
lose pending jobs; a PostgreSQL backup alone does not restore them.

The new migration adds nullable subscription columns, job-history identity and event
receipts. The schema is additive; roll back application code before considering a
schema downgrade. Stop worker owners first and ensure there are no pending billing
events before downgrading. A downgrade discards subscription state and webhook receipts;
prefer forward repair or restoring a verified backup to destructive downgrades.

## Verification

From the repository root (the working directory matters):

```sh
docker compose up -d
cd backend
.venv/bin/python -m pytest -q -p no:cacheprovider
cd ../frontend
npm ci
npm run lint
npm run build
npx tsc --noEmit
npx playwright install chromium
npm run test:e2e
```

To use an installed Google Chrome locally instead of downloading Chromium, run
`PLAYWRIGHT_CHANNEL=chrome npm run test:e2e`. CI uses Playwright's bundled Chromium.

Backend tests migrate/wipe the separate `bondeth_test` database and Redis DB 15. Use
only isolated test infrastructure for overrides. Browser tests run the built frontend
against controlled HTTP fixtures, on desktop and mobile Chromium. They cover signed-in
TTS credential propagation, billing states and portal navigation, and consent-page
layout. They do not make real Stripe payments or run real models.

CI runs backend integration tests, lint/build/types, browser tests and all Compose
variants. Real model and GPU quality/latency evaluations remain opt-in; see
[GPU evaluation](../deploy/gpu/README.md). The original blueprint's latency/cost
targets must not be treated as measured production guarantees.

Dependency audits should distinguish shipped packages from tooling. At implementation
time `npm audit --omit=dev` reported no vulnerabilities; the full audit reported an
unresolved `braces` advisory through the Next.js ESLint dependency chain. Its suggested
automatic fix downgraded the framework lint config across major versions, so it was
not applied. Recheck advisories and upstream compatible fixes when updating dependencies.
