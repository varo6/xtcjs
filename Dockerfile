# Multi-stage build for building and bundling
FROM oven/bun:1 AS builder
WORKDIR /usr/src/app

# Copy dependency configuration files
COPY package.json bun.lock ./

# Install all dependencies (including devDependencies) to build the app
RUN bun install --frozen-lockfile

# Copy the rest of the project source code
COPY . .

# Build the frontend static assets (outputs to /usr/src/app/dist)
ENV NODE_ENV=production
RUN bun run build

# Bundle the server code and Hono dependencies into a single file (dist/server.js)
RUN bun build --target=bun server/index.ts --outfile=dist/server.js

# Final production stage using Bun on Alpine Linux
FROM oven/bun:1-alpine AS release
WORKDIR /usr/src/app

# Copy only the compiled client assets and the bundled server code
COPY --from=builder /usr/src/app/dist dist

# Create data directory for SQLite persistence
RUN mkdir -p data && chown bun:bun data

# Run the app using the bundled server file
USER bun
EXPOSE 3000/tcp
ENTRYPOINT [ "bun", "run", "dist/server.js" ]
