import { readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

type GraphQLResponse<T> = {
  data?: T;
  errors?: Array<{ message?: string }>;
};

type AuthPayload = {
  accessToken?: string | null;
  verificationRequired: boolean;
  user: { id: string };
};

type UploadResponse = {
  assetId: string;
  uploadUrl: string;
  maxSizeBytes: number;
  maxDurationSec: number;
};

type PreparedUpload = UploadResponse & { bytes: Buffer };

type MediaStatus = {
  status: 'UPLOADING' | 'PROCESSING' | 'READY' | 'REJECTED';
  rejectionReason?: string | null;
};

type HomeFeedResponse = {
  edges: Array<{
    node: {
      id: string;
      viewsCount: number;
      offering?: { id: string; title: string } | null;
    };
  }>;
};

const POLL_INTERVAL_MS = 5000;
const PROCESSING_TIMEOUT_MS = 5 * 60 * 1000;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

function graphQLEndpoint(): string {
  const baseUrl = new URL(requiredEnv('BASE_URL'));
  if (!baseUrl.pathname.replace(/\/+$/, '').endsWith('/graphql')) {
    baseUrl.pathname = `${baseUrl.pathname.replace(/\/+$/, '')}/graphql`;
  }
  return baseUrl.toString();
}

async function graphql<T>(
  endpoint: string,
  query: string,
  variables: Record<string, unknown>,
  accessToken?: string,
): Promise<T> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  const result = (await response.json()) as GraphQLResponse<T>;
  if (!response.ok || result.errors?.length || !result.data) {
    const details = result.errors
      ?.map(({ message }) => message)
      .filter(Boolean)
      .join('; ');
    throw new Error(details || `GraphQL request failed with HTTP ${response.status}`);
  }
  return result.data;
}

async function authenticate(endpoint: string, prefix: 'USER_A' | 'USER_B'): Promise<string> {
  const email = requiredEnv(`${prefix}_EMAIL`);
  const password = requiredEnv(`${prefix}_PASSWORD`);
  const loginQuery = `
    mutation Login($input: LoginInput!) {
      login(input: $input) {
        accessToken
        verificationRequired
        user { id }
      }
    }
  `;

  try {
    const response = await graphql<{ login: AuthPayload }>(endpoint, loginQuery, {
      input: { identifier: email, password },
    });
    if (!response.login.accessToken) {
      throw new Error('Login response did not include an access token');
    }
    return response.login.accessToken;
  } catch {
    const registerResponse = await graphql<{ register: AuthPayload }>(
      endpoint,
      `
        mutation Register($input: RegisterInput!) {
          register(input: $input) {
            accessToken
            verificationRequired
            user {
              id
            }
          }
        }
      `,
      {
        input: {
          fullName: process.env[`${prefix}_FULL_NAME`] || `Nexify smoke ${prefix}`,
          email,
          phoneNumber: requiredEnv(`${prefix}_PHONE_NUMBER`),
          verificationMethod: 'EMAIL',
        },
      },
    );
    const userId = registerResponse.register.user.id;
    const verificationCode = process.env[`${prefix}_VERIFICATION_CODE`]?.trim();
    if (!verificationCode) {
      throw new Error(
        `Account registration requires email verification; set ${prefix}_VERIFICATION_CODE and rerun`,
      );
    }

    await graphql(
      endpoint,
      `
        mutation VerifyRegistration($input: VerifyRegistrationInput!) {
          verifyRegistration(input: $input) {
            verificationRequired
            user {
              id
            }
          }
        }
      `,
      { input: { userId, code: verificationCode } },
    );
    await graphql(
      endpoint,
      `
        mutation CompletePasswordSetup($input: CompletePasswordSetupInput!) {
          completePasswordSetup(input: $input) {
            verificationRequired
            user {
              id
            }
          }
        }
      `,
      { input: { userId, password } },
    );
    await graphql(
      endpoint,
      `
        mutation CompleteProfile($input: CompleteProfileInput!) {
          completeProfile(input: $input) {
            verificationRequired
            user {
              id
            }
          }
        }
      `,
      {
        input: {
          userId,
          fullName: process.env[`${prefix}_FULL_NAME`] || `Nexify smoke ${prefix}`,
          country: 'Kenya',
          location: 'Nairobi',
          interests: ['business', 'agriculture'],
        },
      },
    );

    const response = await graphql<{ login: AuthPayload }>(endpoint, loginQuery, {
      input: { identifier: email, password },
    });
    if (!response.login.accessToken) {
      throw new Error('Login response did not include an access token after registration');
    }
    return response.login.accessToken;
  }
}

async function runStep<T>(label: string, action: () => Promise<T>): Promise<T> {
  try {
    const result = await action();
    console.log(`[PASS] ${label}`);
    return result;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unexpected error';
    console.error(`[FAIL] ${label}: ${message}`);
    throw error;
  }
}

async function requestUpload(
  endpoint: string,
  accessToken: string,
  videoPath: string,
): Promise<PreparedUpload> {
  const fileInfo = await stat(videoPath);
  const upload = await graphql<{ requestVideoUpload: UploadResponse }>(
    endpoint,
    `
      mutation RequestVideoUpload($input: RequestVideoUploadInput!) {
        requestVideoUpload(input: $input) {
          assetId
          uploadUrl
          maxSizeBytes
          maxDurationSec
        }
      }
    `,
    { input: { contentType: 'video/mp4', sizeBytes: fileInfo.size } },
    accessToken,
  );
  const uploadInfo = upload.requestVideoUpload;
  if (fileInfo.size > uploadInfo.maxSizeBytes) {
    throw new Error('Sample video exceeds the server upload size limit');
  }

  const bytes = await readFile(videoPath);
  return { ...uploadInfo, bytes };
}

async function putUpload(upload: PreparedUpload): Promise<void> {
  const body = new ArrayBuffer(upload.bytes.byteLength);
  new Uint8Array(body).set(upload.bytes);
  const response = await fetch(upload.uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(upload.bytes.byteLength),
    },
    body,
  });
  if (!response.ok) {
    throw new Error(`Direct upload failed with HTTP ${response.status}`);
  }
}

async function completeUpload(
  endpoint: string,
  accessToken: string,
  assetId: string,
): Promise<void> {
  await graphql(
    endpoint,
    'mutation CompleteUpload($assetId: ID!) { completeUpload(assetId: $assetId) { id status } }',
    { assetId },
    accessToken,
  );
}

async function pollMedia(
  endpoint: string,
  accessToken: string,
  assetId: string,
  expected: 'READY' | 'REJECTED',
): Promise<MediaStatus> {
  const deadline = Date.now() + PROCESSING_TIMEOUT_MS;
  let status: MediaStatus | undefined;
  while (Date.now() < deadline) {
    const result = await graphql<{ mediaAsset: MediaStatus }>(
      endpoint,
      `
        query MediaAsset($id: ID!) {
          mediaAsset(id: $id) {
            status
            rejectionReason
          }
        }
      `,
      { id: assetId },
      accessToken,
    );
    status = result.mediaAsset;
    if (status.status === expected || status.status === 'REJECTED') {
      break;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, POLL_INTERVAL_MS));
  }
  if (!status || status.status !== expected) {
    throw new Error(
      `Media processing did not reach ${expected}; final status=${status?.status ?? 'unknown'}`,
    );
  }
  return status;
}

function assertVideoExceedsDuration(videoPath: string, maximumDurationSec: number): void {
  const probe = spawnSync(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      videoPath,
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  if (probe.error || probe.status !== 0) {
    throw new Error('ffprobe is required to validate LONG_VIDEO_SAMPLE_PATH');
  }

  const durationSec = Number(probe.stdout.trim());
  if (!Number.isFinite(durationSec) || durationSec <= maximumDurationSec) {
    throw new Error(`Long-video sample must exceed ${maximumDurationSec} seconds`);
  }
}

async function run(): Promise<void> {
  const endpoint = graphQLEndpoint();
  const sampleVideoPath = requiredEnv('SAMPLE_VIDEO_PATH');
  const userA = await runStep('Authenticate user A', () => authenticate(endpoint, 'USER_A'));
  const userB = await runStep('Authenticate user B', () => authenticate(endpoint, 'USER_B'));
  const upload = await runStep('Request video upload', () =>
    requestUpload(endpoint, userA, sampleVideoPath),
  );
  await runStep('PUT sample video to upload URL', () => putUpload(upload));
  await runStep('Complete video upload', () => completeUpload(endpoint, userA, upload.assetId));
  await runStep('Poll uploaded video until READY', () =>
    pollMedia(endpoint, userA, upload.assetId, 'READY'),
  );

  const offeringId = await runStep('Create service offering with READY demo asset', async () => {
    const response = await graphql<{ createServiceOffering: string }>(
      endpoint,
      `
        mutation CreateServiceOffering($input: CreateServiceOfferingInput!) {
          createServiceOffering(input: $input)
        }
      `,
      {
        input: {
          title: `Smoke test service ${Date.now()}`,
          category: 'agriculture services',
          description: 'Automated upload-to-feed smoke test',
          skills: ['Video demonstration'],
          yearsExperience: 1,
          vertical: 'AGRICULTURE',
          demoAssetId: upload.assetId,
        },
      },
      userA,
    );
    return response.createServiceOffering;
  });

  const postId = await runStep('Find offering in user B home feed', async () => {
    const response = await graphql<{ homeFeed: HomeFeedResponse }>(
      endpoint,
      `
        query HomeFeed {
          homeFeed(input: { first: 30, tab: ALL }) {
            edges {
              node {
                id
                viewsCount
                offering {
                  id
                  title
                }
              }
            }
          }
        }
      `,
      {},
      userB,
    );
    const card = response.homeFeed.edges.find(({ node }) => node.offering?.id === offeringId);
    if (!card) {
      throw new Error('The new offering is missing from user B home feed');
    }
    return card.node.id;
  });

  const playbackUrl = await runStep('Request playback URL as user B', async () => {
    const response = await graphql<{
      playback: { hlsUrl: string };
    }>(
      endpoint,
      'query Playback($postId: ID!) { playback(postId: $postId) { hlsUrl } }',
      { postId },
      userB,
    );
    return response.playback.hlsUrl;
  });
  await runStep('Fetch playback URL successfully', async () => {
    const response = await fetch(playbackUrl);
    if (!response.ok) {
      throw new Error(`Playback URL returned HTTP ${response.status}`);
    }
  });

  await runStep('Record view twice and verify idempotent view count', async () => {
    const mutation = 'mutation RecordView($postId: ID!) { recordView(postId: $postId) }';
    await graphql(endpoint, mutation, { postId }, userB);
    await graphql(endpoint, mutation, { postId }, userB);
    const response = await graphql<{ homeFeed: HomeFeedResponse }>(
      endpoint,
      `
        query HomeFeed {
          homeFeed(input: { first: 30, tab: ALL }) {
            edges {
              node {
                id
                viewsCount
              }
            }
          }
        }
      `,
      {},
      userB,
    );
    const post = response.homeFeed.edges.find(({ node }) => node.id === postId)?.node;
    if (post?.viewsCount !== 1) {
      throw new Error(
        `Expected viewsCount=1 after duplicate records; got ${post?.viewsCount ?? 'missing'}`,
      );
    }
  });

  const longVideoPath = process.env.LONG_VIDEO_SAMPLE_PATH?.trim();
  if (longVideoPath) {
    await runStep('Verify long-video sample exceeds configured duration', async () => {
      assertVideoExceedsDuration(longVideoPath, upload.maxDurationSec);
    });
    const longUpload = await runStep('Request long-video upload', () =>
      requestUpload(endpoint, userA, longVideoPath),
    );
    await runStep('PUT long video to upload URL', () => putUpload(longUpload));
    await runStep('Complete long-video upload', () =>
      completeUpload(endpoint, userA, longUpload.assetId),
    );
    const rejected = await runStep('Poll long video until REJECTED', () =>
      pollMedia(endpoint, userA, longUpload.assetId, 'REJECTED'),
    );
    await runStep('Check long-video rejection reason', async () => {
      if (!rejected.rejectionReason) {
        throw new Error('Rejected long video did not include a rejection reason');
      }
    });
  } else {
    console.log('[PASS] Long-video rejection check skipped (LONG_VIDEO_SAMPLE_PATH not set)');
  }
}

run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unexpected error';
  console.error(`[FAIL] Smoke run: ${message}`);
  process.exitCode = 1;
});
