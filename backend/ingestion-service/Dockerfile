FROM node:18-alpine
WORKDIR /usr/src/app

# Copy package and lock files
COPY package.json package-lock.json* pnpm-lock.yaml* ./
RUN npm install

# Copy TypeScript config and source code
COPY tsconfig.json ./
COPY src ./src

# Build the TypeScript sources into the dist/ directory
RUN npm run build

# Expose the ingestion service port
EXPOSE 3000

# Run the compiled application
CMD ["node", "dist/index.js"]