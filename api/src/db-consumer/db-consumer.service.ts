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
  ) {
    console.log('DbConsumerService: Injected!');
  }

  // Envia uma requisição de transcodificação para o worker.
  private async sendTranscodeRequest(dbId: number, originalPath: string) {
    if (!this.channel) {
        this.logger.error('Channel is not initialized. Cannot send transcode request.');
        return;
    }
    const msg = { task: 'transcode_video', dbId, originalPath };
    this.channel.sendToQueue('transcode_queue', Buffer.from(JSON.stringify(msg)));
    this.logger.log(`[x] Sent transcode request for DB ID ${dbId}`);
  }

  async onModuleInit() {
    // Adiciona a lógica de retentativa de conexão
    let connected = false;
    let retries = 0;
    const maxRetries = 10;
    const retryInterval = 5000; // 5 segundos

    while (!connected && retries < maxRetries) {
      try {
        this.logger.log('DbConsumerService: Tentando conectar ao RabbitMQ...');
        const connection = await amqp.connect('amqp://rabbitmq:5672');
        this.channel = await connection.createChannel();
        await this.channel.assertQueue('db_queue', { durable: true });
        await this.channel.assertQueue('transcode_queue', { durable: true });
        this.logger.log('DbConsumerService: Conexão com o RabbitMQ estabelecida e filas verificadas.');
        connected = true;
      } catch (error) {
        retries++;
        this.logger.error(`Falha na conexão com RabbitMQ. Tentativa ${retries}/${maxRetries}.`, { error: error.message });
        await new Promise(res => setTimeout(res, retryInterval));
      }
    }

    if (!connected) {
      this.logger.error('Não foi possível conectar ao RabbitMQ após várias tentativas. Encerrando.');
      throw new Error('Failed to connect to RabbitMQ.');
    }

    this.channel.consume('db_queue', async (msg) => {
      if (msg !== null) {
        const data = JSON.parse(msg.content.toString());
        this.logger.log(`[x] Received DB update:`, { data });

        try {
          if (data.task === 'create_metadata') {
            const video = data.data;
            const newMetadata = this.fileMetadataRepository.create({
              originalPath: video.originalPath,
              status: 'pending',
              filename: video.filename,
              fileType: video.fileType,
              fileSize: video.fileSize,
              fileDateTime: video.fileDateTime,
              transcodedPath: '',
            });
            const savedMetadata = await this.fileMetadataRepository.save(newMetadata);
            this.logger.log(`[x] Initial metadata saved for ${savedMetadata.originalPath} with ID ${savedMetadata.id}`);

            // DISPARA O PROCESSO DE TRANSCODIFICAÇÃO COM O ID DO DB
            await this.sendTranscodeRequest(savedMetadata.id, savedMetadata.originalPath);

          } else if (data.task === 'update_metadata') {
            const video = data.data;
            const existingMetadata = await this.fileMetadataRepository.findOneBy({ id: video.dbId });
            
            if (existingMetadata) {
              existingMetadata.status = video.status;
              existingMetadata.transcodedPath = video.transcodedPath;
              await this.fileMetadataRepository.save(existingMetadata);
              this.logger.log(`[x] Metadata updated for ID ${existingMetadata.id}`);
            } else {
              this.logger.warn(`[!] No metadata found for ID ${video.dbId}`);
            }
          }
        } catch (error) {
          this.logger.error('Error processing DB message', { error: error.message });
          this.channel.nack(msg, false, true);
          return;
        }
        this.channel.ack(msg);
      }
    });
  }
}