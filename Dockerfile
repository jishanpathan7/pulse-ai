FROM node:22-alpine
RUN corepack enable && corepack prepare pnpm@latest --activate && npm install -g tsx
WORKDIR /app

# Copy monorepo manifests
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/ packages/
COPY apps/api/package.json apps/api/

# Install all deps in place (pnpm symlinks stay valid — no stage copy)
ENV NODE_ENV=development
RUN pnpm install --frozen-lockfile --filter @pulse/api...

# Copy source
COPY apps/api/src/ apps/api/src/

ENV NODE_ENV=production
EXPOSE 3003
CMD ["tsx", "apps/api/src/main.ts"]
