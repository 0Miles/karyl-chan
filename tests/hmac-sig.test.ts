import { describe, expect, it } from "vitest";
import { createHmac } from "crypto";
import {
  signBodyV0,
  signBodyV1,
  buildOutboundSignatureHeaders,
  verifyInboundSignature,
  SIGNATURE_HEADER,
  SIGNATURE_HEADER_V1,
  TIMESTAMP_HEADER,
  SIGNATURE_VERSION_V0,
  SIGNATURE_VERSION_V1,
  REPLAY_WINDOW_SECONDS,
} from "../src/utils/hmac.js";

const SECRET = "test-secret-for-hmac";
const TS = "1700000000";
const BODY = JSON.stringify({ hello: "world" });
const METHOD = "POST";
const PATH = "/dm/greet/dispatch";

// ─── Helper to build a response Headers object ─────────────────────────────

function makeHeaders(entries: Record<string, string>): Headers {
  return new Headers(entries);
}

function makeSigHeaders(
  secret: string,
  method: string,
  path: string,
  ts: string,
  body: string,
  scheme: "v0" | "v1" | "both",
): Headers {
  const v0sig = signBodyV0(secret, ts, body);
  const v1sig = signBodyV1(secret, method, path, ts, body);
  const entries: Record<string, string> = { [TIMESTAMP_HEADER]: ts };
  if (scheme === "v0" || scheme === "both") {
    entries[SIGNATURE_HEADER] = `${SIGNATURE_VERSION_V0}=${v0sig}`;
  }
  if (scheme === "v1" || scheme === "both") {
    entries[SIGNATURE_HEADER_V1] = `${SIGNATURE_VERSION_V1}=${v1sig}`;
  }
  return makeHeaders(entries);
}

// ─── signBodyV0 ────────────────────────────────────────────────────────────

describe("signBodyV0", () => {
  it("produces the correct HMAC-SHA256 hex digest", () => {
    const expected = createHmac("sha256", SECRET)
      .update(`v0:${TS}:${BODY}`)
      .digest("hex");
    expect(signBodyV0(SECRET, TS, BODY)).toBe(expected);
  });

  it("different body → different sig", () => {
    expect(signBodyV0(SECRET, TS, BODY)).not.toBe(
      signBodyV0(SECRET, TS, "{}"),
    );
  });

  it("different timestamp → different sig", () => {
    expect(signBodyV0(SECRET, TS, BODY)).not.toBe(
      signBodyV0(SECRET, "9999999999", BODY),
    );
  });
});

// ─── signBodyV1 ────────────────────────────────────────────────────────────

describe("signBodyV1", () => {
  it("produces the correct HMAC-SHA256 hex digest", () => {
    const expected = createHmac("sha256", SECRET)
      .update(`v1:${METHOD}:${PATH}:${TS}:${BODY}`)
      .digest("hex");
    expect(signBodyV1(SECRET, METHOD, PATH, TS, BODY)).toBe(expected);
  });

  it("same body + different method (POST vs PUT) → different sig", () => {
    const a = signBodyV1(SECRET, "POST", PATH, TS, BODY);
    const b = signBodyV1(SECRET, "PUT", PATH, TS, BODY);
    expect(a).not.toBe(b);
  });

  it("same body + different path (/foo vs /bar) → different sig", () => {
    const a = signBodyV1(SECRET, METHOD, "/foo", TS, BODY);
    const b = signBodyV1(SECRET, METHOD, "/bar", TS, BODY);
    expect(a).not.toBe(b);
  });

  it("same body + same method + same path + different ts → different sig", () => {
    const a = signBodyV1(SECRET, METHOD, PATH, TS, BODY);
    const b = signBodyV1(SECRET, METHOD, PATH, "9999999999", BODY);
    expect(a).not.toBe(b);
  });

  it("different body → different sig", () => {
    const a = signBodyV1(SECRET, METHOD, PATH, TS, BODY);
    const b = signBodyV1(SECRET, METHOD, PATH, TS, "{}");
    expect(a).not.toBe(b);
  });

  it("method is normalised to uppercase", () => {
    expect(signBodyV1(SECRET, "post", PATH, TS, BODY)).toBe(
      signBodyV1(SECRET, "POST", PATH, TS, BODY),
    );
  });

  it("v0 and v1 sigs differ for same inputs", () => {
    expect(signBodyV0(SECRET, TS, BODY)).not.toBe(
      signBodyV1(SECRET, METHOD, PATH, TS, BODY),
    );
  });
});

// ─── buildOutboundSignatureHeaders ────────────────────────────────────────

describe("buildOutboundSignatureHeaders", () => {
  it("includes all three headers", () => {
    const h = buildOutboundSignatureHeaders(SECRET, METHOD, PATH, BODY, TS);
    expect(h[TIMESTAMP_HEADER]).toBe(TS);
    expect(h[SIGNATURE_HEADER]).toBeDefined();
    expect(h[SIGNATURE_HEADER_V1]).toBeDefined();
  });

  it("X-Karyl-Signature is v0=<correct hex>", () => {
    const h = buildOutboundSignatureHeaders(SECRET, METHOD, PATH, BODY, TS);
    const expected = `${SIGNATURE_VERSION_V0}=${signBodyV0(SECRET, TS, BODY)}`;
    expect(h[SIGNATURE_HEADER]).toBe(expected);
  });

  it("X-Karyl-Signature-V1 is v1=<correct hex>", () => {
    const h = buildOutboundSignatureHeaders(SECRET, METHOD, PATH, BODY, TS);
    const expected = `${SIGNATURE_VERSION_V1}=${signBodyV1(SECRET, METHOD, PATH, TS, BODY)}`;
    expect(h[SIGNATURE_HEADER_V1]).toBe(expected);
  });

  it("defaults timestamp to roughly now when not supplied", () => {
    const before = Math.floor(Date.now() / 1000);
    const h = buildOutboundSignatureHeaders(SECRET, METHOD, PATH, BODY);
    const after = Math.floor(Date.now() / 1000);
    const ts = Number(h[TIMESTAMP_HEADER]);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after + 1);
  });
});

// ─── verifyInboundSignature ────────────────────────────────────────────────

const NOW = Number(TS);

describe("verifyInboundSignature", () => {
  it("accepts a valid v0-only response", () => {
    const headers = makeSigHeaders(SECRET, METHOD, PATH, TS, BODY, "v0");
    const result = verifyInboundSignature(
      SECRET, headers, BODY, NOW, METHOD, PATH,
    );
    expect(result.ok).toBe(true);
  });

  it("accepts a valid v1-only response", () => {
    const headers = makeSigHeaders(SECRET, METHOD, PATH, TS, BODY, "v1");
    const result = verifyInboundSignature(
      SECRET, headers, BODY, NOW, METHOD, PATH,
    );
    expect(result.ok).toBe(true);
  });

  it("when both headers present and v1 is correct, accepts", () => {
    const headers = makeSigHeaders(SECRET, METHOD, PATH, TS, BODY, "both");
    const result = verifyInboundSignature(
      SECRET, headers, BODY, NOW, METHOD, PATH,
    );
    expect(result.ok).toBe(true);
  });

  it("when both headers present but v1 is wrong, rejects (does not fall back to v0)", () => {
    const v0sig = signBodyV0(SECRET, TS, BODY);
    const headers = makeHeaders({
      [TIMESTAMP_HEADER]: TS,
      [SIGNATURE_HEADER]: `${SIGNATURE_VERSION_V0}=${v0sig}`,
      [SIGNATURE_HEADER_V1]: `${SIGNATURE_VERSION_V1}=badhex`,
    });
    const result = verifyInboundSignature(
      SECRET, headers, BODY, NOW, METHOD, PATH,
    );
    expect(result.ok).toBe(false);
    expect(result).toHaveProperty("reason");
    if (!result.ok) expect(result.reason).toMatch(/v1 signature mismatch/);
  });

  it("rejects when both headers are missing", () => {
    const headers = makeHeaders({ [TIMESTAMP_HEADER]: TS });
    const result = verifyInboundSignature(
      SECRET, headers, BODY, NOW, METHOD, PATH,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects when timestamp is missing", () => {
    const headers = makeSigHeaders(SECRET, METHOD, PATH, TS, BODY, "both");
    // Rebuild without the timestamp header
    const v0sig = signBodyV0(SECRET, TS, BODY);
    const v1sig = signBodyV1(SECRET, METHOD, PATH, TS, BODY);
    const noTs = makeHeaders({
      [SIGNATURE_HEADER]: `${SIGNATURE_VERSION_V0}=${v0sig}`,
      [SIGNATURE_HEADER_V1]: `${SIGNATURE_VERSION_V1}=${v1sig}`,
    });
    // Not using `headers` above, silence the unused variable.
    void headers;
    const result = verifyInboundSignature(
      SECRET, noTs, BODY, NOW, METHOD, PATH,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/Timestamp/);
  });

  it("rejects when timestamp is outside replay window", () => {
    const staleTs = (NOW - REPLAY_WINDOW_SECONDS - 1).toString();
    const headers = makeSigHeaders(SECRET, METHOD, PATH, staleTs, BODY, "v1");
    const result = verifyInboundSignature(
      SECRET, headers, BODY, NOW, METHOD, PATH,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/replay window/);
  });

  it("v0 fallback is checked with correct v0 payload (not v1)", () => {
    // Construct headers where only v0 is present but v0 sig was computed
    // against a DIFFERENT path — should fail because the sig doesn't match.
    const wrongPathSig = signBodyV0(SECRET, TS, BODY);
    // Same body, same ts, but verify with a different path key does nothing
    // for v0 (path is not in v0 payload). So v0 should still pass.
    const headers = makeHeaders({
      [TIMESTAMP_HEADER]: TS,
      [SIGNATURE_HEADER]: `${SIGNATURE_VERSION_V0}=${wrongPathSig}`,
    });
    // v0 doesn't bind the path, so it should still verify OK.
    const result = verifyInboundSignature(
      SECRET, headers, BODY, NOW, "PUT", "/other-path",
    );
    expect(result.ok).toBe(true);
  });

  it("v1 includes method + path (cross-endpoint replay rejected)", () => {
    // A v1 sig made for POST /original-path should fail if we try to
    // verify it as POST /other-path.
    const originalPath = "/original-path";
    const v1sig = signBodyV1(SECRET, "POST", originalPath, TS, BODY);
    const headers = makeHeaders({
      [TIMESTAMP_HEADER]: TS,
      [SIGNATURE_HEADER_V1]: `${SIGNATURE_VERSION_V1}=${v1sig}`,
    });
    const result = verifyInboundSignature(
      SECRET, headers, BODY, NOW, "POST", "/other-path",
    );
    expect(result.ok).toBe(false);
  });
});
