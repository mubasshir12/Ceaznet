import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import NodeCache from 'node-cache';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { GoogleGenAI } from '@google/genai';
import { createClient } from '@supabase/supabase-js';

// Add stealth plugin to puppeteer
puppeteer.use(StealthPlugin());

// Initialize a memory cache (default TTL 1 hour)
const dbCache = new NodeCache({ stdTTL: 3600, checkperiod: 120 });

// Simple way to use the Supabase client already configured
import { supabase } from './services/supabaseClient';

const supabaseAdminUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://itjurgqbvsqniphuehiz.supabase.co';
const supabaseAdminKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0anVyZ3FidnNxbmlwaHVlaGl6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyODM5NTgsImV4cCI6MjA5MDg1OTk1OH0.WSyZbgJ7rcbaTGCwURHTxQCHU9__F_ql75L6upVsVag';
const supabaseAdmin = createClient(supabaseAdminUrl, supabaseAdminKey);

// Initialize realtime cache invalidation listener
supabase
  .channel('db-cache-invalidation')
  .on('postgres_changes', { event: '*', schema: 'public' }, (payload) => {
    const table = payload.table;
    const keys = dbCache.keys().filter(key => key.startsWith(`tbl_${table}_`));
    if (keys.length > 0) {
      dbCache.del(keys);
      console.log(`[Cache] Invalidated ${keys.length} cached queries for table: ${table} due to ${payload.eventType} event.`);
    }
  })
  .subscribe((status) => {
    console.log(`[Cache Invalidation] Realtime status: ${status}`);
  });

// Singleton browser instance
let browserInstance: any = null;
async function getBrowser() {
  if (!browserInstance) {
    console.log("Launching Puppeteer browser instance...");
    browserInstance = await puppeteer.launch({
      headless: true, // Use new headless mode implicitly in newer puppeteer
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
  }
  return browserInstance;
}

// Ensure browser closes on exit
process.on('SIGINT', async () => {
    if (browserInstance) await browserInstance.close();
    process.exit(0);
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Database Query Caching API
  app.post("/api/db/query", async (req, res) => {
    try {
      const { table, select, eq, order, limit } = req.body;
      if (!table) return res.status(400).json({ error: "Missing table parameter" });

      const cacheKey = `tbl_${table}_${JSON.stringify({ select, eq, order, limit })}`;
      const cachedData = dbCache.get(cacheKey);
      if (cachedData) {
        res.setHeader('X-Cache', 'HIT');
        return res.json(cachedData);
      }

      let query = supabase.from(table).select(select || '*');
      if (eq) Object.entries(eq).forEach(([key, value]) => { query = query.eq(key, value); });
      if (order) query = query.order(order.column, { ascending: order.ascending });
      if (limit) query = query.limit(limit);

      const { data, error } = await query;
      if (error) throw error;

      dbCache.set(cacheKey, { data });
      res.setHeader('X-Cache', 'MISS');
      res.json({ data });
    } catch (error: any) {
      console.error(`DB Query Proxy Error:`, error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // News Caching API
  app.get("/api/news", async (req, res) => {
    try {
      const { category } = req.query;
      if (!category) return res.status(400).json({ error: "Missing category parameter" });

      const cacheKey = `news_cat_${category}`;
      const cachedData = dbCache.get(cacheKey);
      if (cachedData) {
        res.setHeader('X-Cache', 'HIT');
        // Vercel Edge caching config for downstream
        res.setHeader('Cache-Control', `s-maxage=10800, stale-while-revalidate=600`);
        return res.json({ data: cachedData });
      }

      const { data, error } = await supabase
        .from('public_news_articles')
        .select('category, article_data, formatted_content_md, views, likes, bookmarks')
        .eq('category', category)
        .order('created_at', { ascending: false })
        .limit(30);

      if (error) throw error;

      // Calculate next cache invalidation time (5 minutes past every 3rd hour starting at 00:00 UTC)
      // This ensures cron jobs (which run at 00:00, 03:00 UTC, etc. - 05:30 IST) have time to complete
      const now = new Date();
      const currentHour = now.getUTCHours();
      const currentMinute = now.getUTCMinutes();
      const totalMinutes = currentHour * 60 + currentMinute;
      
      const updateIntervals = [
        5,          // 00:05 UTC (05:35 IST)
        3 * 60 + 5, // 03:05 UTC (08:35 IST)
        6 * 60 + 5, // 06:05 UTC (11:35 IST)
        9 * 60 + 5, // 09:05 UTC (14:35 IST)
        12 * 60 + 5,// 12:05 UTC (17:35 IST)
        15 * 60 + 5,// 15:05 UTC (20:35 IST)
        18 * 60 + 5,// 18:05 UTC (23:35 IST)
        21 * 60 + 5,// 21:05 UTC (02:35 IST)
        24 * 60 + 5 // Next day 00:05 UTC
      ];
      
      const nextUpdateMinutes = updateIntervals.find(m => m > totalMinutes) || updateIntervals[updateIntervals.length - 1];
      
      const nextUpdate = new Date(now);
      nextUpdate.setUTCHours(0, 0, 0, 0);
      nextUpdate.setUTCMinutes(nextUpdateMinutes);
      
      const maxAgeSeconds = Math.floor((nextUpdate.getTime() - now.getTime()) / 1000);
      
      // Store in memory cache
      dbCache.set(cacheKey, data, maxAgeSeconds);

      res.setHeader('X-Cache', 'MISS');
      res.setHeader('Cache-Control', `public, s-maxage=${maxAgeSeconds}, stale-while-revalidate=60`);
      
      res.json({ data });
    } catch (error: any) {
      console.error(`News API Proxy Error:`, error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // URL Reader Endpoint
  app.post("/api/url-reader", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({ error: "UNAUTHORIZED: Missing token" });
      }
      
      const token = authHeader.split(' ')[1];
      const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
      
      if (authError || !user) {
          return res.status(401).json({ error: "UNAUTHORIZED: Invalid token" });
      }

      const { url } = req.body;
      if (!url) return res.status(400).json({ error: "Missing url parameter" });

      let html = "";
      
      try {
        // Fast path: Axios
        const response = await axios.get(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          },
          timeout: 10000,
        });
        html = response.data;
      } catch (err: any) {
        console.warn(`[URL-Reader] Axios failed (${err.message}), falling back to Puppeteer Stealth for ${url}`);
        // Fallback: Puppeteer Stealth
        const browser = await getBrowser();
        const page = await browser.newPage();
        try {
          // Block images/styles to make it fast
          await page.setRequestInterception(true);
          page.on('request', (req: any) => {
              if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) req.abort();
              else req.continue();
          });
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          html = await page.content();
        } finally {
          await page.close();
        }
      }

      const doc = new JSDOM(html, { url });
      const reader = new Readability(doc.window.document);
      const article = reader.parse();

      if (!article || !article.textContent) {
        const $ = cheerio.load(html);
        $('script, style, nav, footer, header, aside').remove();
        const fallbackText = $('body').text().replace(/\s+/g, ' ').trim();
        return res.json({ title: $('title').text() || 'Unknown Title', content: fallbackText });
      }

      res.json({ title: article.title, content: article.textContent });
    } catch (error: any) {
      console.error("URL Reader Error:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // URL Reader Follow-up (AI) Endpoint
  app.post("/api/url-reader/follow-up", async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
          res.write(`data: ${JSON.stringify({ error: "UNAUTHORIZED: Missing token" })}\n\n`);
          res.end();
          return;
      }
      
      const token = authHeader.split(' ')[1];
      const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
      
      if (authError || !user) {
          res.write(`data: ${JSON.stringify({ error: "UNAUTHORIZED: Invalid token" })}\n\n`);
          res.end();
          return;
      }

      const { prompt, apiKey: clientApiKey } = req.body;
      if (!prompt) {
         res.write(`data: ${JSON.stringify({ error: "Missing prompt" })}\n\n`);
         res.end();
         return;
      }

      let apiKey = clientApiKey;

      if (!apiKey) {
          res.write(`data: ${JSON.stringify({ error: "Please configure your Gemini API key in the Settings to use this feature." })}\n\n`);
          res.end();
          return;
      }

      let success = false;
      let lastError = null;

      try {
          const ai = new GoogleGenAI({ apiKey });
          
          const stream = await ai.models.generateContentStream({
              model: 'gemini-2.5-flash',
              contents: prompt,
              config: {
                  tools: [{ googleSearch: {} }],
              }
          });

          for await (const chunk of stream) {
              const chunkText = chunk.text;
              const sources = chunk.candidates?.[0]?.groundingMetadata?.groundingChunks?.map((c: any) => c);
              
              const eventData = {
                  text: chunkText,
                  sources: sources
              };
              res.write(`data: ${JSON.stringify(eventData)}\n\n`);
          }
          
          success = true;

      } catch (err: any) {
          lastError = err;
          console.warn(`[URL Reader AI] User ${user.id} API key failed:`, err.message);
      }

      if (!success) {
          res.write(`data: ${JSON.stringify({ error: lastError?.message || "Failed to generate response. Please check your API key." })}\n\n`);
          res.end();
          return;
      }
      
      res.write(`data: [DONE]\n\n`);
      res.end();

    } catch (error: any) {
      console.error("URL Reader Follow-up Error:", error.message);
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.end();
    }
  });

  // Image/File Proxy Endpoint
  app.get("/api/image-proxy", async (req, res) => {
    try {
      const { url } = req.query;
      if (!url || typeof url !== 'string') return res.status(400).json({ error: "Missing url query parameter" });

      let base64 = "";
      let contentType = "application/octet-stream";

      try {
        // Fast path: Axios
        const urlObj = new URL(url);
        let response = await axios.get(url, {
          responseType: 'arraybuffer',
          headers: {
             'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
             'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
             'Accept-Language': 'en-US,en;q=0.5',
             'Referer': urlObj.origin + '/',
             'Sec-Fetch-Dest': 'image',
             'Sec-Fetch-Mode': 'no-cors',
             'Sec-Fetch-Site': 'cross-site'
          },
          timeout: 10000,
          maxRedirects: 5,
          validateStatus: () => true, // resolve on all status codes
        });
        
        if (response.status === 404 || response.status === 400 || response.status === 410) {
           return res.status(response.status).json({ error: `Image not found (Status ${response.status})` });
        }

        if (response.status >= 400) {
           throw new Error(`Request failed with status code ${response.status}`);
        }

        contentType = (response.headers['content-type'] as string) || 'application/octet-stream';
        base64 = Buffer.from(response.data, 'binary').toString('base64');
        
      } catch (err: any) {
        console.warn(`[Image-Proxy] Axios failed (${err.message}), trying wsrv.nl proxy for ${url}`);
        try {
          const wsrvUrl = `https://wsrv.nl/?url=${encodeURIComponent(url)}`;
          const response = await axios.get(wsrvUrl, {
            responseType: 'arraybuffer',
            timeout: 10000,
            validateStatus: () => true,
          });

          if (response.status === 404 || response.status === 400 || response.status === 410) {
             return res.status(404).json({ error: `Image not found via proxy (Status ${response.status})` });
          }
          if (response.status >= 400) {
             throw new Error(`Request failed with status code ${response.status}`);
          }

          contentType = (response.headers['content-type'] as string) || 'application/octet-stream';
          base64 = Buffer.from(response.data, 'binary').toString('base64');
        } catch (wsrvErr: any) {
          console.warn(`[Image-Proxy] wsrv.nl failed (${wsrvErr.message}), falling back to Puppeteer Stealth for ${url}`);
          // Fallback: Puppeteer Stealth
          const browser = await getBrowser();
          const page = await browser.newPage();
          
          const urlObj = new URL(url);
          await page.setExtraHTTPHeaders({
               'Accept-Language': 'en-US,en;q=0.5',
               'Referer': urlObj.origin + '/'
          });
  
          try {
            const response = await page.goto(url, { timeout: 30000, waitUntil: 'networkidle0' });
            if (!response) {
              throw new Error("Puppeteer received null response.");
            }
            if (response.status() === 404 || response.status() === 400 || response.status() === 410) {
              return res.status(404).json({ error: "Image not found via puppeteer" });
            }
            if (response.status() >= 400) {
              throw new Error(`Puppeteer received error status ${response.status()}`);
            }
            
            const buffer = await response.buffer();
            contentType = response.headers()['content-type'] || 'application/octet-stream';
            base64 = buffer.toString('base64');
          } finally {
            await page.close();
          }
        }
      }

      const dataUrl = `data:${contentType};base64,${base64}`;
      res.setHeader('Cache-Control', 'public, max-age=31536000');
      res.json({ dataUrl });

    } catch (error: any) {
      console.error("Image Proxy Error:", error.message);
      res.status(500).json({ error: `Failed to proxy image: ${error.message}` });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
