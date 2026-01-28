FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY apps/api/package*.json ./apps/api/
COPY packages/shared/package*.json ./packages/shared/
COPY packages/ai-prompts/package*.json ./packages/ai-prompts/

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Generate Prisma client
RUN cd apps/api && npx prisma generate

# Build the packages and API
RUN npm run build

WORKDIR /app/apps/api

EXPOSE 3001

CMD ["npm", "start"]
