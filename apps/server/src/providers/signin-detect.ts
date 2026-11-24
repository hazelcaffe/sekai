/**
 * Extracts sign-in links, one-time device codes and paste prompts from a CLI's terminal output, in memory only
 * (nothing is ever logged or saved). Used to render big one-tap buttons above the terminal panel.
 */

// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escape sequences from PTY output
const ANSI_OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escape sequences from PTY output
const ANSI_CSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escape sequences from PTY output
const ANSI_OTHER = /\u001b[@-Z\\-_]/g;

/** Removes ANSI escape codes and normalizes line breaks from terminal output. */
export function stripAnsi(text: string): string {
	return text
		.replace(ANSI_OSC, "")
		.replace(ANSI_CSI, "")
		.replace(ANSI_OTHER, "")
		.replace(/\r\n/g, "\n")
		.replace(/\r/g, "\n");
}

const LOCAL_HOST = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:\d+)?(\/|$)/i;
const AUTH_URL_HINT = /(auth|login|signin|sign-in|device|oauth|activate|verify|authorize|token|connect|sso)/i;
const URL_RE = /https:\/\/[^\s"'<>)\]]+/gi;
const TRAILING_PUNCT = /[.,;:!?)'"]+$/;

/** Joins wrapped URL lines that terminals split across 80-column boundaries. */
function joinWrappedUrls(text: string): string {
	const lines = text.split("\n");
	const out: string[] = [];
	for (const line of lines) {
		const prev = out[out.length - 1];
		// If the previous line ends with an https:// URL fragment and the next line has no leading whitespace
		// (or minimal indent in box-drawn output) and looks like URL query/path continuation, join it.
		if (
			prev &&
			/https:\/\/\S+$/.test(prev) &&
			/^[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+$/.test(line.trim()) &&
			!/^(https?:\/\/|[A-Z][a-z]+:)/.test(line.trim()) &&
			!CODE_STANDALONE.test(line.trim()) &&
			(prev.length >= 60 || /[?&=%/_-]$/.test(prev))
		) {
			out[out.length - 1] = prev + line.trim();
		} else {
			out.push(line);
		}
	}
	return out.join("\n");
}

const CODE_STANDALONE = /^[A-Z0-9]{4,5}-[A-Z0-9]{4,5}$/;

/**
 * Finds the best sign-in URL in terminal output, ignoring loopback callback URLs.
 * Prefers URLs whose path/host looks like an auth/device/login page when multiple URLs appear.
 */
export function detectSignInLink(stripped: string): string | null {
	const joined = joinWrappedUrls(stripped);
	const matches = joined.match(URL_RE);
	if (!matches) return null;
	const candidates = matches
		.map((raw) => raw.replace(TRAILING_PUNCT, ""))
		.filter((u) => {
			if (LOCAL_HOST.test(u)) return false;
			try {
				const parsed = new URL(u);
				return parsed.protocol === "https:" && parsed.hostname.includes(".");
			} catch {
				return false;
			}
		});
	if (candidates.length === 0) return null;
	const authLinks = candidates.filter((u) => AUTH_URL_HINT.test(u));
	return (authLinks.length ? authLinks[authLinks.length - 1] : candidates[candidates.length - 1]) ?? null;
}

const CODE_CONTEXT =
	/(?:one-time\s+code|device\s+code|user\s+code|verification\s+code|pairing\s+code|enter\s+(?:this\s+)?code|enter\s+code|confirmation\s+code|code\s*[:=]|code\s+below)[^\n]{0,120}/gi;
const HYPHEN_CODE = /\b([A-Z0-9]{4,5}-[A-Z0-9]{4,5}(?:-[A-Z0-9]{4})?)\b/g;
const PLAIN_CODE = /\b([A-Z0-9]{6,9})\b/;

/** Rejects false-positive codes (pure numbers that look like years/ports, common words, hex-only UUID parts). */
function looksLikeDeviceCode(candidate: string): boolean {
	if (!/[A-Z]/.test(candidate) && !candidate.includes("-")) return false;
	if (/^\d{4}-\d{4}$/.test(candidate)) return true;
	if (/^[A-Z0-9]{4,5}-[A-Z0-9]{4,5}(?:-[A-Z0-9]{4})?$/.test(candidate)) {
		// Reject things like HTTP-2026 or UTF8-XXXX where first segment is a common prefix
		if (/^(HTTP|JSON|CTRL|BASH|TERM|USER|AUTH|CODE|EXIT|LINE|WARN|INFO)-/i.test(candidate)) return false;
		return true;
	}
	// Unhyphenated code: must have both letters and digits (e.g. A1B2C3D4)
	return /[A-Z]/.test(candidate) && /\d/.test(candidate);
}

/** Finds a one-time device code (e.g. `ABCD-12345`, `WXYZ-1234`) in terminal output. */
export function detectDeviceCode(stripped: string): string | null {
	// Remove URLs first so query params or path segments aren't mistaken for device codes.
	const withoutUrls = joinWrappedUrls(stripped).replace(URL_RE, " ");

	// 1. Look right next to explicit code prompts (including the following line).
	const lines = withoutUrls.split("\n");
	for (let i = 0; i < lines.length; i++) {
		const window = `${lines[i] ?? ""}\n${lines[i + 1] ?? ""}`;
		if (CODE_CONTEXT.test(window)) {
			CODE_CONTEXT.lastIndex = 0;
			const hyphenMatches = [...window.matchAll(HYPHEN_CODE)].map((m) => m[1] ?? "");
			for (const c of hyphenMatches) {
				if (looksLikeDeviceCode(c)) return c;
			}
			// Check the next line alone if it's a standalone code token
			const nextTrim = (lines[i + 1] ?? "").trim();
			const plain = nextTrim.match(PLAIN_CODE)?.[1];
			if (plain && nextTrim === plain && looksLikeDeviceCode(plain)) return plain;
		}
		CODE_CONTEXT.lastIndex = 0;
	}

	// 2. Fallback: a standalone hyphenated uppercase device code on its own line (common in boxed terminal UIs).
	for (const line of lines) {
		const trimmed = line.replace(/[│┃|]/g, "").trim();
		if (CODE_STANDALONE.test(trimmed) && looksLikeDeviceCode(trimmed)) return trimmed;
	}

	return null;
}

const PASTE_PROMPT =
	/(?:paste\s+(?:the\s+|your\s+)?(?:auth(?:orization)?\s+)?(?:code|token|key|callback|url)|enter\s+(?:the\s+|your\s+)?(?:auth(?:orization)?\s+code|token|api\s*key)|copy\s+and\s+paste\s+(?:the\s+)?(?:code|token))/i;

/** Whether the CLI appears to be waiting for the user to paste an auth code or token back. */
export function detectPastePrompt(stripped: string): boolean {
	return PASTE_PROMPT.test(stripped);
}

export type SignInDetection = { type: "link"; url: string } | { type: "code"; code: string } | { type: "paste" };

/**
 * Stateful streaming detector for one sign-in terminal session. Keeps only a small sliding text buffer in
 * memory and emits each newly discovered link, device code, or paste prompt once.
 */
export class SignInDetector {
	private buffer = "";
	private lastLink: string | null = null;
	private lastCode: string | null = null;
	private sawPaste = false;

	push(chunk: string): SignInDetection[] {
		this.buffer = (this.buffer + stripAnsi(chunk)).slice(-6_000);
		const events: SignInDetection[] = [];

		const link = detectSignInLink(this.buffer);
		if (link && link !== this.lastLink) {
			this.lastLink = link;
			events.push({ type: "link", url: link });
		}

		const code = detectDeviceCode(this.buffer);
		if (code && code !== this.lastCode) {
			this.lastCode = code;
			events.push({ type: "code", code });
		}

		if (!this.sawPaste && detectPastePrompt(this.buffer)) {
			this.sawPaste = true;
			events.push({ type: "paste" });
		}

		return events;
	}
}
