FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ─────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/scripts/migrate-and-start.mjs ./scripts/migrate-and-start.mjs
COPY --from=builder /app/migrate-only.mjs ./migrate-only.mjs

EXPOSE 3001
CMD ["node", "scripts/migrate-and-start.mjs"]
