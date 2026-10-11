# Changes

## Phase 0 — Safety and baseline

### Changes

- Added `scripts/assert-dev-db.js` to reject production mode, Render database
  hosts, and malformed configured database URLs before guarded database
  scripts proceed.
- Guarded `prisma:migrate`, `prisma:seed`, and `test:int`.
- Ignored generated build output and untracked the previously committed
  compiled Prisma seed and integration test outputs without deleting their
  local copies.
- Added `.kilo/` to Git ignore rules; no `.kilo` contents were accessed or
  modified.

### Files touched

- `.gitignore`
- `package.json`
- `scripts/assert-dev-db.js`
- Removed from Git index only: `prisma/seed.d.ts`, `prisma/seed.js`,
  `prisma/seed.js.map`, `test/feed.integration.spec.d.ts`,
  `test/feed.integration.spec.js`, `test/feed.integration.spec.js.map`,
  `tsconfig.tsbuildinfo`

### Migrations and deprecations

- No migrations added.
- No API deprecations.

### Validation

- `npm run build` passed.
- Unit tests: 56 passed, 2 skipped.
- Safety checks confirmed production and Render database targets are rejected.

## Phase 1 — Deployability

### Changes

- Standardized the web and worker images on Node 22 slim, added OpenSSL and
  worker FFmpeg/ffprobe, retained Prisma Client generation in each builder,
  and kept migrations out of the image start commands.
- Added Joi environment validation through Nest ConfigModule's Standard Schema
  interface. Database URL and JWT secret are always required; production
  requires shared object storage, R2 settings, Redis, and CORS configuration.
- Rejected local storage in production, added retrying Prisma startup,
  graceful web/worker shutdown, and Redis/database health checks with HTTP 503
  on dependency failures.
- Added CI validation, generation, application and Docker builds, unit tests,
  and opt-in integration tests against the local CI Postgres service.
- Made `test:int` skip unless `DATABASE_URL_TEST` is set, and route that
  connection through the safety guard before Jest starts.
- Added the Render and Cloudflare deployment checklist in `docs/DEPLOY.md`.
- Updated `.env.example` for the runtime configuration requirements.

### Files touched

- `.dockerignore`, `.env.example`, `Dockerfile`, `Dockerfile.worker`
- `.github/workflows/ci.yml`, `docs/DEPLOY.md`
- `package.json`, `package-lock.json`, `scripts/run-integration-tests.js`
- `src/app.module.ts`, `src/config/env-validation.schema.ts`
- `src/health/health.controller.ts`, `src/health/health.module.ts`,
  `src/health/health.service.ts`
- `src/main.ts`, `src/prisma/prisma.service.ts`,
  `src/storage/storage.module.ts`
- `src/worker.ts`, `src/worker/worker.module.ts`,
  `src/worker/video-processing.worker.ts`
- `src/config/env-validation.schema.spec.ts`,
  `src/health/health.controller.spec.ts`,
  `src/health/health.service.spec.ts`, `src/prisma/prisma.service.spec.ts`

### Migrations and deprecations

- No migrations added.
- No API deprecations.

### Validation

- `npm run build` passed.
- Focused Phase 1 unit tests: 13 passed.
- Full unit suite: 70 passed, 2 skipped.
- Prisma schema validation and client generation passed.
- Docker image builds could not be run locally because Docker is not installed;
  the CI workflow now builds both images.

## NEEDS HUMAN

- Apply the Render service, pre-deploy migration, health-check, environment,
  Redis, and R2 settings in `docs/DEPLOY.md`; supply production secrets through
  Render's dashboard.
- Configure the real frontend origins in the R2 bucket CORS policy and
  `CORS_ORIGINS`.
- Restore/reconcile the historical base migrations before deploying to the
  existing database.
- Set the GitHub Actions repository variable `DATABASE_URL_TEST` to opt in to
  integration tests. It must point to the local CI Postgres service, not a
  hosted database.
- Resolve the high-severity prototype-pollution advisory
  GHSA-7mx3-vvmw in `@graphql-tools/utils` (pulled in by `@nestjs/graphql`);
  production dependency audit reported two high-severity vulnerability
  entries. It was left unchanged pending human direction.
