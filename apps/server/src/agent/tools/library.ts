import { z } from "zod";
import { errorMessage } from "../../lib/errors.ts";
import { findDocuments, listDocuments, readDocument, readyCount, searchLibrary } from "../../library/index.ts";
import { defineTool, ToolError } from "./types.ts";

const hasDocuments = async () => (await readyCount()) > 0;

export const libraryTools = [
	defineTool({
		name: "library_search",
		category: "library",
		description:
			"Search the user's document library (PDFs, Word files, notes, manuals, papers they uploaded) by meaning and by words. Use it before answering questions their documents may cover, and cite the title and page. Without a query: lists the documents.",
		parameters: z.object({
			query: z.string().max(500).optional().describe("What to look for, in your own words"),
			document: z.string().max(200).optional().describe("Only in this document (its title or id)"),
			limit: z.number().int().min(1).max(12).default(6),
		}),
		risk: "read",
		available: hasDocuments,
		title: (a) => (a.query ? `Searched the library for "${a.query.slice(0, 60)}"` : "Looked at the library"),
		async execute(args) {
			if (!args.query?.trim()) {
				const docs = (await listDocuments()).filter((d) => d.status === "ready");
				return {
					documents: docs.map((d) => ({
						id: d.id,
						title: d.title,
						...(d.collection ? { folder: d.collection } : {}),
						...(d.pages ? { pages: d.pages } : {}),
					})),
				};
			}
			try {
				let ids: string[] | undefined;
				if (args.document) {
					ids = (await findDocuments(args.document)).map((d) => d.id);
					if (!ids.length)
						throw new ToolError(
							`No document matches "${args.document}". Search without it to see them all.`,
						);
				}
				const hits = await searchLibrary(args.query, { documentIds: ids, limit: args.limit });
				if (!hits.length)
					return { results: [], note: "Nothing in the library matches. Say so rather than guessing." };
				return {
					results: hits.map((h) => ({
						document: h.title,
						documentId: h.documentId,
						chunk: h.chunk,
						...(h.page !== null ? { page: h.page } : {}),
						...(h.heading ? { section: h.heading } : {}),
						text: h.content.length > 900 ? `${h.content.slice(0, 900)}…` : h.content,
					})),
					tip: "library_read with documentId and chunk reads what's around a result.",
				};
			} catch (err) {
				if (err instanceof ToolError) throw err;
				throw new ToolError(errorMessage(err));
			}
		},
	}),
	defineTool({
		name: "library_read",
		category: "library",
		description:
			"Read part of a document in the user's library: around a search result (its chunk), a page of a PDF, or from the start. Answers say whether there's more.",
		parameters: z.object({
			document: z.string().min(1).max(200).describe("Its id (from library_search) or title"),
			chunk: z.number().int().min(0).optional().describe("A result's chunk from library_search"),
			page: z.number().int().min(1).optional(),
		}),
		risk: "read",
		available: hasDocuments,
		title: (a) => `Read ${a.page ? `page ${a.page} of ` : ""}a document`,
		async execute(args) {
			const [doc] = await findDocuments(args.document);
			if (!doc) throw new ToolError(`No document matches "${args.document}".`);
			try {
				const r = await readDocument(doc.id, { chunk: args.chunk, page: args.page });
				return {
					document: r.document.title,
					...(r.document.pages ? { pages: r.document.pages } : {}),
					text: r.text,
					...(r.more ? { next: `More follows: library_read with chunk ${r.to + 1}` } : {}),
				};
			} catch (err) {
				throw new ToolError(errorMessage(err));
			}
		},
	}),
];
