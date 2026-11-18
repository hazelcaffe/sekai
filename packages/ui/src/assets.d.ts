/** Images the design system ships (bundled by the apps' Vite builds). */
declare module "*.png" {
	const url: string;
	export default url;
}
