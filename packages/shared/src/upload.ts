export interface Upload {
	id: string;
	name: string;
	mime: string;
	size: number;
	url: string;
	kind: "image" | "file";
	createdAt: number;
}

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
