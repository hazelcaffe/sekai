import { useState } from "react";

/** The last value that wasn't null, so a closing dialog keeps its content while it animates away. */
export function useLastNonNull<T>(value: T | null): T | null {
	const [last, setLast] = useState(value);
	if (value !== null && value !== last) setLast(value);
	return value ?? last;
}

/** "ana.lima" from "Ána Lima": a username suggestion (they can change it). */
export function usernameFrom(name: string): string {
	return name
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.trim()
		.replace(/\s+/g, ".")
		.replace(/[^a-z0-9._-]+/g, "")
		.replace(/^[._-]+/, "")
		.slice(0, 39);
}

export const USERS = ["admin", "users"] as const;
export const ROLES = ["admin", "roles"] as const;
export const SSO = ["admin", "sso"] as const;
export const EMAIL = ["admin", "email"] as const;

export const PHONE = /^\+[1-9]\d{6,14}$/;
export const EMAIL_LIKE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
