// Pseudonym generation for tracked people (§7: pseudonymous by default).
// Adjective-animal pairs are readable in dashboards without leaking
// identity; uniqueness per org is enforced by the DB constraint, with the
// repository layer retrying (and finally suffixing) on collision.

const ADJECTIVES = [
  "amber", "bold", "brisk", "calm", "candid", "cedar", "civic", "clever",
  "coral", "crisp", "daring", "deft", "dusky", "eager", "early", "fabled",
  "fleet", "gentle", "gilded", "glad", "hardy", "hazel", "humble", "indigo",
  "jade", "keen", "kind", "lively", "lucid", "lunar", "mellow", "mild",
  "noble", "nimble", "olive", "opal", "pale", "placid", "plucky", "proud",
  "quiet", "rapid", "roan", "rustic", "sable", "sage", "sandy", "sleek",
  "solar", "spry", "steady", "stout", "sunny", "swift", "tidal", "tranquil",
  "umber", "vivid", "wary", "witty",
] as const;

const ANIMALS = [
  "auk", "badger", "bison", "bream", "crane", "curlew", "dingo", "dunlin",
  "egret", "falcon", "finch", "gannet", "gecko", "grouse", "heron", "hoopoe",
  "ibex", "jackal", "kestrel", "kite", "lark", "lemur", "linnet", "lynx",
  "marten", "merlin", "moth", "newt", "ocelot", "oriole", "osprey", "otter",
  "owl", "pika", "pipit", "plover", "puffin", "quail", "raven", "redwing",
  "seal", "serow", "shrew", "skink", "stoat", "stork", "swift", "tapir",
  "teal", "tern", "thrush", "vole", "wagtail", "walrus", "weasel", "wigeon",
  "wren", "yak", "zebu", "zorilla",
] as const;

export type Rng = () => number;

/** One adjective-animal pseudonym, e.g. "brisk-otter". */
export function generatePseudonym(rng: Rng = Math.random): string {
  const adjective = ADJECTIVES[Math.floor(rng() * ADJECTIVES.length)];
  const animal = ANIMALS[Math.floor(rng() * ANIMALS.length)];
  return `${adjective}-${animal}`;
}

/**
 * Collision-proof variant for retry exhaustion: appends a short random
 * suffix, e.g. "brisk-otter-9f2c". 3,600 base pairs cover small orgs; the
 * suffixed form covers the rest.
 */
export function generateSuffixedPseudonym(rng: Rng = Math.random): string {
  const suffix = Math.floor(rng() * 0xffff)
    .toString(16)
    .padStart(4, "0");
  return `${generatePseudonym(rng)}-${suffix}`;
}
