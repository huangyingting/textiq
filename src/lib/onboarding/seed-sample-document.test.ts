import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { seedSampleDocument } from "@/lib/onboarding/seed-sample-document";
import { prisma } from "@/test/prisma-raw";

function stubPrismaMethod<T extends object, K extends keyof T>(
  t: { after: (fn: () => void) => void },
  object: T,
  methodName: K,
  implementation: (...args: unknown[]) => unknown,
): { calls: unknown[][] } {
  const original = object[methodName];
  const calls: unknown[][] = [];
  const wrapped = (...args: unknown[]) => {
    calls.push(args);
    return (implementation as (...args: unknown[]) => unknown)(...args);
  };
  Object.defineProperty(object, methodName, {
    value: wrapped,
    configurable: true,
  });
  t.after(() => {
    Object.defineProperty(object, methodName, {
      value: original,
      configurable: true,
    });
  });
  return { calls };
}

describe("seedSampleDocument", () => {
  it("does not seed when the user already has a document", async (t) => {
    stubPrismaMethod(t, prisma.document, "findFirst", async () => ({
      id: "existing-doc",
    }));
    const create = stubPrismaMethod(t, prisma.document, "create", async () => {
      throw new Error("create should not be called");
    });

    await seedSampleDocument("user-1");

    assert.equal(create.calls.length, 0);
  });

  it("creates a welcome document with one attached sample visual", async (t) => {
    stubPrismaMethod(t, prisma.document, "findFirst", async () => null);
    const create = stubPrismaMethod(t, prisma.document, "create", async () => ({
      id: "created-doc",
    }));

    await seedSampleDocument("user-1");

    assert.equal(create.calls.length, 1);
    const [{ data }] = create.calls[0] as [
      {
        data: {
          title: string;
          content: string;
          contentJson: {
            root: { children: Array<{ type: string }> };
          };
          ownerId: string;
          visuals: {
            create: {
              anchorBlockId: string;
              type: string;
              title: string | null;
              data: { type: string };
            };
          };
        };
      },
    ];
    assert.equal(data.title, "Welcome to TextIQ");
    assert.equal(data.ownerId, "user-1");
    assert.match(data.content, /Welcome to TextIQ/);
    assert.match(data.content, /\| Need \| TextIQ surface \|/);
    assert.deepEqual(
      data.contentJson.root.children.map((child) => child.type).slice(0, -1),
      [
        "heading",
        "paragraph",
        "paragraph",
        "heading",
        "list",
        "heading",
        "list",
        "heading",
        "table",
        "heading",
        "paragraph",
      ],
    );
    assert.equal(data.contentJson.root.children.at(-1)?.type, "visual");
    assert.equal(data.visuals.create.anchorBlockId.length > 0, true);
    assert.equal(data.visuals.create.type, "FLOWCHART");
    assert.equal(data.visuals.create.data.type, "flowchart");
  });

  it("logs and swallows seeding failures", async (t) => {
    stubPrismaMethod(t, prisma.document, "findFirst", async () => {
      throw new Error("database unavailable");
    });
    const originalError = console.error;
    const errors: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    t.after(() => {
      console.error = originalError;
    });

    await assert.doesNotReject(() => seedSampleDocument("user-1"));

    assert.equal(errors.length, 1);
    assert.equal(errors[0][0], "Failed to seed first-run sample document");
  });
});
