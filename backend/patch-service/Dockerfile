FROM node:18

# Create app directory
WORKDIR /usr/src/app

# Copy package and lock files to install dependencies.  Install both
COPY package.json package-lock.json* tsconfig.json ./

# Install all dependencies including dev dependencies for TypeScript
RUN npm install

# Copy source code
COPY src ./src

# Build the TypeScript sources into the dist/ directory
RUN npm run build

# Expose service port
EXPOSE 3004

# Run the compiled application
CMD ["node", "dist/index.js"]