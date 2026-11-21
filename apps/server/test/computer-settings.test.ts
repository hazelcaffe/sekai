import { expect, test } from "bun:test";
import { SettingsUpdate } from "@sekai/shared";
import { defaultSettings, publicSettings } from "../src/services/settings.ts";

test("computer setup is discoverable to a member without disclosing the server or its credentials", () => {
	const settings = defaultSettings();
	settings.machines.proxmox = {
		...settings.machines.proxmox,
		url: "https://example.invalid",
		node: "example",
		tokenId: "test-id",
		tokenSecret: "example-only",
	};
	settings.machines.tailscaleAuthKey = "example-only";
	const member = publicSettings(settings, false).machines;
	expect(member.configured).toBe(true);
	expect(member.proxmox).toMatchObject({ url: "", node: "", tokenId: "", tokenSecret: "" });
	expect(member.tailscaleAuthKey).toBe("");
	expect(publicSettings(settings, true).machines.proxmox.tokenSecret).not.toBe(settings.machines.proxmox.tokenSecret);
	expect(SettingsUpdate.parse({ machines: member }).machines).not.toHaveProperty("configured");
	settings.machines.proxmox.tokenId = "";
	expect(publicSettings(settings, false).machines.configured).toBe(false);
});
