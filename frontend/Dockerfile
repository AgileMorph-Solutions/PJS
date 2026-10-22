# Multi-stage: compile the Vite/React app, then serve the static bundle with nginx.
#
# The build context is the REPO ROOT, not frontend/ — the app imports @anagroci/contract, which is
# a workspace package, so npm needs the root manifest and packages/ to resolve it.
#
# Debian (glibc), not Alpine: Vite 8 builds through rolldown, whose native binding ships as an
# optional dependency with no musl build.
FROM node:20-slim AS build
WORKDIR /app

COPY package.json ./
COPY packages/contract/package.json ./packages/contract/
COPY frontend/package.json ./frontend/
# The lockfile is deliberately NOT copied here. npm resolves optional deps per platform and records
# only the host's (npm/cli#4828), so a lockfile generated on macOS omits rolldown's linux binding
# and the build fails inside the container. The backend image does use the lockfile — it has no
# native deps. See backend/README.md.
RUN npm install --no-audit --no-fund

COPY packages/contract/ ./packages/contract/
COPY frontend/ ./frontend/
RUN npm -w frontend run build

FROM nginx:alpine AS serve
COPY --from=build /app/frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
