# Usa uma imagem base do Node.js LTS
FROM node:18

# Instala FFmpeg
# RUN apk add --no-cache ffmpeg
RUN apt-get update && apt-get install -y ffmpeg

# Define o diretório de trabalho no container
WORKDIR /app

# Copia os arquivos de configuração do Node.js
COPY package*.json ./

# Instala as dependências da aplicação
RUN npm install

# Copia todo o código-fonte
COPY . .

# Expõe a porta que sua aplicação NestJS usa
EXPOSE 3000

# Compila a aplicação TypeScript para JavaScript
RUN npm run build

# Define o comando para iniciar a aplicação
CMD [ "npm", "run", "start:prod" ]
