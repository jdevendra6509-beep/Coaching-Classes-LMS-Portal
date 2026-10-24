import { parseCsv } from "../src/common/csv.js";
import { decrypt, encrypt } from "../src/common/crypto.js";
import { totpCode, verifyTotp } from "../src/auth/totp.js";
import { chargeAmountPaise, splitGst } from "../src/platform/money.js";
import { resolveSlug } from "../src/tenancy/tenant.middleware.js";
import type { AppRequest } from "../src/common/request.js";

describe("TOTP", () => {
  // RFC 6238 appendix B: ASCII secret "12345678901234567890", SHA-1, T=59s → 94287082 (last 6 digits).
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

  it("matches the RFC 6238 test vectors", () => {
    expect(totpCode(secret, 59_000)).toBe("287082");
    expect(totpCode(secret, 1_111_111_109_000)).toBe("081804");
  });

  it("accepts one step of clock drift and nothing more", () => {
    const now = 1_700_000_000_000;
    expect(verifyTotp(secret, totpCode(secret, now - 30_000), now)).toBe(true);
    expect(verifyTotp(secret, totpCode(secret, now - 90_000), now)).toBe(false);
    expect(verifyTotp(secret, "12345", now)).toBe(false);
  });
});

describe("encryption at rest", () => {
  it("round-trips and uses a fresh IV each time", () => {
    const a = encrypt("secret");
    expect(a).not.toBe(encrypt("secret"));
    expect(decrypt(a)).toBe("secret");
  });

  it("rejects tampered ciphertext", () => {
    const [iv, tag, data] = encrypt("secret").split(".");
    const flipped = Buffer.from(data, "base64url");
    flipped[0] ^= 1;
    expect(() => decrypt([iv, tag, flipped.toString("base64url")].join("."))).toThrow();
  });
});

describe("subscription money", () => {
  it("adds GST and converts to paise", () => {
    expect(chargeAmountPaise(999, 18)).toBe(117882);
    expect(chargeAmountPaise("1499.50", 18)).toBe(176941);
  });

  it("splits a GST-inclusive charge back into taxable value and GST", () => {
    const { amount, gst } = splitGst(117882, 18);
    expect(amount.toFixed(2)).toBe("999.00");
    expect(gst.toFixed(2)).toBe("179.82");
  });
});

describe("tenant slug resolution", () => {
  const req = (hostname: string, slug?: string) =>
    ({ hostname, header: (n: string) => (n === "x-institute-slug" ? slug : undefined) }) as unknown as AppRequest;

  it("reads the subdomain of the platform host", () => {
    expect(resolveSlug(req("alpha.lvh.me"))).toBe("alpha");
  });

  it("ignores the bare platform host, reserved and nested subdomains, and foreign hosts", () => {
    expect(resolveSlug(req("lvh.me"))).toBeUndefined();
    expect(resolveSlug(req("api.lvh.me"))).toBeUndefined();
    expect(resolveSlug(req("a.b.lvh.me"))).toBeUndefined();
    expect(resolveSlug(req("alpha.evil.com"))).toBeUndefined();
  });

  it("prefers the header the web app forwards", () => {
    expect(resolveSlug(req("api.lvh.me", "Beta"))).toBe("beta");
  });
});

describe("CSV parsing", () => {
  it("handles quotes, embedded commas/newlines, CRLF, a BOM and blank lines", () => {
    const csv = '﻿Name,Email,Address\r\n"Rao, Asha",asha@x.in,"Flat 2\nPune"\r\n\r\nRavi,"ravi@x.in",""" quoted """\r\n';
    const { headers, rows } = parseCsv(csv);
    expect(headers).toEqual(["name", "email", "address"]);
    expect(rows).toEqual([
      { name: "Rao, Asha", email: "asha@x.in", address: "Flat 2\nPune" },
      { name: "Ravi", email: "ravi@x.in", address: '" quoted "' },
    ]);
  });

  it("rejects an unterminated quote", () => {
    expect(() => parseCsv('name\n"oops')).toThrow(/Unterminated/);
  });
});
