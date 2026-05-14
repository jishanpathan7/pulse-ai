FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# Install deps
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/ packages/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @pulse/web...

# Build static assets
FROM deps AS build
COPY packages/ packages/
COPY apps/web/ apps/web/
# VITE_API_URL can be injected at build time or handled via runtime env
RUN pnpm --filter @pulse/web build

# Serve with nginx
FROM nginx:alpine AS runtime
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
