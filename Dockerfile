# Imagem única: compila o cliente e sobe o servidor, que entrega o jogo e o socket na mesma porta.
FROM node:22-slim
RUN apt-get update && apt-get install -y openssl && rm -rf /var/lib/apt/lists/* && npm install -g pnpm@10
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build && pnpm --filter @truco/server exec prisma generate
ENV PORT=3001 DATABASE_URL="file:/data/truco.db"
VOLUME /data
EXPOSE 3001
# Cria ou atualiza o banco no volume e inicia o servidor.
CMD ["sh", "-c", "pnpm --filter @truco/server exec prisma db push --skip-generate && pnpm start"]
