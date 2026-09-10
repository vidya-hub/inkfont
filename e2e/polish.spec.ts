import { test, expect } from "@playwright/test";

test("projects popup uses a styled backup button, not a native file widget", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("status").first()).toContainText("Saved");
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "Download editable backup" }),
  ).toBeVisible();
  await expect(dialog.getByText("Open backup")).toBeVisible();
  await expect(dialog.getByText("Choose file")).toHaveCount(0);
  await expect(dialog.locator('input[type="file"]').first()).toHaveCSS(
    "opacity",
    "0",
  );
});

test("proof shows missing-letter boxes instead of a serif fallback", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("status").first()).toContainText("Saved");
  const sample = page.locator(".proof-text");
  await expect(sample.locator(".missing-glyph").first()).toBeVisible();
  const missing = await sample.locator(".missing-glyph").count();
  expect(missing).toBeGreaterThan(10);
  await page.getByRole("button", { name: "Edit T", exact: true }).click();
  const canvas = page.getByLabel("Glyph vector editor");
  const box = (await canvas.boundingBox())!;
  await page.getByRole("button", { name: "Ellipse", exact: true }).click();
  await page.mouse.move(box.x + 150, box.y + 130);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 330, { steps: 10 });
  await page.mouse.up();
  const drawn = sample.locator("span:not(.missing-glyph)", { hasText: "T" });
  await expect(drawn.first()).toBeVisible({ timeout: 20000 });
  const face = await drawn
    .first()
    .evaluate((el) => getComputedStyle(el).fontFamily);
  expect(face).toMatch(/Inkfont/);
});

test("preview popup opens large and closes", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("status").first()).toContainText("Saved");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Font preview");
  await expect(dialog.locator(".preview-sample")).toBeVisible();
  await expect(dialog.getByLabel("Preview size")).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test("eraser cursor differs from brush and hides brush-only controls", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("status").first()).toContainText("Saved");
  const canvas = page.getByLabel("Glyph vector editor");
  await page.getByRole("button", { name: "Brush", exact: true }).click();
  await expect(canvas).toHaveCSS("cursor", "crosshair");
  await page.getByRole("button", { name: "Eraser", exact: true }).click();
  await expect(canvas).toHaveCSS("cursor", "none");
  await expect(page.getByLabel("Eraser size")).toBeVisible();
  await expect(page.getByLabel("Brush width")).toHaveCount(0);
  await page.getByRole("button", { name: "Brush", exact: true }).click();
  await expect(page.getByLabel("Brush width")).toBeVisible();
});
