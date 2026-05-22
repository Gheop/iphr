FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY config ./config
COPY public ./public
RUN mkdir -p data && chown -R node:node /app
USER node
EXPOSE 8080
CMD ["node", "src/server.js"]
