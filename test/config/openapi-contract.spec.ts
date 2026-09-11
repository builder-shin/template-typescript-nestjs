import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import type {
  SchemaObject,
  ReferenceObject,
  OperationObject,
  RequestBodyObject,
  ParameterObject,
} from '@nestjs/swagger';
import type { Server } from 'node:http';
import request from 'supertest';
import { createTestApp } from '../app-factory.js';

const VENDOR = 'application/vnd.api+json';
describe('OpenAPI public contract', () => {
  let app: INestApplication<Server> | undefined;
  let document: OpenAPIObject;
  beforeAll(async () => {
    app = await createTestApp();
    const response = await request(app.getHttpServer()).get('/api/schema').expect(200);
    document = response.body as OpenAPIObject;
  });
  afterAll(async () => {
    await app?.close();
  });
  it('declares the shared current-user validation response', () => {
    expect(Object.keys(document.paths['/api/v1/users/me']?.get?.responses ?? {}).sort()).toEqual([
      '200',
      '401',
      '406',
      '422',
      '500',
    ]);
  });
  function schema(value: SchemaObject | ReferenceObject | undefined): SchemaObject {
    if (value === undefined) throw new Error('Missing documented schema');
    if ('$ref' in value)
      return schema(document.components?.schemas?.[value.$ref.split('/').at(-1) ?? '']);
    return value;
  }
  function input(operation: OperationObject | undefined): SchemaObject {
    const body = operation?.requestBody as RequestBodyObject | undefined;
    expect(body?.required).toBe(true);
    return schema(schema(body?.content[VENDOR]?.schema).properties?.data);
  }
  it('documents required create/replace attributes and PUT id while PATCH stays sparse', () => {
    for (const operation of [
      document.paths['/api/v1/examples']?.post,
      document.paths['/api/v1/examples/{id}']?.put,
    ]) {
      const data = input(operation);
      const attributes = schema(data.properties?.attributes);
      expect(attributes.required?.sort()).toEqual(['score', 'status', 'title']);
      expect(attributes.additionalProperties).toBe(false);
      expect(attributes.properties?.score).toMatchObject({
        type: 'integer',
        minimum: 0,
        maximum: 100,
      });
      expect(attributes.properties?.title).toMatchObject({
        type: 'string',
        minLength: 1,
        maxLength: 200,
      });
      expect(attributes.properties?.description).toMatchObject({ type: ['string', 'null'] });
    }
    expect(input(document.paths['/api/v1/examples/{id}']?.put).required).toContain('id');
    expect(input(document.paths['/api/v1/examples/{id}']?.patch).required).toEqual(['type', 'id']);
    expect(input(document.paths['/api/v1/examples/{id}']?.patch).additionalProperties).toBe(false);
    expect(input(document.paths['/api/v1/examples/{id}']?.patch).anyOf).toEqual([
      { required: ['attributes'] },
      { required: ['relationships'] },
    ]);
    expect(
      schema(input(document.paths['/api/v1/examples/{id}']?.patch).properties?.attributes)
        .required ?? [],
    ).toEqual([]);
  });
  it('does not require omitted empty relationships on reference resources', () => {
    expect(schema(document.components?.schemas?.exampleTagsResource).required).not.toContain(
      'relationships',
    );
    expect(schema(document.components?.schemas?.usersResource).required).not.toContain(
      'relationships',
    );
  });
  it('derives auth limits from the runtime DTOs', () => {
    for (const path of ['/api/v1/auth/register', '/api/v1/auth/login']) {
      const attributes = schema(input(document.paths[path]?.post).properties?.attributes);
      expect(attributes.required?.sort()).toEqual(['email', 'password']);
      expect(attributes.properties?.email).toMatchObject({ format: 'email', maxLength: 254 });
      expect(attributes.properties?.password).toMatchObject({
        minLength: 12,
        maxLength: 128,
        writeOnly: true,
      });
    }
    const refresh = schema(
      input(document.paths['/api/v1/auth/refresh']?.post).properties?.attributes,
    );
    expect(refresh.properties?.refreshToken).toMatchObject({ type: 'string', minLength: 1 });
    expect(schema(refresh.properties?.refreshToken).maxLength).toBeUndefined();
  });
  it('describes typed linkage and no-content relationship mutations', () => {
    const operation = document.paths['/api/v1/examples/{id}/relationships/tags']?.patch;
    const data = input(operation);
    expect(data.type).toBe('array');
    expect(data.uniqueItems).toBe(true);
    expect(schema(data.items).properties?.type).toEqual({ type: 'string', enum: ['exampleTags'] });
    expect(operation?.responses['204']).toEqual({ description: 'No content' });
  });
  it('publishes allowlists and numeric limits for collection queries', () => {
    const parameters = document.paths['/api/v1/examples']?.get?.parameters ?? [];
    const byName = new Map(
      parameters
        .filter((parameter): parameter is ParameterObject => !('$ref' in parameter))
        .map((parameter) => [parameter.name, parameter]),
    );
    expect(byName.get('filter[score][gte]')?.schema).toMatchObject({
      type: 'integer',
      minimum: -2147483648,
      maximum: 2147483647,
    });
    expect(byName.get('filter[status][in]')?.description).toContain('draft');
    expect(byName.get('include')?.description).toContain('category');
    expect(byName.get('sort')?.description).toContain('createdAt');
    expect(byName.get('page[size]')?.description).toContain('100');
    expect(byName.has('fields[examples]')).toBe(false);
  });
  it('uses JSON:API 1.1 documents, nullable pagination links and header errors', () => {
    expect(document.openapi).toBe('3.1.0');
    const operation = document.paths['/api/v1/examples']?.get;
    const success = operation?.responses['200'];
    if (success === undefined || '$ref' in success) throw new Error('Missing success response');
    const body = schema(success.content?.[VENDOR]?.schema);
    expect(schema(body.properties?.jsonapi).properties?.version).toEqual({
      type: 'string',
      enum: ['1.1'],
    });
    expect(schema(body.properties?.links).properties?.next).toMatchObject({
      type: ['string', 'null'],
    });
    const failure = operation?.responses['406'];
    if (failure === undefined || '$ref' in failure) throw new Error('Missing error response');
    const errorBody = schema(failure.content?.[VENDOR]?.schema);
    const error = schema(schema(errorBody.properties?.errors).items);
    expect(schema(error.properties?.source).properties?.header).toEqual({ type: 'string' });
  });
});
