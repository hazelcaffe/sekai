import { describe, expect, test } from "bun:test";
import { imageMime, imageMimeBase64, sniffImageMime } from "../src/lib/mime.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const GIF = new TextEncoder().encode("GIF89a......");
const WEBP = new TextEncoder().encode("RIFF\x24\x00\x00\x00WEBPVP8 ");

describe("an image's real type", () => {
	test("from its first bytes", () => {
		expect(sniffImageMime(PNG)).toBe("image/png");
		expect(sniffImageMime(JPEG)).toBe("image/jpeg");
		expect(sniffImageMime(GIF)).toBe("image/gif");
		expect(sniffImageMime(WEBP)).toBe("image/webp");
		expect(sniffImageMime(new TextEncoder().encode("<svg xmlns"))).toBeNull();
		expect(sniffImageMime(new Uint8Array())).toBeNull();
	});

	test("wins over a wrong label (Discord sent a PNG as image/webp), and the label stays when it can't tell", () => {
		expect(imageMime(PNG, "image/webp")).toBe("image/png");
		expect(imageMimeBase64(Buffer.from(PNG).toString("base64"), "image/webp")).toBe("image/png");
		expect(imageMimeBase64(Buffer.from(GIF).toString("base64"), "image/png")).toBe("image/gif");
		expect(imageMime(new TextEncoder().encode("<svg"), "image/svg+xml")).toBe("image/svg+xml");
	});
});
