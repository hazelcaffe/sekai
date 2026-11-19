import type { MachineBackend, MachineSpecs } from "@sekai/shared";
import { errorMessage } from "../lib/errors.ts";
import type { ProxmoxClient } from "./proxmox.ts";

/**
 * A machine on Proxmox, whatever it runs as: the calls that differ between a VM (qemu) and a container (lxc).
 * Deletes pass the machine's hostname, so a guest that took over the id is never touched.
 */
export class Guest {
	constructor(
		private readonly px: ProxmoxClient,
		readonly vmid: number,
		readonly backend: MachineBackend,
		private readonly hostname: string,
		private readonly imageStorage: string,
	) {}

	get kind(): "qemu" | "lxc" {
		return this.backend === "vm" ? "qemu" : "lxc";
	}

	/** A VM's cloud-init seed (it holds passwords; deleted once setup is done). */
	get seedVolume(): string {
		return `${this.imageStorage}:iso/sekai-seed-${this.vmid}.iso`;
	}

	async power(action: "start" | "stop" | "shutdown" | "reboot"): Promise<void> {
		if (this.backend === "lxc") return this.px.lxcPower(this.vmid, action);
		if (action === "start") await this.ejectSeed();
		try {
			await this.px.vmPower(this.vmid, action);
		} catch (err) {
			// A VM shuts down through its guest agent, which isn't up yet while it's still starting: stop it instead.
			if ((action !== "shutdown" && action !== "reboot") || !/guest agent|qga/i.test(errorMessage(err)))
				throw err;
			await this.px.vmPower(this.vmid, "stop");
			if (action === "reboot") await this.px.vmPower(this.vmid, "start");
		}
	}

	async running(): Promise<boolean> {
		const s = this.backend === "vm" ? await this.px.vmStatus(this.vmid) : await this.px.lxcStatus(this.vmid);
		return s.status === "running";
	}

	/** Deletes it from Proxmox (a VM's seed too, if it's still there). */
	async remove(): Promise<void> {
		if (this.backend === "lxc") return this.px.deleteLxc(this.vmid, this.hostname);
		await this.px.deleteVm(this.vmid, this.hostname);
		await this.px.deleteVolume(this.imageStorage, this.seedVolume).catch(() => {});
	}

	/**
	 * Applies a new size. Containers take cores and memory while running (and never balloon); a VM needs a restart
	 * for them, which is left to the caller: returns whether one is needed.
	 */
	async resize(from: MachineSpecs, to: MachineSpecs): Promise<boolean> {
		const grow = to.diskGb > from.diskGb ? `${to.diskGb}G` : null;
		if (this.backend === "lxc") {
			await this.px.setLxcConfig(this.vmid, { cores: to.cores, memory: to.memoryMb });
			if (grow) await this.px.resizeLxcDisk(this.vmid, grow);
			return false;
		}
		await this.px.setVmConfig(this.vmid, { cores: to.cores, memory: to.memoryMb, balloon: to.minMemoryMb });
		if (grow) await this.px.resizeVmDisk(this.vmid, "scsi0", grow);
		return to.cores !== from.cores || to.memoryMb !== from.memoryMb;
	}

	/**
	 * A stopped VM that still points at its setup seed (deleted once setup finished) can't start: Proxmox refuses a
	 * missing volume. That happens after going back to a checkpoint taken before the seed was ejected.
	 */
	async ejectSeed(): Promise<void> {
		if (this.backend !== "vm") return;
		const cfg = await this.px.vmConfig(this.vmid).catch(() => ({}) as Record<string, string | number>);
		const stale = Object.entries(cfg).filter(
			([k, v]) => /^(ide|sata|scsi)\d+$/.test(k) && /iso\/(sekai|feesh)-seed-/.test(String(v)),
		);
		for (const [k] of stale) await this.px.setVmConfig(this.vmid, { [k]: "none,media=cdrom" });
	}
}
