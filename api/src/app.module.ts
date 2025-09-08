import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { FileMetadata } from './file-metadata/file-metadata.entity';
import { CatalogModule } from './catalog/catalog.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'sqlite',
      database: './database/catalog.sqlite',
      entities: [FileMetadata],
      synchronize: true,
    }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, 'videos'),
      serveRoot: '/videos'
    }),
    CatalogModule    
  ],
  controllers: [AppController],
  providers: [AppService],  
})
export class AppModule {}