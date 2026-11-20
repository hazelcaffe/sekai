import { describe, expect, test } from "bun:test";
import { describePorts } from "../src/agent/tools/machines.ts";
import { parseListening, parseServe, parseTailscaleSelf, pickHttpsPort, portsView } from "../src/machines/ports.ts";

const SS = `LISTEN 0      4096         0.0.0.0:22         0.0.0.0:*    users:(("sshd",pid=301,fd=3))
LISTEN 0      511          0.0.0.0:5173       0.0.0.0:*    users:(("node",pid=900,fd=21))
LISTEN 0      511        127.0.0.1:3000       0.0.0.0:*    users:(("python3",pid=950,fd=3))
LISTEN 0      10         127.0.0.1:9222       0.0.0.0:*    users:(("chrome",pid=1000,fd=40))
LISTEN 0      4096   127.0.0.53%lo:53         0.0.0.0:*    users:(("systemd-resolve",pid=200,fd=15))
LISTEN 0      511             [::]:5173          [::]:*    users:(("node",pid=900,fd=22))
LISTEN 0      4096           [::1]:3000          [::]:*    users:(("python3",pid=950,fd=4))
LISTEN 0      128                *:8080             *:*    users:(("docker-proxy",pid=1200,fd=4))
LISTEN 0      4096     100.70.1.20:443        0.0.0.0:*    users:(("tailscaled",pid=150,fd=20))
LISTEN 0      5          127.0.0.1:5901       0.0.0.0:*    users:(("x11vnc",pid=400,fd=7))`;

const STATUS = JSON.stringify({
	BackendState: "Running",
	Self: { DNSName: "api-test.tail0a1b2c.ts.net.", TailscaleIPs: ["100.70.1.20", "fd7a:115c:a1e0::1"] },
});
const SERVE = JSON.stringify({
	TCP: { "443": { HTTPS: true } },
	Web: { "api-test.tail0a1b2c.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:3000" } } } },
});

describe("Web apps on a machine", () => {
	test("reads ss with and without the programs, IPv6 and interface-scoped addresses", () => {
		const rows = parseListening(SS);
		expect(rows).toContainEqual({ port: 5173, host: "0.0.0.0", process: "node" });
		expect(rows).toContainEqual({ port: 3000, host: "::1", process: "python3" });
		expect(rows).toContainEqual({ port: 53, host: "127.0.0.53", process: "systemd-resolve" });
		expect(rows).toContainEqual({ port: 8080, host: "*", process: "docker-proxy" });
		// Without sudo, ss can't say which program: still listed.
		expect(parseListening("LISTEN 0 511 0.0.0.0:4000 0.0.0.0:*")).toEqual([
			{ port: 4000, host: "0.0.0.0", process: null },
		]);
		expect(parseListening("State Recv-Q\nnot a line\n")).toEqual([]);
	});

	test("the tailnet, and what tailscale serve shares over HTTPS", () => {
		expect(parseTailscaleSelf(STATUS)).toEqual({ ip: "100.70.1.20", dnsName: "api-test.tail0a1b2c.ts.net" });
		expect(parseTailscaleSelf(JSON.stringify({ BackendState: "NeedsLogin" }))).toBeNull();
		expect(parseTailscaleSelf("")).toBeNull();
		const serve = parseServe(SERVE);
		expect(serve.byApp.get(3000)).toEqual({ url: "https://api-test.tail0a1b2c.ts.net", httpsPort: 443 });
		expect([...serve.taken]).toEqual([443]);
		const other = parseServe(
			JSON.stringify({ Web: { "x.ts.net:8443": { Handlers: { "/": { Proxy: "http://127.0.0.1:5173" } } } } }),
		);
		expect(other.byApp.get(5173)?.url).toBe("https://x.ts.net:8443");
		expect(parseServe("").byApp.size).toBe(0);
		expect(parseServe("not json").byApp.size).toBe(0);
	});

	test("HTTPS links take 443 first, then 8443 and up, never a port an app uses", () => {
		expect(pickHttpsPort(new Set())).toBe(443);
		expect(pickHttpsPort(new Set([443]))).toBe(8443);
		expect(pickHttpsPort(new Set([443, 8443, 8444]))).toBe(8445);
	});

	test("links on a VM: apps on 127.0.0.1 need an HTTPS link; system ports are left out", () => {
		const view = portsView(parseListening(SS), parseTailscaleSelf(STATUS), parseServe(SERVE), {
			container: false,
			lan: "192.168.0.50",
		});
		expect(view.ports.map((p) => p.port)).toEqual([3000, 5173, 8080]);
		expect(view.ports[0]).toEqual({
			port: 3000,
			process: "python3",
			running: true,
			localOnly: true,
			ipUrl: null,
			httpsUrl: "https://api-test.tail0a1b2c.ts.net",
		});
		expect(view.ports[1]?.ipUrl).toBe("http://100.70.1.20:5173");
		expect(view.ports[2]?.ipUrl).toBe("http://100.70.1.20:8080");
	});

	test("on a container, Tailscale reaches apps on 127.0.0.1 too; a stopped shared app is still listed", () => {
		const view = portsView(parseListening(SS), parseTailscaleSelf(STATUS), parseServe(SERVE), {
			container: true,
			lan: null,
		});
		expect(view.ports.find((p) => p.port === 3000)?.ipUrl).toBe("http://100.70.1.20:3000");
		const stopped = portsView([], parseTailscaleSelf(STATUS), parseServe(SERVE), { container: true, lan: null });
		expect(stopped.ports).toEqual([
			{
				port: 3000,
				process: null,
				running: false,
				localOnly: false,
				ipUrl: null,
				httpsUrl: "https://api-test.tail0a1b2c.ts.net",
			},
		]);
	});

	test("an HTTPS link on an app's own port hides its plain link; off the tailnet, the LAN address", () => {
		const serve = parseServe(
			JSON.stringify({
				TCP: { "5173": { HTTPS: true } },
				Web: { "x.ts.net:5173": { Handlers: { "/": { Proxy: "http://127.0.0.1:5173" } } } },
			}),
		);
		const view = portsView(parseListening(SS), parseTailscaleSelf(STATUS), serve, { container: false, lan: null });
		expect(view.ports.find((p) => p.port === 5173)).toMatchObject({
			ipUrl: null,
			httpsUrl: "https://x.ts.net:5173",
		});
		const lan = portsView(parseListening(SS), null, parseServe(""), { container: false, lan: "192.168.0.50" });
		expect(lan.tailscale).toBeNull();
		expect(lan.ports.find((p) => p.port === 5173)?.ipUrl).toBe("http://192.168.0.50:5173");
		expect(lan.ports.find((p) => p.port === 3000)?.ipUrl).toBeNull();
	});

	test("the bot gets every link, and what to do about apps it can't reach", () => {
		const view = portsView(parseListening(SS), parseTailscaleSelf(STATUS), parseServe(SERVE), {
			container: false,
			lan: null,
		});
		const text = describePorts("api-test", view);
		expect(text).toContain("tailnet only");
		expect(text).toContain("- 3000 (python3): HTTPS https://api-test.tail0a1b2c.ts.net");
		expect(text).toContain("- 5173 (node): http://100.70.1.20:5173");
		const local = portsView(parseListening(SS), parseTailscaleSelf(STATUS), parseServe(""), {
			container: false,
			lan: null,
		});
		expect(describePorts("api-test", local)).toContain("share: 3000");
		expect(describePorts("api-test", { tailscale: { ip: "100.70.1.20", dnsName: null }, ports: [] })).toContain(
			"Nothing is listening yet",
		);
	});
});
