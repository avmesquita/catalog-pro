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
    logger.info('File sent to sendTranscodeRequest', filePath);    
    if (!channel) {
        logger.error('Worker: RabbitMQ channel is not available.');
        return;
    }
    const msg = { task: 'transcode_video', filePath: filePath };
    channel.sendToQueue('transcode_queue', Buffer.from(JSON.stringify(msg)));
    logger.info(`[x] Sent transcode request`, { filePath });
}

async function sendDbUpdateRequest(videoData) {
    if (!channel) {
        logger.error('Worker: Canal do RabbitMQ não está disponível.');
        return;
    }
    const msg = { task: 'save_video_metadata', data: videoData };
    // AQUI: Envia para a nova fila 'db_queue'
    channel.sendToQueue('db_queue', Buffer.from(JSON.stringify(msg)));
    logger.info(`[x] Sent DB update request`, { videoData });
}

// Função para transcodificar um vídeo (lógica do FFmpeg)
async function transcodeVideo(filePath) {
    logger.info(`[x] Starting transcoding`, { filePath });

    const transcodedPath = getTranscodedPath(filePath);
    logger.info(`[x] Transcoding to: ${transcodedPath}`);

    // Cria os diretórios recursivamente para garantir que o caminho exista
    await fs.mkdir(path.dirname(transcodedPath), { recursive: true });

    return new Promise((resolve, reject) => {

        try {
            const fileStream = createReadStream(filePath);
            const ffmpeg = spawn('ffmpeg', [
                '-report', // <--- Adicione esta flag para criar um log detalhado
                '-y', // <--- Overwrite output file without asking
                '-i', filePath, // <--- Entrada direta do arquivo
                '-c:v', 'libx264',
                '-c:a', 'aac',
                '-pix_fmt', 'yuv420p', // <--- Add this for wider compatibility
                '-movflags', '+faststart', // <--- Optimize for web streaming
                transcodedPath // <--- Saída do arquivo transcodificado
            ]);        

            // Trata a saída e o erro para evitar bloqueios
            ffmpeg.stdout.on('data', (data) => { /* ignore */ });
            ffmpeg.stderr.on('data', (data) => {
                logger.error(`[!] FFmpeg stderr: ${data.toString()}`, { filePath });
            });
            
            fileStream.pipe(ffmpeg.stdin);

            ffmpeg.on('message', (msg) => {
                logger.log('ffmped :: message event :: ', msg);
            });

            ffmpeg.on('exit', (code, signal) => {
                logger.log('ffmped :: exit event :: ', code, signal);
            });

            ffmpeg.on('close', (code) => {
                if (code === 0) {
                    logger.info(`[x] Transcoding finished`, { filePath });
                    // Envia a mensagem de sucesso para a fila de retorno
                    sendDbUpdateRequest({ status: 'completed', originalPath: filePath });
                    resolve();
                } else {
                    logger.error(`[!] FFmpeg exited with code ${code}`, { filePath });
                    // Envia a mensagem de falha para a fila de retorno
                    sendDbUpdateRequest({ status: 'failed', originalPath: filePath, error: `FFmpeg exited with code ${code}` });
                    reject(new Error(`FFmpeg exited with code ${code}`));                
                }
            });

            ffmpeg.on('error', (err) => {
                logger.error(`[!] FFmpeg process error`, { filePath, error: err.message });
                sendDbUpdateRequest({ status: 'failed', originalPath: filePath, error: err.message });
                reject(err);
            });            
        } catch (error) {
            logger.error("transcodeVideo error ", error);
            reject(err);
        }
    });
}

// Função para gerar o caminho de saída no novo volume
function getTranscodedPath(originalPath) {
    // 1. Pega o diretório e o nome do arquivo do caminho original
    const originalDir = path.dirname(originalPath); // Ex: /videos/2012/05
    const originalFilename = path.basename(originalPath); // Ex: video-2012-05-13-08-44-46.mp4
    
    // 2. Cria um novo caminho base a partir do volume de saída
    const transcodedBaseDir = '/transcoded_videos';
    const relativePath = path.relative('/videos', originalDir); // Pega a parte relativa do caminho: 2012/05
    
    // 3. Junta tudo para formar o caminho final
    const finalPath = path.join(transcodedBaseDir, relativePath, originalFilename);
    
    return finalPath;
}

// Função principal que consome as mensagens
async function startWorker() {
    try {
        logger.info('Worker starting...');
        connection = await amqp.connect('amqp://rabbitmq:5672');
        channel = await connection.createChannel();
        const queueName = 'transcode_queue';
        await channel.assertQueue(queueName, { durable: true });
        await channel.assertQueue('db_queue', { durable: true });
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
                        logger.info("Total videos found = ", videoFiles.length);
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