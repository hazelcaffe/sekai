import { expect, test } from "bun:test";
import { errorMessage } from "@sekai/ui";
import { ticketFromPath } from "../src/pages/auth/TicketPage.tsx";

test("invite and reset links are read from the router's path", () => {
	const token = "a".repeat(32);
	expect(ticketFromPath(`/welcome/invite/${token}`)).toEqual({ kind: "invite", token });
	expect(ticketFromPath(`/welcome/reset/${token}/`)).toEqual({ kind: "reset", token });
	expect(ticketFromPath("/welcome")).toBeNull();
	expect(ticketFromPath(`/welcome/invite/short`)).toBeNull();
	expect(ticketFromPath(`/c/${token}`)).toBeNull();
});

test("a server's bare status line reads as words", () => {
	expect(errorMessage(new Error("502 Bad Gateway"))).toBe("Sekai's server had a problem. Try again in a moment.");
	expect(errorMessage(new Error("500"))).toBe("Sekai's server had a problem. Try again in a moment.");
	expect(errorMessage(new Error("That link expired or was already used."))).toBe(
		"That link expired or was already used.",
	);
});
