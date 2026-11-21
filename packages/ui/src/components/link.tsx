import { type ComponentProps, createContext, type ReactNode, useContext } from "react";

export type LinkProps = ComponentProps<"a"> & { href: string };

/**
 * How @sekai/ui renders links (Row href, Page back, SectionLayout items): a plain <a> unless the app hands it its
 * router's link once, at the root, e.g.
 * `<LinkProvider component={({ href, ...p }) => <RouterLink to={href} {...p} />}>`.
 */
export type LinkComponent = (props: LinkProps) => ReactNode;

const PlainLink: LinkComponent = (props) => <a {...props} />;

const Ctx = createContext<LinkComponent>(PlainLink);

export function LinkProvider({ component, children }: { component: LinkComponent; children: ReactNode }) {
	return <Ctx.Provider value={component}>{children}</Ctx.Provider>;
}

export function useLinkComponent(): LinkComponent {
	return useContext(Ctx);
}

/** A link through the app's router (a plain <a> without one, and always for other sites). */
export function Link(props: LinkProps) {
	const Router = useLinkComponent();
	if (/^[a-z][a-z0-9+.-]*:/i.test(props.href)) return <a {...props} />;
	return <Router {...props} />;
}
