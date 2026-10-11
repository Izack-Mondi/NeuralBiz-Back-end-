import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import helmet from 'helmet';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  
  // Security headers
  app.use(helmet());
  
  // CORS configuration
  const corsOrigins = process.env.CORS_ORIGINS?.split(',') || '*';
  const isProduction = process.env.NODE_ENV === 'production';
  
  app.enableCors({
    origin: isProduction ? corsOrigins : '*', // Permissive in non-production
    credentials: true,
  });
  
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
  }));

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`🚀 Server ready at http://localhost:${port}/graphql`);
}

bootstrap();
