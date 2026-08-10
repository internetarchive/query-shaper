# query-shaper is 100% client-side (on-device AI, no backend) -- the built image only
# ever needs to serve static files, never run Node.

# Build the deployable site: landing page, demo, docs, and the built module.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:site

# Serve it.
FROM nginx:alpine
COPY --from=build /app/site /usr/share/nginx/html
EXPOSE 80
