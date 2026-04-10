# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npx tsc

# Stage 2: Production
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist/ ./dist/

ENV MCP_TRANSPORT=http
ENV MCP_PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s \
  CMD wget -q -O- http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
