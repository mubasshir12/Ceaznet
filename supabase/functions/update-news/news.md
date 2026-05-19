// supabase/functions/update-news/news.ts: Fetches and processes news articles.
// @ts-nocheck
/// <reference types="https://esm.sh/@supabase/functions-js@2/src/edge-runtime.d.ts" />

import { Logger } from './logger.ts';
import { formatArticleBatchWithGemini } from './gemini.ts';
import { supabaseAdmin, markKeyUsed, markKeyFailed, logKeyAudit } from './supabase.ts';
import { delay } from './utils.ts';

const NEWS_API_URL = 'https://gnews.io/api/v4/top-headlines';

const fetchWithRetryAndRotation = async (
    url: string, 
    category: string,
    logger: Logger, 
    currentKeyObj: any,
    getFallbackKey: (failedKeyId: string, errorMsg: string) => Promise<any>,
    retries = 2
): Promise<{ response: Response, finalKeyObj: any }> => {
    if (!currentKeyObj) {
        throw new Error(`[${category}] No News API key assigned.`);
    }

    const originalUrl = new URL(url);
    try {
        originalUrl.searchParams.set('apikey', currentKeyObj.api_key);
        const response = await fetch(originalUrl.toString());

        if (!response.ok) {
            const isRateLimit = response.status === 429;
            const isAuthError = response.status === 401;
            const errorMsg = `GNews API Error: ${response.status} ${response.statusText}`;

            if ((isRateLimit || isAuthError) && retries > 0) {
                logger.warn(`[${category}] News API key (ending in ...${currentKeyObj.api_key.slice(-4)}) reached its limit or failed. Requesting a backup key...`);
                
                const newKeyObj = await getFallbackKey(currentKeyObj.id, errorMsg);
                
                if (!newKeyObj) {
                    throw new Error(`[${category}] All backup News API keys have failed or are exhausted.`);
                }
                
                // Log the fallback event
                await logKeyAudit(currentKeyObj.id, newKeyObj.id, category, errorMsg);
                
                logger.info(`[${category}] Switched to backup News API key (ending in ...${newKeyObj.api_key.slice(-4)}). Retrying...`);
                await delay(1000);
                return fetchWithRetryAndRotation(url, category, logger, newKeyObj, getFallbackKey, retries - 1);
            }
            throw new Error(errorMsg);
        }
        
        // Success
        await markKeyUsed(currentKeyObj.id, category);
        return { response, finalKeyObj: currentKeyObj };
    } catch (error) {
        if (retries > 0 && !error.message.includes('All backup')) {
            logger.warn(`[${category}] Temporary network error fetching news: ${error.message}. Retrying... (${retries} attempts left)`);
            await delay(2000);
            return fetchWithRetryAndRotation(url, category, logger, currentKeyObj, getFallbackKey, retries - 1);
        }
        throw error;
    }
};

export const processNewsCategory = async (
    category: string, 
    logger: Logger, 
    assignedGnewsKey: any, 
    assignedGeminiKey: any,
    getFallbackGnewsKey: (failedKeyId: string, errorMsg: string) => Promise<any>,
    getFallbackGeminiKey: (failedKeyId: string, errorMsg: string) => Promise<any>,
    config: Record<string, any>
) => {
  let articlesUpdated = 0;
  try {
    logger.info(`[${category}] Scouting the web for the latest news...`);
    const { response } = await fetchWithRetryAndRotation(
        `${NEWS_API_URL}?category=${category}&lang=en&max=10`, 
        category,
        logger, 
        assignedGnewsKey,
        getFallbackGnewsKey
    );
    
    const newsData = await response.json();
    if (newsData.totalArticles === 0) {
      logger.info(`[${category}] Hmm, looks like there's no new news right now. It's quiet out there.`);
      logger.addSummary(`[${category}] Fetched: 0 | Duplicates: 0 | Sent to AI: 0 | AI Formatted: 0 | AI Skipped: 0`);
      return { success: true, articlesUpdated: 0 };
    }

    const articles = newsData.articles;
    if (!articles || articles.length === 0) {
      logger.warn(`[${category}] The news source gave us a weird response. We'll try again later.`);
      logger.addSummary(`[${category}] Fetched: 0 | Duplicates: 0 | Sent to AI: 0 | AI Formatted: 0 | AI Skipped: 0`);
      return { success: true, articlesUpdated: 0 };
    }

    // --- Deduplication Logic & Robust Logging ---
    logger.info(`[${category}] Found ${articles.length} articles! Let's check if we already have any of these...`);
    
    // Fetch FULL existing articles so we can retain them if they are still in the latest news
    const { data: existingArticles } = await supabaseAdmin
        .from('public_news_articles')
        .select('*')
        .eq('category', category);
    
    const existingUrls = new Set(existingArticles?.map(a => a.article_data.url) || []);
    
    // Filter out duplicates. Only keep articles whose URL is NOT in the database.
    const newArticles = articles.filter((a: any) => !existingUrls.has(a.url));
    const duplicateCount = articles.length - newArticles.length;

    if (duplicateCount > 0) {
        logger.info(`[${category}] Ah, ${duplicateCount} of these are old news (duplicates). We'll skip them to save our AI's energy.`);
    }

    // Identify existing articles that are STILL in the latest fetched batch
    const currentFetchedUrls = new Set(articles.map(a => a.url));
    const retainedArticles = (existingArticles || [])
        .filter(a => currentFetchedUrls.has(a.article_data.url))
        .map(a => {
            // Strip id and created_at so they can be cleanly re-inserted
            const { id, created_at, ...rest } = a;
            return rest;
        });

    if (newArticles.length === 0) {
        logger.info(`[${category}] Looks like we already have all ${articles.length} of these articles. Nothing new for the AI to do here!`);
        logger.addSummary(`[${category}] Fetched: ${articles.length} | Duplicates: ${duplicateCount} | Sent to AI: 0 | AI Formatted: 0 | AI Skipped: 0`);
        
        // We still need to update the database to ONLY keep the latest articles (retainedArticles)
        logger.info(`[${category}] Tidying up the database, keeping the ${retainedArticles.length} articles that are still trending...`);
        await supabaseAdmin.from('public_news_articles').delete().eq('category', category);
        if (retainedArticles.length > 0) {
            await supabaseAdmin.from('public_news_articles').insert(retainedArticles);
        }
        return { success: true, articlesUpdated: retainedArticles.length };
    }

    logger.success(`[${category}] Sending ${newArticles.length} fresh, unique articles to the AI for a makeover...`);
    
    const formattedArticlesMap = await formatArticleBatchWithGemini(
        newArticles, 
        category,
        logger, 
        assignedGeminiKey,
        getFallbackGeminiKey,
        config
    );
    
    const successfulArticles = newArticles.map((article: any) => {
        const formattedData = formattedArticlesMap.get(article.url);
        if (formattedData) {
            const updatedArticleData = { ...article };
            updatedArticleData.title = formattedData.title; 

            return {
                category,
                article_data: updatedArticleData,
                formatted_content_md: { markdown: formattedData.markdown }
            };
        }
        return null;
    }).filter(Boolean);

    const successCount = successfulArticles.length;
    const aiSkippedCount = newArticles.length - successCount; // Articles AI refused to format
    
    logger.info(`[${category}] The AI is done! It beautifully formatted ${successCount} articles, and decided to skip ${aiSkippedCount}.`);
    logger.addSummary(`[${category}] Fetched: ${articles.length} | Duplicates: ${duplicateCount} | Sent to AI: ${newArticles.length} | AI Formatted: ${successCount} | AI Skipped: ${aiSkippedCount}`);

    const allArticlesToSave = [...retainedArticles, ...successfulArticles];

    if (allArticlesToSave.length === 0) {
      logger.warn(`[${category}] Nothing new to save this time around.`);
      return { success: true, articlesUpdated: 0 };
    }
    
    logger.info(`[${category}] Clearing out the old news for this category...`);
    const { error: deleteError } = await supabaseAdmin.from('public_news_articles').delete().eq('category', category);
    if (deleteError) throw new Error(`Database cleanup failed: ${deleteError.message}`);
    
    logger.info(`[${category}] Saving ${allArticlesToSave.length} articles to the database (${retainedArticles.length} old favorites + ${successfulArticles.length} brand new ones)...`);
    const { error: insertError } = await supabaseAdmin.from('public_news_articles').insert(allArticlesToSave);
    if (insertError) throw new Error(`Database save failed: ${insertError.message}`);
    
    articlesUpdated = allArticlesToSave.length;
    logger.success(`[${category}] Awesome! ${articlesUpdated} articles are now live and ready to read.`);
    return { success: true, articlesUpdated };
  } catch (error) {
    let simpleError = error.message.includes('GNews') ? "Failed to connect to the news source" : error.message;
    logger.error(`[${category}] Oops, hit a snag while updating this category: ${simpleError}`);
    return { success: false, articlesUpdated: 0 };
  }
};