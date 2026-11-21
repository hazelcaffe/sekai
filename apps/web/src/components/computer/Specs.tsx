import { MachineSpecs } from "@sekai/shared";
import { Field, Input } from "@sekai/ui";

export const specsLine = (s: MachineSpecs) =>
	`${s.cores} ${s.cores === 1 ? "core" : "cores"} · ${s.minMemoryMb > 0 && s.minMemoryMb < s.memoryMb ? `${s.minMemoryMb / 1024}–` : ""}${s.memoryMb / 1024} GB memory · ${s.diskGb} GB disk`;

/** FormGroup doesn't run native form validation. Check disk growth and the memory floor before saving. */
export function validSpecs(s: MachineSpecs, minDisk = 4) {
	return MachineSpecs.safeParse(s).success && s.minMemoryMb <= s.memoryMb && s.diskGb >= minDisk;
}

export function SpecsFields({
	value,
	change,
	variableMemory = false,
	minDisk = 4,
}: {
	value: MachineSpecs;
	change: (s: MachineSpecs) => void;
	variableMemory?: boolean;
	minDisk?: number;
}) {
	return (
		<div className="grid grid-cols-2 gap-3">
			{(
				[
					["Processor cores", "cores", 1, 64, 1],
					["Memory (GB)", "memoryMb", 0.5, 256, 1024],
					["Disk (GB)", "diskGb", minDisk, 4096, 1],
					...(variableMemory
						? [["Minimum memory (GB)", "minMemoryMb", 0, value.memoryMb / 1024, 1024] as const]
						: []),
				] as const
			).map(([label, k, min, max, scale]) => (
				<Field key={k} label={label} hint={k === "minMemoryMb" ? "Use 0 for a fixed amount." : undefined}>
					<Input
						type="number"
						min={min}
						max={max}
						step={scale === 1024 ? 0.5 : 1}
						value={value[k] / scale}
						onChange={(e) => change({ ...value, [k]: Number(e.target.value) * scale })}
					/>
				</Field>
			))}
		</div>
	);
}
