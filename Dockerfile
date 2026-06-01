FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# Install deps — NODE_ENV=development so pnpm includes tsx (production dep now)
FROM base AS deps
ENV NODE_ENV=development
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/ packages/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @pulse/api...

# Runtime
FROM base AS runtime
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/pnpm-workspace.yaml .
COPY --from=deps /app/package.json .
COPY --from=deps /app/pnpm-lock.yaml .
COPY packages/ packages/
COPY apps/api/ apps/api/

ENV NODE_ENV=production
EXPOSE 3003

CMD ["node_modules/.bin/tsx", "apps/api/src/main.ts"]
