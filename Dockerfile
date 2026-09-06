FROM node:24-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY server ./server
RUN npm run build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S neta && adduser -S -G neta -u 10001 neta
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY tsconfig.json ./
USER neta
EXPOSE 8080
CMD ["node", "--import", "tsx", "server/server.ts"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:8080/portal-api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
