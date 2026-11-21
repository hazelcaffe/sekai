import { mobile } from "@sekai/client";
import { Confirm, ErrorBoundary, SectionLayout, StatusDot, useIsPhone, useMediaQuery } from "@sekai/ui";
import { Suspense, useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router";
import { PageLoading } from "../components/layout/Loading.tsx";
import { SearchButton } from "../components/layout/SearchButton.tsx";
import { useGoBack } from "../lib/back.ts";
import { signOut } from "../lib/session.ts";
import { useViewer } from "../lib/viewer.ts";
import { useUi } from "../stores/ui.ts";
import {
	canEditSection,
	canOpenSection,
	homeSection,
	listedSections,
	SETTINGS_GROUPS,
	type SettingsSectionDef,
	sectionBack,
	sectionFromPath,
	sectionPath,
	settingsSection,
} from "./registry.tsx";
import { useAttention } from "./server/attention.ts";

/** /settings/:section: everything you can set, in sections grouped by who it's for (the list of them on phones). */
export function SettingsPage() {
	const { pathname } = useLocation();
	const viewer = useViewer();
	const phone = useIsPhone();
	const goBack = useGoBack();
	const { bySection } = useAttention();
	// On touch screens a stray tap shouldn't end the session: Sign out asks first there.
	const touch = useMediaQuery("(pointer: coarse)");
	const [signingOut, setSigningOut] = useState(false);
	const found = sectionFromPath(pathname);
	const title = found?.section.title;
	useEffect(() => {
		document.title = title ? `${title} · Sekai` : "Settings · Sekai";
		return () => {
			document.title = "Sekai";
		};
	}, [title]);

	const atRoot = pathname.replace(/\/+$/, "") === "/settings";
	// An unknown section, or one that isn't yours to open: Settings itself (your first section on wider screens).
	if (!atRoot && (!found || !canOpenSection(found.section, viewer))) return <Navigate to="/settings" replace />;
	if (atRoot && !phone) return <Navigate to={sectionPath(homeSection(viewer).id)} replace />;

	const listed = listedSections(viewer);
	const act = (s: SettingsSectionDef) =>
		s.action === "sign-out"
			? () => (touch ? setSigningOut(true) : void signOut())
			: s.action === "phone-server"
				? () => mobile?.openSettings()
				: s.action === "get-apps"
					? () => useUi.getState().setGetAppsOpen(true)
					: undefined;
	const item = (s: SettingsSectionDef) => {
		const tone = bySection[s.id];
		return {
			id: s.id,
			title: s.title,
			icon: s.icon,
			href: s.action ? undefined : sectionPath(s.id),
			onSelect: act(s),
			badge: tone ? <StatusDot tone={tone} label="Needs attention" /> : undefined,
			danger: s.action === "sign-out",
		};
	};
	// Sign out sits apart, at the foot of the rail and the end of the phone list.
	const footer = listed.filter((s) => s.action === "sign-out").map(item);
	const groups = SETTINGS_GROUPS.map((g) => ({
		id: g.id,
		title: g.title,
		items: listed.filter((s) => s.group === g.id && s.action !== "sign-out").map(item),
	}));

	const section = found?.section;
	// A sub-page lights up its parent in the list (when that's where it's reached from).
	const parent = section?.parent ? settingsSection(section.parent) : undefined;
	const active = section ? (parent && canOpenSection(parent, viewer) ? parent.id : section.id) : null;
	const Section = section?.component;
	const back = section ? sectionBack(section, viewer) : null;

	return (
		<>
			<SectionLayout
				title="Settings"
				groups={groups}
				footer={footer}
				active={active}
				back={{ label: "Chats", onClick: () => goBack("/") }}
				header={phone ? <SearchButton label="Search settings" scope="settings" className="-mt-4" /> : undefined}
			>
				{Section && section && back && (
					<ErrorBoundary resetKey={pathname}>
						<Suspense fallback={<PageLoading />}>
							<Section
								back={{ label: back.label, onClick: () => goBack(back.to), phoneOnly: back.phoneOnly }}
								rest={found?.rest ?? ""}
								readOnly={!canEditSection(section, viewer)}
							/>
						</Suspense>
					</ErrorBoundary>
				)}
			</SectionLayout>
			<Confirm
				open={signingOut}
				onOpenChange={setSigningOut}
				title="Sign out of Sekai?"
				description="You'll sign in again on this device to get back to your chats."
				confirmLabel="Sign out"
				onConfirm={() => void signOut()}
			/>
		</>
	);
}
