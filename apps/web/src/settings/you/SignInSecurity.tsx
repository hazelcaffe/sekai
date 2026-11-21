import { useAuth } from "@sekai/client";
import { Page, SkeletonRows } from "@sekai/ui";
import { useEffect } from "react";
import { useLocation } from "react-router";
import type { SettingsSectionProps } from "../section.ts";
import { LinkedAccounts, Passkeys, Password, TwoFactor } from "./account.tsx";
import { OtherDevices, Sessions, Tokens } from "./sessions.tsx";

export function SignInSecuritySection({ back }: SettingsSectionProps) {
	const { data: status } = useAuth();
	const { hash } = useLocation();
	// Old links to "Sign-ins & tokens" land on #sessions.
	useEffect(() => {
		if (!hash || !status) return;
		const t = setTimeout(() => document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" }), 150);
		return () => clearTimeout(t);
	}, [hash, status]);
	return (
		<Page
			back={back}
			title="Sign-in & security"
			description="How you sign in, and where you're signed in."
			width="form"
		>
			{status ? (
				<>
					<Password />
					<Passkeys status={status} />
					<TwoFactor />
					<LinkedAccounts status={status} />
					<Sessions />
					<Tokens />
					<OtherDevices />
				</>
			) : (
				<SkeletonRows count={4} />
			)}
		</Page>
	);
}
