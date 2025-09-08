import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Habilitar CORS
  app.enableCors();

  const config = new DocumentBuilder()
    .setTitle('Catálogo de Vídeos')
    .setDescription('API para catalogar e gerenciar metadados de vídeos em um diretório.')
    .setVersion('1.0')
    .addTag('catalog')
    .build();
  
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  await app.listen(3000);
}
bootstrap();