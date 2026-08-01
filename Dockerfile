FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY .env.example ./.env.example

RUN mkdir -p logs data src/state

ENV NODE_ENV=production

CMD ["node", "src/index.js"]
