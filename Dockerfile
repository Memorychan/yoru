FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 python3-venv ca-certificates openssl postgresql-15 redis-server && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund
COPY requirements.txt ./
RUN python3 -m venv /opt/hf && /opt/hf/bin/pip install --no-cache-dir -r requirements.txt
ENV PYTHON_BIN=/opt/hf/bin/python
COPY . .
ARG API_INTERNAL_URL=http://127.0.0.1:4000
ARG GATEWAY_INTERNAL_URL=http://127.0.0.1:4001
ENV API_INTERNAL_URL=$API_INTERNAL_URL
ENV GATEWAY_INTERNAL_URL=$GATEWAY_INTERNAL_URL
RUN npm run db:generate && npm run build
ENV NODE_ENV=production
ENV DATA_DIR=/home/node/data
ENV PG_BIN=/usr/lib/postgresql/15/bin
RUN mkdir -p /home/node/data /app/data && chown -R node:node /app /home/node/data
USER node
EXPOSE 7860
CMD ["node", "scripts/start-space.cjs"]
