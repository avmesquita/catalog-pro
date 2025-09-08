import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as amqp from 'amqplib';

@Injectable()
export class TranscoderService implements OnModuleInit {
  private channel: amqp.Channel;
  private readonly logger = new Logger(TranscoderService.name);

  constructor() {
    console.log('TranscoderService: Construtor chamado.');
  }

  async onModuleInit() {
    console.log('TranscoderService: onModuleInit chamado. Tentando conectar ao RabbitMQ...');
    try {
      // Conexão assíncrona com o RabbitMQ
      const connection = await amqp.connect('amqp://rabbitmq:5672');
      this.channel = await connection.createChannel();
      await this.channel.assertQueue('transcode_queue', { durable: true }); // Fila não persistente para testes
      this.logger.log('TranscoderService: Conexão com o RabbitMQ estabelecida e fila verificada.');
    } catch (error) {
      this.logger.error('TranscoderService: Erro ao conectar ao RabbitMQ', error);
      // Lança a exceção para que o NestJS saiba que a inicialização falhou
      throw error;
    }
  }

  async processVideos() {
    if (!this.channel) {
      this.logger.error('TranscoderService: Canal do RabbitMQ não está disponível.');
      return;
    }

    const msg = { task: 'process_directory' }; // Mensagem genérica
    this.channel.sendToQueue('transcode_queue', Buffer.from(JSON.stringify(msg)));
    this.logger.log(`[x] Sent processing request to the queue.`);
  }  

  async transcodeVideo(filePath: string) {
    if (!this.channel) {
      this.logger.error('TranscoderService: Canal do RabbitMQ não está disponível.');
      return;
    }
    const msg = { filePath: filePath };
    this.channel.sendToQueue('transcode_queue', Buffer.from(JSON.stringify(msg)));
    this.logger.log(`[x] Sent video transcode request for: ${filePath}`);
  }
}