# effect-cicd

To install dependencies:

```bash
bun install
```

## Local Infra (Postgres + MinIO)

Prereqs:

- Docker Desktop (or Docker Engine + `docker compose`)
- Bun

Start infra:

```bash
bun run infra:up
```

Stop infra:

```bash
bun run infra:down
```

Environment:

```bash
cp .env.demo .env
```

Notes:

- Postgres is exposed on `localhost:5432` (db `effect_cicd`, user `ci`, password `secret`).
- MinIO is exposed on `http://localhost:9000` with console at `http://localhost:9001`.
- The MinIO bucket `effect-cicd-artifacts` is created by the one-shot `minio-init` service.

Run tests:

```bash
bun run typecheck
bun run test
```

Run storage integration tests (requires running infra + `.env` present):

```bash
RUN_STORAGE_TESTS=1 bun run test
```

Run CLI against real infra:

```bash
bun run index.ts validate ./tests/fixtures/workflows/valid-workflow.ts
bun run index.ts plan ./tests/fixtures/workflows/valid-workflow.ts
bun run index.ts run ./tests/fixtures/workflows/valid-workflow.ts
```

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.3.1. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
