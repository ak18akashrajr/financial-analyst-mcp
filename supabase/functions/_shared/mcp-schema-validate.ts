// Validates tools/call `arguments` against the tool's declared JSON Schema
// before the handler ever runs.
//
// Without this, every tool's `inputSchema` (advertised to MCP clients via
// tools/list) was purely decorative — each handler hand-rolled its own
// ad-hoc checks, inconsistently: some threw on bad input, at least one
// (get_concentration_risk's topN) silently substituted a default instead of
// rejecting, so a client passing an invalid value got a *successful* result
// computed from a different input than it asked for, with no signal that
// happened. This covers the narrow subset of JSON Schema our tools actually
// use (flat "object" schemas, primitive-typed properties plus a
// string-array property, required, additionalProperties, minimum, pattern,
// minLength, enum, minItems) — not a general-purpose validator, and not
// meant to become one.
export type JsonSchema = Record<string, unknown>;

function typeOf(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

/** Returns a human-readable error string, or null if `args` satisfies `schema`. */
export function validateArgs(schema: JsonSchema, args: Record<string, unknown>): string | null {
  if (schema.type !== "object") return null; // every tool in this registry uses an object schema

  const properties = (schema.properties as Record<string, JsonSchema>) || {};
  const required = (schema.required as string[]) || [];

  for (const key of required) {
    if (!(key in args) || args[key] === undefined) {
      return `Missing required argument: ${key}`;
    }
  }

  if (schema.additionalProperties === false) {
    const unexpected = Object.keys(args).filter((k) => !(k in properties));
    if (unexpected.length > 0) {
      return `Unexpected argument(s): ${unexpected.join(", ")}`;
    }
  }

  for (const [key, propSchema] of Object.entries(properties)) {
    if (!(key in args) || args[key] === undefined) continue; // optional and absent
    const value = args[key];
    const expectedType = propSchema.type as string | undefined;

    if (expectedType === "number") {
      if (typeOf(value) !== "number" || !Number.isFinite(value as number)) {
        return `Argument "${key}" must be a number`;
      }
      const minimum = propSchema.minimum as number | undefined;
      if (typeof minimum === "number" && (value as number) < minimum) {
        return `Argument "${key}" must be >= ${minimum}`;
      }
    } else if (expectedType === "string") {
      if (typeOf(value) !== "string") {
        return `Argument "${key}" must be a string`;
      }
      const pattern = propSchema.pattern as string | undefined;
      if (pattern && !new RegExp(pattern).test(value as string)) {
        return `Argument "${key}" does not match required format`;
      }
      const minLength = propSchema.minLength as number | undefined;
      if (typeof minLength === "number" && (value as string).length < minLength) {
        return `Argument "${key}" must be at least ${minLength} character(s)`;
      }
      const enumValues = propSchema.enum as string[] | undefined;
      if (enumValues && !enumValues.includes(value as string)) {
        return `Argument "${key}" must be one of: ${enumValues.join(", ")}`;
      }
    } else if (expectedType === "boolean") {
      if (typeOf(value) !== "boolean") {
        return `Argument "${key}" must be a boolean`;
      }
    } else if (expectedType === "array") {
      if (typeOf(value) !== "array") {
        return `Argument "${key}" must be an array`;
      }
      const items = propSchema.items as JsonSchema | undefined;
      if (items?.type === "string" && (value as unknown[]).some((v) => typeOf(v) !== "string")) {
        return `Argument "${key}" must be an array of strings`;
      }
      const minItems = propSchema.minItems as number | undefined;
      if (typeof minItems === "number" && (value as unknown[]).length < minItems) {
        return `Argument "${key}" must have at least ${minItems} item(s)`;
      }
    }
  }

  return null;
}
