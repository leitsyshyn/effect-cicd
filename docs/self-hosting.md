# Self-Hosting

## Prerequisites

- Bun
- Postgres 16+
- S3-compatible object storage
- Docker Engine with `docker compose` for the containerized path

## Quick Start

```bash
cp .env.demo .env
docker compose up --build
```

Service endpoints:

- `GET /healthz`
- `GET /readyz`
- `GET /metrics`
- `GET /version`

## Bare Metal

```bash
bun install
bun run server.ts
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `ENGINE_PORT` | `3000` | HTTP port |
| `ENGINE_BASE_URL` | `http://127.0.0.1:3000` | External base URL |
| `POSTGRES_URL` | none | Full Postgres DSN |
| `PGHOST` / `PGPORT` / `PGDATABASE` / `PGUSER` / `PGPASSWORD` | none | Split Postgres config |
| `POSTGRES_CONNECT_RETRIES` | `3` | Initial Postgres connect retries |
| `POSTGRES_CONNECT_RETRY_DELAY_MS` | `1000` | Initial Postgres retry delay |
| `S3_ENDPOINT` | none | S3-compatible endpoint |
| `S3_REGION` | none | S3 region |
| `S3_BUCKET` | required | Artifact bucket |
| `S3_ACCESS_KEY` / `S3_ACCESS_KEY_ID` | required | S3 access key |
| `S3_SECRET_KEY` / `S3_SECRET_ACCESS_KEY` | required | S3 secret |
| `S3_PATH_STYLE` | `false` | Force path-style requests |
| `S3_PREFIX` | none | Object key prefix |
| `S3_OPERATION_RETRIES` | `3` | S3 operation retry count |
| `ARTIFACT_RETENTION_DAYS` | `90` | Default artifact/log retention |
| `ARTIFACT_MAX_SIZE_MB` | `1024` | Soft storage budget |
| `ARTIFACT_GC_INTERVAL_MINUTES` | `60` | Background GC cadence |
| `LOG_LEVEL` | `info` | Structured log threshold |
| `MAX_CONCURRENT_RUNS` | `1` | Global run concurrency |
| `MAX_CONCURRENT_RUNS_PER_PROJECT` | `1` | Per-project concurrency |
| `RUN_RECOVERY_ON_STARTUP` | `true` | Resume non-terminal runs |
| `SECRETS_MASTER_KEY` | required for secrets | Secret encryption key |

## Migrations

Runtime storage migrations run automatically on startup.

Manual startup check:

```bash
bun run server.ts
```

## Backup And Restore

Database:

```bash
pg_dump "$POSTGRES_URL" > effect-cicd.sql
pg_restore -d "$POSTGRES_URL" effect-cicd.sql
```

Objects:

```bash
mc mirror myminio/effect-cicd-artifacts ./artifact-backup
mc mirror ./artifact-backup myminio/effect-cicd-artifacts
```

Enable bucket versioning if your S3 provider supports it.

## Upgrade Procedure

1. Stop the service.
2. Back up Postgres and object storage.
3. Deploy the new image or source tree.
4. Start the service and let migrations run.
5. Verify `readyz` and `metrics`.

## Monitoring

- `healthz` for liveness
- `readyz` for Postgres + S3 readiness
- `metrics` for Prometheus scraping
- JSON logs on stdout

## Troubleshooting

- `readyz` failing on Postgres: verify credentials, network reachability, and migration lock contention.
- `readyz` failing on S3: verify bucket name, credentials, and path-style compatibility.
- Missing artifacts: inspect `artifact_metadata` / `log_metadata` rows and bucket objects together.
- Stuck runs after restart: keep `RUN_RECOVERY_ON_STARTUP=true` and inspect `RunResumed` / `RunInterrupted` events.
