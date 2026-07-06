import { describe, expect, it } from "vitest";
import { isAllowedExternalUrl } from "../src/features/links/externalLinks";

describe("isAllowedExternalUrl", () => {
  it("allows only external schemes opened by the app", () => {
    expect(isAllowedExternalUrl("https://example.com")).toBe(true);
    expect(isAllowedExternalUrl("http://example.com")).toBe(true);
    expect(isAllowedExternalUrl("mailto:test@example.com")).toBe(true);
    expect(isAllowedExternalUrl("tel:+15555555555")).toBe(true);
    expect(isAllowedExternalUrl("ftp://example.com/file")).toBe(true);
    expect(isAllowedExternalUrl("file:///tmp/book.pdf")).toBe(false);
    expect(isAllowedExternalUrl("data:text/html,hi")).toBe(false);
    expect(isAllowedExternalUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedExternalUrl("https://example.com/\nnext")).toBe(false);
    expect(isAllowedExternalUrl("")).toBe(false);
  });
});
