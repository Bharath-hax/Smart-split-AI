# ── SplitSettle AI — single Dockerfile ───────────────────────────────────
# Builds a production Next.js server (stable, no dev-mode file watching —
# the Windows libuv fs-event crash cannot happen inside this container).

FROM node:20-alpine AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ── 1. Install dependencies (cached unless package files change) ─────────
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ── 2. Build the production bundle ───────────────────────────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Prisma client + schema push (SQLite) so build-time page data checks succeed
RUN npx prisma generate --schema prisma/schema.local.prisma \
 && npx prisma db push --schema prisma/schema.local.prisma --skip-generate \
 && npm run build

# ── 3. Minimal runtime image ─────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
# SQLite lives here; mount a volume on /app/data for persistence
RUN mkdir -p /app/data
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY package.json next.config.mjs ./

EXPOSE 3000
# Push the schema (idempotent) then start the production server.
# `restart: unless-stopped` in docker-compose keeps it alive no matter what.
CMD ["sh", "-c", "npx prisma db push --schema prisma/schema.local.prisma --skip-generate && npm run start"]
