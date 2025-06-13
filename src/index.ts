import axios from 'axios';
import * as xml2js from 'xml2js';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { Pool, PoolClient } from 'pg';

// Load environment variables from .env file
dotenv.config();

interface RSSItem {
  title: string[];
  link: string[];
  description: string[];
  'content:encoded': string[];
  record: any[];
}

interface ErrorDetails {
  message: string;
  statusCode?: number;
  statusText?: string;
  url?: string;
  timestamp: string;
  environment: string;
  ip?: string;
}

interface DBRSSItem {
  id?: number;
  title: string;
  link: string;
  description: string;
  content_encoded: string;
  record_data: any;
  event_dates: Date[];
  first_seen: Date;
  last_seen: Date;
  is_active: boolean;
}

class TPLScraper {
  private readonly RSS_URL = 'https://www.torontopubliclibrary.ca/rss.jsp?N=37867+33162+37846&Ns=p_pub_date_sort&Nso=0';
  private readonly transporter: nodemailer.Transporter;
  private readonly pool: Pool;

  private getEnvironment(): string {
    if (process.env.GITHUB_ACTIONS) {
      return 'GitHub Actions';
    }
    if (process.env.FLY_APP_NAME || process.env.NODE_ENV === 'production') {
      return 'Fly.io';
    }
    return 'Local Development';
  }

  private isProductionEnvironment(): boolean {
    return process.env.GITHUB_ACTIONS === 'true' || 
           !!process.env.FLY_APP_NAME || 
           process.env.NODE_ENV === 'production';
  }

  private async fetchPublicIP(): Promise<string | null> {
    try {
      const response = await axios.get('https://ifconfig.me/ip', {
        timeout: 10000,
        headers: {
          'User-Agent': 'TPL-Scraper/1.0'
        }
      });
      return response.data.trim();
    } catch (error) {
      console.error('Failed to fetch public IP:', error);
      return null;
    }
  }

  constructor() {
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      throw new Error('EMAIL_USER and EMAIL_PASS environment variables must be set');
    }

    // Initialize PostgreSQL connection (requires DATABASE_URL)
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable must be set');
    }

    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5, // Minimal connection pool
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    // Initialize database on startup
    this.initializeDatabase().catch(console.error);
  }

  private async initializeDatabase(): Promise<void> {
    const client = await this.pool.connect();
    try {
      // Create table if it doesn't exist
      await client.query(`
        CREATE TABLE IF NOT EXISTS rss_items (
          id SERIAL PRIMARY KEY,
          title VARCHAR(500) NOT NULL UNIQUE,
          link VARCHAR(1000) NOT NULL,
          description TEXT,
          content_encoded TEXT,
          record_data JSONB,
          event_dates TIMESTAMP WITH TIME ZONE[],
          first_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
      `);

      // Add event_dates column if it doesn't exist (for existing databases)
      await client.query(`
        ALTER TABLE rss_items 
        ADD COLUMN IF NOT EXISTS event_dates TIMESTAMP WITH TIME ZONE[];
      `);

      // Create index for performance
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_rss_items_title ON rss_items(title);
        CREATE INDEX IF NOT EXISTS idx_rss_items_active ON rss_items(is_active);
        CREATE INDEX IF NOT EXISTS idx_rss_items_last_seen ON rss_items(last_seen);
      `);

      console.log('Database initialized successfully');
    } catch (error) {
      console.error('Error initializing database:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  private async fetchRSSFeed(): Promise<string> {
    try {
      const response = await axios.get(this.RSS_URL, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/xml,application/xhtml+xml,text/html,application/rss+xml'
        },
        timeout: 30000, // 30 second timeout
        validateStatus: function (status) {
          return status < 500; // Don't throw for 4xx errors, we want to handle them
        }
      });

      if (response.status >= 400) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      return response.data;
    } catch (error) {
      // Re-throw with enhanced error information
      if (axios.isAxiosError(error)) {
        const statusCode = error.response?.status;
        const statusText = error.response?.statusText;
        const enhancedError = new Error(`Failed to fetch RSS feed: ${error.message}`);
        (enhancedError as any).statusCode = statusCode;
        (enhancedError as any).statusText = statusText;
        (enhancedError as any).url = this.RSS_URL;
        throw enhancedError;
      }
      throw error;
    }
  }

  private async getCurrentItemsFromDB(): Promise<DBRSSItem[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'SELECT * FROM rss_items WHERE is_active = TRUE ORDER BY last_seen DESC'
      );
      return result.rows;
    } finally {
      client.release();
    }
  }

  private async upsertRSSItems(items: RSSItem[]): Promise<{ newItems: string[], removedItems: string[] }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Get current active items
      const currentActiveResult = await client.query(
        'SELECT title FROM rss_items WHERE is_active = TRUE'
      );
      const currentActiveTitles = new Set(currentActiveResult.rows.map((row: any) => row.title));

      // Process new items
      const newItemTitles: string[] = [];
      const currentItemTitles = new Set<string>();

      for (const item of items) {
        // Safely extract data with fallbacks for undefined/empty arrays
        const title = item.title?.[0];
        const link = item.link?.[0];
        const description = item.description?.[0];
        const contentEncoded = item['content:encoded']?.[0];
        const recordData = item.record?.[0] ? JSON.stringify(item.record[0]) : null;
        
        // Extract event dates
        const eventDates = this.getEventDates(item);

        // Skip items with missing essential data
        if (!title || !link) {
          console.warn('Skipping item with missing title or link:', { title, link });
          continue;
        }

        currentItemTitles.add(title);

        // Check if this is a new item
        if (!currentActiveTitles.has(title)) {
          newItemTitles.push(title);
        }

        // Upsert the item
        await client.query(`
          INSERT INTO rss_items (title, link, description, content_encoded, record_data, event_dates, last_seen, is_active)
          VALUES ($1, $2, $3, $4, $5, $6, NOW(), TRUE)
          ON CONFLICT (title) 
          DO UPDATE SET 
            link = EXCLUDED.link,
            description = EXCLUDED.description,
            content_encoded = EXCLUDED.content_encoded,
            record_data = EXCLUDED.record_data,
            event_dates = EXCLUDED.event_dates,
            last_seen = NOW(),
            is_active = TRUE,
            updated_at = NOW()
        `, [title, link, description, contentEncoded, recordData, eventDates]);
      }

      // Mark items as inactive if they're no longer in the feed
      const removedItemTitles: string[] = [];
      for (const activeTitle of currentActiveTitles) {
        if (!currentItemTitles.has(activeTitle)) {
          removedItemTitles.push(activeTitle);
          await client.query(
            'UPDATE rss_items SET is_active = FALSE, updated_at = NOW() WHERE title = $1',
            [activeTitle]
          );
        }
      }

      await client.query('COMMIT');

      return { newItems: newItemTitles, removedItems: removedItemTitles };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async pruneOldData(): Promise<void> {
    const client = await this.pool.connect();
    try {
      // Keep only last 30 days of inactive items to minimize DB usage
      const result = await client.query(`
        DELETE FROM rss_items 
        WHERE is_active = FALSE 
        AND last_seen < NOW() - INTERVAL '30 days'
      `);
      
      if (result.rowCount && result.rowCount > 0) {
        console.log(`Pruned ${result.rowCount} old inactive items from database`);
      }
    } catch (error) {
      console.error('Error pruning old data:', error);
    } finally {
      client.release();
    }
  }

  private async clearDatabase(): Promise<void> {
    const client = await this.pool.connect();
    try {
      console.log('🗑️  Clearing database...');
      
      // Delete all items from the database
      const result = await client.query('DELETE FROM rss_items');
      
      console.log(`✅ Database cleared successfully. Removed ${result.rowCount || 0} items.`);
      
      // Reset the sequence to start from 1 again
      await client.query('ALTER SEQUENCE rss_items_id_seq RESTART WITH 1');
      console.log('✅ Database ID sequence reset to 1.');
      
    } catch (error) {
      console.error('❌ Error clearing database:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  private async confirmClearDatabase(): Promise<boolean> {
    // In production environments, require explicit confirmation
    if (this.isProductionEnvironment()) {
      console.log('⚠️  WARNING: You are attempting to clear the database in a production environment!');
      console.log('⚠️  This action cannot be undone and will permanently delete all stored RSS items.');
      console.log('⚠️  To proceed, you must set the environment variable CONFIRM_CLEAR_DB=true');
      
      return process.env.CONFIRM_CLEAR_DB === 'true';
    }
    
    // For local development, show warning but allow
    console.log('⚠️  WARNING: This will permanently delete all RSS items from the database.');
    console.log('⚠️  This action cannot be undone.');
    
    return true;
  }

  private formatContent(items: RSSItem[], newEvents: Set<string>, removedEvents: Set<string>): string {
    const changeSummary = [];
    if (newEvents.size > 0) {
      changeSummary.push(`<h3>🆕 New Events:</h3><ul>${Array.from(newEvents).map(title => `<li>${title}</li>`).join('')}</ul>`);
    }
    if (removedEvents.size > 0) {
      changeSummary.push(`<h3>🗑️ Removed Events:</h3><ul>${Array.from(removedEvents).map(title => `<li>${title}</li>`).join('')}</ul>`);
    }

    const eventsList = items.map(item => {
      // Safely extract data with fallbacks
      const title = item.title?.[0] || 'No Title';
      const link = item.link?.[0] || '#';
      const contentEncoded = item['content:encoded']?.[0] || '';
      
      const content = contentEncoded
        .replace(/<content:encoded><!\[CDATA\[/, '')
        .replace(/\]\]><\/content:encoded>/, '')
        .replace(/<record>.*<\/record>/, '');
      
      const isNew = newEvents.has(title);
      const badge = isNew ? '<span style="background-color: #4CAF50; color: white; padding: 2px 6px; border-radius: 3px; margin-left: 8px;">New</span>' : '';
      
      // Get and format event dates
      const eventDates = this.getEventDates(item);
      const formattedDates = this.formatEventDates(eventDates);
      
      return `<div class="item">
        <h3><a href="${link}">${title}</a>${badge}</h3>
        ${formattedDates}
        ${content}
        <div class="clearfix"></div>
      </div>`;
    }).join('\n');

    return changeSummary.length > 0 ? changeSummary.join('') + '<hr/>' + eventsList : eventsList;
  }

  private getFirstEventDate(item: RSSItem): Date {
    try {
      const record = item.record?.[0];
      if (!record || !record.attributes?.[0]?.attr) {
        return new Date();
      }
      
      const dates = record.attributes[0].attr
        .filter((a: any) => a.name?.[0] === 'p_event_date')
        .map((a: any) => a.$.name === 'p_event_date' ? new Date(a._) : null)
        .filter((d: Date | null) => d !== null);
      
      return dates.length > 0 ? dates[0] : new Date();
    } catch (error) {
      console.error('Error parsing date:', error);
      return new Date();
    }
  }

  private getEventDates(item: RSSItem): Date[] {
    try {
      const record = item.record?.[0];
      if (!record || !record.attributes?.[0]?.attr) {
        return [];
      }
      
      const dates = record.attributes[0].attr
        .filter((a: any) => a.name?.[0] === 'p_event_date')
        .map((a: any) => {
          try {
            // Handle different possible date formats in the RSS data
            const dateValue = a._ || a.$?.value || a.value?.[0];
            if (dateValue) {
              const parsedDate = new Date(dateValue);
              return isNaN(parsedDate.getTime()) ? null : parsedDate;
            }
            return null;
          } catch (dateError) {
            console.warn('Error parsing individual date:', dateError);
            return null;
          }
        })
        .filter((d: Date | null) => d !== null)
        .sort((a: Date, b: Date) => a.getTime() - b.getTime()); // Sort dates chronologically
      
      return dates as Date[];
    } catch (error) {
      console.error('Error parsing event dates:', error);
      return [];
    }
  }

  private formatEventDates(dates: Date[]): string {
    if (dates.length === 0) {
      return '';
    }

    const formatDate = (date: Date): string => {
      return date.toLocaleDateString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    };

    const formatTime = (date: Date): string => {
      return date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
    };

    if (dates.length === 1) {
      const date = dates[0];
      const dateStr = formatDate(date);
      const timeStr = formatTime(date);
      return `<div class="event-date">📅 ${dateStr} at ${timeStr}</div>`;
    } else {
      // Multiple dates - show them as a list
      const datesList = dates.map(date => {
        const dateStr = formatDate(date);
        const timeStr = formatTime(date);
        return `<li>${dateStr} at ${timeStr}</li>`;
      }).join('');
      
      return `<div class="event-dates">
        <div class="event-dates-label">📅 Event Dates:</div>
        <ul class="event-dates-list">${datesList}</ul>
      </div>`;
    }
  }

  private async sendEmail(content: string, errorDetails?: ErrorDetails): Promise<void> {
    const date = new Date().toISOString().split('T')[0];
    
    if (errorDetails) {
      const errorHtml = `
      <!DOCTYPE html>
      <html>
      <head>
          <style>
              body { font-family: Arial, sans-serif; margin: 20px; background-color: #f5f5f5; }
              .error-container { 
                  background-color: white; 
                  padding: 20px; 
                  border-radius: 8px; 
                  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                  max-width: 800px;
              }
              .error-header { 
                  color: #d32f2f; 
                  border-bottom: 2px solid #d32f2f; 
                  padding-bottom: 10px; 
                  margin-bottom: 20px;
              }
              .error-details { 
                  background-color: #fff3e0; 
                  padding: 15px; 
                  border-radius: 4px; 
                  margin: 15px 0;
                  border-left: 4px solid #ff9800;
              }
              .detail-row { 
                  margin: 8px 0; 
                  display: flex; 
                  align-items: center;
              }
              .detail-label { 
                  font-weight: bold; 
                  min-width: 120px; 
                  color: #333;
              }
              .detail-value { 
                  color: #666; 
                  font-family: monospace;
                  background-color: #f5f5f5;
                  padding: 2px 6px;
                  border-radius: 3px;
              }
              .status-error { color: #d32f2f; font-weight: bold; }
              .environment-badge {
                  display: inline-block;
                  padding: 4px 8px;
                  border-radius: 12px;
                  font-size: 12px;
                  font-weight: bold;
                  color: white;
              }
              .env-github { background-color: #24292e; }
              .env-flyio { background-color: #8b5cf6; }
              .env-local { background-color: #666; }
          </style>
      </head>
      <body>
          <div class="error-container">
              <h2 class="error-header">🚨 TPL Scraper Error Report</h2>
              
              <div class="error-details">
                  <div class="detail-row">
                      <span class="detail-label">Environment:</span>
                      <span class="environment-badge ${errorDetails.environment === 'GitHub Actions' ? 'env-github' : 
                                                       errorDetails.environment === 'Fly.io' ? 'env-flyio' : 'env-local'}">
                          ${errorDetails.environment}
                      </span>
                  </div>
                  
                  <div class="detail-row">
                      <span class="detail-label">Timestamp:</span>
                      <span class="detail-value">${errorDetails.timestamp}</span>
                  </div>
                  
                  ${errorDetails.ip ? `
                  <div class="detail-row">
                      <span class="detail-label">Public IP:</span>
                      <span class="detail-value">${errorDetails.ip}</span>
                  </div>
                  ` : ''}
                  
                  ${errorDetails.url ? `
                  <div class="detail-row">
                      <span class="detail-label">Target URL:</span>
                      <span class="detail-value">${errorDetails.url}</span>
                  </div>
                  ` : ''}
                  
                  ${errorDetails.statusCode ? `
                  <div class="detail-row">
                      <span class="detail-label">HTTP Status:</span>
                      <span class="detail-value status-error">${errorDetails.statusCode} ${errorDetails.statusText || ''}</span>
                  </div>
                  ` : ''}
                  
                  <div class="detail-row">
                      <span class="detail-label">Error Message:</span>
                      <span class="detail-value">${errorDetails.message}</span>
                  </div>
              </div>
              
              <p><strong>Next Steps:</strong></p>
              <ul>
                  <li>Check if the TPL RSS feed URL is still accessible: <a href="${this.RSS_URL}">${this.RSS_URL}</a></li>
                  <li>Verify network connectivity from the ${errorDetails.environment} environment</li>
                  <li>Check database connectivity and credentials</li>
                  ${errorDetails.statusCode && errorDetails.statusCode >= 500 ? 
                    '<li>This appears to be a server-side error. The issue may resolve automatically.</li>' : ''}
                  ${errorDetails.statusCode && errorDetails.statusCode >= 400 && errorDetails.statusCode < 500 ? 
                    '<li>This appears to be a client-side error. The URL or request format may need updating.</li>' : ''}
                  <li>Monitor subsequent runs to see if this is a persistent issue</li>
              </ul>
          </div>
      </body>
      </html>`;

      await this.transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: process.env.EMAIL_TO,
        subject: `🚨 TPL Scraper Error [${errorDetails.environment}] - ${date}`,
        html: errorHtml
      });
      return;
    }

    const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            .item { 
                margin-bottom: 20px; 
                padding: 15px;
                border-bottom: 1px solid #eee;
                clear: both;
            }
            .item img { 
                float: left;
                margin-right: 15px;
                margin-bottom: 10px;
                max-width: 150px;
            }
            .item h3 { 
                color: #2B4C7E;
                margin-top: 0;
            }
            .item table { 
                border-collapse: collapse;
            }
            .item td {
                padding: 8px;
                vertical-align: top;
            }
            .clearfix::after {
                content: '';
                clear: both;
                display: table;
            }
            .event-date {
                background-color: #f0f8ff;
                border-left: 4px solid #2B4C7E;
                padding: 8px 12px;
                margin: 10px 0;
                font-weight: bold;
                color: #2B4C7E;
                border-radius: 4px;
            }
            .event-dates {
                background-color: #f0f8ff;
                border-left: 4px solid #2B4C7E;
                padding: 8px 12px;
                margin: 10px 0;
                border-radius: 4px;
            }
            .event-dates-label {
                font-weight: bold;
                color: #2B4C7E;
                margin-bottom: 5px;
            }
            .event-dates-list {
                margin: 0;
                padding-left: 20px;
                color: #2B4C7E;
            }
            .event-dates-list li {
                margin: 3px 0;
            }
        </style>
    </head>
    <body>
    <h2>Toronto Public Library - New Items (${date})</h2>
    <div class='results'>
    ${content}
    </div>
    </body>
    </html>`;

    await this.transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_TO,
      subject: `TPL New Items - ${date}`,
      html: htmlContent
    });
  }

  public async run(clearDb: boolean = false): Promise<void> {
    try {
      console.log('Starting TPL Scraper with PostgreSQL backend...');
      
      // Initialize database first
      await this.initializeDatabase();
      
      // Handle clear database command
      if (clearDb) {
        const confirmed = await this.confirmClearDatabase();
        if (confirmed) {
          await this.clearDatabase();
          console.log('✅ Database cleared successfully. Exiting...');
          return;
        } else {
          console.log('❌ Database clear operation cancelled.');
          return;
        }
      }
      
      // Prune old data to keep DB minimal
      await this.pruneOldData();

      const rssContent = await this.fetchRSSFeed();

      if (rssContent) {
        const parser = new xml2js.Parser();
        const currentResult = await parser.parseStringPromise(rssContent);
        const currentItems: RSSItem[] = currentResult.rss.channel[0].item;
        
        // Get current items from database and update with new feed data
        const { newItems, removedItems } = await this.upsertRSSItems(currentItems);

        const newEvents = new Set(newItems);
        const removedEvents = new Set(removedItems);

        // Check if this is the first run (no previous data)
        const dbItems = await this.getCurrentItemsFromDB();
        const isFirstRun = dbItems.length === currentItems.length && newItems.length === currentItems.length;

        if (newEvents.size > 0 || removedEvents.size > 0) {
          console.log(`Changes detected - New: ${newEvents.size}, Removed: ${removedEvents.size}`);
          const formattedContent = this.formatContent(currentItems, newEvents, removedEvents);
          await this.sendEmail(formattedContent);
        } else if (isFirstRun) {
          console.log('First run detected - sending initial email with all items');
          const formattedContent = this.formatContent(currentItems, new Set(), new Set());
          await this.sendEmail(formattedContent);
        } else {
          console.log('No changes detected');
        }
      } else {
        throw new Error('Empty RSS content received');
      }
    } catch (error) {
      console.error('Error:', error);
      
      // Enhanced error handling for production environments
      if (this.isProductionEnvironment()) {
        const errorDetails: ErrorDetails = {
          message: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString(),
          environment: this.getEnvironment()
        };

        // Add HTTP status information if available
        if (error && typeof error === 'object' && 'statusCode' in error) {
          errorDetails.statusCode = (error as any).statusCode;
          errorDetails.statusText = (error as any).statusText;
          errorDetails.url = (error as any).url;
        }

        // Fetch public IP for diagnostic purposes
        try {
          const ip = await this.fetchPublicIP();
          if (ip) {
            errorDetails.ip = ip;
          }
        } catch (ipError) {
          console.error('Failed to fetch IP for error report:', ipError);
        }

        await this.sendEmail('', errorDetails);
      } else {
        // For local development, use the simple error email
        await this.sendEmail('', {
          message: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString(),
          environment: this.getEnvironment()
        });
      }
    } finally {
      // Close database connections
      await this.pool.end();
    }
  }
}

// Run the scraper
if (require.main === module) {
  // Parse command line arguments
  const args = process.argv.slice(2);
  const clearDb = args.includes('--clear-db') || args.includes('--clear');
  const showHelp = args.includes('--help') || args.includes('-h');
  
  if (showHelp) {
    console.log('TPL Scraper - Toronto Public Library RSS Feed Monitor');
    console.log('================================================');
    console.log('');
    console.log('Usage:');
    console.log('  npm start                    Run the scraper normally');
    console.log('  npm run dev                  Run in development mode');
    console.log('  npm run clear-db             Clear database with safety checks');
    console.log('');
    console.log('Command line options:');
    console.log('  --clear-db, --clear          Clear all data from database');
    console.log('  --help, -h                   Show this help message');
    console.log('');
    console.log('Environment variables:');
    console.log('  EMAIL_USER                   Gmail address for sending notifications');
    console.log('  EMAIL_PASS                   Gmail app password');
    console.log('  EMAIL_TO                     Recipient email address');
    console.log('  DATABASE_URL                 PostgreSQL connection string');
    console.log('  CONFIRM_CLEAR_DB             Set to "true" to allow clearing in production');
    console.log('');
    process.exit(0);
  }
  
  const scraper = new TPLScraper();
  
  if (clearDb) {
    console.log('🗑️  Clear database mode activated');
  }
  
  scraper.run(clearDb).catch(console.error);
}
