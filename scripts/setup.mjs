// Prepara o projeto depois do "pnpm install": cria o .env do servidor (se faltar) e o banco SQLite.
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';

const env = 'apps/server/.env';
if (!existsSync(env)) {
  copyFileSync('apps/server/.env.example', env);
  console.log('Criado apps/server/.env');
}
execSync('pnpm --filter @truco/server db:push', { stdio: 'inherit' });
console.log('\nPronto! Rode "pnpm dev" e abra http://localhost:5173');
