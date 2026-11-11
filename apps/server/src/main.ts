import { createServer } from './server';

const port = Number(process.env.PORT ?? 3001);
const server = await createServer({ port, logger: true });
console.log(`Servidor do Truco na Mesa 3D em http://localhost:${server.port}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}
