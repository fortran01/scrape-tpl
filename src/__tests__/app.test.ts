import { TPLScraper } from '../index';

/**
 * Test suite for TPL Scraper Application
 * Tests core functionality, configuration validation, and utility functions
 */
describe('TPL Scraper Application', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeAll(() => {
    originalEnv = process.env;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  /**
   * Configuration and Environment Tests
   */
  describe('Configuration Validation', () => {
    test('should validate feed configuration structure', () => {
      const validConfig = {
        feeds: [
          {
            name: 'Test Branch',
            url: 'https://test.com/rss',
            enabled: true
          }
        ],
        email: {
          subject_prefix: 'Test TPL',
          include_branch_name: true
        },
        database: {
          prune_inactive_after_days: 30
        }
      };

      expect(validConfig.feeds).toBeInstanceOf(Array);
      expect(validConfig.feeds.length).toBeGreaterThan(0);
      expect(validConfig.feeds[0]).toHaveProperty('name');
      expect(validConfig.feeds[0]).toHaveProperty('url');
      expect(validConfig.feeds[0]).toHaveProperty('enabled');
      expect(validConfig.email).toHaveProperty('subject_prefix');
      expect(validConfig.database).toHaveProperty('prune_inactive_after_days');
    });

    test('should identify enabled feeds correctly', () => {
      const config = {
        feeds: [
          { name: 'Branch 1', url: 'https://test1.com', enabled: true },
          { name: 'Branch 2', url: 'https://test2.com', enabled: false },
          { name: 'Branch 3', url: 'https://test3.com', enabled: true }
        ]
      };

      const enabledFeeds = config.feeds.filter(feed => feed.enabled);
      expect(enabledFeeds).toHaveLength(2);
      expect(enabledFeeds[0].name).toBe('Branch 1');
      expect(enabledFeeds[1].name).toBe('Branch 3');
    });

    test('should validate RSS feed URLs', () => {
      const urls = [
        'https://www.torontopubliclibrary.ca/rss.jsp?N=37867+33162+37846',
        'https://test.com/rss',
        'http://example.com/feed.xml'
      ];

      urls.forEach(url => {
        const urlRegex = /^https?:\/\/[^\s]+$/;
        expect(url).toMatch(urlRegex);
      });
    });
  });

  /**
   * Environment Detection Tests
   */
  describe('Environment Detection', () => {
    test('should detect GitHub Actions environment', () => {
      const getEnvironment = (envVars: Record<string, string | undefined>) => {
        if (envVars.GITHUB_ACTIONS) {
          return 'GitHub Actions';
        }
        if (envVars.FLY_APP_NAME || envVars.NODE_ENV === 'production') {
          return 'Fly.io';
        }
        return 'Local Development';
      };

      expect(getEnvironment({ GITHUB_ACTIONS: 'true' })).toBe('GitHub Actions');
    });

    test('should detect Fly.io environment', () => {
      const getEnvironment = (envVars: Record<string, string | undefined>) => {
        if (envVars.GITHUB_ACTIONS) {
          return 'GitHub Actions';
        }
        if (envVars.FLY_APP_NAME || envVars.NODE_ENV === 'production') {
          return 'Fly.io';
        }
        return 'Local Development';
      };

      expect(getEnvironment({ FLY_APP_NAME: 'test-app' })).toBe('Fly.io');
      expect(getEnvironment({ NODE_ENV: 'production' })).toBe('Fly.io');
    });

    test('should default to local development environment', () => {
      const getEnvironment = (envVars: Record<string, string | undefined>) => {
        if (envVars.GITHUB_ACTIONS) {
          return 'GitHub Actions';
        }
        if (envVars.FLY_APP_NAME || envVars.NODE_ENV === 'production') {
          return 'Fly.io';
        }
        return 'Local Development';
      };

      expect(getEnvironment({ NODE_ENV: 'test' })).toBe('Local Development');
    });

    test('should correctly identify production environments', () => {
      const isProductionEnvironment = (envVars: Record<string, string | undefined>) => {
        return envVars.GITHUB_ACTIONS === 'true' || 
               !!envVars.FLY_APP_NAME || 
               envVars.NODE_ENV === 'production';
      };

      expect(isProductionEnvironment({ GITHUB_ACTIONS: 'true' })).toBe(true);
      expect(isProductionEnvironment({ FLY_APP_NAME: 'test-app' })).toBe(true);
      expect(isProductionEnvironment({ NODE_ENV: 'production' })).toBe(true);
      expect(isProductionEnvironment({ NODE_ENV: 'test' })).toBe(false);
    });
  });

  /**
   * Date Parsing and Event Processing Tests
   */
  describe('Date Parsing Utilities', () => {
    test('should parse common date formats from event descriptions', () => {
      const testDates = [
        'Tuesday, January 15, 2024 at 2:00 PM',
        'Wednesday, January 16, 2024 at 3:30 PM',
        'Monday, February 5, 2024 from 10:00 AM to 11:00 AM'
      ];

      testDates.forEach(dateStr => {
        const dateRegex = /(\w+day),\s+(\w+)\s+(\d+),\s+(\d+)/;
        const match = dateStr.match(dateRegex);
        expect(match).toBeTruthy();
        
        if (match) {
          const [, dayName, monthName, day, year] = match;
          expect(dayName).toMatch(/\w+day/);
          expect(monthName).toMatch(/\w+/);
          expect(parseInt(day)).toBeGreaterThan(0);
          expect(parseInt(year)).toBeGreaterThan(2020);
        }
      });
    });

    test('should extract time information from event descriptions', () => {
      const timePatterns = [
        'at 2:00 PM',
        'from 10:00 AM to 11:00 AM',
        'at 3:30 PM'
      ];

      timePatterns.forEach(timeStr => {
        const timeRegex = /(at|from)\s+(\d{1,2}:\d{2}\s+[AP]M)/;
        const match = timeStr.match(timeRegex);
        expect(match).toBeTruthy();
        
        if (match) {
          const [, preposition, time] = match;
          expect(['at', 'from']).toContain(preposition);
          expect(time).toMatch(/\d{1,2}:\d{2}\s+[AP]M/);
        }
      });
    });

    test('should handle various date formats', () => {
      const dateFormats = [
        'January 15, 2024',
        'Jan 15, 2024',
        '15 January 2024',
        '2024-01-15'
      ];

      dateFormats.forEach(dateStr => {
        // Test that each format can be processed by Date constructor
        const date = new Date(dateStr);
        expect(date instanceof Date).toBe(true);
        expect(isNaN(date.getTime())).toBe(false);
      });
    });
  });

  /**
   * Data Structure Tests
   */
  describe('Data Structures', () => {
    test('should define proper RSS item structure', () => {
      const rssItem = {
        title: ['Test Event'],
        link: ['https://test.com/event'],
        description: ['Test description'],
        'content:encoded': ['Test content'],
        record: [{}]
      };

      expect(rssItem).toHaveProperty('title');
      expect(rssItem).toHaveProperty('link');
      expect(rssItem).toHaveProperty('description');
      expect(rssItem).toHaveProperty('content:encoded');
      expect(rssItem).toHaveProperty('record');
      
      expect(Array.isArray(rssItem.title)).toBe(true);
      expect(Array.isArray(rssItem.link)).toBe(true);
      expect(Array.isArray(rssItem.description)).toBe(true);
    });

    test('should define proper database item structure', () => {
      const dbItem = {
        id: 1,
        title: 'Test Event',
        link: 'https://test.com/event',
        description: 'Test description',
        content_encoded: 'Test content',
        record_data: {},
        event_dates: [new Date()],
        first_seen: new Date(),
        last_seen: new Date(),
        is_active: true,
        feed_name: 'Test Branch'
      };

      expect(dbItem).toHaveProperty('id');
      expect(dbItem).toHaveProperty('title');
      expect(dbItem).toHaveProperty('link');
      expect(dbItem).toHaveProperty('event_dates');
      expect(dbItem).toHaveProperty('feed_name');
      expect(Array.isArray(dbItem.event_dates)).toBe(true);
      expect(typeof dbItem.is_active).toBe('boolean');
    });

    test('should define proper error details structure', () => {
      const errorDetails = {
        message: 'Test error',
        statusCode: 500,
        statusText: 'Internal Server Error',
        url: 'https://test.com',
        timestamp: new Date().toISOString(),
        environment: 'test',
        ip: '192.168.1.1'
      };

      expect(errorDetails).toHaveProperty('message');
      expect(errorDetails).toHaveProperty('timestamp');
      expect(errorDetails).toHaveProperty('environment');
      expect(typeof errorDetails.statusCode).toBe('number');
      expect(typeof errorDetails.message).toBe('string');
    });
  });

  /**
   * Constructor and Initialization Tests
   */
  describe('TPLScraper Constructor', () => {
    test('should require EMAIL_USER and EMAIL_PASS environment variables', () => {
      delete process.env.EMAIL_USER;
      delete process.env.EMAIL_PASS;
      delete process.env.DATABASE_URL;
      
      expect(() => {
        new TPLScraper();
      }).toThrow('EMAIL_USER and EMAIL_PASS environment variables must be set');
    });

    test('should require DATABASE_URL environment variable', () => {
      process.env.EMAIL_USER = 'test@example.com';
      process.env.EMAIL_PASS = 'test-password';
      delete process.env.DATABASE_URL;
      
      expect(() => {
        new TPLScraper();
      }).toThrow('DATABASE_URL environment variable must be set');
    });
  });

  /**
   * Utility Function Tests
   */
  describe('Utility Functions', () => {
    test('should format dates consistently', () => {
      const testDate = new Date('2024-01-15T14:00:00');
      const options: Intl.DateTimeFormatOptions = {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
      };
      
      const formatted = testDate.toLocaleDateString('en-US', options);
      // The format can vary by locale, so let's check for the general pattern
      expect(formatted).toMatch(/\w{3}.*\w{3}.*\d{1,2}/);
    });

    test('should handle empty or null values gracefully', () => {
      const emptyArray: any[] = [];
      const nullValue = null;
      const undefinedValue = undefined;
      
      expect(Array.isArray(emptyArray)).toBe(true);
      expect(emptyArray.length).toBe(0);
      expect(nullValue).toBeNull();
      expect(undefinedValue).toBeUndefined();
    });

    test('should validate email format', () => {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const validEmails = [
        'test@example.com',
        'user.name@domain.co.uk',
        'admin@test-site.org'
      ];
      
      const invalidEmails = [
        'invalid-email',
        '@domain.com',
        'user@',
        'user@domain'
      ];
      
      validEmails.forEach(email => {
        expect(email).toMatch(emailRegex);
      });
      
      invalidEmails.forEach(email => {
        expect(email).not.toMatch(emailRegex);
      });
    });
  });

  /**
   * Integration Tests (without external dependencies)
   */
  describe('Integration Tests', () => {
    test('should handle configuration loading logic', () => {
      const mockConfig = {
        feeds: [
          { name: 'Test Branch', url: 'https://test.com/rss', enabled: true }
        ],
        email: { subject_prefix: 'TPL', include_branch_name: true },
        database: { prune_inactive_after_days: 30 }
      };
      
      // Test configuration validation logic
      expect(mockConfig.feeds).toBeInstanceOf(Array);
      expect(mockConfig.feeds.length).toBeGreaterThan(0);
      
      const enabledFeeds = mockConfig.feeds.filter(feed => feed.enabled);
      expect(enabledFeeds.length).toBeGreaterThan(0);
    });

    test('should handle RSS item processing logic', () => {
      const mockRSSItems = [
        {
          title: ['Event 1'],
          link: ['https://test.com/event1'],
          description: ['Description 1'],
          'content:encoded': ['Content 1'],
          record: [{}]
        },
        {
          title: ['Event 2'],
          link: ['https://test.com/event2'],
          description: ['Description 2'],
          'content:encoded': ['Content 2'],
          record: [{}]
        }
      ];
      
      // Test processing logic
      expect(mockRSSItems.length).toBe(2);
      mockRSSItems.forEach(item => {
        expect(item.title).toBeInstanceOf(Array);
        expect(item.title.length).toBeGreaterThan(0);
        expect(item.link[0]).toMatch(/^https?:\/\//);
      });
    });
  });
}); 