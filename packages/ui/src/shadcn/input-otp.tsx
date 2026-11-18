import { OTPInput, OTPInputContext } from "input-otp";
import { MinusIcon } from "lucide-react";
import * as React from "react";
import { cn } from "../lib/utils.ts";

function InputOTP({
	className,
	containerClassName,
	...props
}: React.ComponentProps<typeof OTPInput> & { containerClassName?: string }) {
	return (
		<OTPInput
			data-slot="input-otp"
			containerClassName={cn("flex items-center gap-2 has-disabled:opacity-50", containerClassName)}
			spellCheck={false}
			className={cn("disabled:cursor-not-allowed", className)}
			{...props}
		/>
	);
}

function InputOTPGroup({ className, ...props }: React.ComponentProps<"div">) {
	return <div data-slot="input-otp-group" className={cn("flex items-center gap-1.5", className)} {...props} />;
}

/** One rounded, filled cell per character; the active one gets the brand edge and a blinking caret. */
function InputOTPSlot({ index, className, ...props }: React.ComponentProps<"div"> & { index: number }) {
	const context = React.useContext(OTPInputContext);
	const { char, hasFakeCaret, isActive } = context?.slots[index] ?? {};
	return (
		<div
			data-slot="input-otp-slot"
			data-active={isActive}
			className={cn(
				"relative flex h-12 w-10 items-center justify-center rounded-xl border border-transparent bg-muted font-mono text-lg font-medium uppercase transition-[border-color,box-shadow,background-color] duration-150 aria-invalid:border-destructive/60 data-[active=true]:z-10 data-[active=true]:border-brand/60 data-[active=true]:bg-background data-[active=true]:ring-[3px] data-[active=true]:ring-ring/15",
				className,
			)}
			{...props}
		>
			{char}
			{hasFakeCaret && (
				<div className="pointer-events-none absolute inset-0 flex items-center justify-center">
					<div className="h-5 w-px animate-caret-blink bg-foreground" />
				</div>
			)}
		</div>
	);
}

function InputOTPSeparator(props: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="input-otp-separator"
			aria-hidden
			className="flex items-center text-fg-subtle [&_svg]:size-4"
			{...props}
		>
			<MinusIcon />
		</div>
	);
}

export { InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot };
