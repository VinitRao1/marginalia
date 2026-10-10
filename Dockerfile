# Studio-only image (for Railway, Fly.io, Cloud Run…). Runs the n8n workflow JSON
# with the built-in engine unless N8N_URL points at a reachable n8n.
FROM node:22-alpine
WORKDIR /app
COPY . .
ENV ENGINE=auto PORT=3000 NODE_ENV=production
EXPOSE 3000
CMD ["node", "server/index.js"]
