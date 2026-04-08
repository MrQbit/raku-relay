FROM oven/bun:1.3.11
WORKDIR /app
COPY package.json bunfig.toml tsconfig.json ./
COPY apps ./apps
COPY packages ./packages
RUN bun install
CMD ["bun", "run", "apps/api/src/index.ts"]

