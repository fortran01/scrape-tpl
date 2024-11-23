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

class TPLScraper {
  private readonly RSS_URL = 'https://www.torontopubliclibrary.ca/rss.jsp?N=37867+33162+37846&Ns=p_pub_date_sort&Nso=0';
  private readonly WORK_DIR = process.env.NODE_ENV === 'production' ? '/app/data' : path.join(process.cwd(), 'data');
  private readonly transporter: nodemailer.Transporter;

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
    const response = await axios.get(this.RSS_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/xml,application/xhtml+xml,text/html,application/rss+xml'
      }
    });
    return response.data;
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

  private async sendEmail(content: string, isError: boolean = false): Promise<void> {
    const date = new Date().toISOString().split('T')[0];
    
    if (isError) {
      await this.transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: process.env.EMAIL_TO,
        subject: `TPL Scraper Error - ${date}`,
        text: 'The scraper failed to fetch the RSS feed. Please check if the URL is still valid.'
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
      await this.sendEmail('', true);
    }
  }
}

// Run the scraper
if (require.main === module) {
  const scraper = new TPLScraper();
  scraper.run().catch(console.error);
}
