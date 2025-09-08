import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FileMetadata } from '../file-metadata/file-metadata.entity';
import { DbConsumerService } from './db-consumer.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([FileMetadata]),
  ],
  providers: [DbConsumerService],
})
export class DbConsumerModule {}