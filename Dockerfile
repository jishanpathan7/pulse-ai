FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# Install ALL deps (including dev — needed for tsx runtime)
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/ packages/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @pulse/api...

# Runtime — copy source + node_modules, run with tsx
FROM base AS runtime
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/pnpm-workspace.yaml .
COPY --from=deps /app/package.json .
COPY --from=deps /app/pnpm-lock.yaml .
COPY packages/ packages/
COPY apps/api/ apps/api/

ENV NODE_ENV=production
EXPOSE 3003

# tsx handles TypeScript imports at runtime — avoids needing compiled dist
CMD ["node_modules/.bin/tsx", "apps/api/src/main.ts"]
