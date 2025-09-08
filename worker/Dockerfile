# Usa uma imagem base do Node.js LTS
FROM node:18

# Instala FFmpeg
#RUN apk add --no-cache ffmpeg
RUN apt-get update && apt-get install -y ffmpeg

# Define o diretório de trabalho no container
WORKDIR /app

# Copia os arquivos de configuração do Node.js
COPY package*.json ./

# Instala as dependências (neste caso, amqplib e o que mais precisar)
RUN npm install

# Copia o script do worker
COPY worker.js .

# Define o comando para iniciar o worker
CMD [ "node", "worker.js" ]
