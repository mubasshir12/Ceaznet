# Ceaznet - Edge Function: `update-news`

This directory contains the files for the `update-news` Supabase Edge Function. This function is responsible for periodically fetching fresh news articles, formatting them using the Gemini API, and updating the central `public_news_articles` table in the database.

As part of its run, it now clears all existing article follow-up conversations (`article_conversations` table), the global article content cache (`public_article_cache`), AND all user article interactions (`user_article_interactions`) to ensure data relevance, since old articles are being replaced.

**New Feature**: Upon successful completion, this function now automatically triggers the `scrape-article-images` function to begin fetching images for the newly updated articles.

It is designed as a multi-file function for better organization and maintainability. This version introduces several key improvements including fetching API keys dynamically from a database table, batch processing of categories, and detailed logging of each run.

**Instructions for Myself (the AI):**
- I will refer to these files when asked to view, modify, or explain the news-fetching logic.
- I will not duplicate this code in the `readmeSql.md` file.
- When adding a new edge function or modifying an existing one, I will provide the complete, updated code in a code block directly in the chat, in addition to updating these files.

---

## File Structure

The function is composed of the following files, all located in the `supabase/functions/update-news/` directory:

-   `index.md`: The main entry point that Supabase serves. It orchestrates the entire process.
-   `news.md`: Handles fetching news from the GNews API and processing each category.
-   `gemini.md`: Contains all logic for interacting with the Gemini API, including formatting articles, formatting logs, and API key rotation.
-   `email.md`: Responsible for sending the final HTML log report via the Brevo (Sendinblue) API.
-   `logger.md`: A simple class for collecting and formatting logs throughout the execution.
-   `supabase.md`: Initializes and exports the Supabase admin client for database operations.
-   `utils.md`: Contains shared utility functions like `delay`.
-   `index.ts`: An empty file that Supabase serves. The actual logic is in `index.md`.

## Setup & Required Secrets

This function now fetches API keys from a database table, reducing the number of required environment variables.

### Environment Variables (Secrets)
Before deploying, ensure the following secrets are set in your Supabase project settings:
-   `SUPABASE_URL`: Your Supabase project URL.
-   `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase service role key.
-   `BREVO_API_KEY`: Your API key for the Brevo email service.
-   `LOG_RECIPIENT_EMAIL`: The email address where logs will be sent.
-   `LOG_SENDER_EMAIL`: A verified sender email address in your Brevo account.

### Database Configuration (via Admin Panel)
The following API keys are no longer managed via environment variables. Instead, they must be configured in the `news_api_keys` table using the News Admin Panel:
-   `gnews`: Your GNews API keys.
-   `gemini`: Your Google Gemini API keys.

This allows for dynamic key rotation, load balancing, and automatic cooldowns without re-deploying the function.

## Code for Each File

### `index.md` (Main Entry Point)
```typescript
// supabase/functions/update-news/index.ts: Main entry point for the news update function.
import { serve } from "https://deno.land/std/http/server.ts";
import { Logger } from './logger.ts';
import { corsHeaders } from './utils.ts';
import { processNewsCategory } from './news.ts';
import { sendEmailLog } from './email.ts';
import { supabaseAdmin, markKeyFailed } from './supabase.ts';

const CATEGORIES = ['technology', 'business', 'science', 'health', 'sports', 'entertainment'];
const BATCH_SIZE = 6; // Process all categories in parallel

// KeyManager handles dynamic assignment, load balancing, cooldowns, and fallback logic
class KeyManager {
    private gnewsKeys: any[];
    private geminiKeys: any[];

    constructor(keys: any[]) {
        const now = new Date().getTime();
        const availableKeys = keys.filter(k => {
            if (k.status === 'active') return true;
            if (k.status === 'exhausted' && k.cooldown_until) {
                return now > new Date(k.cooldown_until).getTime();
            }
            return false;
        });

        const sortedKeys = availableKeys.sort((a, b) => {
            if (a.calls_count !== b.calls_count) return a.calls_count - b.calls_count;
            return (a.last_used_at ? new Date(a.last_used_at).getTime() : 0) - (b.last_used_at ? new Date(b.last_used_at).getTime() : 0);
        });

        this.gnewsKeys = sortedKeys.filter(k => k.provider === 'gnews');
        this.geminiKeys = sortedKeys.filter(k => k.provider === 'gemini');
    }

    getInitialKey(provider: 'gnews' | 'gemini', categoryIndex: number) {
        const pool = provider === 'gnews' ? this.gnewsKeys : this.geminiKeys;
        return pool.length > 0 ? pool[categoryIndex % pool.length] : null;
    }

    getFallbackKey(provider: 'gnews' | 'gemini', failedKeyId: string) {
        const pool = provider === 'gnews' ? this.gnewsKeys : this.geminiKeys;
        const validPool = pool.filter(k => k.id !== failedKeyId);
        return validPool.length > 0 ? validPool.sort((a, b) => a.calls_count - b.calls_count)[0] : null;
    }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const logger = new Logger();
  let overallStatus: 'SUCCESS' | 'FAILURE' = 'SUCCESS';
  const startTime = Date.now();

  try {
    logger.info('🚀 Waking up the news bot!');
    
    const { data: keysData, error: keysError } = await supabaseAdmin.from('news_api_keys').select('*');
    if (keysError || !keysData) throw new Error(`Failed to fetch keys: ${keysError?.message}`);

    const keyManager = new KeyManager(keysData);
    if (!keyManager.getInitialKey('gnews', 0) || !keyManager.getInitialKey('gemini', 0)) {
        throw new Error('No available API keys. System is on cooldown.');
    }
    
    logger.info('🧹 Sweeping away yesterday\'s news...');
    await Promise.all([
      supabaseAdmin.from('article_conversations').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
      supabaseAdmin.from('public_article_cache').delete().neq('article_url', 'dummy_url'),
      supabaseAdmin.from('user_article_interactions').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    ]);
    
    const allResults = await Promise.all(CATEGORIES.map((category, index) => {
        const gKey = keyManager.getInitialKey('gnews', index);
        const gemKey = keyManager.getInitialKey('gemini', index);
        return processNewsCategory(category, logger, gKey, gemKey, 
            async (id, msg) => { await markKeyFailed(id, msg); return keyManager.getFallbackKey('gnews', id); },
            async (id, msg) => { await markKeyFailed(id, msg); return keyManager.getFallbackKey('gemini', id); }
        );
    }));
    
    const totalUpdated = allResults.reduce((acc, r) => acc + (r.articlesUpdated || 0), 0);
    logger.info(`✅ News update finished. Total Articles: ${totalUpdated}`);
    
    return new Response(JSON.stringify({ message: 'Success' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    overallStatus = 'FAILURE';
    logger.error(`🚨 Error: ${error.message}`);
    return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  } finally {
    const duration = Date.now() - startTime;
    await supabaseAdmin.from('update_news_logs').insert({ status: overallStatus, duration_ms: duration, summary: logger.getSummary(), details: logger.getLogs().join('\n') });
    await sendEmailLog(logger, overallStatus);
  }
});
```

### `news.md` (News Processing)
```typescript
// supabase/functions/update-news/news.ts: Fetches and processes news articles.
// @ts-nocheck - This is a Deno file and should not be type-checked by the frontend's TypeScript compiler.
/// <reference types="https://esm.sh/@supabase/functions-js@2/src/edge-runtime.d.ts" />

import { Logger } from './logger.ts';
import { formatArticleBatchWithGemini } from './gemini.ts';
import { supabaseAdmin } from './supabase.ts';
import { delay } from './utils.ts';

let currentGNewsKeyIndex = 0;
const NEWS_API_URL = 'https://gnews.io/api/v4/top-headlines';

const rotateGNewsApiKey = (logger: Logger, gnewsApiKeys: string[]): boolean => {
  if (gnewsApiKeys.length === 0) return false;
  const failedKey = gnewsApiKeys[currentGNewsKeyIndex];
  logger.warn(`GNews key ...${failedKey.slice(-4)} failed or was rate-limited. Rotating...`);
  currentGNewsKeyIndex = (currentGNewsKeyIndex + 1) % gnewsApiKeys.length;
  if (currentGNewsKeyIndex === 0) {
    logger.error('All GNews API keys have been tried and failed. Aborting category fetch.');
    return false;
  }
  const newKey = gnewsApiKeys[currentGNewsKeyIndex];
  logger.info(`Switched to GNews key ...${newKey.slice(-4)}.`);
  return true;
};

const fetchWithRetryAndRotation = async (url: string, logger: Logger, gnewsApiKeys: string[], retries = 2): Promise<Response> => {
    const originalUrl = new URL(url);
    try {
        originalUrl.searchParams.set('apikey', gnewsApiKeys[currentGNewsKeyIndex]);
        const response = await fetch(originalUrl.toString());

        if (!response.ok) {
            const isRateLimit = response.status === 429;
            const isAuthError = response.status === 401;

            if ((isRateLimit || isAuthError) && retries > 0) {
                if (!rotateGNewsApiKey(logger, gnewsApiKeys)) {
                    throw new Error('All GNews API keys failed.');
                }
                await delay(1000);
                return fetchWithRetryAndRotation(url, logger, gnewsApiKeys, retries - 1);
            }
            throw new Error(`GNews API request failed: ${response.status} ${response.statusText}`);
        }
        return response;
    } catch (error) {
        if (retries > 0) {
            logger.warn(`GNews API fetch error: ${error.message}. Retrying... (${retries} attempts left)`);
            await delay(2000);
            return fetchWithRetryAndRotation(url, logger, gnewsApiKeys, retries - 1);
        }
        throw error;
    }
};

export const processNewsCategory = async (category: string, logger: Logger, gnewsApiKeys: string[], geminiApiKeys: string[]) => {
  let articlesUpdated = 0;
  try {
    const response = await fetchWithRetryAndRotation(`${NEWS_API_URL}?category=${category}&lang=en&max=10`, logger, gnewsApiKeys);
    
    const newsData = await response.json();
    if (newsData.totalArticles === 0) {
      logger.info(`[${category}] GNews API returned 0 articles.`);
      return { success: true, articlesUpdated: 0 };
    }

    const articles = newsData.articles;
    if (!articles || articles.length === 0) {
      logger.warn(`[${category}] No articles array found.`);
      return { success: true, articlesUpdated: 0 };
    }

    logger.success(`[${category}] Fetched ${articles.length} raw articles.`);
    logger.addSummary(`[${category}] Fetched: ${articles.length}`);
    
    const formattedArticlesMap = await formatArticleBatchWithGemini(articles, logger, geminiApiKeys);
    
    const successfulArticles = articles.map((article: any) => {
        const formattedMarkdown = formattedArticlesMap.get(article.url);
        if (formattedMarkdown) return { category, article_data: article, formatted_content_md: { markdown: formattedMarkdown } };
        return null;
    }).filter(Boolean);

    const successCount = successfulArticles.length;
    const failedCount = articles.length - successCount;
    logger.info(`[${category}] Formatting complete. Success: ${successCount}, Failed: ${failedCount}`);
    logger.addSummary(`[${category}] Formatted: ${successCount}, Failed: ${failedCount}`);

    if (successfulArticles.length === 0) {
      logger.warn(`[${category}] No articles formatted. Skipping DB update.`);
      return { success: true, articlesUpdated: 0 };
    }
    
    logger.info(`[${category}] Deleting old articles...`);
    const { error: deleteError } = await supabaseAdmin.from('public_news_articles').delete().eq('category', category);
    if (deleteError) throw new Error(`DB delete failed: ${deleteError.message}`);
    logger.success(`[${category}] Old articles deleted.`);
    
    logger.info(`[${category}] Inserting ${successfulArticles.length} new articles...`);
    const { error: insertError } = await supabaseAdmin.from('public_news_articles').insert(successfulArticles);
    if (insertError) throw new Error(`DB insert failed: ${insertError.message}`);
    
    articlesUpdated = successfulArticles.length;
    logger.success(`[${category}] Stored ${articlesUpdated} articles.`);
    return { success: true, articlesUpdated };
  } catch (error) {
    let simpleError = error.message.includes('GNews') ? "GNews request failed" : error.message;
    logger.error(`[${category}] Process failed: ${simpleError}`);
    return { success: false, articlesUpdated: 0 };
  }
};
```

### `gemini.md` (Gemini API Service)
```typescript
// supabase/functions/update-news/gemini.ts: Service for interacting with the Google Gemini API.
// @ts-nocheck - This is a Deno file and should not be type-checked by the frontend's TypeScript compiler.
/// <reference types="https://esm.sh/@supabase/functions-js@2/src/edge-runtime.d.ts" />

import { GoogleGenAI, Type } from 'https://esm.sh/@google/genai@^1.16.0';
import { Logger } from './logger.ts';

// State is maintained for the duration of the function invocation.
let currentKeyIndex = 0;

/**
 * Rotates to the next available Gemini API key.
 * @param logger - The logger instance.
 * @param geminiApiKeys - The array of available API keys.
 * @returns A new GoogleGenAI client instance or null if all keys have been tried.
 */
const rotateApiKey = (logger: Logger, geminiApiKeys: string[]): GoogleGenAI | null => {
  if (geminiApiKeys.length === 0) return null;
  
  const failedKey = geminiApiKeys[currentKeyIndex];
  logger.warn(`Gemini key ...${failedKey.slice(-4)} failed. Rotating...`);
  
  // Move to the next key index.
  currentKeyIndex = (currentKeyIndex + 1) % geminiApiKeys.length;
  
  // If we've looped back to the start, it means all keys have failed in this cycle.
  if (currentKeyIndex === 0) {
    logger.error('All Gemini API keys have failed within this cycle. Aborting subsequent attempts.');
    return null;
  }
  
  const newKey = geminiApiKeys[currentKeyIndex];
  logger.info(`Switched to Gemini key ...${newKey.slice(-4)}.`);
  
  // Return a new client instance with the new key.
  return new GoogleGenAI({ apiKey: newKey });
};

const BATCH_SYSTEM_PROMPT = `You are an expert article formatter. You will receive a JSON array of news articles. For EACH article in the array, you MUST generate a comprehensive summary formatted with rich markdown, following the structure below precisely.

**Formatting Structure for EACH Article:**
1.  **Lead Paragraph:** A single, compelling introductory paragraph summarizing the article's essence.
2.  **Key Points Section:** A section with the exact heading "### Key Points", followed immediately by a bulleted list of the main takeaways.
3.  **Detailed Summary:** The rest of the detailed summary, using subheadings (e.g., #### Background) for clarity.

**Output Requirement:**
You MUST respond with a single, valid JSON array. Each object in the array must contain two keys:
- \`original_url\`: The URL of the article you just formatted.
- \`formatted_markdown\`: The full markdown content you generated for that article. The markdown string MUST use newline characters (\\n) to separate paragraphs, headings, and list items for correct rendering.

Handle each article independently. If an article's content is missing or invalid, skip it and do not include it in your final JSON array output.
`;

export const formatArticleBatchWithGemini = async (articles: any[], logger: Logger, geminiApiKeys: string[]): Promise<Map<string, string>> => {
    if (articles.length === 0) return new Map();
    
    // Always create a new client instance with the current key to ensure it's fresh after potential rotation.
    let geminiAi = new GoogleGenAI({ apiKey: geminiApiKeys[currentKeyIndex] });

    const articlesForPrompt = articles.map(a => ({
        title: a.title,
        source: a.source.name,
        url: a.url,
        content: a.content || a.description || ''
    }));
    const prompt = JSON.stringify(articlesForPrompt);

    try {
        const response = await geminiAi.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: { 
                systemInstruction: BATCH_SYSTEM_PROMPT, 
                responseMimeType: 'application/json', 
                responseSchema: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            original_url: { type: Type.STRING },
                            formatted_markdown: { type: Type.STRING }
                        },
                        required: ["original_url", "formatted_markdown"]
                    }
                } 
            },
        });
        
        const jsonText = response.text.trim();
        // Handle cases where the model might return an empty string for valid reasons.
        if (!jsonText) {
             logger.warn('Gemini returned an empty response for the batch. No articles will be formatted.');
             return new Map<string, string>();
        }
        
        const results: { original_url: string; formatted_markdown: string }[] = JSON.parse(jsonText);
        
        const resultMap = new Map<string, string>();
        for (const res of results) {
            if (res.original_url && res.formatted_markdown) {
                resultMap.set(res.original_url, res.formatted_markdown);
            }
        }
        
        logger.success(`Batch formatted ${resultMap.size} articles.`);
        return resultMap;

    } catch (error) {
        logger.error(`Gemini batch formatting failed: ${error.message}`);
        
        const isRateLimit = error.message.includes('429');
        const isAuthError = error.message.includes('API key not valid');

        // If it's a key-related error, try rotating the key and retrying ONCE.
        if (isRateLimit || isAuthError) {
            const newClient = rotateApiKey(logger, geminiApiKeys);
            if (newClient) {
                // We don't want to get stuck in a loop, so we won't call this function recursively again.
                // The next category's call will use the new key. This attempt is just a one-off retry.
                logger.info('Retrying Gemini call with new key...');
                try {
                     const retryResponse = await newClient.models.generateContent({
                        model: 'gemini-2.5-flash',
                        contents: prompt,
                        config: { 
                            systemInstruction: BATCH_SYSTEM_PROMPT, 
                            responseMimeType: 'application/json', 
                            responseSchema: {
                                type: Type.ARRAY,
                                items: {
                                    type: Type.OBJECT,
                                    properties: {
                                        original_url: { type: Type.STRING },
                                        formatted_markdown: { type: Type.STRING }
                                    },
                                    required: ["original_url", "formatted_markdown"]
                                }
                            } 
                        },
                     });
                     const jsonText = retryResponse.text.trim();
                     const results: { original_url: string; formatted_markdown: string }[] = JSON.parse(jsonText);
                     const resultMap = new Map<string, string>();
                     for (const res of results) {
                        if (res.original_url && res.formatted_markdown) resultMap.set(res.original_url, res.formatted_markdown);
                     }
                     logger.success(`Batch formatted ${resultMap.size} articles on retry.`);
                     return resultMap;
                } catch (retryError) {
                    logger.error(`Gemini retry failed: ${retryError.message}`);
                }
            }
        }
        
        // If rotation fails, or it's another type of error, or retry fails, return an empty map.
        // This prevents the entire function run from crashing.
        logger.warn('Could not format articles in this batch due to a persistent Gemini error.');
        return new Map<string, string>();
    }
};

// formatLogsWithGemini remains the same but will use the rotated key if needed
export const formatLogsWithGemini = async (logger: Logger, status: string, geminiApiKeys: string[]): Promise<string> => {
    let geminiAi = new GoogleGenAI({ apiKey: geminiApiKeys[currentKeyIndex] });
    const summaryText = logger.getSummary().join('\n');
    const logsText = logger.getLogs().join('\n');
    const prompt = `You are a log formatting assistant... (prompt remains the same)`;
    try {
        const response = await geminiAi.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
        return response.text.trim();
    } catch (error) {
        logger.error(`Failed to format logs with Gemini: ${error.message}. Sending raw logs instead.`);
        throw error;
    }
};
```

### `email.md` (Email Service)
```typescript
// @ts-nocheck - This is a Deno file and should not be type-checked by the frontend's TypeScript compiler.
// FIX: Updated Supabase functions type reference to resolve type errors.
/// <reference types="https://esm.sh/@supabase/functions-js@2.4.1/src/edge-runtime.d.ts" />

import { Logger } from './logger.ts';
import { encodeBase64 } from "https://deno.land/std/encoding/base64.ts";

const BREVO_API_KEY = Deno.env.get('BREVO_API_KEY');
const LOG_RECIPIENT_EMAIL = Deno.env.get('LOG_RECIPIENT_EMAIL');
const LOG_SENDER_EMAIL = Deno.env.get('LOG_SENDER_EMAIL');

/**
 * Creates a new, enhanced HTML log report based on the user-provided template.
 * @param logger The logger instance with all execution data.
 * @param status The overall status of the function run.
 * @returns A complete HTML string for the email body.
 */
function createEnhancedHtmlLog(logger: Logger, status: 'SUCCESS' | 'FAILURE'): string {
    const logs = logger.getLogs();
    const summary = logger.getSummary();

    // 1. Calculate statistics from logs and summary
    let articlesFetched = 0;
    let articlesFormatted = 0;
    let dbUpdates = 0;
    const warningCount = logs.filter(log => log.includes('[WARN]')).length;
    const errorCount = logs.filter(log => log.includes('[ERROR]')).length;

    summary.forEach(line => {
        const fetchedMatch = line.match(/Fetched: (\d+)/);
        if (fetchedMatch) articlesFetched += parseInt(fetchedMatch[1], 10);
        
        const formattedMatch = line.match(/Formatted: (\d+)/);
        if (formattedMatch) articlesFormatted += parseInt(formattedMatch[1], 10);
    });
    
    logs.forEach(log => {
        const dbUpdateMatch = log.match(/Stored (\d+) articles/);
        if(dbUpdateMatch) dbUpdates += parseInt(dbUpdateMatch[1], 10);
    });

    const successRate = articlesFetched > 0 ? ((articlesFormatted / articlesFetched) * 100).toFixed(1) : "100.0";
    const generatedDateGMT = new Date().toUTCString();

    // 2. Generate dynamic HTML parts
    const headerClass = status === 'FAILURE' ? 'header failure' : 'header';
    const headerIcon = status === 'FAILURE' ? 'fas fa-times-circle' : 'fas fa-check-circle';
    
    const summaryItemsHtml = summary.map(line => {
        let icon = 'fas fa-info-circle';
        let iconClass = 'icon-info';
        if (line.toLowerCase().includes('total articles') || line.toLowerCase().includes('formatted')) {
            icon = 'fas fa-check';
            iconClass = 'icon-success';
        }
        if (line.toLowerCase().includes('failed')) {
            icon = 'fas fa-exclamation-triangle';
            iconClass = 'icon-warning';
        }
        // Sanitize the line to prevent HTML injection
        const sanitizedLine = line.replace(/</g, "&lt;").replace(/>/g, "&gt;");
        return `
        <div class="summary-item">
            <div class="summary-icon ${iconClass}"><i class="${icon}"></i></div>
            <div>${sanitizedLine.replace(/\[(.*?)\]/g, '<strong>[$1]</strong>')}</div>
        </div>
        `;
    }).join('');

    const logDataForJs = logs.map((log, index) => {
        const match = log.match(/\[(.*?)\] \[(.*?)\] (.*)/s);
        if (!match) return null;

        const [, time, level, content] = match;
        const formattedTime = new Date(time).toLocaleTimeString('en-US', { hour12: false, timeZone: 'GMT' });
        const type = level.toLowerCase();
        let icon = 'fas fa-info-circle';
        if (type === 'error') icon = 'fas fa-times-circle';
        if (type === 'warn') icon = 'fas fa-exclamation-triangle';
        if (type === 'success') icon = 'fas fa-check-circle';

        const escapedContent = content.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/'/g, "\\'").replace(/\n/g, '\\n');
        
        return `{ number: ${index + 1}, time: "${formattedTime}", content: "${escapedContent}", type: "${type}", icon: "${icon}" }`;
    }).filter(Boolean).join(',\n            ');


    // 3. Assemble final HTML from the provided template
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Ceaznet News Log</title>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f8fafc; color: #334155; padding: 20px; min-height: 100vh; font-size: 15px; line-height: 1.6; }
            .header { padding: 24px 30px; text-align: center; border-bottom: 1px solid #e2e8f0; background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); color: white; margin-bottom: 30px; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1); }
            .header.failure { background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); }
            .header h1 { color: white; font-size: 26px; font-weight: 700; margin-bottom: 12px; display: flex; align-items: center; justify-content: center; gap: 10px; }
            .status-badge { display: inline-block; padding: 8px 20px; background: rgba(255, 255, 255, 0.2); border-radius: 20px; font-size: 14px; font-weight: 600; letter-spacing: 0.5px; }
            .timestamp { margin-top: 10px; font-size: 14px; opacity: 0.9; }
            .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 20px; margin-bottom: 30px; }
            .stat-card { background: #ffffff; padding: 20px; border-left: 4px solid #3b82f6; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05); border-top: 1px solid #f1f5f9; }
            .stat-card.success { border-left-color: #10b981; }
            .stat-card.error { border-left-color: #ef4444; }
            .stat-card.warning { border-left-color: #f59e0b; }
            .stat-label { font-size: 13px; color: #64748b; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; display: flex; align-items: center; gap: 6px; }
            .stat-value { font-size: 28px; font-weight: 700; color: #0f172a; }
            .section { margin-bottom: 30px; }
            .section-title { font-size: 18px; color: #1e293b; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; gap: 8px; }
            .summary-box { background: #ffffff; padding: 20px; border: 1px solid #e2e8f0; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.03); }
            .summary-item { padding: 12px 0; border-bottom: 1px solid #f1f5f9; display: flex; align-items: center; }
            .summary-item:last-child { border-bottom: none; }
            .summary-icon { width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; margin-right: 15px; font-weight: bold; }
            .icon-success { background: #d1fae5; color: #047857; }
            .icon-info { background: #dbeafe; color: #1d4ed8; }
            .icon-warning { background: #fef3c7; color: #d97706; }
            .logs-container { background: #f8fafc; border: 1px solid #e2e8f0; overflow-x: auto; max-height: 400px; overflow-y: auto; }
            .log-entry { padding: 12px 20px; font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Roboto Mono', monospace; font-size: 14px; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; gap: 15px; }
            .log-entry:last-child { border-bottom: none; }
            .log-number { color: #94a3b8; min-width: 40px; text-align: right; }
            .log-time { color: #64748b; min-width: 80px; }
            .log-content { flex: 1; white-space: pre-wrap; word-break: break-all; }
            .log-error { color: #dc2626; }
            .log-warn { color: #d97706; }
            .log-success { color: #059669; }
            .log-info { color: #475569; }
            .footer { background: #f8fafc; padding: 20px 30px; text-align: center; color: #64748b; font-size: 13px; border-top: 1px solid #e2e8f0; margin-top: 30px; }
            .progress-container { margin-bottom: 10px; }
            .progress-bar { width: 100%; height: 10px; background: #e2e8f0; border-radius: 5px; overflow: hidden; margin: 10px 0; }
            .progress-fill { height: 100%; background: linear-gradient(90deg, #3b82f6, #60a5fa); border-radius: 5px; }
            .progress-success .progress-fill { background: linear-gradient(90deg, #10b981, #34d399); }
            .log-filters { display: flex; gap: 10px; margin-bottom: 15px; }
            .filter-btn { padding: 6px 12px; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 13px; cursor: pointer; transition: all 0.2s; }
            .filter-btn.active { background: #3b82f6; color: white; border-color: #3b82f6; }
            .filter-btn:hover { background: #e2e8f0; }
            .filter-btn.active:hover { background: #2563eb; }
            .execution-time { display: flex; justify-content: space-between; margin-top: 5px; font-size: 14px; color: #64748b; }
        </style>
    </head>
    <body>
        <div class="${headerClass}">
            <h1><i class="fas fa-robot"></i> Ceaznet News Log</h1>
            <div class="status-badge"><i class="${headerIcon}"></i> ${status}</div>
            <div class="timestamp">Generated: ${generatedDateGMT}</div>
        </div>
        <div class="stats-grid">
            <div class="stat-card success"><div class="stat-label"><i class="fas fa-newspaper"></i> Articles Formatted</div><div class="stat-value">${articlesFormatted}</div></div>
            <div class="stat-card success"><div class="stat-label"><i class="fas fa-database"></i> Database Updates</div><div class="stat-value">${dbUpdates}</div></div>
            <div class="stat-card warning"><div class="stat-label"><i class="fas fa-exclamation-triangle"></i> Warnings</div><div class="stat-value">${warningCount}</div></div>
            <div class="stat-card error"><div class="stat-label"><i class="fas fa-times-circle"></i> Errors</div><div class="stat-value">${errorCount}</div></div>
        </div>
        <div class="section">
            <div class="section-title"><i class="fas fa-chart-line"></i> Success Rate</div>
            <div class="progress-container">
                <div class="progress-bar progress-success">
                    <div class="progress-fill" style="width: ${successRate}%;"></div>
                </div>
                <div class="execution-time">
                    <span>Formatting Progress</span>
                    <span>${successRate}%</span>
                </div>
            </div>
        </div>
        <div class="section">
            <div class="section-title"><i class="fas fa-list-alt"></i> Summary</div>
            <div class="summary-box">${summaryItemsHtml}</div>
        </div>
        <div class="section">
            <div class="section-title"><i class="fas fa-terminal"></i> Execution Logs</div>
            <div class="log-filters">
                <button class="filter-btn active" data-filter="all">All</button>
                <button class="filter-btn" data-filter="info">Info</button>
                <button class="filter-btn" data-filter="success">Success</button>
                <button class="filter-btn" data-filter="warn">Warnings</button>
                <button class="filter-btn" data-filter="error">Errors</button>
            </div>
            <div class="logs-container"><div id="logsList"></div></div>
        </div>
        <div class="footer">
            <div><i class="fas fa-code-branch"></i> Ceaznet News Bot v2.2</div>
            <div style="margin-top: 5px;">Automated Report • Powered by Supabase & Deno</div>
        </div>
        <script>
            const logData = [
            ${logDataForJs}
            ];
            function renderLogs(filter = "all") {
                const logsContainer = document.getElementById('logsList');
                if (!logsContainer) return;
                logsContainer.innerHTML = '';
                const filteredLogs = filter === "all" ? logData : logData.filter(log => log.type === filter);
                filteredLogs.forEach(log => {
                    const logEntry = document.createElement('div');
                    logEntry.className = 'log-entry';
                    logEntry.setAttribute('data-type', log.type);
                    logEntry.innerHTML = \`
                        <span class="log-number">\${log.number}</span>
                        <span class="log-time">\${log.time}</span>
                        <span class="log-content log-\${log.type}"><i class="\${log.icon}" style="margin-right: 8px;"></i> \${log.content}</span>
                    \`;
                    logsContainer.appendChild(logEntry);
                });
            }
            renderLogs();
            document.querySelectorAll('.filter-btn').forEach(button => {
                button.addEventListener('click', function() {
                    document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
                    this.classList.add('active');
                    renderLogs(this.getAttribute('data-filter'));
                });
            });
        </script>
    </body>
    </html>
    `;
}

export async function sendEmailLog(logger: Logger, status: 'SUCCESS' | 'FAILURE') {
  if (!BREVO_API_KEY || !LOG_RECIPIENT_EMAIL || !LOG_SENDER_EMAIL) {
    logger.error('Email service env vars not set. Skipping email.');
    return;
  }
  const subject = `Ceaznet News Update Log: ${status}`;
  const htmlContent = createEnhancedHtmlLog(logger, status);
  const attachmentContent = encodeBase64(htmlContent);

  const emailPayload = {
    sender: { name: 'Ceaznet Bot', email: LOG_SENDER_EMAIL },
    to: [{ email: LOG_RECIPIENT_EMAIL }],
    subject,
    htmlContent: `<p>Please find the log report attached.</p><p>Generated at: ${new Date().toUTCString()}</p>`,
    attachment: [{
        name: `Ceaznet-News-Log-${new Date().toISOString().split('T')[0]}.html`,
        content: attachmentContent,
    }],
  };

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'accept': 'application/json', 'api-key': BREVO_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify(emailPayload),
    });
    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Brevo API Error: ${response.status} - ${errorBody}`);
    }
    logger.success('Successfully sent email log.');
  } catch (error) {
    logger.error(`Email send failed: ${error.message}`);
  }
}
```

### `logger.md` (Logging Class)
```typescript
// supabase/functions/update-news/logger.ts: A simple class for collecting and formatting logs.
export class Logger {
  private logs: string[] = [];
  private summary: string[] = [];
  private startTime: number;

  constructor() {
    this.startTime = Date.now();
  }

  private add(level: string, message: string) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}`;
    this.logs.push(logMessage);
    // Also log to console for real-time debugging in Supabase logs
    if (level === 'ERROR') {
      console.error(logMessage);
    } else if (level === 'WARN') {
      console.warn(logMessage);
    } else {
      console.log(logMessage);
    }
  }

  info(message: string) { this.add('INFO', message); }
  warn(message: string) { this.add('WARN', message); }
  error(message: string) { this.add('ERROR', message); }
  success(message: string) { this.add('SUCCESS', message); }
  addSummary(message: string) { this.summary.push(message); }
  getLogs = (): string[] => this.logs;
  
  getSummary = (): string[] => {
    const duration = ((Date.now() - this.startTime) / 1000).toFixed(2);
    return [
      `Start Time: ${new Date(this.startTime).toUTCString()}`,
      `End Time: ${new Date().toUTCString()}`,
      `Total Duration: ${duration} seconds`,
      ...this.summary
    ];
  };
}
```

### `supabase.md` (Supabase Client)
```typescript
// @ts-nocheck - This is a Deno file and should not be type-checked by the frontend's TypeScript compiler.
// FIX: Updated Supabase functions type reference to resolve type errors.
/// <reference types="https://esm.sh/@supabase/functions-js@2.4.1/src/edge-runtime.d.ts" />

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Supabase environment variables (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) are not set.");
}

export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
```

### `utils.md` (Utilities)
```typescript
// supabase/functions/update-news/utils.ts: Contains shared utility functions.
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
```