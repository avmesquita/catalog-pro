import { Module } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FileMetadata } from '../file-metadata/file-metadata.entity';
import { TranscoderModule } from '../transcoder/transcoder.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([FileMetadata]),
    TranscoderModule,
  ],
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}