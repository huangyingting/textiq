import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Drives the shared `SelectMenu` primitive (a button that opens a portaled
 * listbox) the way a user would: click the trigger, pick the option by its
 * visible label, and wait for the listbox to close. The listbox is portaled to
 * the document body, so options are always resolved from `page` even when the
 * trigger lives inside a scoped container.
 */
export async function chooseFromSelectMenu(
  page: Page,
  scope: Page | Locator,
  ariaLabel: string,
  optionName: string,
): Promise<void> {
  await scope.getByRole("button", { name: ariaLabel, exact: true }).click();
  const listbox = page.getByRole("listbox", { name: ariaLabel });
  await listbox.getByRole("option", { name: optionName, exact: true }).click();
  await expect(listbox).toHaveCount(0);
}

/** Inspector panel id → the label shown by the "Inspector panel" SelectMenu. */
export const INSPECTOR_PANEL_LABEL: Record<string, string> = {
  slide: "Slide",
  notes: "Notes",
  text: "Text",
  shape: "Shape",
  image: "Image",
  adjust: "Adjust",
  arrange: "Arrange",
  style: "Style",
  effects: "Effects",
  source: "Source",
  layers: "Layers",
  visual: "Visual",
  line: "Line",
  table: "Table",
  diagnostics: "Diagnostics",
};
