import { describe, expect, it, vi } from "vitest";

// Firestore is mocked for every test in this file. The point is to exercise the
// routing and the identity handling without credentials, a network, or an
// emulator — `npm test` has to run on a laptop that has never seen this project.
vi.mock("../src/firestore.ts", () => ({
    checkFirestore: vi.fn(async () => ({ reachable: true, databaseId: "hector" })),
}));

const { app } = await import("../src/app.ts");

describe("healthz", () => {
    it("answers without touching Firestore", async () => {
        const response = await app.request("/healthz");
        expect(response.status).toBe(200);
        expect(await response.text()).toBe("ok\n");
    });
});

describe("readyz", () => {
    it("reports the database it reached", async () => {
        const response = await app.request("/readyz");
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ reachable: true, databaseId: "hector" });
    });
});

describe("the status page", () => {
    it("names the signed-in user, with IAP's provider prefix stripped", async () => {
        const response = await app.request("/", {
            headers: { "x-goog-authenticated-user-email": "accounts.google.com:someone@example.com" },
        });
        const body = await response.text();
        expect(response.status).toBe(200);
        expect(body).toContain("someone@example.com");
        expect(body).not.toContain("accounts.google.com:");
    });

    it("says so when there is no IAP header, rather than inventing a user", async () => {
        const body = await (await app.request("/")).text();
        expect(body).toContain("not signed in");
    });

    it("escapes the identity, which is a header and therefore input", async () => {
        const body = await (
            await app.request("/", {
                headers: { "x-goog-authenticated-user-email": "accounts.google.com:<script>x</script>@e.com" },
            })
        ).text();
        expect(body).not.toContain("<script>x</script>");
        expect(body).toContain("&lt;script&gt;");
    });
});

describe("unknown routes", () => {
    it("404s", async () => {
        expect((await app.request("/nope")).status).toBe(404);
    });
});
