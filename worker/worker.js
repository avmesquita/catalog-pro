const amqp = require('amqplib');
const { spawn, exec } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const winston = require('winston');
const os = require('os');

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'worker.log' })
    ],
});

let connection;
let channel;
const videoDir = '/videos';

function getVideoDuration(filePath) {
    return new Promise((resolve, reject) => {
        exec(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`, (error, stdout, stderr) => {
            if (error) {
                reject(error);
                return;
            }
            const duration = parseFloat(stdout);
            resolve(duration);
        });
    });
}

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
                try {
                    const fileStat = await fs.stat(fullPath);
                    const fileData = {
                        originalPath: fullPath,
                        filename: file.name,
                        fileType: fileExtension.substring(1),
                        fileSize: fileStat.size,
                        fileDateTime: fileStat.mtime.toISOString(),
                        status: 'pending'
                    };
                    videoFiles.push(fileData);
                } catch (err) {
                    logger.error(`[!] Failed to get file stats for ${fullPath}`, { error: err.message });
                }
            }
        }
    }
    logger.info(`Found ${videoFiles.length} video files.`);
    return videoFiles;
}

function getTranscodedPath(originalPath) {
    const relativePath = path.relative(videoDir, originalPath);
    const transcodedDir = '/transcoded_videos';
    return path.join(transcodedDir, relativePath);
}

async function transcodeVideo(filePath, transcodedPath) {
    logger.info(`[x] Starting transcoding`, { filePath });
    logger.info(`[x] Transcoding to: ${transcodedPath}`);

    try {
        await fs.mkdir(path.dirname(transcodedPath), { recursive: true });
    } catch (err) {
        logger.error(`[!] Failed to create directory: ${path.dirname(transcodedPath)}`, { error: err.message });
        throw err;
    }

    return new Promise( async(resolve, reject) => {
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

        const duration = await getVideoDuration(filePath);
        const timeoutInMs = (duration * 1.5) * 1000; // 1.5x a duração do vídeo em milissegundos

        const timeout = setTimeout(() => {
            logger.error(`[!] FFmpeg process for ${filePath} timed out after 4 hours. Killing process.`);
            ffmpeg.kill('SIGKILL');
            reject(new Error(`FFmpeg process for ${filePath} timed out.`));
        }, timeoutInMs); // 4 horas em milissegundos

        ffmpeg.stderr.on('data', (data) => {
            logger.info(data.toString().trim());
        });

        ffmpeg.on('close', async (code) => {
            if (code === 0) {
                try {
                    const stats = await fs.stat(transcodedPath);
                    if (stats.size > 0) {
                        logger.info(`[x] Transcoding finished successfully for ${filePath}`);
                        resolve();
                    } else {
                        const errorMessage = `[!] Transcoded file is 0 bytes for ${filePath}`;
                        logger.error(errorMessage);
                        reject(new Error(errorMessage));
                    }
                } catch (err) {
                    const errorMessage = `[!] Failed to get file stats after transcoding for ${filePath}`;
                    logger.error(errorMessage, { error: err.message });
                    reject(new Error(errorMessage));
                }
            } else {
                logger.error(`[!] FFmpeg exited with code ${code} for ${filePath}`);
                reject(new Error(`FFmpeg exited with code ${code}`));
            }
        });

        ffmpeg.on('error', (err) => {
            logger.error(`[!] Failed to start FFmpeg process for ${filePath}`, { error: err.message });
            reject(err);
        });
    });
}

async function sendDbCreateRequest(videoData) {
    if (!channel) return;
    const msg = { task: 'create_metadata', data: videoData };
    channel.sendToQueue('db_queue', Buffer.from(JSON.stringify(msg)));
    logger.info(`[x] Sent DB create request`, { videoData });
}

async function sendDbUpdateRequest(dbId, status, transcodedPath) {
    if (!channel) return;
    const msg = { task: 'update_metadata', data: { dbId, status, transcodedPath } };
    channel.sendToQueue('db_queue', Buffer.from(JSON.stringify(msg)));
    logger.info(`[x] Sent DB update request`, { dbId, status, transcodedPath });
}

async function startWorker() {
    let connected = false;
    let retries = 0;
    const maxRetries = 10;
    const retryInterval = 5000;

    const connectToRabbitMQ = async () => {
        try {
            logger.info('Worker: Tentando conectar ao RabbitMQ...');
            connection = await amqp.connect('amqp://rabbitmq:5672');
            channel = await connection.createChannel();
            await channel.assertQueue('transcode_queue', { durable: true });
            await channel.assertQueue('db_queue', { durable: true });
            logger.info('Worker: Conexão com RabbitMQ estabelecida e filas verificadas.');

            // Event listener para lidar com a queda da conexão
            connection.on('error', (err) => {
                logger.error('Connection error. Attempting to reconnect...', { error: err.message });
                if (!connection.closing) {
                    process.exit(1); // Sai para que o Docker possa reiniciar o contêiner
                }
            });
            return true;
        } catch (error) {
            retries++;
            logger.error(`Falha na conexão com RabbitMQ. Tentativa ${retries}/${maxRetries}.`, { error: error.message });
            await new Promise(res => setTimeout(res, retryInterval));
            return false;
        }
    };

    while (!connected && retries < maxRetries) {
        connected = await connectToRabbitMQ();
    }

    if (!connected) {
        logger.error('Não foi possível conectar ao RabbitMQ após várias tentativas. Encerrando.');
        process.exit(1);
    }

    const concurrencyLimit = os.cpus().length > 2 ? os.cpus().length - 1 : 1;
    let activeJobs = 0;
    
    const consumerOptions = {
        noAck: false,
        consumer_timeout: 3600000 * 2
    };

    channel.consume('transcode_queue', async (msg) => {
        if (msg !== null) {
            if (activeJobs >= concurrencyLimit) {
                logger.info(`Concurrency limit reached (${activeJobs}/${concurrencyLimit}). Re-queuing message.`);
                channel.nack(msg, false, true);
                return;
            }

            const data = JSON.parse(msg.content.toString());
            logger.info(`[x] Received job from transcode_queue. Starting job ${activeJobs + 1}/${concurrencyLimit}`, { data });
            
            activeJobs++;

            try {
                if (data.task === 'process_directory') {
                    logger.info('Received request to process directory.');
                    const videoFiles = await findVideoFiles(videoDir);
                    logger.info(`Total videos found = ${videoFiles.length}`);

                    for (const fileData of videoFiles) {
                        await sendDbCreateRequest(fileData);
                    }
                } else if (data.task === 'transcode_video') {
                    const { dbId, originalPath } = data;
                    const transcodedPath = getTranscodedPath(originalPath);
                    
                    await transcodeVideo(originalPath, transcodedPath);
                    
                    await sendDbUpdateRequest(dbId, 'completed', transcodedPath);

                } else {
                    logger.warn(`[!] Unknown task received`, { data });
                }
                channel.ack(msg);
            } catch (error) {
                logger.error('Error processing job. Message will NOT be re-queued.', { error: error.message, data });
                await sendDbUpdateRequest(data.dbId, 'failed', null);
                channel.nack(msg, false, false);
            } finally {
                activeJobs--;
            }
        }
    }, consumerOptions);
}

startWorker();
