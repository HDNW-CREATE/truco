import { PrismaClient } from '@prisma/client';

/** Cria o cliente do banco. A URL vem de DATABASE_URL ou do parâmetro (usado nos testes). */
export function createDb(url?: string): PrismaClient {
  return new PrismaClient(url ? { datasources: { db: { url } } } : undefined);
}

export type Db = PrismaClient;
