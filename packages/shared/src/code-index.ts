export type CodeIndexStatus = "indexing" | "ready" | "error";

export interface CodeIndexProgress {
	phase: "scanning" | "embedding" | "cleaning";
	done: number;
	total: number;
}

export interface CodeIndex {
	id: string;
	agentId: string;
	machineId: string;
	machineName: string;
	root: string;
	name: string;
	embeddingModel: string;
	status: CodeIndexStatus;
	progress: CodeIndexProgress | null;
	files: number;
	chunks: number;
	bytes: number;
	error: string | null;
	lastIndexedAt: number | null;
	createdAt: number;
}

export interface CodeSearchHit {
	path: string;
	startLine: number;
	endLine: number;
	symbol: string | null;
	content: string;
	score: number;
}
