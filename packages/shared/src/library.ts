/** A file in your document library. */
export interface LibraryDocument {
	id: string;
	title: string;
	/** The folder it came in with ("" for files uploaded on their own). */
	collection: string;
	fileName: string;
	mime: string;
	size: number;
	/** The original file, to open or download. */
	url: string | null;
	status: "indexing" | "ready" | "error";
	/** Why it failed; or, when ready, a warning (e.g. searchable by words only). */
	error: string | null;
	pages: number | null;
	chunks: number;
	chars: number;
	createdAt: number;
	updatedAt: number;
}

/** A passage that matched a search. */
export interface LibraryHit {
	documentId: string;
	title: string;
	collection: string;
	/** Its position in the document (pass to read it with what's around it). */
	chunk: number;
	page: number | null;
	heading: string | null;
	content: string;
	score: number;
}
