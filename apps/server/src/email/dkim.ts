import { resolveTxt } from "node:dns/promises";
import { dkimVerify } from "mailauth/lib/dkim/verify";

/** Local mailcow delivery may carry its domain signature but no authentication report. */
export async function signedBy(raw: Uint8Array, address: string): Promise<boolean> {
	const check = await dkimVerify(Buffer.from(raw), {
		minBitLength: 1024,
		resolver: async (name, type) => {
			if (type !== "TXT") throw new Error("Expected a DKIM key lookup");
			const txt = await resolveTxt(name);
			// Bun can return each 255-byte chunk of one DNS TXT RR as a separate row. Only reassemble
			// a single DKIM record followed by bare key material; mailauth still validates the key/signature.
			const head = txt.find((r) => /^v=DKIM1;/i.test(r.join("")));
			const rest = txt.filter((r) => r !== head);
			return head && rest.length && rest.every((r) => /^[A-Za-z0-9+/]+=*$/.test(r.join("")))
				? [[...head, ...rest.flat()]]
				: txt;
		},
	});
	return (
		check.fromFields === 1 &&
		check.fromSyntax === "valid" &&
		check.headerFrom.length === 1 &&
		check.headerFrom[0]?.toLowerCase() === address &&
		check.results.some(
			(r) =>
				r.status.result === "pass" &&
				!r.canonBodyLengthLimited &&
				!r.status.testing &&
				r.algo?.endsWith("-sha256") &&
				r.signingDomain?.toLowerCase() === address.split("@")[1],
		)
	);
}
