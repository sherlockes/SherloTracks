FROM node:20-slim AS build

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Para desarrollo servimos directamente, para prod haríamos build
# Pero configuramos un comando simple
CMD ["npm", "run", "dev", "--", "--host"]
