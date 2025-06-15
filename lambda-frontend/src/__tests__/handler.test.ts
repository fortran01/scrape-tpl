import { LambdaFunctionURLEvent } from 'aws-lambda';

// Mock the handler module
jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue({
      query: jest.fn().mockResolvedValue({
        rows: [
          {
            id: 1,
            title: 'Test Event',
            link: 'https://example.com',
            description: 'Test description',
            content_encoded: '<p>Test content</p>',
            record_data: {},
            event_dates: [new Date('2024-01-15T10:00:00Z')],
            feed_name: 'Test Branch',
            first_seen: new Date('2024-01-01T00:00:00Z'),
            last_seen: new Date('2024-01-01T00:00:00Z'),
            is_active: true,
            created_at: new Date('2024-01-01T00:00:00Z'),
            updated_at: new Date('2024-01-01T00:00:00Z'),
          }
        ]
      }),
      release: jest.fn(),
    }),
  })),
}));

// Set environment variable for testing
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';

import { handler } from '../handler';

describe('Lambda Handler', () => {
  const mockEvent: LambdaFunctionURLEvent = {
    version: '2.0',
    routeKey: '$default',
    rawPath: '/',
    rawQueryString: '',
    headers: {
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-encoding': 'gzip, deflate, br',
      'accept-language': 'en-US,en;q=0.5',
      'content-length': '0',
      'host': 'lambda-url.us-east-1.on.aws',
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:88.0) Gecko/20100101 Firefox/88.0',
      'x-amzn-trace-id': 'Root=1-60c0c0c0-1234567890abcdef',
      'x-forwarded-for': '192.0.2.1',
      'x-forwarded-port': '443',
      'x-forwarded-proto': 'https'
    },
    queryStringParameters: {},
    requestContext: {
      accountId: '123456789012',
      apiId: 'lambda-url',
      domainName: 'lambda-url.us-east-1.on.aws',
      domainPrefix: 'lambda-url',
      routeKey: '$default',
      stage: '$default',
      time: '12/Mar/2020:19:03:58 +0000',
      timeEpoch: 1583348638390,
      http: {
        method: 'GET',
        path: '/',
        protocol: 'HTTP/1.1',
        sourceIp: '192.0.2.1',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:88.0) Gecko/20100101 Firefox/88.0'
      },
      requestId: 'c6af9ac6-7b61-11e6-9a41-93e8deadbeef'
    },
    isBase64Encoded: false
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return HTML response by default', async () => {
    const result = await handler(mockEvent);

    expect(result).toHaveProperty('statusCode', 200);
    expect(result).toHaveProperty('headers');
    expect((result as any).headers['Content-Type']).toBe('text/html');
    expect((result as any).body).toContain('Toronto Public Library Events');
    expect((result as any).body).toContain('Test Event');
  });

  it('should return JSON response when format=json', async () => {
    const eventWithJson = {
      ...mockEvent,
      queryStringParameters: { format: 'json' },
      rawQueryString: 'format=json'
    };

    const result = await handler(eventWithJson);

    expect(result).toHaveProperty('statusCode', 200);
    expect((result as any).headers['Content-Type']).toBe('application/json');
    
    const body = JSON.parse((result as any).body);
    expect(body).toHaveProperty('items');
    expect(body).toHaveProperty('count');
    expect(body).toHaveProperty('lastUpdated');
    expect(body.items).toHaveLength(1);
    expect(body.items[0].title).toBe('Test Event');
  });

  it('should include cache headers', async () => {
    const result = await handler(mockEvent);

    expect(result).toHaveProperty('statusCode', 200);
    expect((result as any).headers['Cache-Control']).toBe('public, max-age=300');
  });
}); 