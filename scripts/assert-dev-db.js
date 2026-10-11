'use strict';

const databaseUrl = process.env.DATABASE_URL;
const nodeEnv = process.env.NODE_ENV;

if (nodeEnv && nodeEnv.toLowerCase() === 'production') {
  console.error('Refusing database command because NODE_ENV is production.');
  process.exit(1);
}

if (databaseUrl) {
  let hostname;

  try {
    hostname = new URL(databaseUrl).hostname;
  } catch {
    console.error('Refusing database command because DATABASE_URL is not a valid URL.');
    process.exit(1);
  }

  if (hostname.toLowerCase().includes('render.com')) {
    console.error('Refusing database command because DATABASE_URL points to a Render host.');
    process.exit(1);
  }
}
