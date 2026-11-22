/**
 * An image's real type from its first bytes: PNG, JPEG, GIF or WebP (the ones models take), else null. Labels can be
 * wrong (Discord's CDN, a renamed file), and models refuse an image whose label doesn't match its bytes.
 */
export function sniffImageMime(bytes: Uint8Array): string | null {
	const b = bytes;
	if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
	if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
	if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return "image/gif";
	if (
		b.length >= 12 &&
		b[0] === 0x52 &&
		b[1] === 0x49 &&
		b[2] === 0x46 &&
		b[3] === 0x46 &&
		b[8] === 0x57 &&
		b[9] === 0x45 &&
		b[10] === 0x42 &&
		b[11] === 0x50
	)
		return "image/webp";
	return null;
}

/** The type to send a model for an image: what its bytes say, else what it was labelled. */
export function imageMime(bytes: Uint8Array, declared: string): string {
	return sniffImageMime(bytes) ?? declared;
}

/** The same for an image already in base64 (only its first bytes are decoded). */
export function imageMimeBase64(base64: string, declared: string): string {
	return imageMime(Buffer.from(base64.slice(0, 32), "base64"), declared);
}
