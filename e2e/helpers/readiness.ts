import { expect, type Locator, type Page } from "@playwright/test";

function documentSaveStatus(page: Page): Locator {
  return page.getByRole("status").filter({
    hasText: /all changes saved|saving|unsaved changes|couldn't save/i,
  });
}

export async function waitForDocumentEditorReady(page: Page): Promise<Locator> {
  const body = page.getByRole("textbox", { name: "Document body" });
  await expect(body).toBeEditable({ timeout: 30_000 });
  await expect(
    page.getByRole("status").filter({ hasText: /^Live$/ }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(documentSaveStatus(page)).toHaveText("All changes saved", {
    timeout: 30_000,
  });
  return body;
}

export async function waitForDocumentAutosaveAfter<T>(
  page: Page,
  mutate: () => Promise<T>,
): Promise<T> {
  const saveStatus = documentSaveStatus(page);
  const result = await mutate();
  await expect(saveStatus).toHaveText(/Unsaved changes|Saving/, {
    timeout: 5_000,
  });
  await expect(saveStatus).toHaveText("All changes saved", {
    timeout: 20_000,
  });
  return result;
}

export async function waitForStableSlideStage(locator: Locator): Promise<void> {
  await locator.waitFor({ state: "visible", timeout: 10_000 });
  await waitForStableLocatorBox(locator);
}

export async function waitForStableLocatorBox(
  locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const [box] = await waitForStableLocatorBoxes([locator]);
  return box;
}

export async function waitForStableLocatorBoxes(
  locators: readonly Locator[],
): Promise<Array<{ x: number; y: number; width: number; height: number }>> {
  let previous: string | null = null;
  let stableFrames = 0;
  for (let frame = 0; frame < 60; frame += 1) {
    const boxes = await Promise.all(
      locators.map((locator) => locator.boundingBox()),
    );
    if (boxes.every((box) => box && box.width > 0 && box.height > 0)) {
      const resolvedBoxes = boxes.filter(
        (box): box is NonNullable<typeof box> => box !== null,
      );
      const signature = resolvedBoxes
        .flatMap((box) => [box.x, box.y, box.width, box.height])
        .map((value) => value.toFixed(2))
        .join(":");
      stableFrames = signature === previous ? stableFrames + 1 : 0;
      previous = signature;
      if (stableFrames >= 2) {
        return resolvedBoxes;
      }
    } else {
      stableFrames = 0;
      previous = null;
    }
    await locators[0]?.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        }),
    );
  }
  throw new Error("Locator geometry did not stabilize within 60 frames.");
}

export async function waitForSlideAutosave(
  page: Page,
  { timeout = 20_000 }: { timeout?: number } = {},
): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );

  // The responsive footer status trigger remains mounted even when the visible
  // save chip disappears, so its accessible label is a stable state boundary.
  const footerStatus = page
    .locator('button[aria-label^="Footer status:"]')
    .first();
  await expect(footerStatus).toHaveAttribute(
    "aria-label",
    /^Footer status: All changes saved\./,
    { timeout },
  );
}

export async function waitForSlideAutosaveAfter<T>(
  page: Page,
  mutate: () => Promise<T>,
): Promise<T> {
  const footerStatus = page
    .locator('button[aria-label^="Footer status:"]')
    .first();
  const result = await mutate();
  await expect(footerStatus).not.toHaveAttribute(
    "aria-label",
    /^Footer status: All changes saved\./,
    { timeout: 5_000 },
  );
  await expect(footerStatus).toHaveAttribute(
    "aria-label",
    /^Footer status: All changes saved\./,
    { timeout: 20_000 },
  );
  return result;
}
