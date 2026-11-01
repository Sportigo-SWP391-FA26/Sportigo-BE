import { Prisma } from '@prisma/client';

const isRetryableTransactionError = (error: unknown) => {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === 'P2034';
  }

  // PostgreSQL deadlocks can be surfaced by Prisma as an "unknown" request
  // error, especially through a pooler. The SQLSTATE is still present in the
  // message, so retry the complete transaction instead of leaking a 500.
  return error instanceof Error && (error.message.includes('40P01') || error.message.includes('deadlock detected'));
};

export async function withTransactionRetry<T>(work: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      lastError = error;
      if (!isRetryableTransactionError(error) || attempt === attempts - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }

  throw lastError;
}
