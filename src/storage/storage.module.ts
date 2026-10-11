import { Global, Module, Provider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { S3StorageService } from './s3-storage.service';
import { LocalStorageService } from './local-storage.service';
import { LocalStorageController } from './local-storage.controller';
import { StorageService } from './storage.service.interface';
import { MediaUrlSigner } from './media-url-signer.interface';
import { PublicMediaUrlSigner } from './public-media-url-signer';
import { PrismaModule } from '../prisma/prisma.module';

const storageProviders: Provider[] = [
  {
    provide: 'STORAGE_SERVICE',
    useFactory: (configService: ConfigService) => {
      const driver = configService.get<string>('STORAGE_DRIVER') || 'local';

      if (configService.get<string>('NODE_ENV') === 'production' && driver === 'local') {
        throw new Error(
          'STORAGE_DRIVER=local is not supported in production; configure shared R2 or S3 storage.',
        );
      }
      
      if (driver === 'r2' || driver === 's3') {
        return new S3StorageService(configService);
      } else if (driver === 'local') {
        return new LocalStorageService(configService);
      } else {
        throw new Error(`Unknown storage driver: ${driver}`);
      }
    },
    inject: [ConfigService],
  },
  {
    provide: StorageService,
    useExisting: 'STORAGE_SERVICE',
  },
];

@Global()
@Module({
  imports: [ConfigModule, PrismaModule],
  controllers: [LocalStorageController],
  providers: [...storageProviders, LocalStorageService, PublicMediaUrlSigner, {
    provide: MediaUrlSigner,
    useExisting: PublicMediaUrlSigner,
  }],
  exports: [StorageService, MediaUrlSigner],
})
export class StorageModule {}
