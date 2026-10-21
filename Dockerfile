FROM oven/bun:1.3.14-slim
RUN apt-get update && apt-get install -y python3 make g++ git && rm -rf /var/lib/apt/lists/*
WORKDIR /workspaces/opencode
COPY . .
RUN bun install
RUN bun run --cwd packages/opencode build --single
CMD ["./packages/opencode/dist/opencode-linux-x64/bin/opencode", "web", "--hostname", "0.0.0.0", "--port", "4096"]
