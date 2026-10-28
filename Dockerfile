# PreviewPilot GitHub App server. The Playwright image already has Chromium and its system libraries.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production PORT=3001 RUNS_DIR=/data/runs
VOLUME /data
EXPOSE 3001
CMD ["node", "dist/app/server.js"]
