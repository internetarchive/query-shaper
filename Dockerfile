# query-shaper is entirely client-side (on-device AI, no backend) -- only the
# runtime stage matters for an actual deployment; dev and build exist for local
# development and CI. `docker build .` with no --target builds runtime, the last
# stage, by default.

# ---- deps: shared base, dependencies installed once for both dev and build ----
FROM node:26-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- dev: runs the Vite dev server in watch mode ----
# Bind-mount the repo over /app for live-reload against your own edits; the extra
# anonymous volume on node_modules keeps this stage's own install from being
# shadowed by the host's (see README).
FROM deps AS dev
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host"]

# ---- build: verifies and builds the deployable artifacts ----
FROM deps AS build
COPY . .
RUN npm run typecheck
RUN npm run lint
RUN npm test
RUN npm run build:site

# ---- runtime: serves site/ as an unprivileged user ----
FROM nginxinc/nginx-unprivileged:alpine AS runtime
COPY --from=build /app/site /usr/share/nginx/html
EXPOSE 8080
