/**
 * Sanitize tool function names and JSON schemas before they are sent to
 * DeepSeek. The API is strict about names (`^[a-zA-Z][a-zA-Z0-9_-]*$`, ≤64
 * chars) and about JSON-schema features (no advanced keywords, no
 * composite branches like anyOf/oneOf/allOf). Sanitize rather than reject
 * so a single non-conforming tool doesn't break the whole request.
 */

const INTEGER_LIKE_MARKERS = [
  'id',
  'limit',
  'count',
  'index',
  'size',
  'offset',
  'length',
  'results_limit',
  'maxresults',
  'debugsessionid',
  'cellid',
];

function isIntegerLikePropertyName(propertyName: string | undefined): boolean {
  if (!propertyName) return false;
  const lowered = propertyName.toLowerCase();
  return INTEGER_LIKE_MARKERS.some((m) => lowered.includes(m)) || lowered.endsWith('_id');
}

export function sanitizeFunctionName(name: unknown): string {
  if (typeof name !== 'string' || !name) return 'tool';
  let sanitized = name.replace(/[^a-zA-Z0-9_-]/g, '_');
  if (!/^[a-zA-Z]/.test(sanitized)) sanitized = `tool_${sanitized}`;
  sanitized = sanitized.replace(/_+/g, '_');
  return sanitized.slice(0, 64);
}

const ALLOWED_SCHEMA_KEYS = new Set([
  'type',
  'properties',
  'required',
  'additionalProperties',
  'description',
  'enum',
  'default',
  'items',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'pattern',
  'format',
]);

function pruneUnknownSchemaKeywords(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (ALLOWED_SCHEMA_KEYS.has(k)) out[k] = v;
  }
  return out;
}

export function sanitizeSchema(input: unknown, propName?: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { type: 'object', properties: {} };
  }

  let schema = input as Record<string, unknown>;

  // Flatten anyOf/oneOf/allOf to the first branch (preferring a string-typed branch).
  for (const composite of ['anyOf', 'oneOf', 'allOf']) {
    const branch = schema[composite];
    if (Array.isArray(branch) && branch.length > 0) {
      let preferred: Record<string, unknown> | undefined;
      for (const b of branch) {
        if (b && typeof b === 'object' && (b as Record<string, unknown>).type === 'string') {
          preferred = b as Record<string, unknown>;
          break;
        }
      }
      schema = { ...(preferred ?? (branch[0] as Record<string, unknown>)) };
      break;
    }
  }

  schema = pruneUnknownSchemaKeywords(schema);

  let t = schema.type as string | undefined;
  if (t == null) {
    t = 'object';
    schema.type = t;
  }

  // "number" with an integer-looking property name → coerce to integer
  // so DeepSeek doesn't pass through floats (and so the model emits
  // integers in the tool call args).
  if (t === 'number' && propName && isIntegerLikePropertyName(propName)) {
    schema.type = 'integer';
    t = 'integer';
  }

  if (t === 'object') {
    const props = (schema.properties as Record<string, unknown> | undefined) ?? {};
    const newProps: Record<string, unknown> = {};
    if (props && typeof props === 'object') {
      for (const [k, v] of Object.entries(props)) {
        newProps[k] = sanitizeSchema(v, k);
      }
    }
    schema.properties = newProps;

    const req = schema.required;
    if (Array.isArray(req)) {
      schema.required = req.filter((r) => typeof r === 'string');
    } else if (req !== undefined) {
      schema.required = [];
    }

    const ap = schema.additionalProperties;
    if (ap !== undefined && typeof ap !== 'boolean') {
      delete schema.additionalProperties;
    }
  } else if (t === 'array') {
    const items = schema.items;
    if (Array.isArray(items) && items.length > 0) {
      schema.items = sanitizeSchema(items[0]);
    } else if (items && typeof items === 'object') {
      schema.items = sanitizeSchema(items);
    } else {
      schema.items = { type: 'string' };
    }
  }

  return schema;
}

export function tryParseJSONObject(
  text: string,
): { ok: true; value: Record<string, unknown> } | { ok: false } {
  try {
    if (!text || !/[{]/.test(text)) return { ok: false };
    const value = JSON.parse(text);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return { ok: true, value };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}
