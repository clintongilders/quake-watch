FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_API_URL=
ARG VITE_TILE_URL=https://tile.openstreetmap.org/{z}/{x}/{y}.png
ARG VITE_TILE_ATTRIBUTION="&copy; OpenStreetMap contributors"
ENV VITE_API_URL=$VITE_API_URL VITE_TILE_URL=$VITE_TILE_URL VITE_TILE_ATTRIBUTION=$VITE_TILE_ATTRIBUTION
RUN npm run build
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
