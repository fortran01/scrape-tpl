import { LambdaFunctionURLEvent, APIGatewayProxyResultV2 } from 'aws-lambda';
import { Pool } from 'pg';
import * as ejs from 'ejs';
import * as path from 'path';
import * as fs from 'fs';

interface DBRSSItem {
  id: number;
  title: string;
  link: string;
  description: string;
  content_encoded: string;
  record_data: any;
  event_dates: Date[];
  feed_name: string;
  first_seen: Date;
  last_seen: Date;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

// Initialize connection pool outside handler for connection reuse
let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL environment variable is required');
    }
    
    pool = new Pool({
      connectionString: databaseUrl,
      max: 3, // Keep minimal for Lambda
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
  }
  return pool;
}

async function fetchTPLItems(): Promise<DBRSSItem[]> {
  const client = await getPool().connect();
  try {
    const result = await client.query(`
      SELECT * FROM rss_items 
      WHERE is_active = TRUE 
      ORDER BY 
        CASE 
          WHEN event_dates IS NOT NULL AND array_length(event_dates, 1) > 0 
          THEN event_dates[1] 
          ELSE last_seen 
        END ASC,
        feed_name ASC,
        title ASC
    `);
    
    // Pre-process the items to handle description formatting
    return result.rows.map(item => ({
      ...item,
      description: item.description ? item.description.replace(/\n/g, '<br>') : null
    }));
  } finally {
    client.release();
  }
}

function formatEventDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Toronto'
  }).format(date);
}

function groupItemsByMonth(items: DBRSSItem[]): Map<string, DBRSSItem[]> {
  const grouped = new Map<string, DBRSSItem[]>();
  
  for (const item of items) {
    let monthKey: string;
    
    if (item.event_dates && item.event_dates.length > 0) {
      const eventDate = new Date(item.event_dates[0]);
      monthKey = new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'long',
        timeZone: 'America/Toronto'
      }).format(eventDate);
    } else {
      const lastSeen = new Date(item.last_seen);
      monthKey = new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'long',
        timeZone: 'America/Toronto'
      }).format(lastSeen);
    }
    
    if (!grouped.has(monthKey)) {
      grouped.set(monthKey, []);
    }
    grouped.get(monthKey)!.push(item);
  }
  
  return grouped;
}

export const handler = async (
  event: any // Changed from LambdaFunctionURLEvent to any for debugging
): Promise<any> => {
  try {
    // Add comprehensive logging for debugging
    console.log('=== Lambda Handler Started ===');
    console.log('Event type:', typeof event);
    console.log('Event keys:', Object.keys(event || {}));
    console.log('Event structure:', JSON.stringify(event, null, 2));
    
    // Handle different event types
    let queryStringParameters: any = null;
    let httpMethod = 'GET';
    
    if (event.queryStringParameters) {
      queryStringParameters = event.queryStringParameters;
    }
    
    if (event.requestContext?.http?.method) {
      httpMethod = event.requestContext.http.method;
    } else if (event.httpMethod) {
      httpMethod = event.httpMethod;
    }
    
    console.log('HTTP Method:', httpMethod);
    console.log('Query parameters:', queryStringParameters);
    
    // Handle OPTIONS request for CORS
    if (httpMethod === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
        body: '',
      };
    }
    
    console.log('Fetching TPL items from database...');
    const items = await fetchTPLItems();
    console.log(`Found ${items.length} active items`);
    
    // Check if JSON format is requested
    const format = queryStringParameters?.format;
    if (format === 'json') {
      const jsonResponse = {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({
          items,
          count: items.length,
          lastUpdated: new Date().toISOString()
        }, null, 2),
      };
      
      console.log('=== JSON Response being returned ===');
      console.log('JSON Response status:', jsonResponse.statusCode);
      console.log('JSON Response headers:', JSON.stringify(jsonResponse.headers));
      console.log('JSON Response body length:', jsonResponse.body.length);
      
      return jsonResponse;
    }
    
    // Group items by month for calendar-like display
    const groupedItems = groupItemsByMonth(items);
    
    // Read and render the EJS template
    const templatePath = path.join(__dirname, 'views', 'index.ejs');
    let template: string;
    
    try {
      template = fs.readFileSync(templatePath, 'utf-8');
    } catch (error) {
      console.error('Error reading template:', error);
      // Fallback inline template
      template = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Toronto Public Library Events</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .header { background: #2B4C7E; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
        .content { padding: 20px; }
        .month-section { margin-bottom: 30px; }
        .month-title { color: #2B4C7E; border-bottom: 2px solid #2B4C7E; padding-bottom: 10px; margin-bottom: 20px; }
        .event-card { border: 1px solid #ddd; border-radius: 6px; margin-bottom: 15px; padding: 15px; background: white; }
        .event-title { color: #2B4C7E; margin-bottom: 8px; font-weight: bold; }
        .event-meta { color: #666; font-size: 0.9em; margin-bottom: 10px; }
        .event-date { background: #e8f4f8; padding: 8px 12px; border-radius: 4px; margin: 8px 0; color: #2B4C7E; font-weight: bold; }
        .branch-tag { background: #2B4C7E; color: white; padding: 4px 8px; border-radius: 12px; font-size: 0.8em; margin-right: 8px; }
        .no-events { text-align: center; color: #666; padding: 40px; }
        .stats { background: #f8f9fa; padding: 15px; border-radius: 6px; margin-bottom: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🏛️ Toronto Public Library Events</h1>
            <p>Upcoming events and programs across TPL branches</p>
        </div>
        <div class="content">
            <div class="stats">
                <strong>📊 <%= items.length %> active events</strong> • 
                Last updated: <%= new Date().toLocaleString('en-US', { timeZone: 'America/Toronto' }) %>
                <a href="?format=json" style="float: right; color: #2B4C7E;">📄 JSON API</a>
            </div>
            
            <% if (items.length === 0) { %>
                <div class="no-events">
                    <h3>No events currently available</h3>
                    <p>Check back later for new events and programs!</p>
                </div>
            <% } else { %>
                <% groupedItems.forEach((monthItems, monthName) => { %>
                    <div class="month-section">
                        <h2 class="month-title">📅 <%= monthName %></h2>
                        <% monthItems.forEach(item => { %>
                            <div class="event-card">
                                <h3 class="event-title">
                                    <a href="<%= item.link %>" target="_blank" style="color: #2B4C7E; text-decoration: none;">
                                        <%= item.title %>
                                    </a>
                                </h3>
                                <div class="event-meta">
                                    <span class="branch-tag"><%= item.feed_name %></span>
                                    Added: <%= new Date(item.first_seen).toLocaleDateString('en-US', { timeZone: 'America/Toronto' }) %>
                                </div>
                                <% if (item.event_dates && item.event_dates.length > 0) { %>
                                    <% item.event_dates.forEach(date => { %>
                                        <div class="event-date">
                                            🗓️ <%= formatEventDate(new Date(date)) %>
                                        </div>
                                    <% }); %>
                                <% } %>
                                <% if (item.description) { %>
                                    <div style="margin-top: 10px; line-height: 1.5;">
                                        <%- item.description %>
                                    </div>
                                <% } %>
                            </div>
                        <% }); %>
                    </div>
                <% }); %>
            <% } %>
        </div>
    </div>
</body>
</html>`;
    }
    
    const html = ejs.render(template, {
      items,
      groupedItems,
      formatEventDate
    });
    
    const response = {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/html',
        'Cache-Control': 'public, max-age=300', // Cache for 5 minutes
        'Access-Control-Allow-Origin': '*',
      },
      body: html,
    };
    
    console.log('=== Response being returned ===');
    console.log('Response status:', response.statusCode);
    console.log('Response headers:', JSON.stringify(response.headers));
    console.log('Response body length:', response.body.length);
    console.log('Response body preview:', response.body.substring(0, 200) + '...');
    
    return response;
    
  } catch (error) {
    console.error('=== Error in Lambda handler ===');
    console.error('Error type:', typeof error);
    console.error('Error message:', error instanceof Error ? error.message : 'Unknown error');
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    console.error('Full error object:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      }),
    };
  }
}; 