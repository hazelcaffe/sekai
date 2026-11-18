import { expect, test } from "bun:test";
import { reachOf } from "../src/lib/net.ts";

test("reach", async () => {
	expect(await reachOf(new URL("http://127.0.0.1:7420/api"))).toBe("local");
	expect(await reachOf(new URL("http://169.254.169.254/latest"))).toBe("local");
	expect(await reachOf(new URL("http://localhost/"))).toBe("local");
	expect(await reachOf(new URL("http://[::1]/"))).toBe("local");
	expect(await reachOf(new URL("http://192.168.0.5:8788/v1"))).toBe("private");
	expect(await reachOf(new URL("http://100.73.180.74:7420"))).toBe("private");
	expect(await reachOf(new URL("http://10.1.2.3"))).toBe("private");
	expect(await reachOf(new URL("https://8.8.8.8"))).toBe("public");
	expect(await reachOf(new URL("https://example.com"))).toBe("public");
});
