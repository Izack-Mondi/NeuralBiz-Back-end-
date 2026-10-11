import Joi from 'joi';

export const envValidationSchema = Joi.object({
  DATABASE_URL: Joi.string().required(),
  JWT_SECRET: Joi.string().required(),
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  STORAGE_DRIVER: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string()
      .valid('r2', 's3')
      .required()
      .messages({
        'any.only': 'STORAGE_DRIVER must be r2 or s3 in production; local storage is not supported.',
      }),
    otherwise: Joi.string().valid('local', 'r2', 's3').default('local'),
  }),
  R2_ACCOUNT_ID: Joi.string().when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
  }),
  R2_ACCESS_KEY_ID: Joi.string().when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
  }),
  R2_SECRET_ACCESS_KEY: Joi.string().when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
  }),
  R2_BUCKET: Joi.string().when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
  }),
  R2_PUBLIC_BASE_URL: Joi.string().when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
  }),
  REDIS_HOST: Joi.string().when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
  }),
  REDIS_PORT: Joi.number().port().when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
  }),
  CORS_ORIGINS: Joi.string().when('NODE_ENV', {
    is: 'production',
    then: Joi.required(),
  }),
  PORT: Joi.number().port(),
  LOCAL_STORAGE_DIR: Joi.string(),
  LOCAL_STORAGE_PUBLIC_URL: Joi.string(),
  LOCAL_UPLOAD_SECRET: Joi.string(),
  MAX_VIDEO_BYTES: Joi.number().positive(),
  MAX_VIDEO_DURATION_SEC: Joi.number().positive(),
  MAX_IMAGE_BYTES: Joi.number().positive(),
  MAX_CONCURRENT_UPLOADS: Joi.number().integer().positive(),
  UPLOAD_URL_EXPIRES_IN: Joi.number().positive(),
  VIDEO_PROCESSING_TIMEOUT_MS: Joi.number().positive(),
  TEMP_DIR: Joi.string(),
  TWILIO_ACCOUNT_SID: Joi.string(),
  TWILIO_AUTH_TOKEN: Joi.string(),
  TWILIO_FROM_NUMBER: Joi.string(),
  SMTP_HOST: Joi.string(),
  SMTP_PORT: Joi.number().port(),
  SMTP_USER: Joi.string(),
  SMTP_PASSWORD: Joi.string(),
  ADMIN_EMAILS: Joi.string(),
}).unknown(true).prefs({ abortEarly: false });

export const configValidationSchema = {
  '~standard': {
    version: 1 as const,
    vendor: 'joi',
    validate(value: unknown) {
      const result = envValidationSchema.validate(value, {
        abortEarly: false,
        allowUnknown: true,
      });

      if (result.error) {
        return {
          issues: result.error.details.map(({ message, path }) => ({ message, path })),
        };
      }

      return { value: result.value };
    },
  },
};
