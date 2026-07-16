import type { Prisma } from "@/generated/prisma/client";

type DocumentMutationMethod =
  | "create"
  | "createMany"
  | "createManyAndReturn"
  | "delete"
  | "deleteMany"
  | "update"
  | "updateMany"
  | "updateManyAndReturn"
  | "upsert";

type RawClientEscapeMethod =
  | "$executeRaw"
  | "$executeRawUnsafe"
  | "$extends"
  | "$queryRaw"
  | "$queryRawUnsafe"
  | "$runCommandRaw";

type TransactionOptions = {
  maxWait?: number;
  timeout?: number;
  isolationLevel?: Prisma.TransactionIsolationLevel;
};

type AwaitedTuple<T extends readonly unknown[]> = {
  -readonly [Key in keyof T]: Awaited<T[Key]>;
};

export type PrismaDocumentReadDelegate = Omit<
  Prisma.TransactionClient["document"],
  DocumentMutationMethod
>;

export type PrismaTransactionClient = Omit<
  Prisma.TransactionClient,
  "document" | RawClientEscapeMethod
> & {
  readonly document: PrismaDocumentReadDelegate;
};

export interface PrismaTransactionRunner {
  $transaction<P extends readonly Prisma.PrismaPromise<unknown>[]>(
    operations: [...P],
    options?: TransactionOptions,
  ): Promise<AwaitedTuple<P>>;
  $transaction<TResult>(
    operation: (prisma: PrismaTransactionClient) => Promise<TResult>,
    options?: TransactionOptions,
  ): Promise<TResult>;
}

export type PrismaClientSurface = Omit<
  Prisma.TransactionClient,
  "document" | "$transaction" | RawClientEscapeMethod
> &
  PrismaTransactionRunner & {
    $connect(): Promise<void>;
    $disconnect(): Promise<void>;
    readonly document: PrismaDocumentReadDelegate;
  };

export type DocumentWriteTarget = {
  readonly document: object;
};
