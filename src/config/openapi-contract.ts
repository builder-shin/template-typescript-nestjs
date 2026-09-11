import type { OpenAPIObject } from '@nestjs/swagger';
import type {
  OperationObject,
  ParameterObject,
  ReferenceObject,
  SchemaObject,
} from '@nestjs/swagger';
import type { ClassConstructor } from 'class-transformer';
import { getMetadataStorage } from 'class-validator';
import type { DataSource, EntityTarget, ObjectLiteral } from 'typeorm';
import { ERROR_CATALOG } from '../app/jsonapi/errors.js';
import { JSONAPI_MEDIA_TYPE } from '../app/jsonapi/media-type.js';
import { Category } from '../app/models/category.entity.js';
import { Example } from '../app/models/example.entity.js';
import { Tag } from '../app/models/tag.entity.js';
import { User } from '../app/models/user.entity.js';
import { AuthCredentials, RefreshTokenInput, UserRegister } from '../app/schemas/auth.schemas.js';
import { EXAMPLE_CATEGORY_QUERY_POLICY } from '../app/schemas/category.query-policy.js';
import { EXAMPLE_QUERY_POLICY } from '../app/schemas/example.query-policy.js';
import { ExampleCreate, ExampleReplace, ExampleUpdate } from '../app/schemas/example.schemas.js';
import type { QueryPolicy } from '../app/schemas/query-policy.js';
import { EXAMPLE_TAG_QUERY_POLICY } from '../app/schemas/tag.query-policy.js';
import { CATEGORY_SERIALIZER } from '../app/serializers/category.serializer.js';
import { EXAMPLE_SERIALIZER } from '../app/serializers/example.serializer.js';
import type { ResourceSerializer } from '../app/serializers/serializer.js';
import { TAG_SERIALIZER } from '../app/serializers/tag.serializer.js';
import { USER_SERIALIZER } from '../app/serializers/user.serializer.js';

type Schema = SchemaObject | ReferenceObject;
const string: SchemaObject = { type: 'string' };
const uuid: SchemaObject = { type: 'string', format: 'uuid' };
const version: SchemaObject = {
  type: 'object',
  required: ['version'],
  properties: { version: { type: 'string', enum: ['1.1'] } },
};
const links: SchemaObject = {
  type: 'object',
  required: ['self', 'first', 'prev', 'next', 'last'],
  properties: Object.fromEntries(
    ['self', 'first', 'prev', 'next', 'last'].map((name) => [name, { type: ['string', 'null'] }]),
  ),
};
const ref = (name: string): ReferenceObject => ({ $ref: `#/components/schemas/${name}` });
const object = (
  properties: Record<string, Schema>,
  required = Object.keys(properties),
): SchemaObject => ({ type: 'object', properties, required });

/** Read the actual class-validator DTO contract, including inherited and conditional fields. */
function attributesSchema(dto: ClassConstructor<object>): SchemaObject {
  const validations = getMetadataStorage().getTargetValidationMetadatas(dto, '', true, false);
  const properties: Record<string, SchemaObject> = {};
  const required: string[] = [];
  for (const name of new Set(validations.map((entry) => entry.propertyName))) {
    const rules = validations.filter((entry) => entry.propertyName === name);
    const skips = (value: unknown): boolean =>
      rules.some((rule) => {
        const constraints: readonly unknown[] = Array.isArray(rule.constraints)
          ? rule.constraints
          : [];
        const predicate = constraints[0];
        if (rule.type !== 'conditionalValidation' || typeof predicate !== 'function') return false;
        const result: unknown = Reflect.apply(predicate, undefined, [{ [name]: value }, value]);
        return result === false;
      });
    if (!skips(undefined)) required.push(name);
    const field: SchemaObject = {};
    for (const rule of rules) {
      const constraints: readonly unknown[] = Array.isArray(rule.constraints)
        ? rule.constraints
        : [];
      const [first, second] = constraints;
      if (rule.name === 'isString' || rule.name === 'isEmail' || rule.name === 'email')
        field.type = 'string';
      if (rule.name === 'isEmail' || rule.name === 'email') field.format = 'email';
      if (rule.name === 'isInt') field.type = 'integer';
      if ((rule.name === 'isLength' || rule.name === 'minLength') && typeof first === 'number')
        field.minLength = first;
      if (rule.name === 'isLength' && typeof second === 'number') field.maxLength = second;
      if (rule.name === 'min' && typeof first === 'number') field.minimum = first;
      if (rule.name === 'max' && typeof first === 'number') field.maximum = first;
      if (rule.name === 'isIn' && Array.isArray(first)) {
        field.type = 'string';
        field.enum = first;
      }
    }
    if (skips(null) && typeof field.type === 'string') field.type = [field.type, 'null'];
    if (name === 'password') field.writeOnly = true;
    properties[name] = field;
  }
  return { type: 'object', properties, required, additionalProperties: false };
}

function identifier(type: string): SchemaObject {
  return {
    ...object({ type: { type: 'string', enum: [type] }, id: string, meta: { type: 'object' } }, [
      'type',
      'id',
    ]),
    additionalProperties: false,
  };
}

function linkage(type: string, many: boolean): SchemaObject {
  return many
    ? { type: 'array', uniqueItems: true, items: identifier(type) }
    : { anyOf: [identifier(type), { type: 'null' }] };
}

function success(data: Schema, collection = false, included: readonly string[] = []): SchemaObject {
  return object(
    {
      jsonapi: version,
      data,
      ...(collection
        ? { links, meta: object({ totalCount: { type: 'integer', minimum: 0 } }) }
        : {}),
      included: {
        type: 'array',
        items: included.length
          ? { oneOf: included.map((type) => ref(`${type}Resource`)) }
          : { type: 'object' },
      },
    },
    collection ? ['jsonapi', 'data', 'links'] : ['jsonapi', 'data'],
  );
}

function response(operation: OperationObject | undefined, data: Schema, statuses = [200]): void {
  if (operation === undefined) return;
  operation.responses = Object.fromEntries(
    statuses.map((status) => [
      String(status),
      status === 204
        ? { description: 'No content' }
        : { description: 'JSON:API success', content: { [JSONAPI_MEDIA_TYPE]: { schema: data } } },
    ]),
  );
  for (const status of [400, 401, 403, 404, 405, 406, 409, 415, 422, 500]) {
    operation.responses[String(status)] = {
      description: 'JSON:API error',
      content: { [JSONAPI_MEDIA_TYPE]: { schema: ref('JsonApiErrorDocument') } },
    };
  }
}

function body(operation: OperationObject | undefined, data: Schema): void {
  if (operation === undefined) return;
  operation.requestBody = {
    required: true,
    description:
      'JSON:API document. Content-Type may include a profile parameter; other media parameters are rejected.',
    content: {
      [JSONAPI_MEDIA_TYPE]: { schema: { ...object({ data }), additionalProperties: false } },
    },
  };
}

function writeDocument(
  type: string,
  dto: ClassConstructor<object>,
  relationships: Record<string, Schema>,
  requireId = false,
  allowId = false,
): SchemaObject {
  const attributes = attributesSchema(dto);
  const resource = object(
    {
      type: { type: 'string', enum: [type] },
      ...(requireId || allowId
        ? {
            id: {
              ...string,
              description:
                'Must identify the same UUID as the URL id; accepted UUID aliases are normalized.',
            },
          }
        : {}),
      attributes,
      ...(Object.keys(relationships).length
        ? {
            relationships: {
              ...object(relationships, []),
              additionalProperties: false,
              minProperties: 1,
            },
          }
        : {}),
    },
    [
      'type',
      ...(requireId ? ['id'] : []),
      ...((attributes.required?.length ?? 0) ? ['attributes'] : []),
    ],
  );
  resource.additionalProperties = false;
  if ((attributes.required?.length ?? 0) === 0 && Object.keys(relationships).length) {
    resource.anyOf = [{ required: ['attributes'] }, { required: ['relationships'] }];
  }
  return resource;
}

function parameter(name: string, schema: SchemaObject, description?: string): ParameterObject {
  return {
    in: 'query',
    name,
    required: false,
    schema,
    ...(description === undefined ? {} : { description }),
  };
}

function pageParameters(policy: QueryPolicy, related = false): ParameterObject[] {
  return [
    parameter(
      'page[number]',
      { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER + 1 },
      'Offset mode only. (number - 1) * clamped size must not exceed 9007199254740991.',
    ),
    parameter(
      'page[size]',
      { type: 'integer', minimum: 1, format: 'int64', default: policy.defaultPageSize },
      'Positive int64, clamped to 100 before computing the offset.',
    ),
    ...(related
      ? []
      : [
          parameter(
            'page[totals]',
            { type: 'boolean', default: false },
            'Include totalCount and the last offset page.',
          ),
        ]),
    ...(related
      ? []
      : [
          parameter(
            'page[after]',
            { ...string, maxLength: 4096 },
            'Opaque cursor. Empty starts at the beginning; cannot combine with before or number.',
          ),
          parameter(
            'page[before]',
            { ...string, maxLength: 4096 },
            'Opaque cursor. Empty starts at the end; cannot combine with after or number.',
          ),
        ]),
  ];
}

function queryParameters(policy: QueryPolicy): ParameterObject[] {
  const result = pageParameters(policy);
  result.push(
    parameter(
      'sort',
      string,
      `Comma-separated fields; prefix - for descending: ${Object.keys(policy.sorts).join(', ')}. Default: ${policy.defaultSort.map((term) => `${term.direction === 'DESC' ? '-' : ''}${term.field}`).join(', ')}.`,
    ),
  );
  result.push(
    parameter(
      'include',
      string,
      `Comma-separated relationships: ${policy.includes.join(', ')}. Empty requests included: [].`,
    ),
  );
  for (const [name, field] of Object.entries(policy.filters)) {
    for (const operator of field.operators) {
      let schema: SchemaObject =
        field.type === 'integer'
          ? { type: 'integer', minimum: -2147483648, maximum: 2147483647 }
          : field.type === 'number'
            ? { type: 'number' }
            : field.type === 'boolean'
              ? { type: 'boolean' }
              : { type: 'string' };
      if (field.type === 'timestamp') schema.format = 'date-time';
      if (field.type === 'uuid') schema.format = 'uuid';
      if (field.values !== undefined) schema.enum = [...field.values];
      let description = operator === 'contains' ? 'Case-sensitive literal substring.' : operator;
      if (operator === 'in') {
        schema = string;
        description = `Comma-separated values${field.values === undefined ? '' : `: ${field.values.join(', ')}`}.`;
      }
      if (operator === 'isNull') schema = { type: 'boolean' };
      result.push(parameter(`filter[${name}][${operator}]`, schema, description));
      if (operator === 'exact')
        result.push(parameter(`filter[${name}]`, schema, 'Alias of exact.'));
    }
  }
  return result;
}

function resourceSchema<T extends ObjectLiteral & { id: string }>(
  dataSource: DataSource,
  model: EntityTarget<T>,
  serializer: ResourceSerializer<T>,
  dto?: ClassConstructor<object>,
): SchemaObject {
  const metadata = dataSource.getMetadata(model);
  const validated = dto === undefined ? {} : (attributesSchema(dto).properties ?? {});
  const attributes: Record<string, Schema> = {};
  for (const name of Object.keys(serializer.attributes)) {
    const column = metadata.findColumnWithPropertyName(name);
    let property: SchemaObject = { type: 'string' };
    if (column?.type === 'boolean') property = { type: 'boolean' };
    if (column?.type === 'integer') property = { type: 'integer' };
    if (column?.type === 'timestamptz')
      property = {
        type: 'string',
        format: 'date-time',
        description: 'UTC; fractional seconds retain six digits when nonzero.',
      };
    if (column?.enum !== undefined) property.enum = column.enum;
    if (column?.length) property.maxLength = Number(column.length);
    if (column?.isNullable && typeof property.type === 'string')
      property.type = [property.type, 'null'];
    attributes[name] = validated[name] ?? property;
  }
  const relationships = Object.fromEntries(
    Object.entries(serializer.relationships).map(([name, definition]) => [
      name,
      object({
        data: linkage(definition.target().type, definition.cardinality === 'many'),
        links: object({ self: string, related: string }),
      }),
    ]),
  );
  return object({
    type: { type: 'string', enum: [serializer.type] },
    id: uuid,
    attributes: object(attributes),
    ...(Object.keys(relationships).length ? { relationships: object(relationships) } : {}),
    links: object({ self: string }),
  });
}

function describeCrud<T extends ObjectLiteral & { id: string }>(
  document: OpenAPIObject,
  dataSource: DataSource,
  model: EntityTarget<T>,
  serializer: ResourceSerializer<T>,
  policy: QueryPolicy,
  write?: {
    create: ClassConstructor<object>;
    update: ClassConstructor<object>;
    replace: ClassConstructor<object>;
  },
): void {
  const path = serializer.resourcePath;
  if (path === undefined) throw new TypeError('CRUD documentation needs resourcePath');
  const componentName = `${serializer.type}Resource`;
  document.components ??= {};
  document.components.schemas ??= {};
  document.components.schemas[componentName] = resourceSchema(
    dataSource,
    model,
    serializer,
    write?.create,
  );
  const schema = ref(componentName);
  const collection = document.paths[path];
  const item = document.paths[`${path}/{id}`];
  const included = Object.values(serializer.relationships).map(
    (definition) => definition.target().type,
  );
  response(collection?.get, success({ type: 'array', items: schema }, true, included));
  if (collection?.get) collection.get.parameters = queryParameters(policy);
  response(item?.get, success(schema, false, included));
  if (item?.get)
    item.get.parameters = [
      ...(item.get.parameters ?? []),
      parameter('include', string, `Comma-separated relationships: ${policy.includes.join(', ')}.`),
    ];
  const relationships: Record<string, Schema> = {};
  for (const [name, definition] of Object.entries(serializer.relationships)) {
    const data = linkage(definition.target().type, definition.cardinality === 'many');
    relationships[name] = { ...object({ data }), additionalProperties: false };
    const relation = document.paths[`${path}/{id}/relationships/${name}`];
    response(
      relation?.get,
      object({ jsonapi: version, data, links: object({ self: string, related: string }) }),
    );
    for (const operation of [relation?.patch, relation?.post, relation?.delete]) {
      body(operation, data);
      response(operation, {}, [204]);
    }
    const related = document.paths[`${path}/{id}/${name}`]?.get;
    response(
      related,
      success(
        definition.cardinality === 'many'
          ? { type: 'array', items: ref(`${definition.target().type}Resource`) }
          : { anyOf: [ref(`${definition.target().type}Resource`), { type: 'null' }] },
        definition.cardinality === 'many',
      ),
    );
    if (related && definition.cardinality === 'many')
      related.parameters = [...(related.parameters ?? []), ...pageParameters(policy, true)];
  }
  if (write !== undefined) {
    body(collection?.post, writeDocument(serializer.type, write.create, relationships));
    body(item?.patch, writeDocument(serializer.type, write.update, relationships, true));
    body(item?.put, writeDocument(serializer.type, write.replace, relationships, true));
    response(collection?.post, success(schema), [201]);
    response(item?.patch, success(schema));
    response(item?.put, success(schema), [200, 201]);
    response(item?.delete, {}, [204]);
  }
}

/** Explicit documentation registration; runtime routes remain owned by RoutesModule. */
export function enrichOpenApi(document: OpenAPIObject, dataSource: DataSource): void {
  document.openapi = '3.1.0';
  document.components ??= {};
  document.components.schemas ??= {};
  document.components.schemas.JsonApiErrorDocument = object({
    jsonapi: version,
    errors: {
      type: 'array',
      minItems: 1,
      items: object(
        {
          status: string,
          code: { type: 'string', enum: Object.keys(ERROR_CATALOG) },
          title: string,
          detail: string,
          source: object({ pointer: string, parameter: string, header: string }, []),
          meta: { type: 'object' },
        },
        ['status', 'code', 'title', 'detail'],
      ),
    },
  });
  describeCrud(document, dataSource, Example, EXAMPLE_SERIALIZER, EXAMPLE_QUERY_POLICY, {
    create: ExampleCreate,
    update: ExampleUpdate,
    replace: ExampleReplace,
  });
  describeCrud(document, dataSource, Category, CATEGORY_SERIALIZER, EXAMPLE_CATEGORY_QUERY_POLICY);
  describeCrud(document, dataSource, Tag, TAG_SERIALIZER, EXAMPLE_TAG_QUERY_POLICY);
  document.components.schemas.usersResource = resourceSchema(
    dataSource,
    User,
    USER_SERIALIZER,
    UserRegister,
  );
  const user = ref('usersResource');
  const tokens = object({
    type: { type: 'string', enum: ['authTokens'] },
    id: uuid,
    attributes: object({
      accessToken: string,
      refreshToken: string,
      tokenType: { type: 'string', enum: ['Bearer'] },
      expiresIn: { type: 'integer' },
      refreshExpiresIn: { type: 'integer' },
    }),
  });
  for (const [action, type, dto] of [
    ['register', 'users', UserRegister],
    ['login', 'authCredentials', AuthCredentials],
    ['refresh', 'refreshTokens', RefreshTokenInput],
    ['logout', 'refreshTokens', RefreshTokenInput],
  ] as const) {
    const operation = document.paths[`/api/v1/auth/${action}`]?.post;
    body(operation, writeDocument(type, dto, {}));
    response(
      operation,
      success(action === 'register' ? user : tokens),
      action === 'register' ? [201] : action === 'logout' ? [204] : [200],
    );
  }
  const registration = document.paths['/api/v1/auth/register']?.post?.responses['201'];
  if (registration && !('$ref' in registration))
    registration.headers = { Location: { schema: { type: 'string', enum: ['/api/v1/users/me'] } } };
  for (const operation of [
    document.paths['/api/v1/examples']?.post,
    document.paths['/api/v1/examples/{id}']?.put,
  ]) {
    const created = operation?.responses['201'];
    if (created && !('$ref' in created))
      created.headers = {
        Location: { schema: string, description: 'Canonical URL of the created example.' },
      };
  }
  response(document.paths['/api/v1/users/me']?.get, success(user));
  for (const path of ['/health/live', '/health/ready']) {
    const operation = document.paths[path]?.get;
    response(
      operation,
      object({
        jsonapi: version,
        data: { type: 'null' },
        meta: object({ status: { type: 'string', enum: ['ok'] } }),
      }),
    );
    if (path.endsWith('/ready') && operation)
      operation.responses['503'] = {
        description: 'Database unavailable',
        content: { [JSONAPI_MEDIA_TYPE]: { schema: ref('JsonApiErrorDocument') } },
      };
  }
  for (const [path, methods] of Object.entries(document.paths)) {
    for (const method of ['get', 'post', 'patch', 'put', 'delete'] as const) {
      const operation = methods[method];
      if (!operation) continue;
      let errors: number[];
      if (path.startsWith('/health/')) errors = path.endsWith('/ready') ? [503] : [];
      else if (path === '/api/v1/users/me') errors = [401, 406, 422, 500];
      else if (path.startsWith('/api/v1/auth/')) {
        errors = path.endsWith('/register')
          ? [406, 409, 415, 422, 500]
          : path.endsWith('/logout')
            ? [401, 406, 415, 422, 500]
            : [401, 403, 406, 415, 422, 500];
      } else if (method === 'get')
        errors = path.includes('{id}') ? [400, 404, 406, 422, 500] : [400, 406, 422, 500];
      else if (method === 'delete' && !path.includes('/relationships/'))
        errors = [400, 401, 403, 404, 406, 422, 500];
      else
        errors = [400, 401, 403, ...(path.includes('{id}') ? [404] : []), 406, 409, 415, 422, 500];
      operation.responses = Object.fromEntries(
        Object.entries(operation.responses).filter(
          ([status]) => Number(status) < 400 || errors.includes(Number(status)),
        ),
      );
    }
  }
}
