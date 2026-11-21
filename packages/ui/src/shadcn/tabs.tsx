import { cva, type VariantProps } from "class-variance-authority";
import { Tabs as TabsPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "../lib/utils.ts";

function Tabs({ className, orientation = "horizontal", ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
	return (
		<TabsPrimitive.Root
			data-slot="tabs"
			data-orientation={orientation}
			orientation={orientation}
			className={cn("group/tabs", className)}
			{...props}
		/>
	);
}

/** One look for tabs: an underline. Old names (chips, pill, line) are kept as aliases of it. */
const underlineList = "gap-5 overflow-x-auto border-b border-border scrollbar-none [-webkit-overflow-scrolling:touch]";
const underlineTrigger =
	"min-h-10 pt-1 pb-2.5 after:pointer-events-none after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full after:bg-brand-ink after:opacity-0 after:transition-opacity data-active:text-fg data-active:after:opacity-100 coarse:min-h-11";

const tabsListVariants = cva("group/tabs-list flex text-fg-muted", {
	variants: {
		variant: {
			underline: underlineList,
			chips: underlineList,
			pill: underlineList,
			line: underlineList,
			/** A vertical list of icon + label rows (section navigation; SectionLayout is the newer way). */
			nav: "flex-col gap-0.5",
			/** Settings navigation: outlined chips that scroll sideways on phones, a side rail on large screens. */
			rail: "gap-1.5 overflow-x-auto scrollbar-none [-webkit-overflow-scrolling:touch] lg:flex-col lg:gap-0.5 lg:overflow-visible",
		},
	},
	defaultVariants: { variant: "underline" },
});

const tabsTriggerVariants = cva(
	"relative inline-flex shrink-0 items-center gap-2 text-body font-medium whitespace-nowrap transition-[background-color,color,box-shadow,border-color] duration-fast hover:text-fg disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
	{
		variants: {
			variant: {
				underline: underlineTrigger,
				chips: underlineTrigger,
				pill: underlineTrigger,
				line: underlineTrigger,
				nav: "h-10 w-full justify-start rounded-md px-3 hover:bg-surface-2 data-active:bg-surface-2 data-active:text-fg data-active:[&_svg]:text-brand-ink",
				rail: "h-9 rounded-full border border-border px-3.5 data-active:border-transparent data-active:bg-primary data-active:text-primary-foreground coarse:h-10 lg:h-10 lg:w-full lg:justify-start lg:rounded-md lg:border-transparent lg:px-3 lg:hover:bg-surface-2 lg:data-active:bg-surface-2 lg:data-active:text-fg lg:data-active:[&_svg]:text-brand-ink",
			},
		},
		defaultVariants: { variant: "underline" },
	},
);

type TabsVariant = NonNullable<VariantProps<typeof tabsListVariants>["variant"]>;
const TabsVariantContext = React.createContext<TabsVariant>("underline");

function TabsList({
	className,
	variant = "underline",
	...props
}: React.ComponentProps<typeof TabsPrimitive.List> & VariantProps<typeof tabsListVariants>) {
	const v = variant ?? "underline";
	return (
		<TabsVariantContext.Provider value={v}>
			<TabsPrimitive.List
				data-slot="tabs-list"
				data-variant={v}
				className={cn(tabsListVariants({ variant: v }), className)}
				{...props}
			/>
		</TabsVariantContext.Provider>
	);
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
	const variant = React.useContext(TabsVariantContext);
	return (
		<TabsPrimitive.Trigger
			data-slot="tabs-trigger"
			className={cn(tabsTriggerVariants({ variant }), className)}
			{...props}
		/>
	);
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
	return (
		<TabsPrimitive.Content
			data-slot="tabs-content"
			className={cn(
				"outline-none data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:duration-panel",
				className,
			)}
			{...props}
		/>
	);
}

export { Tabs, TabsContent, TabsList, TabsTrigger, tabsListVariants, tabsTriggerVariants };
