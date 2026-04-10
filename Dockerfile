FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY dist/ ./dist/

ENV MCP_TRANSPORT=http
ENV MCP_PORT=3000

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s \
  CMD wget -q -O- http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
