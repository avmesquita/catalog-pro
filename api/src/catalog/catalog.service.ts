// src/catalog/catalog.service.ts
import { ConsoleLogger, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import * as fs from 'fs/promises';
import * as path from 'path';
import { FileMetadata } from 'src/file-metadata/file-metadata.entity';

@Injectable()
export class CatalogService implements OnModuleInit {
  private readonly logger = new Logger(CatalogService.name);

  constructor(
    @InjectRepository(FileMetadata)
    private fileMetadataRepository: Repository<FileMetadata>    
  ) {
    this.logger.log('CatalogService: Construtor chamado.');
  }

  async onModuleInit() {
    console.log('CatalogService: onModuleInit chamado. Repositório injetado.');
    // Você pode até mesmo tentar uma query aqui para testar a conexão
    try {
      await this.fileMetadataRepository.count();
      this.logger.log('CatalogService: Conexão com a base de dados testada com sucesso.');
    } catch (error) {
      this.logger.error('CatalogService: Erro ao testar a conexão com a base de dados', error);
    }
  }  

  private isVideoFile(filename: string): boolean {
    const videoExtensions = ['.mp4', '.mkv', '.avi', '.mov'];
    const ext = path.extname(filename).toLowerCase();
    return videoExtensions.includes(ext);
  }

  async processDirectory(directoryPath: string): Promise<string> {
    try {
      await this.readDirectoryRecursively(directoryPath);
      return 'Processamento concluído com sucesso!';
    } catch (error) {
      this.logger.error('Erro ao processar o diretório:', error);
      return 'Ocorreu um erro ao processar o diretório.';
    }
  }

  private async readDirectoryRecursively(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        await this.readDirectoryRecursively(fullPath);
      } else if (entry.isFile() && this.isVideoFile(entry.name)) {
        await this.processFile(fullPath);
      }
    }
  }

  // Use a full path, as the server needs it for streaming
  private async processFile(filePath: string): Promise<void> {
  const existingFile = await this.fileMetadataRepository.findOne({
      where: { originalPath: filePath },
    });

    if (existingFile) {
      this.logger.log(`Arquivo já catalogado, pulando: ${filePath}`);
      return;
    }

    try {
      const stats = await fs.stat(filePath);
      const metadata = new FileMetadata();
      metadata.originalPath = filePath; // SAVE THE FULL ABSOLUTE PATH
      metadata.filename = path.basename(filePath);
      metadata.fileType = path.extname(filePath);
      metadata.fileDateTime = stats.mtime;
      metadata.fileSize = stats.size;

      await this.fileMetadataRepository.save(metadata);
      this.logger.log(`Arquivo catalogado: ${filePath}`);
    } catch (error) {
      this.logger.error(`Erro ao processar o arquivo ${filePath}:`, error);
    }
  }

  async getCatalog(): Promise<FileMetadata[]> {
    return this.fileMetadataRepository.find();
  }

  async getFileStats(filePath: string) {
    return fs.stat(filePath);
  }

  async findVideoById(id: number): Promise<FileMetadata | null> {
      return this.fileMetadataRepository.findOne({ where: { id } });
  }  
}