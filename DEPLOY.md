# Production deploy — pjs.agilemorph.in

This runs on `srv1758903` (72.62.21.175), a shared VPS that already runs one Traefik instance
(`/docker/traefik`) in front of every app on the box — `review.srv1758903.hstgr.cloud`,
`dashboard.srv1758903.hstgr.cloud`, etc. Traefik owns ports 80/443 and issues its own Let's Encrypt
certificates per domain, discovering backends via Docker labels
(`--providers.docker=true`, `--providers.docker.exposedbydefault=false`).

`docker-compose.prod.yml` follows the same pattern as the other apps on this host
(`/root/executive-review-automation/docker-compose.yml` is the reference): it does **not** publish
any port to the host, and does **not** run its own reverse proxy on 80/443 or manage its own
certificates. `nginx` (serves the built SPA, proxies `/api` to `backend`) carries `traefik.*`
labels for `Host(\`pjs.agilemorph.in\`)`; Traefik discovers it via the Docker socket, terminates TLS,
and forwards plain HTTP to it. `db` and `backend` aren't reachable from outside the compose network
at all — the smallest surface Traefik never needs to touch them.

**Non-root throughout:** `nginx` is `nginxinc/nginx-unprivileged` (`frontend/Dockerfile.prod`) —
runs entirely as an unprivileged user, listens on 8080, never binds a privileged port itself.
`backend` (`backend/Dockerfile.prod`) runs as its own dedicated unprivileged user. `db` uses the
official postgres image, already non-root. Nothing in this stack needs root or
`CAP_NET_BIND_SERVICE` — Traefik is the only thing on the box touching 80/443, exactly as it
already does for every other app here.

## Prerequisites (already true on this host)

- DNS: `pjs.agilemorph.in` → `72.62.21.175`. Verified live — `dig +short pjs.agilemorph.in`
  returns `72.62.21.175`, which is this host's own public IPv4.
- Traefik running with a `letsencrypt` cert resolver (`docker ps` shows `traefik-traefik-1`).

If either of those isn't true in a future environment, fix that first — the compose file assumes
both.

## Deploy

```bash
cd /root/PJS-rcn-tracking/PJS   # or wherever this repo lives on the host
cp .env.prod.example .env.prod
# edit .env.prod: set a strong POSTGRES_PASSWORD, and ADMIN_PASSWORD (+ optionally ADMIN_USERNAME,
# default "admin") — the first admin. Without ADMIN_PASSWORD no account exists and nobody can sign in.

docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

`backend`'s container runs `prisma migrate deploy` (applies pending migrations) and the idempotent
`prisma/seed.ts` on every start, then serves. Since Oct 2026 that sets up only the two sites and the user accounts;
it loads no data, so an empty database stays empty until the team enters records in the app — same behavior as the dev compose file, just without
publishing 3000 or 5432 to the host.

The first request to `https://pjs.agilemorph.in` triggers nothing extra — Traefik requests and
caches the certificate itself the first time it sees traffic for that router (typically a few
seconds after the container comes up and Traefik's Docker provider notices the label). Watch it if
needed:

```bash
docker logs -f traefik-traefik-1 | grep -i pjs
```

## First admin

Every request needs a signed-in user, and a fresh (or newly-upgraded) database has none. The
seeder creates the first admin from `ADMIN_USERNAME` / `ADMIN_PASSWORD` in `.env.prod`, but only
while no admin exists, so it never overwrites a changed password. After the first sign-in, create the
real users under Administration › Users and change the admin password. There are no demo accounts in
production.

## Redeploying after a code change

```bash
git pull
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

## Operational notes

- Logs: `docker compose -f docker-compose.prod.yml logs -f [service]`.
- Certificate renewal is entirely Traefik's job (shared `traefik-letsencrypt` volume) — nothing
  project-specific to run or schedule.
- To point this at a different domain, change `DOMAIN` in `.env.prod` and redeploy; Traefik will
  request a certificate for the new host on first traffic.
- `docker-compose.prod.yml`'s `pjs-net` bridge network doesn't need to be shared with Traefik's
  network explicitly — Traefik runs in `network_mode: host`, so it can reach any container's
  bridge-network IP directly, the same way it already reaches `review-automation`'s containers.
