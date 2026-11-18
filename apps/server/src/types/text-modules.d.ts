/** Files imported as text (`import x from "./file.py" with { type: "text" }`), bundled into the server. */
declare module "*.py" {
	const content: string;
	export default content;
}
