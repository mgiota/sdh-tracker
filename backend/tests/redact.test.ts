import { redact, redactDeep } from "../src/services/redact";

describe("redact()", () => {
  // --- Private keys ---
  test("redacts PEM private key block", () => {
    const input = "Use this key:\n-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----\nDone.";
    expect(redact(input)).toBe("Use this key:\n[PRIVATE_KEY]\nDone.");
  });

  // --- JWTs ---
  test("redacts JWT", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyMSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    expect(redact(`Token: ${jwt}`)).toBe("Token: [JWT]");
  });

  test("does not redact plain base64 that lacks 3 segments", () => {
    expect(redact("aGVsbG8=")).toBe("aGVsbG8=");
  });

  // --- GitHub tokens ---
  test("redacts ghp_ token", () => {
    expect(redact("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef12")).toBe("[GITHUB_TOKEN]");
  });

  test("redacts gho_ token", () => {
    expect(redact("gho_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef12")).toBe("[GITHUB_TOKEN]");
  });

  test("does not redact a normal github.com URL", () => {
    const url = "https://github.com/elastic/kibana/issues/123";
    expect(redact(url)).toBe(url);
  });

  // --- Slack tokens ---
  // Built at runtime so the literal doesn't trigger GitHub secret scanning
  test("redacts xoxb- token", () => {
    const token = ["xoxb", "12345678", "12345678", "abcdefghijklmn"].join("-");
    expect(redact(token)).toBe("[SLACK_TOKEN]");
  });

  test("redacts xoxp- token", () => {
    const token = ["xoxp", "12345678", "12345678901234", "abcdefghijklmnopqrstuvwx"].join("-");
    expect(redact(token)).toBe("[SLACK_TOKEN]");
  });

  // --- AWS ---
  test("redacts AWS access key", () => {
    expect(redact("AKIAIOSFODNN7EXAMPLE")).toBe("[AWS_KEY]");
  });

  // --- Stripe ---
  // Built at runtime so the literal doesn't trigger GitHub secret scanning
  test("redacts Stripe live key", () => {
    const key = "sk_" + "live_" + "4eC39HqLyjWDarjtT1zdp7dc";
    expect(redact(key)).toBe("[STRIPE_KEY]");
  });

  test("redacts Stripe test key", () => {
    const key = "sk_" + "test_" + "4eC39HqLyjWDarjtT1zdp7dc";
    expect(redact(key)).toBe("[STRIPE_KEY]");
  });

  // --- Bearer / Basic auth ---
  test("redacts Bearer token", () => {
    expect(redact("Authorization: Bearer eyABC123DEFghij")).toBe("Authorization: Bearer [TOKEN]");
  });

  test("redacts Basic auth", () => {
    expect(redact("Authorization: Basic dXNlcjpwYXNz")).toBe("Authorization: Basic [TOKEN]");
  });

  // --- Connection strings ---
  test("redacts postgres URL with credentials", () => {
    expect(redact("postgres://admin:s3cr3t@db.internal:5432/mydb")).toBe("[CONNECTION_STRING]");
  });

  test("redacts mongodb URL with credentials", () => {
    expect(redact("mongodb://user:pass@mongo.host:27017/mydb")).toBe("[CONNECTION_STRING]");
  });

  test("does not redact URL without credentials", () => {
    const url = "https://github.com/elastic/kibana";
    expect(redact(url)).toBe(url);
  });

  // --- Azure ---
  test("redacts Azure connection string", () => {
    const az = "DefaultEndpointsProtocol=https;AccountName=myaccount;AccountKey=abc123==;EndpointSuffix=core.windows.net";
    expect(redact(az)).toBe("[AZURE_CONN_STRING]");
  });

  // --- Elastic Cloud hosts ---
  test("redacts Elastic Cloud ES host", () => {
    expect(redact("my-cluster.es.us-east-1.cloud.es.io")).toBe("[ELASTIC_CLOUD_HOST]");
  });

  test("redacts found.io host", () => {
    expect(redact("abc123.found.io")).toBe("[ELASTIC_CLOUD_HOST]");
  });

  // --- Emails ---
  test("redacts email address", () => {
    expect(redact("Contact: john.doe@example.com for help")).toBe("Contact: [EMAIL] for help");
  });

  test("does not break text without emails", () => {
    expect(redact("No emails here")).toBe("No emails here");
  });

  // --- IPv4 ---
  test("redacts IPv4 address", () => {
    expect(redact("Server at 192.168.1.100 is down")).toBe("Server at [IP] is down");
  });

  test("does not redact version numbers that look like IPs but are invalid", () => {
    // 999.999.999.999 — each octet > 255 so it doesn't match the strict IP pattern
    expect(redact("version 999.999.999.999")).toBe("version 999.999.999.999");
  });

  // --- Null / undefined ---
  test("returns empty string for null", () => {
    expect(redact(null)).toBe("");
  });

  test("returns empty string for undefined", () => {
    expect(redact(undefined)).toBe("");
  });

  // --- Multiple matches in one string ---
  test("redacts multiple secrets in one string", () => {
    const input = "Email john@example.com, token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef12, ip 10.0.0.1";
    expect(redact(input)).toBe("Email [EMAIL], token [GITHUB_TOKEN], ip [IP]");
  });
});

describe("redactDeep()", () => {
  test("redacts strings in a plain object", () => {
    const input = { url: "https://user:pass@host.com/db", label: "safe" };
    expect(redactDeep(input)).toEqual({ url: "[CONNECTION_STRING]", label: "safe" });
  });

  test("redacts strings in a nested object", () => {
    const input = { meta: { token: "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef12" } };
    expect(redactDeep(input)).toEqual({ meta: { token: "[GITHUB_TOKEN]" } });
  });

  test("redacts strings inside an array", () => {
    const input = ["safe", "192.168.0.1", "also safe"];
    expect(redactDeep(input)).toEqual(["safe", "[IP]", "also safe"]);
  });

  test("passes through non-string primitives unchanged", () => {
    const input = { count: 42, active: true, nothing: null };
    expect(redactDeep(input)).toEqual({ count: 42, active: true, nothing: null });
  });
});
