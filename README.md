# NeuralBiz Backend

NestJS 12 GraphQL API and separate BullMQ worker for NeuralBiz media uploads and feeds.

## Media GraphQL API

Authenticated operations:

```graphql
input RequestVideoUploadInput {
  contentType: String!
  sizeBytes: Int!
}

input RequestImageUploadInput {
  contentType: String!
  sizeBytes: Int!
}

enum MediaAssetKind { VIDEO IMAGE }
enum MediaAssetStatus { UPLOADING PROCESSING READY REJECTED }

type UploadUrlResponse {
  assetId: ID!
  uploadUrl: String!
  expiresAt: DateTime!
  maxSizeBytes: Int!
  maxDurationSec: Int!
}

type MediaAsset {
  id: ID!
  kind: MediaAssetKind!
  status: MediaAssetStatus!
  rejectionReason: String
  mimeType: String!
  sizeBytes: Int!
  durationSec: Float
  width: Int
  height: Int
  createdAt: DateTime!
  updatedAt: DateTime!
}

type PostMedia {
  kind: MediaAssetKind!
  thumbnailUrl: String!
  previewUrl: String!
  blurhash: String!
  durationSec: Float
  width: Int
  height: Int
  hasVideo: Boolean!
}

input CreateServiceOfferingInput {
  title: String!
  category: String!
  description: String
  skills: [String!]!
  yearsExperience: Int!
  startingPrice: Float
  priceUnit: String
  county: String
  demoAssetId: ID
  vertical: PostVertical!
}

type PostServiceOffering {
  id: ID!
  title: String!
  category: String!
  description: String
  skills: [String!]!
  yearsExperience: Int!
  startingPrice: Float
  priceUnit: String
  county: String
}

type PlaybackResponse {
  hlsUrl: String!
  durationSec: Float!
  expiresAt: DateTime!
}

# Mutations
requestVideoUpload(input: RequestVideoUploadInput!): UploadUrlResponse!
requestImageUpload(input: RequestImageUploadInput!): UploadUrlResponse!
completeUpload(assetId: ID!): MediaAsset!
createServiceOffering(input: CreateServiceOfferingInput!): ID!

# Queries
mediaAsset(id: ID!): MediaAsset!
playback(postId: ID!): PlaybackResponse!
homeFeed(input: FeedInput!): FeedConnection!
```

`Post` feed results additionally include nullable `media: PostMedia` and `offering: PostServiceOffering`. Feed media fields contain thumbnail/preview URLs and metadata only; no HLS manifest key or playback URL is included. The `playback` query resolves the ready post asset lazily.

## Flutter Upload Sequence

1. Call `requestVideoUpload` with the MIME type and exact byte size, or `requestImageUpload` for an image. Video MIME types are `video/mp4`, `video/quicktime`, and `video/webm`.
2. Send the raw file bytes with HTTP `PUT` to the returned `uploadUrl`, preserving the requested `Content-Type` and `Content-Length`.
3. Call `completeUpload(assetId: ...)` after the PUT succeeds.
4. Poll `mediaAsset(id: ...)` until `READY` or `REJECTED`. An offering may be created while its demo is `PROCESSING`; its feed post remains hidden until the asset is ready.
5. Call `createServiceOffering` with the returned asset ID.
6. Load the regular authenticated `homeFeed`; it contains poster, preview, blurhash, and video metadata, but never HLS URLs.
7. When the user taps the video card, call `playback(postId: ...)` and play its HLS URL.

Images are processed and marked `READY` by `completeUpload`; videos are processed asynchronously by the separate worker. The server uses ffprobe rather than client duration metadata and rejects videos whose measured duration exceeds `MAX_VIDEO_DURATION_SEC` (600 seconds by default).

## Products, offerings, and author posts

Product creation creates the product and its feed post atomically by default.
Set `postToFeed: false` only when a product should not appear as a post.

```graphql
mutation CreateProduct($input: CreateProductInput!) {
  createProductWithInput(input: $input)
}
```

The service-offering feed uses the same cursor format and readiness rules as
`homeFeed`. Other users see only ready demo videos; a provider can see their
own processing offer, while rejected media is hidden from everyone.

```graphql
query BrowseProducts($after: String) {
  products(first: 10, after: $after, category: "crops") {
    edges {
      cursor
      node {
        id
        name
        price
        unit
        seller {
          id
          fullName
          location
          isVerified
        }
        media {
          kind
          thumbnailUrl
          previewUrl
          blurhash
          hasVideo
        }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}

query BrowseOfferings($after: String) {
  serviceOfferings(first: 10, after: $after, county: "Nairobi") {
    edges {
      cursor
      node {
        id
        title
        category
        provider {
          id
          fullName
          location
          isVerified
        }
        media {
          kind
          thumbnailUrl
          previewUrl
          blurhash
          hasVideo
        }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}

query MyPosts($after: String) {
  myPosts(first: 10, after: $after) {
    edges {
      cursor
      node {
        id
        status
        rejectionReason
        createdAt
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}

mutation DeletePost($postId: ID!) {
  deletePost(postId: $postId)
}
```

`createPost` and `createProduct` retain their original arguments for existing
clients but are deprecated in favor of `createPostWithInput` and
`createProductWithInput`. The legacy `createService` mutation and `Post.service`
field are deprecated; use `createServiceOffering`.

## Environment

Local development defaults (no cloud account required):

```dotenv
STORAGE_DRIVER=local
LOCAL_STORAGE_DIR=./storage
LOCAL_STORAGE_PUBLIC_URL=http://localhost:3000/storage
LOCAL_UPLOAD_SECRET=replace-with-a-long-random-local-secret
REDIS_HOST=localhost
REDIS_PORT=6379
MAX_VIDEO_BYTES=314572800
MAX_VIDEO_DURATION_SEC=600
MAX_IMAGE_BYTES=10485760
MAX_CONCURRENT_UPLOADS=5
UPLOAD_URL_EXPIRES_IN=3600
VIDEO_PROCESSING_TIMEOUT_MS=900000
TEMP_DIR=./temp
```

For R2, set `STORAGE_DRIVER=r2` and provide `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, and `R2_PUBLIC_BASE_URL`. Use an unguessable public bucket path and configure its CDN/public-read policy for processed `media/` outputs. Never make the original `uploads/` path public.

### Environment variable reference

The web and worker services use the same production configuration validation.
Set the production values on both services; the worker does not serve CORS
requests, but `CORS_ORIGINS` is still required by the shared schema.

| Variable                                                                                                                                                     | Required              | Purpose                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- | ------------------------------------------------------------------- |
| `DATABASE_URL`                                                                                                                                               | Always                | PostgreSQL connection                                               |
| `JWT_SECRET`                                                                                                                                                 | Always                | JWT signing key                                                     |
| `NODE_ENV`                                                                                                                                                   | Production deployment | Set to `production`                                                 |
| `STORAGE_DRIVER`                                                                                                                                             | Production            | `r2` or `s3`; local storage is refused                              |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL`                                                               | Production            | Shared object storage and CDN                                       |
| `REDIS_HOST`, `REDIS_PORT`                                                                                                                                   | Production            | BullMQ connection                                                   |
| `CORS_ORIGINS`                                                                                                                                               | Production            | Comma-separated frontend origins                                    |
| `ADMIN_EMAILS`                                                                                                                                               | Optional              | Comma-separated administrator email allowlist for `platformStats`   |
| `DATABASE_URL_TEST`                                                                                                                                          | Optional, local only  | Dedicated local integration-test database; remote hosts are refused |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`                                                                                                       | Optional              | Email delivery; development fallback logs instead of sending        |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`                                                                                              | Optional              | SMS delivery; development fallback logs instead of sending          |
| `LOCAL_STORAGE_DIR`, `LOCAL_STORAGE_PUBLIC_URL`, `LOCAL_UPLOAD_SECRET`                                                                                       | Local only            | Local development storage                                           |
| `MAX_VIDEO_BYTES`, `MAX_VIDEO_DURATION_SEC`, `MAX_IMAGE_BYTES`, `MAX_CONCURRENT_UPLOADS`, `UPLOAD_URL_EXPIRES_IN`, `VIDEO_PROCESSING_TIMEOUT_MS`, `TEMP_DIR` | Optional              | Media upload and processing limits                                  |

See [docs/DEPLOY.md](docs/DEPLOY.md) for the Render pre-deploy command,
web/worker settings, Redis wiring, and the R2 CORS checklist.

## Validation and smoke test

Run the build and lint locally, then run unit tests only after the database
safety guard. Integration tests are skipped unless `DATABASE_URL_TEST` is set,
and are restricted to a local database:

```powershell
npm run build
npm run lint
node scripts/assert-dev-db.js
npm test -- --runInBand
$env:DATABASE_URL_TEST = "postgresql://postgres:postgres@localhost:5432/neuralbiz_test?schema=public"
npm run test:int
```

The GraphQL-only end-to-end smoke script requires `BASE_URL`,
`USER_A_EMAIL`/`USER_A_PASSWORD`, `USER_B_EMAIL`/`USER_B_PASSWORD`, and
`SAMPLE_VIDEO_PATH`. For account registration it also needs the matching
`USER_A_PHONE_NUMBER`/`USER_B_PHONE_NUMBER` and, after email verification, the
optional `USER_A_VERIFICATION_CODE`/`USER_B_VERIFICATION_CODE`. Set
`LONG_VIDEO_SAMPLE_PATH` to exercise the over-limit rejection check; `ffprobe`
must be available for that optional check.

```powershell
npm run smoke:e2e
```

The smoke test performs no database access; it uses GraphQL and the returned
direct-upload and playback URLs only.

`docker compose up --build` starts PostgreSQL, Redis, the API, and a worker image containing ffmpeg/ffprobe. For its isolated development database, the API runs `prisma db push` before starting, because this checkout does not include the historical base-table migrations. The worker and API share the mounted local media directory.

For deployed databases, use `prisma migrate deploy`. The current local migration directory contains the vertical and media incremental migrations, while the configured PostgreSQL database reports applied migrations `20260904000000_init` and `20260905203831_init` that are absent from this checkout. Reconcile/restore those baseline migration files before applying this checkout's migration chain to that database; do not baseline or reset a database containing user data to work around the mismatch.

## Playback URL Limitation

HLS manifests reference multiple segment files, so an individual pre-signed manifest URL does not secure the segment requests. For v1, processed HLS outputs use UUID-based storage paths served through the configured public CDN URL, and `MediaUrlSigner` returns that public URL. This is intentionally a replaceable boundary: a CDN worker or token-signing implementation can be introduced later without changing the GraphQL `playback` contract. Keep the bucket/CDN path private from broad listing and allow only object reads through the intended CDN configuration.
