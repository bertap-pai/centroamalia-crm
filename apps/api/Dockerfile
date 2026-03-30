FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json .
COPY packages/db packages/db
COPY apps/api apps/api
RUN pnpm --filter @crm/db build
RUN pnpm --filter @crm/api build

FROM node:20-alpine
WORKDIR /app
RUN corepack enable

# Install only production dependencies using the lockfile so pnpm correctly
# resolves workspace package deps (e.g. postgres, drizzle-orm) via its virtual
# store. Copying node_modules from the builder loses the workspace symlinks.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/packages/db/dist ./packages/db/dist
# Copy migrations so the runtime can apply them on startup
COPY packages/db/migrations ./packages/db/migrations
COPY --from=builder /app/apps/api/dist ./apps/api/dist

# Run migrations then start the server
CMD ["sh", "-c", "node packages/db/dist/migrate.js && node apps/api/dist/index.js"]
