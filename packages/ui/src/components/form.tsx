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
				className="absolute inset-y-0 right-1 my-auto flex size-8 items-center justify-center rounded-lg text-fg-subtle transition-colors hover:bg-muted hover:text-foreground coarse:size-10 [&_svg]:size-4"
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

export function Field({
	label,
	hint,
	error,
	children,
	className,
	action,
}: {
	label: ReactNode;
	hint?: ReactNode;
	error?: string | null;
	children: ReactNode;
	className?: string;
	action?: ReactNode;
}) {
	const id = useId();
	const hintId = error || hint ? `${id}-hint` : undefined;
	return (
		<FieldContext.Provider value={{ id, hintId, invalid: Boolean(error) }}>
			<div data-slot="field" className={cn("flex flex-col gap-1.5", className)}>
				<div className="flex items-center justify-between gap-2">
					<Label htmlFor={id}>{label}</Label>
					{action}
				</div>
				{children}
				{error ? (
					<p id={hintId} className="text-xs text-destructive">
						{error}
					</p>
				) : hint ? (
					<p id={hintId} className="text-xs leading-5 text-fg-subtle">
						{hint}
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
}: {
	checked: boolean;
	onCheckedChange: (v: boolean) => void;
	disabled?: boolean;
	label?: string;
	id?: string;
	size?: "sm" | "default";
}) {
	return (
		<SwitchPrimitive
			id={id}
			size={size}
			checked={checked}
			onCheckedChange={onCheckedChange}
			disabled={disabled}
			aria-label={label}
		/>
	);
}

/** A labelled row with a switch, used throughout settings. An optional icon sits in a small tile on the left. */
export function ToggleRow({
	title,
	description,
	checked,
	onCheckedChange,
	disabled,
	icon,
	className,
}: {
	title: ReactNode;
	description?: ReactNode;
	checked: boolean;
	onCheckedChange: (v: boolean) => void;
	disabled?: boolean;
	icon?: ReactNode;
	className?: string;
}) {
	const id = useId();
	return (
		<label
			htmlFor={id}
			className={cn(
				"flex cursor-pointer items-start justify-between gap-4 py-1",
				disabled && "cursor-default",
				className,
			)}
		>
			<div className="flex min-w-0 items-start gap-3">
				{icon && (
					<span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-muted text-muted-foreground [&_svg]:size-4">
						{icon}
					</span>
				)}
				<div className="min-w-0">
					<div className="text-sm font-medium">{title}</div>
					{description && <div className="mt-0.5 text-xs leading-5 text-fg-subtle">{description}</div>}
				</div>
			</div>
			<SwitchPrimitive
				id={id}
				checked={checked}
				onCheckedChange={onCheckedChange}
				disabled={disabled}
				className="mt-0.5"
			/>
		</label>
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
				<div className="text-sm leading-5 font-medium">{label}</div>
				{description && <div className="mt-0.5 text-xs leading-5 text-fg-subtle">{description}</div>}
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
}: {
	value: string;
	onValueChange: (v: string) => void;
	options: SelectOption[];
	placeholder?: string;
	className?: string;
	disabled?: boolean;
	size?: "sm" | "md";
}) {
	const field = useField();
	return (
		<SelectRoot value={value} onValueChange={onValueChange} disabled={disabled}>
			<SelectTrigger
				id={field.id}
				aria-describedby={field["aria-describedby"]}
				aria-invalid={field["aria-invalid"]}
				size={size === "sm" ? "sm" : "default"}
				className={className}
			>
				<SelectValue placeholder={placeholder} />
			</SelectTrigger>
			<SelectContent>
				{options.map((o) => (
					<SelectItem key={o.value} value={o.value} disabled={o.disabled} description={o.description}>
						{o.label}
					</SelectItem>
				))}
			</SelectContent>
		</SelectRoot>
	);
}

/** iOS-style segmented control. Wraps on narrow screens. */
export function Segmented<T extends string>({
	value,
	onValueChange,
	options,
	className,
	size,
}: {
	value: T;
	onValueChange: (v: T) => void;
	options: { value: T; label: ReactNode; icon?: ReactNode; disabled?: boolean }[];
	className?: string;
	size?: "sm" | "default";
}) {
	return (
		<ToggleGroup
			type="single"
			variant="segmented"
			size={size}
			value={value}
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
