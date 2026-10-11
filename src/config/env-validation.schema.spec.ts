import { configValidationSchema, envValidationSchema } from './env-validation.schema';

describe('environment validation schema', () => {
  it('requires the database URL and JWT secret in every environment', () => {
    const { error } = envValidationSchema.validate({ NODE_ENV: 'development' });

    expect(error?.message).toContain('DATABASE_URL');
    expect(error?.message).toContain('JWT_SECRET');
  });

  it('allows local storage in development', () => {
    const { error } = envValidationSchema.validate({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://localhost/neuralbiz',
      JWT_SECRET: 'local-secret',
    });

    expect(error).toBeUndefined();
  });

  it('requires production storage, Redis, R2, and CORS settings', () => {
    const { error } = envValidationSchema.validate({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://localhost/neuralbiz',
      JWT_SECRET: 'production-secret',
    });

    for (const name of [
      'STORAGE_DRIVER',
      'R2_ACCOUNT_ID',
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY',
      'R2_BUCKET',
      'R2_PUBLIC_BASE_URL',
      'REDIS_HOST',
      'REDIS_PORT',
      'CORS_ORIGINS',
    ]) {
      expect(error?.message).toContain(name);
    }
  });

  it('rejects local storage in production with an actionable message', () => {
    const { error } = envValidationSchema.validate({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://localhost/neuralbiz',
      JWT_SECRET: 'production-secret',
      STORAGE_DRIVER: 'local',
    });

    expect(error?.message).toContain('STORAGE_DRIVER must be r2 or s3 in production');
  });

  it('accepts a complete production environment using S3 storage', () => {
    const { error } = envValidationSchema.validate({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://localhost/neuralbiz',
      JWT_SECRET: 'production-secret',
      STORAGE_DRIVER: 's3',
      R2_ACCOUNT_ID: 'account',
      R2_ACCESS_KEY_ID: 'access',
      R2_SECRET_ACCESS_KEY: 'secret',
      R2_BUCKET: 'media',
      R2_PUBLIC_BASE_URL: 'https://media.example.com',
      REDIS_HOST: 'redis.internal',
      REDIS_PORT: '6379',
      CORS_ORIGINS: 'https://app.example.com',
    });

    expect(error).toBeUndefined();
  });

  it('exposes plain variable-specific failures through ConfigModule validation', () => {
    const result = configValidationSchema['~standard'].validate({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://localhost/neuralbiz',
      JWT_SECRET: 'production-secret',
    });

    expect('issues' in result && result.issues.map((issue) => issue.message).join('\n'))
      .toContain('R2_ACCOUNT_ID');
  });
});
