import { test, expect, type Page } from "@playwright/test";

async function waitForActiveWorker(page: Page) {
  await page.waitForFunction(
    () =>
      navigator.serviceWorker
        .getRegistration("/")
        .then((r) => !!(r && (r.active || r.waiting))),
    null,
    { timeout: 20000 },
  );
}

test("production shell works offline after the service worker caches assets", async ({
  page,
  context,
  browserName,
}) => {
  await page.goto("/");
  await expect(page.getByRole("status").first()).toContainText("Saved");
  await waitForActiveWorker(page);
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller)))
    await page.reload();

  const sw = await page.evaluate(() => fetch("/sw.js").then((r) => r.text()));
  expect(sw).toMatch(/CACHE='inkfont-[0-9a-f]+'/);
  expect(sw).toMatch(/\/assets\/index-/);
  expect(sw).toMatch(/\/assets\/worker-/);
  expect(sw).toContain("skipWaiting");

  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const name = keys.find((k) => k.startsWith("inkfont-"));
    if (!name) return [];
    const cache = await caches.open(name);
    return (await cache.keys()).map((r) => new URL(r.url).pathname);
  });
  expect(cached).toContain("/index.html");
  expect(cached.some((p) => p.startsWith("/assets/index-"))).toBe(true);

  await context.setOffline(true);
  if (browserName === "webkit") {
    await page.evaluate(() => location.reload());
    await page.waitForLoadState("domcontentloaded");
  } else {
    await page.goto("/", { waitUntil: "domcontentloaded" });
  }
  await expect(page.getByLabel("Glyph vector editor")).toBeVisible({
    timeout: 15000,
  });
  await expect(page.getByRole("status").first()).toContainText("Saved");
  if (!(await page.evaluate(() => navigator.onLine)))
    await expect(page.getByText(/Offline · editing/)).toBeVisible();

  const canvas = page.getByLabel("Glyph vector editor");
  const box = (await canvas.boundingBox())!;
  await page.getByRole("button", { name: "Ellipse", exact: true }).click();
  await page.mouse.move(box.x + 150, box.y + 130);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 330, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByRole("button", { name: /Outline 1/ })).toBeVisible();

  await page.getByRole("button", { name: "Export font", exact: true }).click();
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download OTF", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Download started", {
    timeout: 20000,
  });
  expect((await dl).suggestedFilename()).toMatch(/\.otf$/);
});
