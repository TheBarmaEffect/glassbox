/**
 * Deterministic network-boundary policy for checkpoint targets.
 *
 * This replaces a set of string-prefix tests that were wrong in both directions: they
 * blocked every public hostname beginning with "fc" or "fd" (fda.gov, fcc.gov) because
 * those are the IPv6 unique-local prefixes, and they missed loopback reached through
 * IPv4-mapped, 6to4 and NAT64 encodings, through a trailing-dot hostname, and through
 * the CGNAT and benchmarking ranges.
 *
 * The rule throughout: a prefix test on a *hostname string* is not a prefix test on an
 * *address*. Addresses are parsed and compared numerically; hostnames are compared as
 * labels.
 *
 * Syntactic only. This resolves no DNS, so a public name pointing at a private address
 * is not detected here and must not be claimed as detected.
 */

/** IPv4 ranges that must never be a tool-call target, as [firstOctetMask, prefixLength]. */
const BLOCKED_IPV4_CIDRS: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8],        // RFC 1122 "this network"
  ["10.0.0.0", 8],       // RFC 1918 private
  ["100.64.0.0", 10],    // RFC 6598 carrier-grade NAT
  ["127.0.0.0", 8],      // RFC 1122 loopback
  ["169.254.0.0", 16],   // RFC 3927 link-local, includes cloud metadata 169.254.169.254
  ["172.16.0.0", 12],    // RFC 1918 private
  ["192.0.0.0", 24],     // RFC 6890 IETF protocol assignments
  ["192.0.2.0", 24],     // RFC 5737 TEST-NET-1
  ["192.88.99.0", 24],   // RFC 7526 former 6to4 relay anycast
  ["192.168.0.0", 16],   // RFC 1918 private
  ["198.18.0.0", 15],    // RFC 2544 benchmarking
  ["198.51.100.0", 24],  // RFC 5737 TEST-NET-2
  ["203.0.113.0", 24],   // RFC 5737 TEST-NET-3
  ["224.0.0.0", 4],      // RFC 5771 multicast
  ["240.0.0.0", 4],      // RFC 1112 reserved, includes 255.255.255.255
];

/** Hostnames that name a metadata or internal endpoint without being an IP literal. */
const BLOCKED_HOST_SUFFIXES: readonly string[] = [
  "localhost",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
  "instance-data.ec2.internal",
];

export function parseIpv4(host: string): number | undefined {
  const parts = host.split(".");
  if (parts.length !== 4) return undefined;
  let value = 0;
  for (const part of parts) {
    // Reject non-canonical forms: empty, non-digit, leading zero, out of range. Octal and
    // hex spellings of an address are not accepted as an address at all, which means they
    // fall through to hostname handling and fail to resolve rather than silently passing.
    if (!/^\d{1,3}$/.test(part)) return undefined;
    if (part.length > 1 && part.startsWith("0")) return undefined;
    const octet = Number(part);
    if (octet > 255) return undefined;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

function ipv4InCidr(address: number, base: string, prefix: number): boolean {
  const baseValue = parseIpv4(base);
  if (baseValue === undefined) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (address & mask) >>> 0 === (baseValue & mask) >>> 0;
}

export function isBlockedIpv4(host: string): boolean {
  const address = parseIpv4(host);
  if (address === undefined) return false;
  return BLOCKED_IPV4_CIDRS.some(([base, prefix]) => ipv4InCidr(address, base, prefix));
}

/** Expand an IPv6 literal into its eight 16-bit groups, or undefined if malformed. */
export function expandIpv6(host: string): number[] | undefined {
  let text = host;
  let trailingIpv4: number | undefined;

  // A trailing dotted-quad ("::ffff:127.0.0.1") occupies the last two groups.
  const dotted = /:((?:\d{1,3}\.){3}\d{1,3})$/.exec(text);
  if (dotted) {
    trailingIpv4 = parseIpv4(dotted[1]!);
    if (trailingIpv4 === undefined) return undefined;
    text = text.slice(0, dotted.index + 1);
  }

  const halves = text.split("::");
  if (halves.length > 2) return undefined;
  const parseGroups = (segment: string): number[] | undefined => {
    if (segment === "" || segment === ":") return [];
    const groups: number[] = [];
    for (const part of segment.split(":")) {
      if (part === "") continue;
      if (!/^[0-9a-f]{1,4}$/i.test(part)) return undefined;
      groups.push(parseInt(part, 16));
    }
    return groups;
  };

  const head = parseGroups(halves[0] ?? "");
  const tail = halves.length === 2 ? parseGroups(halves[1] ?? "") : [];
  if (!head || !tail) return undefined;

  const explicit = head.length + tail.length + (trailingIpv4 !== undefined ? 2 : 0);
  if (explicit > 8) return undefined;
  if (halves.length === 1 && explicit !== 8) return undefined;

  const fill = new Array(8 - explicit).fill(0) as number[];
  const groups = [...head, ...fill, ...tail];
  if (trailingIpv4 !== undefined) {
    groups.push((trailingIpv4 >>> 16) & 0xffff, trailingIpv4 & 0xffff);
  }
  return groups.length === 8 ? groups : undefined;
}

/** The IPv4 address embedded in a transition-mechanism IPv6 address, if there is one. */
export function embeddedIpv4(groups: number[]): number | undefined {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups as [number, number, number, number, number, number, number, number];
  const join = (high: number, low: number) => ((high << 16) | low) >>> 0;
  // ::ffff:0:0/96 — IPv4-mapped
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) return join(g6, g7);
  // ::/96 — deprecated IPv4-compatible
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return join(g6, g7);
  // 2002::/16 — 6to4, the embedded address sits in groups 1 and 2
  if (g0 === 0x2002) return join(g1, g2);
  // 64:ff9b::/96 — NAT64 well-known prefix
  if (g0 === 0x0064 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return join(g6, g7);
  return undefined;
}

export function isBlockedIpv6(host: string): boolean {
  const groups = expandIpv6(host);
  if (!groups) return false;

  const embedded = embeddedIpv4(groups);
  if (embedded !== undefined) {
    const dotted = [24, 16, 8, 0].map((shift) => (embedded >>> shift) & 0xff).join(".");
    if (isBlockedIpv4(dotted)) return true;
  }

  const first = groups[0]!;
  if (groups.every((group) => group === 0)) return true;                     // ::
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true; // ::1 loopback
  if ((first & 0xffc0) === 0xfe80) return true;                              // fe80::/10 link-local
  if ((first & 0xfe00) === 0xfc00) return true;                              // fc00::/7 unique-local
  if ((first & 0xff00) === 0xff00) return true;                              // ff00::/8 multicast
  return false;
}

/** Lowercase, strip IPv6 brackets, and remove the fully-qualified trailing dot. */
export function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

export function isBlockedHost(hostname: string): boolean {
  const host = normalizeHost(hostname);
  if (!host) return true;
  if (isBlockedIpv4(host)) return true;
  if (isBlockedIpv6(host)) return true;
  return BLOCKED_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

/**
 * Canonical form of a target URL, for comparing a checkpoint target against a constitution
 * rule value. Without this, `forbid_target` is a raw string comparison and is evaded by a
 * trailing slash, an explicit default port, a dot segment, an empty query, or a
 * percent-encoded unreserved character — all of which name the same resource.
 */
export function canonicalTarget(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return value.trim().toLowerCase();
  }
  // Decode percent-escapes of unreserved characters (RFC 3986 §2.3), which are by
  // definition equivalent to the character itself.
  const decodeUnreserved = (segment: string): string =>
    segment.replace(/%[0-9A-Fa-f]{2}/g, (escape) => {
      const character = String.fromCharCode(parseInt(escape.slice(1), 16));
      return /[A-Za-z0-9\-._~]/.test(character) ? character : escape.toUpperCase();
    });

  const scheme = parsed.protocol.toLowerCase();
  const host = normalizeHost(parsed.hostname);
  const defaultPort = scheme === "https:" ? "443" : scheme === "http:" ? "80" : "";
  const port = parsed.port && parsed.port !== defaultPort ? `:${parsed.port}` : "";
  const path = decodeUnreserved(parsed.pathname).replace(/\/+$/, "");
  const query = parsed.search === "?" ? "" : parsed.search;
  return `${scheme}//${host}${port}${path}${query}`;
}

/** Does a checkpoint target match a constitution rule value, comparing canonical forms? */
export function targetMatchesValue(target: string, ruleValue: string): boolean {
  const normalizedValue = ruleValue.trim().toLowerCase();
  if (normalizedValue.startsWith("*.")) {
    const suffix = normalizedValue.slice(1);
    try {
      return normalizeHost(new URL(target).hostname).endsWith(suffix);
    } catch {
      return target.toLowerCase().endsWith(suffix);
    }
  }
  return canonicalTarget(target) === canonicalTarget(ruleValue);
}

/** The network-boundary finding for a checkpoint target, or undefined when it is allowed. */
export function networkBoundaryFinding(target: string | undefined): string | undefined {
  if (!target) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(target) ? "Checkpoint target is not a valid URL." : undefined;
  }
  if (!["https:", "http:"].includes(parsed.protocol)) {
    return `Checkpoint target uses the disallowed ${parsed.protocol} scheme.`;
  }
  if (parsed.username || parsed.password) {
    return "Checkpoint target contains embedded credentials.";
  }
  if (isBlockedHost(parsed.hostname)) {
    return "Checkpoint target resolves syntactically to a loopback, link-local, private, reserved, or metadata address.";
  }
  return undefined;
}
