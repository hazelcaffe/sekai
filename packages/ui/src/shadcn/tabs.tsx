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

const tabsListVariants = cva("group/tabs-list flex text-muted-foreground", {
	variants: {
		variant: {
			/** Quiet chips that scroll sideways on narrow screens. */
			chips: "gap-1 overflow-x-auto scrollbar-none [-webkit-overflow-scrolling:touch]",
			/** A tinted track; the active tab lifts out as a raised pill. */
			pill: "w-fit max-w-full gap-1 overflow-x-auto rounded-xl bg-muted p-1 scrollbar-none",
			/** Underlined tabs with a brand-colored indicator. */
			line: "gap-5 overflow-x-auto border-b border-border scrollbar-none",
			/** A vertical side rail of icon + label rows. */
			nav: "flex-col gap-0.5",
			/** Settings navigation: outlined chips that scroll sideways on phones, a side rail on large screens. */
			rail: "gap-1.5 overflow-x-auto scrollbar-none [-webkit-overflow-scrolling:touch] lg:flex-col lg:gap-0.5 lg:overflow-visible",
		},
	},
	defaultVariants: { variant: "chips" },
});

const tabsTriggerVariants = cva(
	"relative inline-flex shrink-0 items-center gap-2 text-[13px] font-medium whitespace-nowrap outline-none transition-[background-color,color,box-shadow,border-color] duration-150 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
	{
		variants: {
			variant: {
				chips: "rounded-lg px-3 py-1.5 data-active:bg-muted data-active:text-foreground coarse:py-2",
				pill: "h-8 rounded-[10px] px-3 data-active:bg-background data-active:text-foreground data-active:shadow-[0_1px_2px_rgb(0_0_0/0.08),0_2px_8px_-2px_rgb(0_0_0/0.1)] dark:data-active:bg-surface-3",
				line: "pt-1 pb-2.5 after:pointer-events-none after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full after:bg-brand after:opacity-0 after:transition-opacity data-active:text-foreground data-active:after:opacity-100",
				nav: "h-10 w-full justify-start rounded-xl px-3 text-sm hover:bg-muted/70 data-active:bg-muted data-active:text-foreground data-active:[&_svg]:text-brand-ink",
				rail: "h-9 rounded-full border border-border px-3.5 data-active:border-transparent data-active:bg-primary data-active:text-primary-foreground coarse:h-10 lg:h-10 lg:w-full lg:justify-start lg:rounded-xl lg:border-transparent lg:px-3 lg:text-sm lg:hover:bg-muted/70 lg:data-active:bg-muted lg:data-active:text-foreground lg:data-active:[&_svg]:text-brand-ink",
			},
		},
		defaultVariants: { variant: "chips" },
	},
);

type TabsVariant = NonNullable<VariantProps<typeof tabsListVariants>["variant"]>;
const TabsVariantContext = React.createContext<TabsVariant>("chips");

function TabsList({
	className,
	variant = "chips",
	...props
}: React.ComponentProps<typeof TabsPrimitive.List> & VariantProps<typeof tabsListVariants>) {
	const v = variant ?? "chips";
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
				"outline-none data-[state=active]:animate-in data-[state=active]:fade-in-0 data-[state=active]:duration-200",
				className,
			)}
			{...props}
		/>
	);
}

export { Tabs, TabsContent, TabsList, TabsTrigger, tabsListVariants, tabsTriggerVariants };
