FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# Version is computed from git on the host and passed in (see scripts/build-image.sh)
# so it auto-updates with every build. Vite bakes VITE_* env into the bundle.
ARG VITE_APP_VERSION=dev
ENV VITE_APP_VERSION=$VITE_APP_VERSION
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf
# Security-headers snippet is `include`d by every block in nginx.conf; if it
# is missing the config fails `nginx -t` at boot (fail-closed).
COPY security-headers.conf /etc/nginx/security-headers.conf
EXPOSE 8080
