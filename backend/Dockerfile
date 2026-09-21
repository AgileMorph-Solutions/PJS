FROM node:22-slim

WORKDIR /app

# The seed script reads real data out of ../frontend/src/data/seed — bring that along too rather
# than duplicating the JSON into this image.
COPY backend/package.json backend/package-lock.json* ./
RUN npm install
COPY backend/ ./
COPY frontend/src/data/seed/ /frontend/src/data/seed/

RUN npx prisma generate

ENV DATABASE_URL="file:/data/prod.db"
ENV PORT=3000
VOLUME ["/data"]
EXPOSE 3000

CMD npx prisma migrate deploy && npx tsx prisma/seed.ts && npx tsx src/server.ts
