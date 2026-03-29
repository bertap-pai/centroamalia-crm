FROM node:20-alpine AS builder
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml ./
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
RUN pnpm install

COPY tsconfig.base.json .
COPY packages/db packages/db
COPY apps/api apps/api
RUN pnpm --filter @crm/db build
RUN pnpm --filter @crm/api build

FROM node:20-alpine
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/db/package.json ./packages/db/
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/

CMD ["node", "apps/api/dist/index.js"]
