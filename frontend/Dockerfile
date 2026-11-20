# ---- build: Vite production bundle ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# The API is served from the same origin through nginx (/api → backend)
ENV VITE_API_URL=/api
RUN npm run build

# ---- runtime: nginx serves the SPA and proxies the API ----
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
