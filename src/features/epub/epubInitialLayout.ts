export async function waitForEpubInitialLayout(document: Document): Promise<void> {
  await Promise.all([
    document.fonts?.ready,
    ...Array.from(document.images, (image) => image.decode?.().catch(() => undefined)),
  ]);
  await new Promise<void>((resolve) => document.defaultView?.requestAnimationFrame(() => resolve()) ?? resolve());
}
