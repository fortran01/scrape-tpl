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
}

class TPLScraper {
  private readonly RSS_URL = 'https://www.torontopubliclibrary.ca/rss.jsp?N=37867+33162+37846&Ns=p_pub_date_sort&Nso=0';
  private readonly WORK_DIR = process.env.NODE_ENV === 'production' ? '/app/data' : path.join(process.cwd(), 'data');
  private readonly transporter: nodemailer.Transporter;

  constructor() {
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

  private formatContent(items: RSSItem[]): string {
    return items.map(item => {
      const content = item['content:encoded'][0]
        .replace(/<content:encoded><!\[CDATA\[/, '')
        .replace(/\]\]><\/content:encoded>/, '')
        .replace(/<record>.*<\/record>/, '');
      
      return `<div class="item">
        ${content}
        <div class="clearfix"></div>
      </div>`;
    }).join('\n');
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
        let previousContent: string | null = null;
        try {
          previousContent = await fs.readFile(previousFile, 'utf-8');
        } catch {
          // Previous file doesn't exist, that's okay
        }

        if (!previousContent || previousContent !== rssContent) {
          console.log('Changes detected - sending email...');
          
          const parser = new xml2js.Parser();
          const result = await parser.parseStringPromise(rssContent);
          const items = result.rss.channel[0].item;
          const formattedContent = this.formatContent(items);
          
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
