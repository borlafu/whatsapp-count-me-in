# ==== Build Stage ====
FROM node:22-alpine AS builder

WORKDIR /app

# Install build tools for native modules (like better-sqlite3)
RUN apk add --no-cache python3 make g++

# Install all dependencies (including dev for TypeScript build)
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY tsconfig.json .
COPY src ./src
RUN npm run build

# Remove development dependencies to lighten the final copy
RUN npm prune --omit=dev

# ==== Production Stage ====
FROM node:22-alpine

# Use tini to manage PID 1 so Ctrl+C propagates gracefully
RUN apk add --no-cache tini
ENTRYPOINT ["/sbin/tini", "--"]

ENV TERM=xterm-256color
ENV NODE_ENV=production

WORKDIR /app

# Copy only the compiled code and production dependencies from builder
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# The session and DB are expected to be mounted as volumes:
#   -v /host/path/.auth_info_baileys:/app/.auth_info_baileys
#   -v /host/path/events.db:/app/events.db
CMD ["node", "dist/index.js"]
