FROM node:22-slim

# Prisma's engines need OpenSSL on slim images.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Workspace root manifests first, so npm can resolve packages/contract as a workspace.
COPY package.json package-lock.json* ./
COPY packages/contract/package.json ./packages/contract/
COPY backend/package.json ./backend/
RUN npm install

COPY packages/contract/ ./packages/contract/
COPY backend/ ./backend/
# The seeder reads real data out of frontend/src/data/seed — bring that along rather than
# duplicating the JSON into this image.
COPY frontend/src/data/seed/ ./frontend/src/data/seed/

WORKDIR /app/backend
RUN npx prisma generate

ENV PORT=3000
EXPOSE 3000

# DATABASE_URL comes from compose (the `db` service). Migrate, seed (idempotent) — procurement then
# production, each with its own idempotency guard since seed.ts's `receipt.count() > 0` guard would
# otherwise skip production seeding forever on a DB seeded before this file existed — then serve.
CMD npx prisma migrate deploy && npx tsx prisma/seed.ts && npx tsx prisma/seedProduction.ts && npx tsx src/server.ts
