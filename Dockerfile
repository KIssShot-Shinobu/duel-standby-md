FROM node:22-bookworm

# ffmpeg  : konversi stiker/audio/video
# imagemagick & webp : opsional, untuk alat tambahan
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg imagemagick webp ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=5000
EXPOSE 5000

CMD ["node", "index.js"]
