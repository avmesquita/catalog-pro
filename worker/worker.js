const amqp = require('amqplib');
const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file'); 

// 1. Configuração do Logger
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console(),
        new DailyRotateFile({
            filename: 'worker-%DATE%.log', // Nome do arquivo. %DATE% será substituído pela data.
            datePattern: 'YYYY-MM-DD',     // Formato da data. Cria um novo arquivo por dia.
            zippedArchive: true,           // Comprime arquivos antigos em .zip.
            maxSize: '20m',                // Rotaciona o arquivo quando ele atinge 20MB.
            maxFiles: '14d'                // Mantém logs dos últimos 14 dias.
        })
    ],
});

let connection;
let channel;

// Função de escaneamento de diretórios
async function findVideoFiles(dir) {
    logger.info('Starting directory scan', { directory: dir });
    const files = await fs.readdir(dir, { withFileTypes: true });
    const videoFiles = [];

     const allowedExtensions = ['.mp4', '.mov', '.mkv', '.avi', '.3gp'];

    for (const file of files) {
        const fullPath = path.join(dir, file.name);
        if (file.isDirectory()) {
            videoFiles.push(...(await findVideoFiles(fullPath)));
        } else if (file.isFile()) {
            const fileExtension = path.extname(file.name).toLowerCase();
            if (allowedExtensions.includes(fileExtension)) {
                videoFiles.push(fullPath);
            }
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

// Função para enviar uma atualização de status para a fila do banco de dados
async function sendDbUpdateRequest(videoData) {
    if (!channel) {
        logger.error('Worker: Canal do RabbitMQ não está disponível.');
        return;
    }
    const msg = { task: 'save_video_metadata', data: videoData };
    channel.sendToQueue('db_queue', Buffer.from(JSON.stringify(msg)));
    logger.info(`[x] Sent DB update request`, { videoData });
}

// Função para transcodificar um vídeo (lógica do FFmpeg)
async function transcodeVideo(filePath) {
    logger.info(`[x] Starting transcoding`, { filePath });

    const transcodedPath = getTranscodedPath(filePath);
    logger.info(`[x] Transcoding to: ${transcodedPath}`);

    try {
        await fs.mkdir(path.dirname(transcodedPath), { recursive: true });
    } catch (err) {
        logger.error(`[!] Failed to create directory: ${path.dirname(transcodedPath)}`, { error: err.message });
        throw err;
    }

    return new Promise((resolve, reject) => {
        const ffmpeg = spawn('ffmpeg', [
            '-report',
            '-y',
            '-i', filePath,
            '-c:v', 'libx264',
            '-crf', '28',
            '-c:a', 'aac',
            '-pix_fmt', 'yuv420p',
            '-movflags', '+faststart',
            transcodedPath
        ]);

        ffmpeg.stderr.on('data', (data) => {
            logger.error(`[!] FFmpeg stderr: ${data.toString()}`, { filePath });
        });
        
        ffmpeg.on('close', (code) => {
            if (code === 0) {
                logger.info(`[x] Transcoding finished`, { filePath });
                sendDbUpdateRequest({ status: 'completed', originalPath: filePath, transcodedPath: transcodedPath });
                resolve();
            } else {
                logger.error(`[!] FFmpeg exited with code ${code}`, { filePath });
                sendDbUpdateRequest({ status: 'failed', originalPath: filePath, error: `FFmpeg exited with code ${code}` });
                reject(new Error(`FFmpeg exited with code ${code}`));                
            }
        });

        ffmpeg.on('error', (err) => {
            logger.error(`[!] FFmpeg process error`, { filePath, error: err.message });
            sendDbUpdateRequest({ status: 'failed', originalPath: filePath, error: err.message });
            reject(err);
        });
    });
}

// Função para gerar o caminho de saída no novo volume
function getTranscodedPath(originalPath) {
    const originalDir = path.dirname(originalPath);
    const originalFilename = path.basename(originalPath);
    const transcodedBaseDir = '/transcoded_videos';
    const relativePath = path.relative('/videos', originalDir);
    const finalPath = path.join(transcodedBaseDir, relativePath, originalFilename);
    return finalPath;
}

// Função principal que consome as mensagens
async function startWorker() {
    let connected = false;
    let attempts = 0;
    const maxAttempts = 10;
    const retryDelay = 5000;

    while (!connected && attempts < maxAttempts) {
        attempts++;
        try {
            logger.info(`Worker starting... (Attempt ${attempts} of ${maxAttempts})`);
            connection = await amqp.connect('amqp://rabbitmq:5672');
            channel = await connection.createChannel();
            
            channel.on('error', (err) => {
                logger.error('Channel error', { error: err.message });
            });
            
            connected = true;
            logger.info('Connection to RabbitMQ established successfully.');
        } catch (error) {
            logger.error(`Failed to connect to RabbitMQ. Retrying in ${retryDelay / 1000}s...`, { error: error.message });
            await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
    }

    if (!connected) {
        logger.error('Failed to connect to RabbitMQ after multiple attempts. Exiting...');
        process.exit(1);
    }

    // AQUI: Limite o número de mensagens não confirmadas para 1 por vez
    await channel.prefetch(1);
                
    const queueName = 'transcode_queue';
    await channel.assertQueue(queueName, { durable: true });
    await channel.assertQueue('db_queue', { durable: true });
    logger.info(`[*] Waiting for messages in ${queueName}.`);

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
                logger.error('Stack Trace:', error.stack);
            } finally {
                channel.ack(msg);
            }
        }
    }, { noAck: false });
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