import { randomBytes } from "node:crypto";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
	OAuthClientInformationMixed,
	OAuthClientMetadata,
	OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { eq } from "drizzle-orm";
import { APP_NAME } from "../config.ts";
import { db, schema } from "../db/index.ts";
import { errorMessage } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { seal, unseal } from "../lib/secrets.ts";

/** Where the browser comes back after you approve an app. */
export const OAUTH_CALLBACK_PATH = "/api/mcp/oauth/callback";

/** Everything an app's sign-in needs to remember, encrypted on its server row. */
export interface OAuthState {
	/** The callback address it was registered with (your Sekai's address in the browser). */
	redirectUri?: string;
	client?: OAuthClientInformationMixed;
	tokens?: OAuthTokens;
	verifier?: string;
	/** Ties the callback to this server. */
	state?: string;
	/** Your own OAuth client (not registered automatically): kept across sign-ins. */
	ownClient?: boolean;
	scope?: string;
	/** Added to the sign-in page's address. */
	params?: Record<string, string>;
}

export function readOAuth(sealed: string | null): OAuthState | null {
	if (!sealed) return null;
	try {
		return JSON.parse(unseal(sealed)) as OAuthState;
	} catch (err) {
		log.warn(`couldn't read an app's sign-in: ${errorMessage(err)}`);
		return {};
	}
}

export async function writeOAuth(serverId: string, state: OAuthState): Promise<void> {
	await db
		.update(schema.mcpServers)
		.set({ oauth: seal(JSON.stringify(state)), updatedAt: Date.now() })
		.where(eq(schema.mcpServers.id, serverId));
}

/**
 * The MCP SDK's OAuth client, backed by the server row: dynamic client registration, PKCE, tokens and refresh.
 * When the app needs you to sign in, onAuthorize gets the address to send you to.
 */
export class McpOAuthProvider implements OAuthClientProvider {
	constructor(
		private readonly serverId: string,
		private readonly st: OAuthState,
		private readonly onAuthorize: (url: URL) => void,
	) {}

	get redirectUrl(): string | undefined {
		return this.st.redirectUri;
	}

	get clientMetadata(): OAuthClientMetadata {
		return {
			client_name: APP_NAME,
			redirect_uris: this.st.redirectUri ? [this.st.redirectUri] : [],
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
			token_endpoint_auth_method:
				this.st.ownClient && this.st.client?.client_secret ? "client_secret_post" : "none",
			...(this.st.scope ? { scope: this.st.scope } : {}),
		};
	}

	private save(): Promise<void> {
		return writeOAuth(this.serverId, this.st);
	}

	async state(): Promise<string> {
		this.st.state = randomBytes(18).toString("base64url");
		await this.save();
		return this.st.state;
	}

	clientInformation(): OAuthClientInformationMixed | undefined {
		return this.st.client;
	}

	async saveClientInformation(info: OAuthClientInformationMixed): Promise<void> {
		this.st.client = info;
		await this.save();
	}

	tokens(): OAuthTokens | undefined {
		return this.st.tokens;
	}

	async saveTokens(tokens: OAuthTokens): Promise<void> {
		// Some apps don't send the refresh token again when they refresh: keep the old one.
		this.st.tokens = { ...tokens, refresh_token: tokens.refresh_token ?? this.st.tokens?.refresh_token };
		await this.save();
	}

	redirectToAuthorization(url: URL): void {
		for (const [k, v] of Object.entries(this.st.params ?? {})) url.searchParams.set(k, v);
		this.onAuthorize(url);
	}

	async saveCodeVerifier(verifier: string): Promise<void> {
		this.st.verifier = verifier;
		await this.save();
	}

	codeVerifier(): string {
		if (!this.st.verifier) throw new Error("The sign-in expired. Start it again.");
		return this.st.verifier;
	}

	async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): Promise<void> {
		// Your own client stays: only automatic registrations are thrown away.
		if ((scope === "all" || scope === "client") && !this.st.ownClient) this.st.client = undefined;
		if (scope === "all" || scope === "tokens") this.st.tokens = undefined;
		if (scope === "all" || scope === "verifier") this.st.verifier = undefined;
		await this.save();
	}
}
