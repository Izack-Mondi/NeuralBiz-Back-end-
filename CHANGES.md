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

## Phase 2 — Market and Home completion

### Changes

- Product creation now persists the product and its optional feed post in one
  transaction; `postToFeed` defaults to true.
- Added authenticated cursor-paginated `products` and `serviceOfferings`
  queries with seller/provider summaries, ready-media output, and author-only
  visibility for processing media.
- Added `myPosts` with processing/published/rejected states and rejection
  reasons, plus owner-only `deletePost` with media cleanup coordinated with
  its database transaction.
- Added validated input-object mutations while retaining the existing loose
  mutation forms. The legacy `createPost` and `createProduct` mutations are
  deprecated; use `createPostWithInput` and `createProductWithInput`.
- Deprecated the legacy `createService` mutation and `Post.service` field;
  legacy services are not published in the feed and the database model remains.
- Added the additive `ActivityEvent` model/migration, best-effort activity
  recording for registrations, posts, products, offerings, and views, and an
  admin-email-gated `platformStats` query.
- Replaced destructive sample seeding with stable-ID upserts for one system
  user and six Kenyan agriculture/business opportunity posts. Both seed entry
  points run the development database guard.
- Kept like/comment counts in the schema and marked them deprecated.

### Files touched

- `.env.example`, `package.json`, `CHANGES.md`
- `prisma/schema.prisma`, `prisma/migrations/20261011000000_add_activity_events/migration.sql`,
  `prisma/seed.ts`
- `src/activity/`, `src/platform/`
- `src/app.module.ts`, `src/auth/auth.module.ts`, `src/auth/auth.service.ts`,
  `src/config/env-validation.schema.ts`
- `src/feed/feed.module.ts`, `src/feed/feed.resolver.ts`,
  `src/feed/feed.service.ts`, `src/feed/feed.types.ts`,
  `src/feed/feed-cursor.ts`, `src/feed/post-media.mapper.ts`
- `src/media/cleanup.service.ts`, `src/media/media.module.ts`
- `src/service-offerings/service-offerings.module.ts`,
  `src/service-offerings/service-offerings.resolver.ts`,
  `src/service-offerings/service-offerings.service.ts`,
  `src/service-offerings/service-offerings.types.ts`
- `src/activity/activity.service.spec.ts`,
  `src/feed/feed.phase2.spec.ts`,
  `src/platform/platform-stats.service.spec.ts`,
  `src/service-offerings/service-offerings.service.spec.ts`

### Migrations and deprecations

- Added only `ActivityEvent`, its user relation, and indexes in an additive
  migration; no existing tables, columns, or data are removed or rewritten.
- Deprecated `createPost`, `createProduct`, `createService`, `Post.service`,
  and the likes/comments count fields; replacement mutation names are listed
  above.

### Validation

- `npm run build` passed.
- Focused Phase 2 service tests: 15 passed.
- Full unit suite: 80 passed, 2 skipped.
- The seed TypeScript file type-check passed without running Prisma CLI.
- No migration, seed, or integration database command was run.

## Phase 3 — Engineering quality

### Changes

- Split feed writes, product handling, and playback/contact handling into
  dedicated services while keeping `FeedService` compatibility methods and
  existing feed behavior.
- Made view recording transactional and idempotent by Prisma `P2002` code,
  checking visibility across every attached media asset before counting.
- Restricted playback and contact access to posts whose attached media is
  entirely ready; contact access requires authentication and keeps its
  existing throttle.
- Restored local-only, opt-in TypeScript integration coverage for media
  readiness and cursor pagination. Added a GraphQL-only upload-to-feed smoke
  script, including an optional long-video rejection check.
- Reject measured video durations strictly above the configured maximum.
- Added ESLint/Prettier configuration and a CI lint step; documented upload,
  feed queries, runtime settings, and test workflows.
- Standardized key operation logs around user, post, and asset identifiers.

### Files touched

- `.github/workflows/ci.yml`, `.prettierrc.json`, `eslint.config.mjs`,
  `package.json`, `package-lock.json`, `tsconfig.json`,
  `tsconfig.scripts.json`
- `README.md`, `CHANGES.md`, `docs/DEPLOY.md`
- `scripts/run-integration-tests.js`, `scripts/smoke-e2e.ts`,
  `test/feed.integration.spec.ts`
- `src/activity/`, `src/auth/auth.service.ts`, `src/feed/`,
  `src/media/cleanup.service.ts`, `src/platform/`,
  `src/service-offerings/`, `src/worker/`
- `prisma/seed.ts`

### Migrations and deprecations

- No Phase 3 migration or GraphQL deprecation was added.
- The Phase 2 `ActivityEvent` migration remains additive only.

### Validation

- Application build and smoke/integration TypeScript checks passed.
- Full unit suite before the final visibility corrections: 87 passed,
  6 skipped. Focused tests after those corrections: 25 passed, 3 skipped.
- ESLint and build passed; ESLint reports 21 existing unused-code warnings
  and no errors.
- Integration tests skipped because `DATABASE_URL_TEST` is not configured;
  Docker images and the live smoke flow require external runtime setup.

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
- Set `ADMIN_EMAILS` to a comma-separated allowlist of administrator email
  addresses before using the `platformStats` query.
- Resolve the high-severity prototype-pollution advisory
  GHSA-7mx3-vvmw in `@graphql-tools/utils` (pulled in by `@nestjs/graphql`);
  production dependency audit reported two high-severity vulnerability
  entries. It was left unchanged pending human direction.
- Review the critical transitive `handlebars` advisory affecting versions
  4.0.0–4.7.9 (GHSA-xw65-4hp5-5hc7, GHSA-8r5x-fm3f-whwj, and
  GHSA-p8wg-vrv2-v86f) reported by `npm audit` after adding lint tooling.
  Dependency versions were not changed; remediation remains a human decision.
