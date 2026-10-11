# Render deployment checklist

Deploy the web API and video worker as separate Render services from the same
branch and region. The web service uses `Dockerfile`; the background worker
uses `Dockerfile.worker`. Do not put migrations in either Docker command.

## Web service

| Render setting | Value |
| --- | --- |
| Service type | Web Service |
| Runtime | Docker |
| Dockerfile path | `./Dockerfile` |
| Pre-deploy command | `npx prisma migrate deploy` |
| Health check path | `/health` |
| Docker start command | Leave unset; the image runs `node dist/main.js` |

The pre-deploy command runs once before Render promotes the new web image.
Restore/verify the historical baseline migrations described in the README
before enabling it on a database with existing data.

## Worker service

| Render setting | Value |
| --- | --- |
| Service type | Background Worker |
| Runtime | Docker |
| Dockerfile path | `./Dockerfile.worker` |
| Pre-deploy command | Leave unset |
| Docker start command | Leave unset; the image runs `node dist/worker.js` |

Both services need the following production variables. Configure them on each
service; Render does not share service environment variables automatically.

| Variable | Web | Worker | Notes |
| --- | --- | --- | --- |
| `NODE_ENV` | `production` | `production` | Enables production validation |
| `DATABASE_URL` | Required | Required | Same Render Postgres instance |
| `JWT_SECRET` | Required | Required | Use the same strong secret on both services |
| `STORAGE_DRIVER` | `r2` or `s3` | `r2` or `s3` | Never use local storage in production |
| `R2_ACCOUNT_ID` | Required | Required | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | Required | Required | Dedicated bucket-scoped access key |
| `R2_SECRET_ACCESS_KEY` | Required | Required | Keep secret in Render environment settings |
| `R2_BUCKET` | Required | Required | Existing media bucket name |
| `R2_PUBLIC_BASE_URL` | Required | Required | Public CDN/base URL for processed media |
| `REDIS_HOST` | Required | Required | Hostname from the same-region Render Redis instance |
| `REDIS_PORT` | Required | Required | Port from that Redis instance |
| `CORS_ORIGINS` | Required | Required | Comma-separated allowed browser origins; set the real frontend origins |
| `PORT` | Optional | Not used | Render supplies this to the web service |

Set optional `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`,
`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER` only when
those integrations are configured. In their absence the existing development
fallback logs rather than sending messages.

## Cloudflare R2 setup

Create the bucket and a dedicated API token with only the object permissions
the application needs. Set the five `R2_*` values above on both Render
services. Configure a custom domain/CDN for processed media and do not expose
the original `uploads/` path.

In the R2 bucket's CORS settings, replace the example origins with the deployed
web client origins (and any development origins you intentionally need):

```json
[
  {
    "AllowedOrigins": [
      "https://app.example.com"
    ],
    "AllowedMethods": [
      "GET",
      "HEAD",
      "PUT"
    ],
    "AllowedHeaders": [
      "Content-Type",
      "Content-Length",
      "x-amz-*"
    ],
    "ExposeHeaders": [
      "ETag"
    ],
    "MaxAgeSeconds": 3600
  }
]
```

## Redis wiring

Create or select one Render Redis instance in the same region as both services.
Copy its internal hostname and port into `REDIS_HOST` and `REDIS_PORT` on both
the web and worker services. The API enqueues video processing jobs and the
worker consumes them; they must use the same Redis instance.

## Deploy sequence

1. Configure the Render services, Postgres, Redis, R2 bucket, CORS, and secrets.
2. Confirm all production-required variables above are present on both
   services; startup validation names any missing variable.
3. Confirm the migration history is reconciled before running the web
   pre-deploy migration command against an existing database.
4. Deploy the web service; Render runs `npx prisma migrate deploy` before
   starting the new image.
5. Deploy the worker image and verify `/health`, a completed video job, and
   playback through the public CDN.

## Needs human action

- Apply the Render settings and provide production secrets in the Render
  dashboard; no secret values belong in this repository.
- Create the R2 bucket/token, configure the CDN domain, and apply the
  production-specific CORS origins.
- Create/configure Redis and copy its internal host and port to both services.
- Restore/reconcile the historical base migrations before running
  `prisma migrate deploy` on the existing database.
- Resolve the high-severity `@graphql-tools/utils` advisory documented in
  `CHANGES.md` before deployment.
