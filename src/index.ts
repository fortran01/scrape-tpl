import axios from 'axios';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as xml2js from 'xml2js';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';

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

class TPLScraper {
  private readonly RSS_URL = 'https://www.torontopubliclibrary.ca/rss.jsp?N=37867+33162+37846&Ns=p_pub_date_sort&Nso=0';
  private readonly WORK_DIR = this.getWorkDir();
  private readonly transporter: nodemailer.Transporter;

  private getWorkDir(): string {
    // If running in GitHub Actions, use relative data directory
    if (process.env.GITHUB_ACTIONS) {
      return path.join(process.cwd(), 'data');
    }
    // If running in Docker (production), use /app/data
    if (process.env.NODE_ENV === 'production') {
      return '/app/data';
    }
    // Default for local development
    return path.join(process.cwd(), 'data');
  }

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
    // Check if work directory exists and is writable
    this.checkWorkDir();
    
    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      throw new Error('EMAIL_USER and EMAIL_PASS environment variables must be set');
    }

    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });
  }

  private async checkWorkDir() {
    try {
      await fs.access(this.WORK_DIR, fs.constants.W_OK);
      console.log(`Work directory ${this.WORK_DIR} is accessible and writable`);
      
      // List contents of work directory
      const files = await fs.readdir(this.WORK_DIR);
      console.log('Contents of work directory:', files);
      
      // If previous_output.xml exists, show its stats
      if (files.includes('previous_output.xml')) {
        const stats = await fs.stat(path.join(this.WORK_DIR, 'previous_output.xml'));
        console.log('previous_output.xml stats:', {
          size: stats.size,
          modified: stats.mtime,
          created: stats.birthtime
        });
      } else {
        console.log('No previous_output.xml found in work directory');
      }
    } catch (error) {
      console.error(`Error accessing work directory ${this.WORK_DIR}:`, error);
      throw new Error(`Work directory ${this.WORK_DIR} is not accessible or writable. Volume might not be mounted correctly.`);
    }
  }

  private async ensureWorkDir(): Promise<void> {
    try {
      await fs.access(this.WORK_DIR);
    } catch {
      await fs.mkdir(this.WORK_DIR, { recursive: true });
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

  private formatContent(items: RSSItem[], newEvents: Set<string>, removedEvents: Set<string>): string {
    const changeSummary = [];
    if (newEvents.size > 0) {
      changeSummary.push(`<h3>🆕 New Events:</h3><ul>${Array.from(newEvents).map(title => `<li>${title}</li>`).join('')}</ul>`);
    }
    if (removedEvents.size > 0) {
      changeSummary.push(`<h3>🗑️ Removed Events:</h3><ul>${Array.from(removedEvents).map(title => `<li>${title}</li>`).join('')}</ul>`);
    }

    const eventsList = items.map(item => {
      const content = item['content:encoded'][0]
        .replace(/<content:encoded><!\[CDATA\[/, '')
        .replace(/\]\]><\/content:encoded>/, '')
        .replace(/<record>.*<\/record>/, '');
      
      const isNew = newEvents.has(item.title[0]);
      const badge = isNew ? '<span style="background-color: #4CAF50; color: white; padding: 2px 6px; border-radius: 3px; margin-left: 8px;">New</span>' : '';
      
      return `<div class="item">
        <h3><a href="${item.link[0]}">${item.title[0]}</a>${badge}</h3>
        ${content}
        <div class="clearfix"></div>
      </div>`;
    }).join('\n');

    return changeSummary.length > 0 ? changeSummary.join('') + '<hr/>' + eventsList : eventsList;
  }

  private getFirstEventDate(item: RSSItem): Date {
    try {
      const record = item.record[0];
      const dates = record.attributes[0].attr
        .filter((a: any) => a.name[0] === 'p_event_date')
        .map((a: any) => a.$.name === 'p_event_date' ? new Date(a._) : null)
        .filter((d: Date | null) => d !== null);
      
      return dates.length > 0 ? dates[0] : new Date();
    } catch (error) {
      console.error('Error parsing date:', error);
      return new Date();
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

  public async run(): Promise<void> {
    try {
      await this.ensureWorkDir();
      
      const currentFile = path.join(this.WORK_DIR, 'current_output.xml');
      const previousFile = path.join(this.WORK_DIR, 'previous_output.xml');

      const rssContent = await this.fetchRSSFeed();
      await fs.writeFile(currentFile, rssContent);

      if (rssContent) {
        const parser = new xml2js.Parser();
        const currentResult = await parser.parseStringPromise(rssContent);
        const currentItems = currentResult.rss.channel[0].item;
        
        let previousItems: RSSItem[] = [];
        try {
          const previousContent = await fs.readFile(previousFile, 'utf-8');
          const previousResult = await parser.parseStringPromise(previousContent);
          previousItems = previousResult.rss.channel[0].item;
        } catch {
          // Previous file doesn't exist, that's okay
        }

        // Compare events by title to detect changes
        const currentTitles = new Set(currentItems.map((item: RSSItem) => item.title[0]));
        const previousTitles = new Set(previousItems.map((item: RSSItem) => item.title[0]));

        const newEvents = new Set<string>(currentItems
          .filter((item: RSSItem) => !previousTitles.has(item.title[0]))
          .map((item: RSSItem) => item.title[0]));
          
        const removedEvents = new Set<string>(previousItems
          .filter((item: RSSItem) => !currentTitles.has(item.title[0]))
          .map((item: RSSItem) => item.title[0]));

        if (newEvents.size > 0 || removedEvents.size > 0 || previousItems.length === 0) {
          console.log('Changes detected - sending email...');
          const formattedContent = this.formatContent(currentItems, newEvents, removedEvents);
          await this.sendEmail(formattedContent);
          await fs.rename(currentFile, previousFile);
        } else {
          console.log('No changes detected');
          await fs.unlink(currentFile);
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
    }
  }
}

// Run the scraper
if (require.main === module) {
  const scraper = new TPLScraper();
  scraper.run().catch(console.error);
}
