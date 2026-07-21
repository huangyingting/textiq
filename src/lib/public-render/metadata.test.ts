import assert from "node:assert/strict";
import { test } from "node:test";

import { buildPublicMetadata, type BuildPublicMetadataInput } from "./metadata";

test("buildPublicMetadata returns no-index defaults when a share is denied", () => {
  assert.deepEqual(
    buildPublicMetadata({
      document: null,
      surface: "share",
      baseUrl: "https://textiq.test",
    }),
    {
      title: "Shared Document — TextIQ",
      robots: { index: false, follow: false },
    },
  );
});

test("buildPublicMetadata returns no-index defaults when a shared row has no slug", () => {
  assert.deepEqual(
    buildPublicMetadata({
      document: {
        title: "Legacy Shared Document",
        contentJson: {
          root: { children: [{ type: "paragraph", children: [] }] },
        },
        slug: null,
        shareId: "share123",
        metadataMode: "title-excerpt",
        discoverable: true,
      },
      surface: "share",
      baseUrl: "https://textiq.test",
    }),
    {
      title: "Shared Document — TextIQ",
      robots: { index: false, follow: false },
    },
  );
});

test("buildPublicMetadata treats empty, whitespace, and undefined slugs as no-index defaults", () => {
  const baseDocument = {
    title: "Legacy Shared Document",
    contentJson: {
      root: { children: [{ type: "paragraph", children: [] }] },
    },
    shareId: "share123",
    metadataMode: "title-excerpt",
    discoverable: true,
  };

  for (const slug of ["", "   ", undefined]) {
    assert.deepEqual(
      buildPublicMetadata({
        document: {
          ...baseDocument,
          slug,
        } as BuildPublicMetadataInput["document"],
        surface: "present",
        baseUrl: "https://textiq.test",
      }),
      {
        title: "Presentation — TextIQ",
        robots: { index: false, follow: false },
      },
    );
  }
});

test("buildPublicMetadata treats missing share ids as no-index defaults", () => {
  assert.deepEqual(
    buildPublicMetadata({
      document: {
        title: "Legacy Shared Document",
        contentJson: {
          root: { children: [{ type: "paragraph", children: [] }] },
        },
        slug: "legacy-shared-document",
        shareId: null,
        metadataMode: "title-excerpt",
        discoverable: true,
      },
      surface: "share",
      baseUrl: "https://textiq.test",
    }),
    {
      title: "Shared Document — TextIQ",
      robots: { index: false, follow: false },
    },
  );
});

test("buildPublicMetadata builds share canonical, excerpt, and OG image", () => {
  const metadata = buildPublicMetadata({
    document: {
      title: "Launch Plan",
      contentJson: {
        root: {
          children: [
            {
              type: "paragraph",
              children: [
                {
                  type: "text",
                  text: "A concise public launch plan.",
                },
              ],
            },
          ],
        },
      },
      slug: "launch-plan",
      shareId: "share123",
      metadataMode: "title-excerpt",
      discoverable: true,
    },
    surface: "share",
    baseUrl: "https://textiq.test",
  });

  assert.equal(metadata.title, "Launch Plan — TextIQ");
  assert.equal(metadata.description, "A concise public launch plan.");
  assert.deepEqual(metadata.robots, { index: true, follow: true });
  assert.deepEqual(metadata.alternates, {
    canonical: "https://textiq.test/share/launch-plan-share123",
  });
  assert.deepEqual(metadata.twitter?.images, [
    "https://textiq.test/share/launch-plan-share123/opengraph-image",
  ]);
});

test("buildPublicMetadata includes present canonical and share see-also link", () => {
  const metadata = buildPublicMetadata({
    document: {
      title: "Launch Deck",
      contentJson: {
        root: { children: [{ type: "paragraph", children: [] }] },
      },
      slug: "launch-deck",
      shareId: "share456",
      metadataMode: "title",
      discoverable: false,
    },
    surface: "present",
    baseUrl: "https://textiq.test",
  });

  assert.equal(metadata.title, "Launch Deck — Presentation — TextIQ");
  assert.equal(
    metadata.description,
    "A read-only document shared with TextIQ.",
  );
  assert.deepEqual(metadata.robots, { index: false, follow: false });
  assert.deepEqual(metadata.alternates, {
    canonical: "https://textiq.test/present/launch-deck-share456",
  });

  assert.deepEqual(metadata.other, {
    "og:see_also": "https://textiq.test/share/launch-deck-share456",
  });
});

test("buildPublicMetadata defaults shared links to generic noindex previews", () => {
  const metadata = buildPublicMetadata({
    document: {
      title: "Private Roadmap",
      contentJson: {
        root: {
          children: [
            {
              type: "paragraph",
              children: [{ type: "text", text: "Sensitive launch details" }],
            },
          ],
        },
      },
      slug: "private-roadmap",
      shareId: "share789",
      metadataMode: "generic",
      discoverable: false,
    },
    surface: "share",
    baseUrl: "https://textiq.test",
  });

  assert.equal(metadata.title, "Shared Document — TextIQ");
  assert.equal(
    metadata.description,
    "A read-only document shared with TextIQ.",
  );
  assert.equal(metadata.openGraph?.title, "Shared Document — TextIQ");
  assert.equal(metadata.openGraph?.description.includes("Sensitive"), false);
  assert.deepEqual(metadata.robots, { index: false, follow: false });
});
