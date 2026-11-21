import { type ReactNode, useLayoutEffect, useRef } from "react";
import { useIsPhone } from "../lib/platform.ts";
import { cn } from "../lib/utils.ts";
import { Link, type LinkComponent, LinkProvider } from "./link.tsx";
import { List, Row, Section } from "./list.tsx";
import { InSectionLayout, Page, type PageBack } from "./page.tsx";

export interface SectionItem {
	id: string;
	title: string;
	icon?: ReactNode;
	/** Opens through the app's router (LinkProvider, or `linkComponent` here). */
	href?: string;
	onSelect?: () => void;
	/** A count or a StatusDot on the right. */
	badge?: ReactNode;
	hidden?: boolean;
	/** In danger ink on phones (Sign out). */
	danger?: boolean;
}

export interface SectionGroup {
	id: string;
	/** A small heading over the group ("You", "Bots"); none for the first. */
	title?: string;
	items: SectionItem[];
}

export interface SectionLayoutProps {
	/** What the sections belong to: "Settings", a bot's name. The phone list's title and the rail's heading. */
	title: ReactNode;
	description?: ReactNode;
	groups: SectionGroup[];
	/** The open section's id. On phones, null shows the list of sections instead of a section. */
	active: string | null;
	/**
	 * The open section: a <Page back={{ …, phoneOnly: true }}> (the list is a step back on phones; the rail is the
	 * way back from tablets up). Its own pages (a person, a note) show "‹ People" above their title everywhere.
	 */
	children?: ReactNode;
	/** Above the sections, in the rail and the phone list (a search field, your profile card). */
	header?: ReactNode;
	/** Set apart under the sections: at the rail's foot, and as a group of its own at the end of the phone list (Sign out). */
	footer?: SectionItem[];
	/** On phones, where the list is a screen of its own: back to the screen under it (Chats, the chat). */
	back?: PageBack;
	/** On phones: the list's bar actions. */
	actions?: ReactNode;
	/** The router's link, if the app hasn't given one to LinkProvider. */
	linkComponent?: LinkComponent;
	className?: string;
}

/**
 * Settings and a bot: grouped section navigation on the left from tablets up, a list that pushes each section as its
 * own page on phones. Takes the groups and sections as data; router-agnostic (items have an href or an onSelect).
 */
export function SectionLayout(props: SectionLayoutProps) {
	const { linkComponent } = props;
	const body = <SectionLayoutBody {...props} />;
	return linkComponent ? <LinkProvider component={linkComponent}>{body}</LinkProvider> : body;
}

function SectionLayoutBody({
	title,
	description,
	groups,
	active,
	children,
	header,
	footer,
	back,
	actions,
	className,
}: SectionLayoutProps) {
	const phone = useIsPhone();
	const nav = useRef<HTMLElement>(null);
	// The open section is always in view in the rail (an admin's Status is near the end of a long list).
	// biome-ignore lint/correctness/useExhaustiveDependencies: the rail appears when the screen grows past a phone's
	useLayoutEffect(() => {
		const box = nav.current;
		const item = box?.querySelector<HTMLElement>('[aria-current="page"]');
		if (!box || !item || active === null) return;
		const top = item.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
		const pad = 12;
		if (top < box.scrollTop + pad) box.scrollTop = Math.max(0, top - pad);
		else if (top + item.offsetHeight > box.scrollTop + box.clientHeight - pad)
			box.scrollTop = top + item.offsetHeight - box.clientHeight + pad;
	}, [active, phone]);
	const visible = groups
		.map((g) => ({ ...g, items: g.items.filter((i) => !i.hidden) }))
		.filter((g) => g.items.length > 0);

	if (phone) {
		if (active !== null) return <>{children}</>;
		return (
			<Page
				title={title}
				description={description}
				back={back}
				actions={actions}
				width="form"
				className={className}
			>
				{header}
				{visible.map((g) => (
					<Section key={g.id} title={g.title}>
						<List label={g.title}>
							{g.items.map((item) => (
								<Row
									key={item.id}
									icon={item.icon}
									title={item.title}
									badge={item.badge}
									href={item.href}
									onClick={item.href ? undefined : item.onSelect}
									chevron={Boolean(item.href)}
								/>
							))}
						</List>
					</Section>
				))}
				{footer && footer.length > 0 && (
					<List>
						{footer.map((item) => (
							<Row
								key={item.id}
								icon={item.icon}
								iconTone={item.danger ? "danger" : "neutral"}
								title={item.title}
								danger={item.danger}
								href={item.href}
								onClick={item.href ? undefined : item.onSelect}
								chevron={Boolean(item.href)}
							/>
						))}
					</List>
				)}
			</Page>
		);
	}

	return (
		<div data-slot="section-layout" className={cn("flex min-h-0 flex-1", className)}>
			<nav
				ref={nav}
				aria-label={typeof title === "string" ? title : undefined}
				className="flex w-60 shrink-0 flex-col gap-5 overflow-y-auto border-r border-border bg-bg-subtle px-3 pt-safe-6 pb-safe-6 scrollbar-thin lg:w-64"
			>
				<div className="px-2.5 text-heading font-semibold text-fg">{title}</div>
				{header}
				{visible.map((g) => (
					<div key={g.id} className="flex flex-col gap-0.5">
						{g.title && (
							<div className="px-2.5 pb-1 text-caption font-medium text-fg-subtle">{g.title}</div>
						)}
						{g.items.map((item) => (
							<NavItem key={item.id} item={item} active={item.id === active} />
						))}
					</div>
				))}
				{footer && footer.length > 0 && (
					<div className="mt-auto flex flex-col gap-0.5 border-t border-border pt-3">
						{footer.map((item) => (
							<NavItem key={item.id} item={item} active={item.id === active} />
						))}
					</div>
				)}
			</nav>
			<InSectionLayout.Provider value={true}>
				<div className="flex min-w-0 flex-1 flex-col">{children}</div>
			</InSectionLayout.Provider>
		</div>
	);
}

function NavItem({ item, active }: { item: SectionItem; active: boolean }) {
	const cls = cn(
		"flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-body transition-colors duration-fast coarse:h-11 [&_svg]:size-5 [&_svg]:shrink-0",
		active
			? "bg-selected font-medium text-fg [&_svg]:text-brand-ink"
			: "text-fg-muted hover:bg-surface-2 hover:text-fg [&_svg]:text-fg-subtle",
	);
	const inner = (
		<>
			{item.icon}
			<span className="min-w-0 flex-1 truncate">{item.title}</span>
			{item.badge}
		</>
	);
	if (item.href) {
		return (
			<Link href={item.href} aria-current={active ? "page" : undefined} className={cls}>
				{inner}
			</Link>
		);
	}
	return (
		<button type="button" aria-current={active ? "page" : undefined} onClick={item.onSelect} className={cls}>
			{inner}
		</button>
	);
}
