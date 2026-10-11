'use strict';

const { spawnSync } = require('child_process');

if (!process.env.DATABASE_URL_TEST) {
  console.log('Skipping integration tests because DATABASE_URL_TEST is not set.');
  process.exitCode = 0;
} else {
  const env = {
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL_TEST,
  };
  const guard = spawnSync(process.execPath, ['scripts/assert-dev-db.js'], {
    env,
    stdio: 'inherit',
  });

  if (guard.error) {
    console.error(`Could not run database safety guard: ${guard.error.message}`);
    process.exitCode = 1;
  } else if (guard.status !== 0) {
    process.exitCode = guard.status || 1;
  } else {
    const tests = spawnSync(
      process.execPath,
      [
        '--experimental-vm-modules',
        './node_modules/jest/bin/jest.js',
        '--runInBand',
        'test/feed.integration.spec.ts',
      ],
      {
        env,
        stdio: 'inherit',
      },
    );

    if (tests.error) {
      console.error(`Could not start integration tests: ${tests.error.message}`);
      process.exitCode = 1;
    } else {
      process.exitCode = tests.status === 0 ? 0 : tests.status || 1;
    }
  }
}
