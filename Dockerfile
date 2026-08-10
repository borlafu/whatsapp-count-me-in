# ==== Build Stage ====
FROM node:26-alpine AS builder

WORKDIR /app

# No compiler toolchain is installed. The only native dependency,
# better-sqlite3, ships a musl prebuild (linuxmusl-x64/arm64) from v13 onward,
# and pnpm-workspace.yaml disables its implicit node-gyp build.
RUN corepack enable

# Install all dependencies (including dev for TypeScript build)
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY tsconfig.json .
COPY src ./src
RUN pnpm run build

# Remove development dependencies to lighten the final copy
RUN pnpm prune --prod

# Fail the build here rather than at runtime if the native module cannot load,
# since nothing in this image can compile it as a fallback.
RUN node -e "const D=require('better-sqlite3');const d=new D(':memory:');d.exec('CREATE TABLE t(a)');d.close();console.log('better-sqlite3 OK')"

# ==== Production Stage ====
FROM node:26-alpine

# Use tini to manage PID 1 so Ctrl+C propagates gracefully
RUN apk add --no-cache tini
ENTRYPOINT ["/sbin/tini", "--"]

ENV TERM=xterm-256color
ENV NODE_ENV=production

WORKDIR /app

# Copy only the compiled code and production dependencies from builder
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# The session and DB are expected to be mounted as volumes:
#   -v /host/path/.auth_info_baileys:/app/.auth_info_baileys
#   -v /host/path/events.db:/app/events.db
CMD ["node", "dist/index.js"]
