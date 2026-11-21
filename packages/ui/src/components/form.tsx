import { Eye, EyeOff } from "lucide-react";
import { type ComponentProps, createContext, type ReactNode, useContext, useId, useState } from "react";
import { cn } from "../lib/utils.ts";
import { Checkbox as CheckboxPrimitive } from "../shadcn/checkbox.tsx";
import { Input as InputPrimitive } from "../shadcn/input.tsx";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "../shadcn/input-otp.tsx";
import { Label } from "../shadcn/label.tsx";
import { SelectContent, SelectItem, Select as SelectRoot, SelectTrigger, SelectValue } from "../shadcn/select.tsx";
import { Switch as SwitchPrimitive } from "../shadcn/switch.tsx";
import { Textarea as TextareaPrimitive } from "../shadcn/textarea.tsx";
import { ToggleGroup, ToggleGroupItem } from "../shadcn/toggle-group.tsx";

/** A Field's ids, so its label and hint belong to the control inside it (screen readers, getByLabel). */
const FieldContext = createContext<{ id: string; hintId: string | undefined; invalid: boolean } | null>(null);

function useField(id?: string) {
	const field = useContext(FieldContext);
	return {
		id: id ?? field?.id,
		"aria-describedby": field?.hintId,
		"aria-invalid": field?.invalid || undefined,
	};
}

export function Input({ id, ...props }: ComponentProps<"input">) {
	return <InputPrimitive {...useField(id)} {...props} />;
}

export function Textarea({ id, ...props }: ComponentProps<"textarea">) {
	return <TextareaPrimitive {...useField(id)} {...props} />;
}

/** A password field with a show/hide toggle inside it. */
export function PasswordInput({ id, className, ...props }: Omit<ComponentProps<"input">, "type">) {
	const [visible, setVisible] = useState(false);
	return (
		<div className="relative">
			<InputPrimitive
				{...useField(id)}
				type={visible ? "text" : "password"}
				className={cn("pr-11", className)}
				{...props}
			/>
			<button
				type="button"
				onClick={() => setVisible((v) => !v)}
				aria-label={visible ? "Hide password" : "Show password"}
				aria-pressed={visible}
				className="hit-area absolute inset-y-0 right-1 my-auto flex size-8 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-surface-hover hover:text-fg coarse:size-10 [&_svg]:size-4"
			>
				{visible ? <EyeOff /> : <Eye />}
			</button>
		</div>
	);
}

/** A row of single-character cells for short codes (setup codes, one-time codes). */
export function CodeInput({
	length = 6,
	value,
	onChange,
	onComplete,
	autoFocus,
	disabled,
}: {
	length?: number;
	value: string;
	onChange: (value: string) => void;
	onComplete?: (value: string) => void;
	autoFocus?: boolean;
	disabled?: boolean;
}) {
	const field = useField();
	return (
		<InputOTP
			maxLength={length}
			value={value}
			onChange={(v) => onChange(v.toUpperCase())}
			onComplete={onComplete}
			autoFocus={autoFocus}
			disabled={disabled}
			pattern="^[A-Za-z0-9]*$"
			id={field.id}
			aria-describedby={field["aria-describedby"]}
		>
			<InputOTPGroup>
				{Array.from({ length }, (_, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: slots are positional
					<InputOTPSlot key={i} index={i} aria-invalid={field["aria-invalid"]} />
				))}
			</InputOTPGroup>
		</InputOTP>
	);
}

export interface FieldProps {
	/** Above the control. Placeholders are examples, never labels. */
	label: ReactNode;
	/** One line under the control. */
	hint?: ReactNode;
	/** Shown instead of the hint, in danger ink; marks the control invalid. */
	error?: string | null;
	/** Says "Optional" in the hint (before it, if there's one). */
	optional?: boolean;
	children: ReactNode;
	className?: string;
	/** A small action beside the label (for example "Generate"). */
	action?: ReactNode;
}

/** Label above, the control, a one-line hint below, an error below that. Wires them to the control for screen readers. */
export function Field({ label, hint, error, optional, children, className, action }: FieldProps) {
	const id = useId();
	const note = optional ? hint ? <>Optional. {hint}</> : "Optional" : hint;
	const hintId = error || note ? `${id}-hint` : undefined;
	return (
		<FieldContext.Provider value={{ id, hintId, invalid: Boolean(error) }}>
			<div data-slot="field" className={cn("flex min-w-0 flex-col gap-1.5", className)}>
				<div className="flex items-center justify-between gap-2">
					<Label htmlFor={id}>{label}</Label>
					{action}
				</div>
				{children}
				{error ? (
					<p id={hintId} className="text-small text-danger-ink">
						{error}
					</p>
				) : note ? (
					<p id={hintId} className="text-small text-fg-subtle">
						{note}
					</p>
				) : null}
			</div>
		</FieldContext.Provider>
	);
}

export function Switch({
	checked,
	onCheckedChange,
	disabled,
	label,
	id,
	size,
	className,
}: {
	checked: boolean;
	onCheckedChange: (v: boolean) => void;
	disabled?: boolean;
	/** Its accessible name, when nothing else labels it. */
	label?: string;
	id?: string;
	size?: "sm" | "default";
	className?: string;
}) {
	return (
		<SwitchPrimitive
			id={id}
			size={size}
			checked={checked}
			onCheckedChange={onCheckedChange}
			disabled={disabled}
			aria-label={label}
			className={className}
		/>
	);
}

export function Checkbox({
	checked,
	onCheckedChange,
	disabled,
	label,
	description,
	className,
}: {
	checked: boolean;
	onCheckedChange: (v: boolean) => void;
	disabled?: boolean;
	label?: ReactNode;
	description?: ReactNode;
	className?: string;
}) {
	const id = useId();
	if (!label) {
		return (
			<CheckboxPrimitive
				checked={checked}
				onCheckedChange={(v) => onCheckedChange(v === true)}
				disabled={disabled}
				className={className}
			/>
		);
	}
	return (
		<label htmlFor={id} className={cn("flex cursor-pointer items-start gap-3 py-1", className)}>
			<CheckboxPrimitive
				id={id}
				checked={checked}
				onCheckedChange={(v) => onCheckedChange(v === true)}
				disabled={disabled}
				className="mt-px"
			/>
			<div className="min-w-0">
				<div className="text-body font-medium">{label}</div>
				{description && <div className="mt-0.5 text-small text-fg-subtle">{description}</div>}
			</div>
		</label>
	);
}

export interface SelectOption {
	value: string;
	label: ReactNode;
	description?: ReactNode;
	disabled?: boolean;
}

export function Select({
	value,
	onValueChange,
	options,
	placeholder,
	className,
	disabled,
	size = "md",
	variant = "filled",
	label,
	align,
}: {
	value: string;
	onValueChange: (v: string) => void;
	options: SelectOption[];
	placeholder?: string;
	className?: string;
	disabled?: boolean;
	size?: "sm" | "md";
	/** "plain": just the value and a chevron, for the end of a row (SelectRow). */
	variant?: "filled" | "plain";
	/** Its accessible name, when no Field labels it. */
	label?: string;
	align?: "start" | "end";
}) {
	const field = useField();
	return (
		<SelectRoot value={value} onValueChange={onValueChange} disabled={disabled}>
			<SelectTrigger
				id={field.id}
				aria-describedby={field["aria-describedby"]}
				aria-invalid={field["aria-invalid"]}
				aria-label={label}
				size={size === "sm" ? "sm" : "default"}
				className={cn(
					variant === "plain" &&
						"w-auto max-w-56 gap-1 border-b-transparent bg-transparent px-2 text-fg-muted hover:bg-surface-2 hover:text-fg focus-visible:bg-surface-2 data-open:bg-surface-2 data-open:ring-0",
					className,
				)}
			>
				<SelectValue placeholder={placeholder} />
			</SelectTrigger>
			<SelectContent align={align ?? (variant === "plain" ? "end" : "start")}>
				{options.map((o) => (
					<SelectItem key={o.value} value={o.value} disabled={o.disabled} description={o.description}>
						{o.label}
					</SelectItem>
				))}
			</SelectContent>
		</SelectRoot>
	);
}

/**
 * A choice of a value (Light / Dark / System): iOS's segmented control, Material 3's segmented buttons on Android.
 * Not for switching views (that's Tabs). Wraps on narrow screens.
 */
export function Segmented<T extends string>({
	value,
	onValueChange,
	options,
	className,
	size,
	label,
}: {
	value: T;
	onValueChange: (v: T) => void;
	options: { value: T; label: ReactNode; icon?: ReactNode; disabled?: boolean }[];
	className?: string;
	size?: "sm" | "default";
	/** Its accessible name, when nothing else labels it. */
	label?: string;
}) {
	return (
		<ToggleGroup
			type="single"
			variant="segmented"
			size={size}
			value={value}
			aria-label={label}
			onValueChange={(v) => {
				if (v) onValueChange(v as T);
			}}
			className={className}
		>
			{options.map((o) => (
				<ToggleGroupItem key={o.value} value={o.value} disabled={o.disabled}>
					{o.icon}
					{o.label}
				</ToggleGroupItem>
			))}
		</ToggleGroup>
	);
}
