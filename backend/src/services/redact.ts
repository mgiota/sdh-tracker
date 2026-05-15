// Patterns run in order — most specific first so structured tokens beat generic ones.
const RULES: Array<{ pattern: RegExp; placeholder: string }> = [
  // Private keys / certificates
  {
    pattern: /-----BEGIN [A-Z ]+-----[\s\S]+?-----END [A-Z ]+-----/g,
    placeholder: "[PRIVATE_KEY]",
  },
  // JWTs (three base64url segments)
  {
    pattern: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    placeholder: "[JWT]",
  },
  // GitHub tokens (ghp_, gho_, ghu_, ghs_, ghr_)
  {
    pattern: /gh[pousr]_[A-Za-z0-9]{30,}/g,
    placeholder: "[GITHUB_TOKEN]",
  },
  // Slack tokens
  {
    pattern: /xox[abprs]-[A-Za-z0-9-]{10,}/g,
    placeholder: "[SLACK_TOKEN]",
  },
  // AWS access key IDs
  {
    pattern: /AKIA[0-9A-Z]{16}/g,
    placeholder: "[AWS_KEY]",
  },
  // Stripe keys
  {
    pattern: /sk_(live|test)_[A-Za-z0-9]{20,}/g,
    placeholder: "[STRIPE_KEY]",
  },
  // Bearer / Basic auth headers (inline in text or HTTP headers)
  {
    pattern: /\b(Bearer|Basic)\s+[A-Za-z0-9+/=._-]{8,}/g,
    placeholder: (match: string) => match.startsWith("Bearer") ? "Bearer [TOKEN]" : "Basic [TOKEN]",
  } as any,
  // DB / service URLs with embedded credentials  proto://user:pass@host
  {
    pattern: /(mongodb|postgres|postgresql|mysql|redis|amqp|https?):\/\/[^/\s:]+:[^@\s]+@\S+/gi,
    placeholder: "[CONNECTION_STRING]",
  },
  // Azure connection strings
  {
    pattern: /DefaultEndpointsProtocol=[^;\s"]+;[^"\s]*/gi,
    placeholder: "[AZURE_CONN_STRING]",
  },
  // Elastic Cloud hostnames  *.es.cloud.es.io, *.found.io, etc.
  {
    pattern: /[a-z0-9-]+\.(es|kb|fleet|apm)(\.[a-z0-9-]+)?\.cloud\.es\.io/gi,
    placeholder: "[ELASTIC_CLOUD_HOST]",
  },
  {
    pattern: /[a-z0-9-]+\.found\.io/gi,
    placeholder: "[ELASTIC_CLOUD_HOST]",
  },
  // Emails
  {
    pattern: /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g,
    placeholder: "[EMAIL]",
  },
  // IPv4 addresses
  {
    pattern: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
    placeholder: "[IP]",
  },
];

export function redact(input: string | null | undefined): string {
  if (input == null) return "";
  let result = input;
  for (const rule of RULES) {
    const repl = rule.placeholder;
    if (typeof repl === "function") {
      result = result.replace(rule.pattern, repl as any);
    } else {
      result = result.replace(rule.pattern, repl);
    }
  }
  return result;
}

// Recursively redact strings inside plain objects and arrays (for JSONB columns).
export function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redact(value) as unknown as T;
  if (Array.isArray(value)) return value.map(redactDeep) as unknown as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactDeep(v);
    return out as unknown as T;
  }
  return value;
}
