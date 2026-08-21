FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci --only=production

# Ensure git is available for runtime operations (cloning, spawn git)
# Alpine uses apk package manager
RUN apk add --no-cache git openssh

# Copy source
COPY . .

ENV NODE_ENV=production
EXPOSE 5000

CMD ["node", "src/index.js"]
