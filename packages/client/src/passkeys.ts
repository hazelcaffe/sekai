import type { PasskeyInfo, SignInResult } from "@sekai/shared";
import {
	browserSupportsWebAuthn,
	browserSupportsWebAuthnAutofill,
	type PublicKeyCredentialCreationOptionsJSON,
	type PublicKeyCredentialRequestOptionsJSON,
	startAuthentication,
	startRegistration,
	WebAuthnAbortService,
	WebAuthnError,
} from "@simplewebauthn/browser";
import { api } from "./api.ts";
import { mobile } from "./mobile.ts";

/**
 * This browser can make passkeys, and the server says this address can use them. Not in the phone apps: their web
 * views can't use passkeys for a self-hosted address (signing in goes through the system browser there).
 */
export function passkeysSupported(availableHere: boolean): boolean {
	return !mobile && availableHere && browserSupportsWebAuthn();
}

function friendly(err: unknown): Error {
	if (err instanceof WebAuthnError) {
		if (err.code === "ERROR_CEREMONY_ABORTED" || err.name === "NotAllowedError") {
			return new Error("Cancelled");
		}
		if (err.code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED") {
			return new Error("This device already has a passkey for Sekai");
		}
	}
	if (err instanceof Error && err.name === "NotAllowedError") return new Error("Cancelled");
	return err instanceof Error ? err : new Error(String(err));
}

/** Creates a passkey for the signed-in account (Face ID, Touch ID, Windows Hello, a password manager…). */
export async function registerPasskey(name?: string): Promise<PasskeyInfo> {
	const { challengeId, options } = await api.auth.passkeyRegisterOptions();
	let response: unknown;
	try {
		response = await startRegistration({
			optionsJSON: options as unknown as PublicKeyCredentialCreationOptionsJSON,
		});
	} catch (err) {
		throw friendly(err);
	}
	return api.auth.passkeyRegisterVerify({ challengeId, response, name });
}

/**
 * Signs in with a passkey. With `autofill`, the browser offers saved passkeys in the username field's
 * suggestions instead of opening a dialog (resolves when one is picked).
 */
export async function signInWithPasskey(opts: { autofill?: boolean; reauth?: boolean } = {}): Promise<SignInResult> {
	const { challengeId, options } = await api.auth.passkeyLoginOptions();
	let response: unknown;
	try {
		response = await startAuthentication({
			optionsJSON: options as unknown as PublicKeyCredentialRequestOptionsJSON,
			useBrowserAutofill: opts.autofill ?? false,
		});
	} catch (err) {
		throw friendly(err);
	}
	return api.auth.passkeyLoginVerify({ challengeId, response, reauth: opts.reauth });
}

/**
 * Offers saved passkeys in the username field's autofill (the field needs autocomplete="username webauthn").
 * Resolves with the user once one is picked, or null if this browser can't, or the offer was withdrawn.
 */
export async function passkeyAutofill(): Promise<SignInResult | null> {
	if (!(await browserSupportsWebAuthnAutofill())) return null;
	try {
		return await signInWithPasskey({ autofill: true });
	} catch {
		return null;
	}
}

/** Withdraws a pending passkey prompt or autofill offer. */
export function cancelPasskeyPrompt(): void {
	WebAuthnAbortService.cancelCeremony();
}
