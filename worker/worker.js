// worker.js
const amqp = require('amqplib');
const { spawn } = require('child_process');
const { createReadStream } = require('fs');
const fs = require('fs').promises;
const path = require('path');
const winston = require('winston');

// 1. Configuração do Logger
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console(),
        // Você pode adicionar um transporte de arquivo para persistir os logs
        new winston.transports.File({ filename: 'worker.log' })
    ],
});

let connection;
let channel;

// Função de escaneamento de diretórios
async function findVideoFiles(dir) {
    // Sua lógica de escaneamento aqui...
    logger.info('Starting directory scan', { directory: dir });
    const files = await fs.readdir(dir, { withFileTypes: true });
    const videoFiles = [];

    for (const file of files) {
        const fullPath = path.join(dir, file.name);

        if (file.isDirectory()) {
            videoFiles.push(...(await findVideoFiles(fullPath)));
        } else if (file.isFile() && (file.name.endsWith('.mp4') || file.name.endsWith('.mov') || file.name.endsWith('.mkv'))) {
            videoFiles.push(fullPath);
        }
    }
    logger.info(`Found ${videoFiles.length} video files.`);
    return videoFiles;
}

// Função para enviar uma mensagem de transcodificação para a fila
async function sendTranscodeRequest(filePath) {
    if (!channel) {
        logger.error('Worker: RabbitMQ channel is not available.');
        return;
    }
    const msg = { task: 'transcode_video', filePath: filePath };
    channel.sendToQueue('transcode_queue', Buffer.from(JSON.stringify(msg)));
    logger.info(`[x] Sent transcode request`, { filePath });
}

// Função para transcodificar um vídeo (lógica do FFmpeg)
async function transcodeVideo(filePath) {
    logger.info(`[x] Starting transcoding`, { filePath });
    return new Promise((resolve, reject) => {
        const fileStream = createReadStream(filePath);
        const ffmpeg = spawn('ffmpeg', [
            '-loglevel', 'error',
            '-nostdin',
            '-probesize', '5M',
            '-i', 'pipe:0',
            '-movflags', 'frag_keyframe+empty_moov',
            '-c:v', 'libx264',
            '-c:a', 'aac',
            '-f', 'mp4',
            'pipe:1',
        ]);
        
        fileStream.pipe(ffmpeg.stdin);
        
        ffmpeg.on('close', (code) => {
            if (code === 0) {
                logger.info(`[x] Transcoding finished`, { filePath });
                resolve();
            } else {
                logger.error(`[!] FFmpeg exited with code ${code}`, { filePath });
                reject(new Error(`FFmpeg exited with code ${code}`));
            }
        });
        
        ffmpeg.on('error', (err) => {
            logger.error(`[!] FFmpeg process error`, { filePath, error: err.message });
            reject(err);
        });
    });
}

// Função principal que consome as mensagens
async function startWorker() {
    try {
        logger.info('Worker starting...');
        connection = await amqp.connect('amqp://rabbitmq:5672');
        channel = await connection.createChannel();
        const queueName = 'transcode_queue';
        await channel.assertQueue(queueName, { durable: true });
        logger.info(`[*] Waiting for messages in ${queueName}.`);

        // 2. Tratamento de Erros no Canal
        channel.on('error', (err) => {
            logger.error('Channel error', { error: err.message });
            process.exit(1);
        });
        
        channel.consume(queueName, async (msg) => {
            if (msg !== null) {
                const data = JSON.parse(msg.content.toString());
                logger.info(`[x] Received job`, { data });
                
                try {
                    if (data.task === 'process_directory') {
                        logger.info('Received request to process directory.');
                        const videoDir = '/videos'; 
                        const videoFiles = await findVideoFiles(videoDir);
                        for (const file of videoFiles) {
                            await sendTranscodeRequest(file);
                        }
                    } else if (data.task === 'transcode_video') {
                        const filePath = data.filePath;
                        await transcodeVideo(filePath);
                    } else {
                        logger.warn(`[!] Unknown task received`, { data });
                    }
                } catch (error) {
                    logger.error('Error processing job', { error: error.message, data });
                } finally {
                    channel.ack(msg);
                }
            }
        });
    } catch (error) {
        logger.error('Failed to start worker', { error: error.message });
        process.exit(1);
    }
}

// 3. Tratamento de Erros Globais
process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    process.exit(1);
});

startWorker();