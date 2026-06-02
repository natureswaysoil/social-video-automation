FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install

COPY . .

ENV NODE_ENV=production
ENV NODE_OPTIONS=--max-old-space-size=2048
ENV VIDEO_STYLE=broll_ken_burns
ENV GCS_PUBLIC_BUCKET=natureswaysoil-social-videos
ENV VIDEO_PUBLIC_BUCKET=natureswaysoil-social-videos
ENV VIDEO_PUBLIC_URL_BASE=https://storage.googleapis.com/natureswaysoil-social-videos
ENV ENABLE_PLATFORMS=youtube,instagram,facebook
ENV YT_PRIVACY_STATUS=public
ENV DRY_RUN_LOG_ONLY=false

CMD ["node", "--max-old-space-size=2048", "-r", "ts-node/register/transpile-only", "scripts/post-scheduled.ts"]
