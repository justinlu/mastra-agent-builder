import type { SchemaField } from '../../types';

const types = new Set([
  'string',
  'number',
  'boolean',
  'date',
  'object',
  'array',
  'enum',
  'any',
  'unknown',
  'null',
  'undefined',
]);
const fail = (field: SchemaField, reason: string): never => {
  throw new Error(`Schema field "${field.name}": ${reason}`);
};

/** Shared validation/codegen keeps exported Zod schemas faithful to visual fields. */
export function schemaObject(fields: SchemaField[]): string {
  if (!Array.isArray(fields)) throw new Error('Schema fields must be an array');
  const names = new Set<string>();
  for (const field of fields) {
    if (typeof field.name !== 'string' || !field.name.trim()) fail(field, 'a nonempty name is required');
    if (names.has(field.name)) fail(field, 'duplicate field name');
    names.add(field.name);
  }
  return `z.object({ ${fields.map((field) => `${JSON.stringify(field.name)}: ${schemaType(field)}`).join(', ')} })`;
}

function validateDefault(field: SchemaField, topLevel = true): void {
  const value = field.defaultValue;
  if (value === undefined || (topLevel && value === '')) return; // Existing editor represents an unset default as ''.
  const valid =
    field.type === 'any' ||
    field.type === 'unknown' ||
    (field.type === 'string' && typeof value === 'string') ||
    (field.type === 'number' && typeof value === 'number' && Number.isFinite(value)) ||
    (field.type === 'boolean' && typeof value === 'boolean') ||
    (field.type === 'null' && value === null) ||
    (field.type === 'date' && typeof value === 'string' && !Number.isNaN(Date.parse(value))) ||
    (field.type === 'array' && Array.isArray(value)) ||
    (field.type === 'object' && value !== null && typeof value === 'object' && !Array.isArray(value));
  if (!valid) fail(field, `default value must match type ${field.type}; update or clear it after changing type`);
  if (field.type === 'array')
    for (const item of value)
      validateDefault(
        {
          ...field,
          type: field.arrayItemType ?? 'any',
          defaultValue: item,
          children: field.arrayItemSchema,
          arrayItemType: undefined,
        },
        false,
      );
  if (field.type === 'object' && field.children?.length) {
    for (const child of field.children) {
      if (!(child.name in value)) {
        if (!child.optional && (child.defaultValue === undefined || child.defaultValue === ''))
          fail(field, `object default is missing required field ${child.name}`);
      } else validateDefault({ ...child, defaultValue: value[child.name] }, false);
    }
  }
}

export function schemaType(field: SchemaField): string {
  if (!types.has(field.type)) fail(field, 'unsupported field type');
  validateDefault(field);
  let code: string;
  switch (field.type) {
    case 'object':
      code = field.children?.length ? schemaObject(field.children) : 'z.record(z.string(), z.any())';
      break;
    case 'array': {
      const item =
        field.arrayItemType === 'object' && field.arrayItemSchema?.length
          ? schemaObject(field.arrayItemSchema)
          : schemaType({
              id: '',
              name: field.name + '[]',
              type: field.arrayItemType ?? 'any',
              optional: false,
            });
      code = `z.array(${item})`;
      break;
    }
    case 'enum':
      return fail(field, 'enum values are not represented by this editor; configure an explicit schema in code');
    default:
      code = `z.${field.type}()`;
  }
  for (const rule of field.validation ?? []) {
    if (['min', 'max', 'length'].includes(rule.type)) {
      if (!['string', 'number', 'array'].includes(field.type) || (field.type === 'number' && rule.type === 'length'))
        fail(field, `${rule.type} validation is incompatible with ${field.type}`);
      if (
        typeof rule.value !== 'number' ||
        !Number.isFinite(rule.value) ||
        (field.type !== 'number' && (!Number.isInteger(rule.value) || rule.value < 0))
      )
        fail(field, `${rule.type} requires a ${field.type === 'number' ? 'finite number' : 'nonnegative integer'}`);
      code += `.${rule.type}(${JSON.stringify(rule.value)}${rule.message ? ', ' + JSON.stringify(rule.message) : ''})`;
    } else if (['email', 'url', 'uuid'].includes(rule.type)) {
      if (field.type !== 'string') fail(field, `${rule.type} validation requires a string field`);
      code += `.${rule.type}(${rule.message ? JSON.stringify(rule.message) : ''})`;
    } else if (rule.type === 'regex') {
      if (field.type !== 'string' || typeof rule.value !== 'string')
        fail(field, 'regex requires a string field and string pattern');
      try {
        new RegExp(rule.value);
      } catch {
        fail(field, 'invalid regular expression');
      }
      code += `.regex(new RegExp(${JSON.stringify(rule.value)})${rule.message ? ', ' + JSON.stringify(rule.message) : ''})`;
    } else fail(field, 'custom validation needs a manual implementation');
  }
  if (field.optional) code += '.optional()';
  if (field.description) code += `.describe(${JSON.stringify(field.description)})`;
  if (field.defaultValue !== undefined && field.defaultValue !== '') {
    const value =
      field.type === 'date' ? `new Date(${JSON.stringify(field.defaultValue)})` : JSON.stringify(field.defaultValue);
    code += `.default(${value})`;
  }
  return code;
}
