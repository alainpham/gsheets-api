export const spec = {
  openapi: '3.0.0',
  info: {
    title: 'Google Sheets REST API',
    version: '1.0.0',
    description: 'Query rows from a Google Sheet.',
  },
  servers: [{ url: 'http://localhost:8080' }],
  paths: {
    '/rows': {
      get: {
        summary: 'Get all rows',
        description: 'Returns all rows as JSON objects. The first sheet row is treated as headers.',
        parameters: [
          {
            name: 'range',
            in: 'query',
            description: 'A1 notation range (e.g. Sheet1!A1:D100). Defaults to the configured RANGE env var.',
            required: false,
            schema: { type: 'string', example: 'Sheet1!A1:Z1000' },
          },
        ],
        responses: {
          200: {
            description: 'Rows retrieved successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    headers: { type: 'array', items: { type: 'string' }, example: ['Name', 'Age', 'City'] },
                    total: { type: 'integer', example: 2 },
                    rows: {
                      type: 'array',
                      items: { type: 'object', additionalProperties: { type: 'string' } },
                      example: [
                        { Name: 'Alice', Age: '30', City: 'Paris' },
                        { Name: 'Bob', Age: '25', City: 'Lyon' },
                      ],
                    },
                  },
                },
              },
            },
          },
          500: { $ref: '#/components/responses/InternalError' },
        },
      },
    },
    '/rows/{index}': {
      parameters: [
        {
          name: 'index',
          in: 'path',
          required: true,
          description: '0-based row index (not counting the header row)',
          schema: { type: 'integer', minimum: 0, example: 0 },
        },
      ],
      get: {
        summary: 'Get a row by index',
        responses: {
          200: {
            description: 'Row retrieved successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    index: { type: 'integer', example: 0 },
                    row: {
                      type: 'object',
                      additionalProperties: { type: 'string' },
                      example: { Name: 'Alice', Age: '30', City: 'Paris' },
                    },
                  },
                },
              },
            },
          },
          400: { $ref: '#/components/responses/BadRequest' },
          404: { $ref: '#/components/responses/NotFound' },
          500: { $ref: '#/components/responses/InternalError' },
        },
      },
    },
  },
  components: {
    responses: {
      BadRequest: {
        description: 'Invalid request',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
          },
        },
      },
      NotFound: {
        description: 'Row not found',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
          },
        },
      },
      InternalError: {
        description: 'Internal server error',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Error' },
          },
        },
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string', example: 'Something went wrong' },
        },
      },
    },
  },
};
