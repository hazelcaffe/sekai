import { desktopCapturer, nativeImage, screen } from "electron";

/** A PNG of the main screen at most maxWidth wide, through Electron (Windows and macOS, and Linux fallback). */
export async function captureMainScreen(maxWidth: number): Promise<Buffer> {
	const display = screen.getPrimaryDisplay();
	const fullWidth = Math.round(display.size.width * display.scaleFactor);
	const fullHeight = Math.round(display.size.height * display.scaleFactor);
	const width = Math.min(maxWidth, fullWidth);
	const height = Math.round((width * fullHeight) / fullWidth);
	const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width, height } });
	const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
	if (!source || source.thumbnail.isEmpty()) {
		throw new Error(
			process.platform === "darwin"
				? "Couldn't capture the screen. Allow Sekai under System Settings → Privacy & Security → Screen Recording, then restart it."
				: "Couldn't capture the screen.",
		);
	}
	return source.thumbnail.toPNG();
}

/** Scales a PNG down to maxWidth (keeps it as is when it's already small enough). */
export function shrinkPng(png: Buffer, maxWidth: number): Buffer {
	const image = nativeImage.createFromBuffer(png);
	const { width } = image.getSize();
	if (width <= maxWidth) return png;
	return image.resize({ width: maxWidth, quality: "best" }).toPNG();
}
