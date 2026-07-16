import { Prisma } from "@/generated/prisma/client";
import { projectDocumentContent } from "@/lib/document/content-projection";

type CanonicalProjectionField = "content" | "contentJson";

type WithoutCanonicalProjection<T> = T extends object
  ? Omit<T, CanonicalProjectionField> & {
      content?: never;
      contentJson?: never;
    }
  : T;

type DocumentMethodClient<Method extends string> = {
  document: {
    [Key in Method]: (args: never) => PromiseLike<unknown>;
  };
};

export type DocumentCreateMetadata = WithoutCanonicalProjection<
  Prisma.DocumentCreateArgs["data"]
>;
export type DocumentUpdateMetadata = WithoutCanonicalProjection<
  Prisma.DocumentUpdateArgs["data"]
>;
export type DocumentUpdateManyMetadata = WithoutCanonicalProjection<
  Prisma.DocumentUpdateManyArgs["data"]
>;
export type DocumentUpsertCreateMetadata = WithoutCanonicalProjection<
  Prisma.DocumentUpsertArgs["create"]
>;
export type DocumentUpsertUpdateMetadata = WithoutCanonicalProjection<
  Prisma.DocumentUpsertArgs["update"]
>;

export type CreateDocumentWithCanonicalContentArgs = Omit<
  Prisma.DocumentCreateArgs,
  "data"
> & {
  data: DocumentCreateMetadata;
  contentSnapshot?: unknown;
};

export type UpdateDocumentWithCanonicalContentArgs = Omit<
  Prisma.DocumentUpdateArgs,
  "data"
> & {
  data?: DocumentUpdateMetadata;
  contentSnapshot: unknown;
};

export type UpdateDocumentsWithCanonicalContentArgs = Omit<
  Prisma.DocumentUpdateManyArgs,
  "data"
> & {
  data?: DocumentUpdateManyMetadata;
  contentSnapshot: unknown;
};

export type UpsertDocumentWithCanonicalContentArgs = Omit<
  Prisma.DocumentUpsertArgs,
  "create" | "update"
> & {
  create: DocumentUpsertCreateMetadata;
  update: DocumentUpsertUpdateMetadata;
  contentSnapshot: unknown;
};

export type DocumentContentBackfillSnapshot = Readonly<{
  id: string;
  contentJson: Prisma.JsonValue;
  updatedAt: Date;
}>;

function assertProjectionFree(data: unknown): void {
  if (
    typeof data === "object" &&
    data !== null &&
    ("content" in data || "contentJson" in data)
  ) {
    throw new Error(
      "Document content/contentJson are owned by the document write port.",
    );
  }
}

function sealProjectionFreeData<T extends object>(data: T): T {
  assertProjectionFree(data);
  return Object.freeze({ ...data });
}

function deepFreezeSnapshot(value: unknown): unknown {
  if (Array.isArray(value)) {
    for (const item of value) deepFreezeSnapshot(item);
    return Object.freeze(value);
  }
  if (
    typeof value === "object" &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    for (const item of Object.values(value)) deepFreezeSnapshot(item);
    return Object.freeze(value);
  }
  return value;
}

function sealCanonicalProjection(contentSnapshot: unknown) {
  const immutableSnapshot = deepFreezeSnapshot(
    structuredClone(contentSnapshot),
  ) as Prisma.InputJsonValue;
  return Object.freeze(projectDocumentContent(immutableSnapshot));
}

function projectionData<T extends object>(
  data: T,
  contentSnapshot: unknown,
): T & ReturnType<typeof projectDocumentContent> {
  const metadata = sealProjectionFreeData(data);
  const projection = sealCanonicalProjection(contentSnapshot);
  return Object.freeze({ ...metadata, ...projection });
}

function contentJsonSnapshotFilter(
  contentJson: Prisma.JsonValue,
): Prisma.JsonNullableFilter<"Document"> {
  return {
    equals:
      contentJson === null
        ? Prisma.JsonNull
        : (contentJson as Prisma.InputJsonValue),
  };
}

export async function createDocumentWithCanonicalContent<TResult>(
  db: DocumentMethodClient<"create">,
  args: CreateDocumentWithCanonicalContentArgs,
): Promise<TResult> {
  const { contentSnapshot, data, ...query } = args;
  const persistedData =
    contentSnapshot === undefined
      ? sealProjectionFreeData(data)
      : projectionData(data, contentSnapshot);
  return (await db.document.create({
    ...query,
    data: persistedData,
  } as never)) as TResult;
}

export async function updateDocumentWithCanonicalContent<TResult>(
  db: DocumentMethodClient<"update">,
  args: UpdateDocumentWithCanonicalContentArgs,
): Promise<TResult> {
  const { contentSnapshot, data = {}, ...query } = args;
  return (await db.document.update({
    ...query,
    data: projectionData(data, contentSnapshot),
  } as never)) as TResult;
}

export async function updateDocumentsWithCanonicalContent(
  db: DocumentMethodClient<"updateMany">,
  args: UpdateDocumentsWithCanonicalContentArgs,
): Promise<{ count: number }> {
  const { contentSnapshot, data = {}, ...query } = args;
  return (await db.document.updateMany({
    ...query,
    data: projectionData(data, contentSnapshot),
  } as never)) as { count: number };
}

export async function upsertDocumentWithCanonicalContent<TResult>(
  db: DocumentMethodClient<"upsert">,
  args: UpsertDocumentWithCanonicalContentArgs,
): Promise<TResult> {
  const { contentSnapshot, create, update, ...query } = args;
  const projection = sealCanonicalProjection(contentSnapshot);
  const createMetadata = sealProjectionFreeData(create);
  const updateMetadata = sealProjectionFreeData(update);
  return (await db.document.upsert({
    ...query,
    create: Object.freeze({ ...createMetadata, ...projection }),
    update: Object.freeze({ ...updateMetadata, ...projection }),
  } as never)) as TResult;
}

export async function updateDocumentMetadata<TResult>(
  db: DocumentMethodClient<"update">,
  args: Omit<Prisma.DocumentUpdateArgs, "data"> & {
    data: DocumentUpdateMetadata;
  },
): Promise<TResult> {
  return (await db.document.update({
    ...args,
    data: sealProjectionFreeData(args.data),
  } as never)) as TResult;
}

export async function updateDocumentsMetadata(
  db: DocumentMethodClient<"updateMany">,
  args: Omit<Prisma.DocumentUpdateManyArgs, "data"> & {
    data: DocumentUpdateManyMetadata;
  },
): Promise<{ count: number }> {
  return (await db.document.updateMany({
    ...args,
    data: sealProjectionFreeData(args.data),
  } as never)) as { count: number };
}

export async function deleteDocuments(
  db: DocumentMethodClient<"deleteMany">,
  args: Prisma.DocumentDeleteManyArgs,
): Promise<{ count: number }> {
  return (await db.document.deleteMany(args as never)) as { count: number };
}

export async function backfillDocumentContentProjectionCas(
  db: DocumentMethodClient<"updateMany">,
  snapshot: DocumentContentBackfillSnapshot,
): Promise<{ count: number }> {
  const immutableSnapshot = {
    id: snapshot.id,
    contentJson: deepFreezeSnapshot(
      structuredClone(snapshot.contentJson),
    ) as Prisma.JsonValue,
    updatedAt: new Date(snapshot.updatedAt.getTime()),
  } as const;
  const projection = sealCanonicalProjection(immutableSnapshot.contentJson);

  return (await db.document.updateMany({
    where: {
      id: immutableSnapshot.id,
      updatedAt: immutableSnapshot.updatedAt,
      contentJson: contentJsonSnapshotFilter(immutableSnapshot.contentJson),
    },
    data: { content: projection.content },
  } as never)) as { count: number };
}
