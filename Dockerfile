FROM oven/bun:latest AS deps
WORKDIR /app

COPY package.json bun.lock* tsconfig.json ./
RUN bun install --frozen-lockfile

FROM oven/bun:latest-slim AS runner
WORKDIR /app

ENV BUN_ENV=production
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY . .

EXPOSE 3000

ENTRYPOINT ["bun", "run", "server.ts"]
