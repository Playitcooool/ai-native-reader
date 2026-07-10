import { describe, expect, it, vi } from "vitest";
import { waitForEpubInitialLayout } from "../src/features/epub/epubInitialLayout";

describe("waitForEpubInitialLayout", () => {
  it("waits for fonts, images, and a layout frame", async () => {
    let fontsReady!: () => void;
    let imageReady!: () => void;
    const fontPromise = new Promise<void>((resolve) => { fontsReady = resolve; });
    const imagePromise = new Promise<void>((resolve) => { imageReady = resolve; });
    const frame = vi.fn((callback: FrameRequestCallback) => { callback(0); return 1; });
    const document = {
      fonts: { ready: fontPromise },
      images: [{ decode: () => imagePromise }],
      defaultView: { requestAnimationFrame: frame },
    } as unknown as Document;

    let settled = false;
    const waiting = waitForEpubInitialLayout(document).then(() => { settled = true; });
    fontsReady();
    await Promise.resolve();
    expect(settled).toBe(false);
    imageReady();
    await waiting;
    expect(frame).toHaveBeenCalledOnce();
  });
});
