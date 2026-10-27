FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:24-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4317 DATA_DIR=/data
WORKDIR /app
COPY --from=build --chown=node:node /app/build ./build
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/package-lock.json ./package-lock.json
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 4317
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:4317/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "build/server/index.js"]
