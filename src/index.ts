import axios from 'axios';
import * as xml2js from 'xml2js';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { Pool, PoolClient } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

// Load environment variables from .env file
dotenv.config();

interface RSSItem {
  title: string[];
  link: string[];
  description: string[];
  'content:encoded': string[];
  record: any[];
}

interface RSSItemWithFeed extends RSSItem {
  feedName: string;
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

interface FeedConfig {
  name: string;
  url: string;
  enabled: boolean;
}

interface Config {
  feeds: FeedConfig[];
  email: {
    subject_prefix: string;
    include_branch_name: boolean;
  };
  database: {
    prune_inactive_after_days: number;
  };
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
  feed_name: string;
}

class TPLScraper {
  private readonly transporter: nodemailer.Transporter;
  private readonly pool: Pool;
  private readonly config: Config;

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

  private loadConfig(): Config {
    const configPath = path.join(process.cwd(), 'config.json');
    
    if (!fs.existsSync(configPath)) {
      throw new Error(`Configuration file not found at ${configPath}. Please create it based on config.example.json`);
    }

    try {
      const configContent = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(configContent) as Config;
      
      // Validate configuration
      if (!config.feeds || !Array.isArray(config.feeds) || config.feeds.length === 0) {
        throw new Error('Configuration must contain at least one feed');
      }

      const enabledFeeds = config.feeds.filter(feed => feed.enabled);
      if (enabledFeeds.length === 0) {
        throw new Error('At least one feed must be enabled');
      }

      console.log(`Loaded configuration with ${config.feeds.length} feeds (${enabledFeeds.length} enabled)`);
      return config;
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(`Invalid JSON in configuration file: ${error.message}`);
      }
      throw error;
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

    // Load configuration
    this.config = this.loadConfig();

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
          title VARCHAR(500) NOT NULL,
          link VARCHAR(1000) NOT NULL,
          description TEXT,
          content_encoded TEXT,
          record_data JSONB,
          event_dates TIMESTAMP WITH TIME ZONE[],
          feed_name VARCHAR(100) NOT NULL,
          first_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          UNIQUE(title, feed_name)
        );
      `);

      // Add event_dates column if it doesn't exist (for existing databases)
      await client.query(`
        ALTER TABLE rss_items 
        ADD COLUMN IF NOT EXISTS event_dates TIMESTAMP WITH TIME ZONE[];
      `);

      // Add feed_name column if it doesn't exist (for existing databases)
      await client.query(`
        ALTER TABLE rss_items 
        ADD COLUMN IF NOT EXISTS feed_name VARCHAR(100) DEFAULT 'Parkdale Branch';
      `);

      // Update existing records to have feed_name if they don't
      await client.query(`
        UPDATE rss_items 
        SET feed_name = 'Parkdale Branch' 
        WHERE feed_name IS NULL OR feed_name = '';
      `);

      // Drop the old unique constraint if it exists and create the new one
      await client.query(`
        ALTER TABLE rss_items 
        DROP CONSTRAINT IF EXISTS rss_items_title_key;
      `);

      // Add the new unique constraint if it doesn't exist
      await client.query(`
        DO $$ 
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint 
            WHERE conname = 'rss_items_title_feed_name_key'
          ) THEN
            ALTER TABLE rss_items 
            ADD CONSTRAINT rss_items_title_feed_name_key UNIQUE (title, feed_name);
          END IF;
        END $$;
      `);

      // Create index for performance
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_rss_items_title_feed ON rss_items(title, feed_name);
        CREATE INDEX IF NOT EXISTS idx_rss_items_active ON rss_items(is_active);
        CREATE INDEX IF NOT EXISTS idx_rss_items_last_seen ON rss_items(last_seen);
        CREATE INDEX IF NOT EXISTS idx_rss_items_feed_name ON rss_items(feed_name);
      `);

      console.log('Database initialized successfully');
    } catch (error) {
      console.error('Error initializing database:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  private async fetchRSSFeed(url: string): Promise<string> {
    try {
      const response = await axios.get(url, {
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
        (enhancedError as any).url = url;
        throw enhancedError;
      }
      throw error;
    }
  }

  private async fetchAllRSSItems(baseUrl: string): Promise<RSSItem[]> {
    const allItems: RSSItem[] = [];
    let pageOffset = 0;
    const pageSize = 10; // TPL RSS feeds return 10 items per page
    
    try {
      while (true) {
        // Construct URL with pagination
        const url = pageOffset === 0 ? baseUrl : `${baseUrl}&No=${pageOffset}`;
        console.log(`  Fetching page ${Math.floor(pageOffset / pageSize) + 1} (offset ${pageOffset})`);
        
        const rssContent = await this.fetchRSSFeed(url);
        
        if (!rssContent) {
          console.warn(`  Empty RSS content received for offset ${pageOffset}`);
          break;
        }

        const parser = new xml2js.Parser();
        const result = await parser.parseStringPromise(rssContent);
        
        if (!result.rss || !result.rss.channel || !result.rss.channel[0] || !result.rss.channel[0].item) {
          console.warn(`  No items found in RSS structure for offset ${pageOffset}`);
          break;
        }

        const pageItems: RSSItem[] = result.rss.channel[0].item;
        
        if (pageItems.length === 0) {
          console.log(`  No more items found at offset ${pageOffset}`);
          break;
        }

        console.log(`  Found ${pageItems.length} items on this page`);
        allItems.push(...pageItems);
        
        // If we got fewer items than the page size, we've reached the end
        if (pageItems.length < pageSize) {
          console.log(`  Reached end of results (got ${pageItems.length} < ${pageSize})`);
          break;
        }
        
        pageOffset += pageSize;
        
        // Safety check to prevent infinite loops
        if (pageOffset > 1000) {
          console.warn(`  Safety limit reached at offset ${pageOffset}, stopping pagination`);
          break;
        }
      }
      
      console.log(`  Total items collected: ${allItems.length}`);
      return allItems;
      
    } catch (error) {
      console.error(`  Error during pagination at offset ${pageOffset}:`, error);
      // Return what we have so far
      return allItems;
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

  private async upsertRSSItems(items: RSSItem[], feedName: string): Promise<{ newItems: string[], removedItems: string[] }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Get current active items for this feed
      const currentActiveResult = await client.query(
        'SELECT title FROM rss_items WHERE is_active = TRUE AND feed_name = $1',
        [feedName]
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
          INSERT INTO rss_items (title, link, description, content_encoded, record_data, event_dates, feed_name, last_seen, is_active)
          VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), TRUE)
          ON CONFLICT (title, feed_name) 
          DO UPDATE SET 
            link = EXCLUDED.link,
            description = EXCLUDED.description,
            content_encoded = EXCLUDED.content_encoded,
            record_data = EXCLUDED.record_data,
            event_dates = EXCLUDED.event_dates,
            last_seen = NOW(),
            is_active = TRUE,
            updated_at = NOW()
        `, [title, link, description, contentEncoded, recordData, eventDates, feedName]);
      }

      // Mark items as inactive if they're no longer in the feed
      const removedItemTitles: string[] = [];
      for (const activeTitle of currentActiveTitles) {
        if (!currentItemTitles.has(activeTitle)) {
          removedItemTitles.push(activeTitle);
          await client.query(
            'UPDATE rss_items SET is_active = FALSE, updated_at = NOW() WHERE title = $1 AND feed_name = $2',
            [activeTitle, feedName]
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
      // Keep only last N days of inactive items to minimize DB usage
      const pruneDays = this.config.database.prune_inactive_after_days;
      const result = await client.query(`
        DELETE FROM rss_items 
        WHERE is_active = FALSE 
        AND last_seen < NOW() - INTERVAL '${pruneDays} days'
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

  private formatContent(items: RSSItemWithFeed[], newEvents: Set<string>, removedEvents: Set<string>): string {
    // Create a mapping from event title to branch name for new/removed events
    const titleToBranchMap = new Map<string, string>();
    items.forEach(item => {
      const title = item.title?.[0] || 'No Title';
      titleToBranchMap.set(title, item.feedName);
    });

    const changeSummary = [];
    if (newEvents.size > 0) {
      // Group new events by branch
      const eventsByBranch = new Map<string, string[]>();
      Array.from(newEvents).forEach(title => {
        const branch = titleToBranchMap.get(title) || 'Unknown Branch';
        if (!eventsByBranch.has(branch)) {
          eventsByBranch.set(branch, []);
        }
        eventsByBranch.get(branch)!.push(title);
      });

      // Create grouped HTML
      const branchSections = Array.from(eventsByBranch.entries()).map(([branch, titles]) => {
        const eventsList = titles.map(title => `<li>${title}</li>`).join('');
        return `<h4 style="color: #2B4C7E; margin: 15px 0 8px 0; font-size: 1.1em;">📍 ${branch}</h4><ul style="margin-top: 5px;">${eventsList}</ul>`;
      });
      
      changeSummary.push(`<h3>🆕 New Events:</h3>${branchSections.join('')}`);
    }
    if (removedEvents.size > 0) {
      // Group removed events by branch
      const eventsByBranch = new Map<string, string[]>();
      Array.from(removedEvents).forEach(title => {
        const branch = titleToBranchMap.get(title) || 'Unknown Branch';
        if (!eventsByBranch.has(branch)) {
          eventsByBranch.set(branch, []);
        }
        eventsByBranch.get(branch)!.push(title);
      });

      // Create grouped HTML
      const branchSections = Array.from(eventsByBranch.entries()).map(([branch, titles]) => {
        const eventsList = titles.map(title => `<li>${title}</li>`).join('');
        return `<h4 style="color: #2B4C7E; margin: 15px 0 8px 0; font-size: 1.1em;">📍 ${branch}</h4><ul style="margin-top: 5px;">${eventsList}</ul>`;
      });
      
      changeSummary.push(`<h3>🗑️ Removed Events:</h3>${branchSections.join('')}`);
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
      const feedBadge = `<span style="background-color: #2B4C7E; color: white; padding: 2px 6px; border-radius: 3px; margin-left: 8px; font-size: 0.8em;">${item.feedName}</span>`;
      
      // Get and format event dates
      const eventDates = this.getEventDates(item);
      const formattedDates = this.formatEventDates(eventDates);
      
      return `<div class="item">
        <h3><a href="${link}">${title}</a>${badge}${feedBadge}</h3>
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
      
      // Get event dates, start times, and end times
      const eventDates: string[] = [];
      const eventStartTimes: string[] = [];
      const eventEndTimes: string[] = [];
      
      record.attributes[0].attr.forEach((attr: any) => {
        if (attr.$.name === 'p_event_date') {
          eventDates.push(attr._);
        } else if (attr.$.name === 'p_event_time') {
          eventStartTimes.push(attr._);
        } else if (attr.$.name === 'p_event_endtime') {
          eventEndTimes.push(attr._);
        }
      });
      
      // Create date objects with start times (we'll use these for sorting and the main date display)
      const dates: Date[] = [];
      
      if (eventDates.length > 0) {
        eventDates.forEach((dateStr, index) => {
          try {
            let fullDateTimeStr = dateStr;
            
            // If we have a corresponding start time, add it to the date
            if (eventStartTimes.length > 0) {
              const timeStr = eventStartTimes[index] || eventStartTimes[0]; // Use first time if not enough times
              fullDateTimeStr = `${dateStr}T${timeStr}:00`;
            }
            
            const parsedDate = new Date(fullDateTimeStr);
            if (!isNaN(parsedDate.getTime())) {
              // Store the end time as a property on the date object for later use
              if (eventEndTimes.length > 0) {
                const endTime = eventEndTimes[index] || eventEndTimes[0];
                (parsedDate as any).endTime = endTime;
              }
              dates.push(parsedDate);
            }
          } catch (dateError) {
            console.warn('Error parsing date:', dateStr, dateError);
          }
        });
      }
      
      return dates.sort((a: Date, b: Date) => a.getTime() - b.getTime());
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

    const formatTimeRange = (date: Date): string => {
      const startTime = formatTime(date);
      const endTime = (date as any).endTime;
      
      if (endTime) {
        // Parse the end time and format it
        const endDate = new Date(date);
        const [hours, minutes] = endTime.split(':');
        endDate.setHours(parseInt(hours), parseInt(minutes));
        const endTimeFormatted = formatTime(endDate);
        return `${startTime} - ${endTimeFormatted}`;
      }
      
      return startTime;
    };

    if (dates.length === 1) {
      const date = dates[0];
      const dateStr = formatDate(date);
      const timeStr = formatTimeRange(date);
      return `<div class="event-date">📅 ${dateStr} at ${timeStr}</div>`;
    } else {
      // Multiple dates - show them as a list
      const datesList = dates.map(date => {
        const dateStr = formatDate(date);
        const timeStr = formatTimeRange(date);
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
                  <li>Check if the TPL RSS feed URLs are still accessible</li>
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

    const subject = this.config.email.include_branch_name 
      ? `${this.config.email.subject_prefix} - Multiple Branches - ${date}`
      : `${this.config.email.subject_prefix} - ${date}`;

    await this.transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: process.env.EMAIL_TO,
      subject: subject,
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

      // Process each enabled feed
      const enabledFeeds = this.config.feeds.filter(feed => feed.enabled);
      const allNewEvents = new Set<string>();
      const allRemovedEvents = new Set<string>();
      const allCurrentItems: RSSItemWithFeed[] = [];

      for (const feed of enabledFeeds) {
        console.log(`Processing feed: ${feed.name}`);
        
        try {
          // Use the new pagination method to fetch all items
          const currentItems: RSSItem[] = await this.fetchAllRSSItems(feed.url);
          
          if (currentItems.length > 0) {
            // Get current items from database and update with new feed data
            const { newItems, removedItems } = await this.upsertRSSItems(currentItems, feed.name);

            // Add to overall tracking
            newItems.forEach(item => allNewEvents.add(item));
            removedItems.forEach(item => allRemovedEvents.add(item));
            
            // Add feed name to items for display
            const itemsWithFeed: RSSItemWithFeed[] = currentItems.map(item => ({
              ...item,
              feedName: feed.name
            }));
            allCurrentItems.push(...itemsWithFeed);

            console.log(`Feed ${feed.name}: ${newItems.length} new, ${removedItems.length} removed`);
          } else {
            console.warn(`No items found for feed: ${feed.name}`);
          }
        } catch (feedError) {
          console.error(`Error processing feed ${feed.name}:`, feedError);
          // Continue with other feeds even if one fails
        }
      }

      // Check if this is the first run (no previous data)
      const dbItems = await this.getCurrentItemsFromDB();
      const isFirstRun = dbItems.length === allCurrentItems.length && allNewEvents.size === allCurrentItems.length;

      if (allNewEvents.size > 0 || allRemovedEvents.size > 0) {
        console.log(`Overall changes detected - New: ${allNewEvents.size}, Removed: ${allRemovedEvents.size}`);
        const formattedContent = this.formatContent(allCurrentItems, allNewEvents, allRemovedEvents);
        await this.sendEmail(formattedContent);
      } else if (isFirstRun) {
        console.log('First run detected - sending initial email with all items');
        const formattedContent = this.formatContent(allCurrentItems, new Set(), new Set());
        await this.sendEmail(formattedContent);
      } else {
        console.log('No changes detected across all feeds');
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
    console.log('Configuration:');
    console.log('  config.json                  JSON file defining RSS feeds and settings');
    console.log('  config.example.json          Example configuration file');
    console.log('');
    process.exit(0);
  }
  
  const scraper = new TPLScraper();
  
  if (clearDb) {
    console.log('🗑️  Clear database mode activated');
  }
  
  scraper.run(clearDb).catch(console.error);
}
