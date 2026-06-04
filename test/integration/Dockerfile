FROM --platform=linux/amd64 node:22-bookworm

WORKDIR /app

# Copy package files first for layer caching
COPY package.json package-lock.json ./
RUN npm ci

# Install Playwright's Chromium and its system dependencies
RUN npx playwright install --with-deps chromium

# Copy the rest of the project (wasm/dist/ must already be built)
COPY . .

# Download test slide fixtures
RUN node test/integration/download-fixtures.mjs

# Build TypeScript
RUN npm run build:ts

CMD ["npx", "playwright", "test", "--config", "test/integration/playwright.config.ts"]
