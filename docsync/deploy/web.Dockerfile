FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/web/package.json packages/web/
RUN npm ci --no-audit --no-fund -w @docsync/web --include-workspace-root=false
COPY packages/web ./packages/web
RUN npm run build -w @docsync/web

FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/packages/web/dist /usr/share/nginx/html
