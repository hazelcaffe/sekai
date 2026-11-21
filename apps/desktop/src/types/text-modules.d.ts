/** Helper scripts bundled as text and written to disk when needed. */
declare module "*.py" {
	const content: string;
	export default content;
}
declare module "*.ps1" {
	const content: string;
	export default content;
}
declare module "*.jxa" {
	const content: string;
	export default content;
}

/** Injected by scripts/build.ts from packages/ui/src/styles/index.css. */
declare const __SEKAI_BG_LIGHT__: string;
declare const __SEKAI_BG_DARK__: string;
