/**
 * A tiny ISO 9660 writer with Joliet names, for cloud-init's NoCloud seed: a CD labelled "cidata" holding
 * user-data and meta-data in its root. Joliet keeps the names exact ("user-data"), which plain ISO 9660
 * can't spell. Only a flat root directory is supported, which is all a seed needs.
 */

const SECTOR = 2048;

export interface IsoFile {
	name: string;
	data: Uint8Array;
}

function both16(v: number): Uint8Array {
	const b = new Uint8Array(4);
	const d = new DataView(b.buffer);
	d.setUint16(0, v, true);
	d.setUint16(2, v, false);
	return b;
}

function both32(v: number): Uint8Array {
	const b = new Uint8Array(8);
	const d = new DataView(b.buffer);
	d.setUint32(0, v, true);
	d.setUint32(4, v, false);
	return b;
}

function ascii(s: string, len: number, pad = " "): Uint8Array {
	return new TextEncoder().encode(s.padEnd(len, pad).slice(0, len));
}

/** UCS-2 big-endian, padded with UCS-2 spaces, as Joliet descriptors want. */
function ucs2(s: string, bytes: number): Uint8Array {
	const out = new Uint8Array(bytes);
	const chars = s.padEnd(bytes / 2, " ").slice(0, bytes / 2);
	for (let i = 0; i < chars.length; i++) {
		const c = chars.charCodeAt(i);
		out[i * 2] = c >> 8;
		out[i * 2 + 1] = c & 0xff;
	}
	return out;
}

function ucs2Name(s: string): Uint8Array {
	return ucs2(s, s.length * 2);
}

/** 7-byte date used in directory records. */
function dirDate(d: Date): Uint8Array {
	return new Uint8Array([
		d.getUTCFullYear() - 1900,
		d.getUTCMonth() + 1,
		d.getUTCDate(),
		d.getUTCHours(),
		d.getUTCMinutes(),
		d.getUTCSeconds(),
		0,
	]);
}

/** 17-byte date used in volume descriptors. */
function volDate(d: Date): Uint8Array {
	const p = (n: number, w = 2) => String(n).padStart(w, "0");
	const s = `${p(d.getUTCFullYear(), 4)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}00`;
	const out = new Uint8Array(17);
	out.set(new TextEncoder().encode(s), 0);
	return out;
}

function dirRecord(id: Uint8Array, extent: number, size: number, isDir: boolean, date: Date): Uint8Array {
	const len = 33 + id.length + (id.length % 2 === 0 ? 1 : 0);
	const r = new Uint8Array(len);
	r[0] = len;
	r[1] = 0;
	r.set(both32(extent), 2);
	r.set(both32(size), 10);
	r.set(dirDate(date), 18);
	r[25] = isDir ? 0x02 : 0;
	r.set(both16(1), 28);
	r[32] = id.length;
	r.set(id, 33);
	return r;
}

function pathTable(rootExtent: number, littleEndian: boolean): Uint8Array {
	const t = new Uint8Array(10);
	const d = new DataView(t.buffer);
	t[0] = 1;
	t[1] = 0;
	d.setUint32(2, rootExtent, littleEndian);
	d.setUint16(6, 1, littleEndian);
	t[8] = 0;
	return t;
}

/** ISO 9660 names: upper case letters, digits and underscores, with ";1". */
function isoName(name: string): string {
	const [base = "", ext = ""] = name
		.toUpperCase()
		.replace(/[^A-Z0-9_.]/g, "_")
		.split(/\.(?=[^.]*$)/);
	return `${base.replace(/\./g, "_").slice(0, 30)}.${ext.slice(0, 3)};1`;
}

export function buildIso(files: IsoFile[], label: string): Uint8Array {
	const date = new Date();
	const sorted = [...files].sort((a, b) => (a.name < b.name ? -1 : 1));
	const PVD = 16;
	const SVD = 17;
	const TERM = 18;
	const L_PT = 19;
	const M_PT = 20;
	const JL_PT = 21;
	const JM_PT = 22;
	const ROOT = 23;
	const JROOT = 24;
	let next = 25;
	const extents = sorted.map((f) => {
		const at = next;
		next += Math.max(1, Math.ceil(f.data.length / SECTOR));
		return at;
	});
	const total = next;
	const img = new Uint8Array(total * SECTOR);
	const at = (sector: number) => sector * SECTOR;

	const rootRecord = (extent: number) => dirRecord(new Uint8Array([0]), extent, SECTOR, true, date);

	// Directories: ".", "..", then the files.
	const writeDir = (sector: number, names: Uint8Array[]) => {
		let off = at(sector);
		for (const rec of [
			dirRecord(new Uint8Array([0]), sector, SECTOR, true, date),
			dirRecord(new Uint8Array([1]), sector, SECTOR, true, date),
		]) {
			img.set(rec, off);
			off += rec.length;
		}
		sorted.forEach((f, i) => {
			const rec = dirRecord(names[i] ?? new Uint8Array(), extents[i] ?? 0, f.data.length, false, date);
			img.set(rec, off);
			off += rec.length;
		});
		if (off - at(sector) > SECTOR) throw new Error("Too many files for a one-sector directory");
	};
	writeDir(
		ROOT,
		sorted.map((f) => new TextEncoder().encode(isoName(f.name))),
	);
	writeDir(
		JROOT,
		sorted.map((f) => ucs2Name(`${f.name};1`)),
	);

	const descriptor = (sector: number, joliet: boolean) => {
		const o = at(sector);
		img[o] = joliet ? 2 : 1;
		img.set(new TextEncoder().encode("CD001"), o + 1);
		img[o + 6] = 1;
		img.set(joliet ? ucs2("LINUX", 32) : ascii("LINUX", 32), o + 8);
		img.set(joliet ? ucs2(label.toLowerCase(), 32) : ascii(label.toUpperCase(), 32), o + 40);
		img.set(both32(total), o + 80);
		if (joliet) img.set(new Uint8Array([0x25, 0x2f, 0x45]), o + 88); // UCS-2 level 3
		img.set(both16(1), o + 120);
		img.set(both16(1), o + 124);
		img.set(both16(SECTOR), o + 128);
		img.set(both32(10), o + 132);
		new DataView(img.buffer).setUint32(o + 140, joliet ? JL_PT : L_PT, true);
		new DataView(img.buffer).setUint32(o + 148, joliet ? JM_PT : M_PT, false);
		img.set(rootRecord(joliet ? JROOT : ROOT), o + 156);
		const blank = (off: number, len: number) => img.set(joliet ? ucs2("", len) : ascii("", len), o + off);
		blank(190, 128);
		blank(318, 128);
		blank(446, 128);
		img.set(joliet ? ucs2("SEKAI", 128) : ascii("SEKAI", 128), o + 574);
		blank(702, 37 + 1);
		blank(739, 37 + 1);
		blank(776, 37 + 1);
		img.set(volDate(date), o + 813);
		img.set(volDate(date), o + 830);
		img.set(ascii("0000000000000000", 16, "0"), o + 847);
		img.set(ascii("0000000000000000", 16, "0"), o + 864);
		img[o + 881] = 1;
	};
	descriptor(PVD, false);
	descriptor(SVD, true);
	img[at(TERM)] = 255;
	img.set(new TextEncoder().encode("CD001"), at(TERM) + 1);
	img[at(TERM) + 6] = 1;

	img.set(pathTable(ROOT, true), at(L_PT));
	img.set(pathTable(ROOT, false), at(M_PT));
	img.set(pathTable(JROOT, true), at(JL_PT));
	img.set(pathTable(JROOT, false), at(JM_PT));

	sorted.forEach((f, i) => {
		img.set(f.data, at(extents[i] ?? 0));
	});
	return img;
}

/** The NoCloud seed for cloud-init: user-data and meta-data on a "cidata" CD. */
export function seedIso(userData: string, metaData: string): Uint8Array {
	const enc = new TextEncoder();
	return buildIso(
		[
			{ name: "meta-data", data: enc.encode(metaData) },
			{ name: "user-data", data: enc.encode(userData) },
		],
		"cidata",
	);
}
