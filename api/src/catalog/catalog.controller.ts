import { Controller, Get, Query, Res, HttpStatus, Post } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { Response } from 'express';
import { CatalogService } from './catalog.service';
import { TranscoderService } from '../transcoder/transcoder.service';
import { FileMetadata } from 'src/file-metadata/file-metadata.entity';

@ApiTags('catalog')
@Controller('catalog')
export class CatalogController {
  constructor(
    private readonly catalogService: CatalogService,
    private readonly transcoderService: TranscoderService, // Injetando o novo serviço
  ) {}

 @Post('process')
  @ApiOperation({
    summary: 'Inicia o processamento de vídeos a partir de um diretório.',
    description: 'Envia uma mensagem para o worker iniciar a descoberta de novos vídeos para processamento.',
  })
  async processDirectory(@Res() res: Response) {
    // Envia uma mensagem genérica para a fila para iniciar o processamento
    await this.transcoderService.processVideos();

    return res.status(HttpStatus.ACCEPTED).send({
      message: 'Processamento de vídeos iniciado em segundo plano.',
    });
  }
  
  @Get('videos')
  @ApiOperation({
    summary: 'Retorna todos os vídeos catalogados.',
    description: 'Obtém uma lista de todos os metadados de vídeos armazenados no banco de dados.',
  })
  async getVideos(): Promise<FileMetadata[]> {
    return this.catalogService.getCatalog();
  }

  @Get('stream')
  @ApiOperation({
    summary: 'Faz o streaming e transcodificação de um vídeo.',
    description: 'Este endpoint usa o ID do vídeo para localizar o arquivo, transcodifica-o em tempo real para um formato compatível (MP4) e faz o streaming para o navegador.',
  })
  @ApiQuery({
    name: 'id',
    description: 'ID único do vídeo no catálogo.',
    example: '123',
  })
  async streamVideo(@Query('id') id: string, @Res() res: Response) {
    if (!id) {
      return res.status(HttpStatus.BAD_REQUEST).send('O parâmetro "id" é obrigatório.');
    }

    try {
        const video = await this.catalogService.findVideoById(parseInt(id, 10));
        if (!video) {
            return res.status(HttpStatus.NOT_FOUND).send('Vídeo não encontrado.');
        }

        const filePath = video.originalPath;

        // Ao invés de processar aqui, enviamos a requisição para a fila
        await this.transcoderService.transcodeVideo(filePath);

        // Retorna uma resposta indicando que a transcodificação foi solicitada
        res.status(HttpStatus.ACCEPTED).send('Transcodificação solicitada. O streaming começará em breve.');

    } catch (error) {
        console.error('Erro ao solicitar a transcodificação:', error);
        return res.status(HttpStatus.NOT_FOUND).send('Arquivo não encontrado ou acesso negado.');
    }
  }
}