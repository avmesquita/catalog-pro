import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as amqp from 'amqplib';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FileMetadata } from '../file-metadata/file-metadata.entity';

@Injectable()
export class DbConsumerService implements OnModuleInit {
  private readonly logger = new Logger(DbConsumerService.name);
  private channel: amqp.Channel;

  constructor(
    @InjectRepository(FileMetadata)
    private fileMetadataRepository: Repository<FileMetadata>,
  ) {}

  async onModuleInit() {
    try {
      this.logger.log('DbConsumerService: Tentando conectar ao RabbitMQ...');
      const connection = await amqp.connect('amqp://rabbitmq:5672');
      this.channel = await connection.createChannel();
      await this.channel.assertQueue('db_queue', { durable: true });
      this.logger.log('DbConsumerService: Conexão com o RabbitMQ estabelecida e fila verificada.');

      this.channel.consume('db_queue', async (msg) => {
        if (msg !== null) {
          const data = JSON.parse(msg.content.toString());
          this.logger.log(`[x] Received DB update:`, { data });

          if (data.task === 'save_video_metadata') {
            const video = data.data;
            try {
              // Salva a informação no banco de dados
              const newMetadata = this.fileMetadataRepository.create({
                originalPath: video.originalPath,
                status: video.status,
                // ... adicione outros campos aqui
              });
              await this.fileMetadataRepository.save(newMetadata);
              this.logger.log(`[x] Metadata saved for ${video.originalPath}`);
            } catch (error) {
              this.logger.error('Error saving metadata', { error: error.message });
            } finally {
              this.channel.ack(msg);
            }
          }
        }
      });
    } catch (error) {
      this.logger.error('Failed to start DbConsumerService:', error);
      throw error;
    }
  }
}
