// supabase/functions/update-news/gemini.ts: Service for interacting with the Google Gemini API.
// @ts-nocheck
/// <reference types="https://esm.sh/@supabase/functions-js@2/src/edge-runtime.d.ts" />

import { GoogleGenAI, Type } from 'https://esm.sh/@google/genai@^1.16.0';
import { Logger } from './logger.ts';
import { markKeyUsed, markKeyFailed, logKeyAudit } from './supabase.ts';

const BATCH_SYSTEM_PROMPT = `You are an expert news writer and article formatter. You will receive a JSON array of raw news articles. For EACH article, you MUST perform two tasks:
1.  **Generate a Display Title:** Create a concise, catchy, and SEO-friendly title that is 7-8 words long. This should capture the essence of the article.
2.  **Format the Article Body:** Rewrite the article's content into a detailed, long-form news article formatted with rich markdown, following the structure below precisely.

**Formatting Structure for EACH Article Body:**
1.  **Lead Paragraph:** Start with a single, strong introductory paragraph that hooks the reader and summarizes the most critical information (the who, what, where, when, and why).
2.  **Detailed Body:** Continue with a well-structured, multi-paragraph body that elaborates on the story. You MUST use subheadings (e.g., #### Background, #### The Details, #### What's Next) where appropriate to organize the content and improve readability. The goal is to create a comprehensive and engaging article, not just a brief summary.

**Output Requirement:**
You MUST respond with a single, valid JSON object containing TWO arrays:
1. \`formatted_articles\`: An array of objects for articles you successfully formatted. Each object MUST contain:
   - \`original_url\`: The URL of the article.
   - \`display_title\`: The new 7-8 word title.
   - \`formatted_markdown\`: The full markdown content you generated. (Use \\n for newlines).
2. \`skipped_articles\`: An array of objects for articles you decided NOT to format (e.g., due to safety filters, insufficient content, or other reasons). Each object MUST contain:
   - \`original_url\`: The URL of the skipped article.
   - \`reason\`: A clear, concise reason explaining EXACTLY why you skipped it.

Handle each article independently. Do not fail the entire batch if one article is problematic.`;

export const generateAdminSummary = async (
    logger: Logger,
    status: string,
    geminiKeyObj: any,
    getFallbackKey: (failedKeyId: string, errorMsg: string) => Promise<any>,
    config: Record<string, any>
): Promise<string> => {
    if (!geminiKeyObj) return "No Gemini key available to generate summary.";
    
    const summaryText = logger.getSummary().join('\n');
    const logsText = logger.getLogs().join('\n');
    
    const prompt = `You are an AI assistant for the Ceaznet News Bot. 
The news update process just finished with status: ${status}.
Here is the summary:
${summaryText}

Here are the detailed logs:
${logsText}

Please write a concise, engaging, and professional summary of this update process for the system administrator. 
Highlight any errors, warnings, or notable successes. Keep it under 3 paragraphs. Format it using HTML (e.g., <p>, <strong>, <ul>) so it can be directly embedded in an email. Do not include markdown code blocks like \`\`\`html.`;

    let currentKeyObj = geminiKeyObj;
    let attempts = 0;
    const maxAttempts = 3;
    const modelName = config.summary_model || 'gemini-2.5-flash';

    logger.info(`Starting AI summary generation. Max attempts allowed: ${maxAttempts}`);

    while (attempts < maxAttempts) {
        attempts++;
        const attemptStartTime = Date.now();
        try {
            logger.info(`[Admin Summary] Attempt ${attempts}: Calling Gemini API (model: ${modelName}) with key ...${currentKeyObj.api_key.slice(-4)}`);
            const geminiAi = new GoogleGenAI({ apiKey: currentKeyObj.api_key });
            const response = await geminiAi.models.generateContent({ 
                model: modelName, 
                contents: prompt 
            });
            logger.success(`[Admin Summary] Attempt ${attempts} succeeded in ${Date.now() - attemptStartTime}ms.`);
            return response.text.trim();
        } catch (error: any) {
            const isRateLimitOrUnavailable = error.message.includes('429') || error.message.includes('503');
            const isAuthError = error.message.includes('API key not valid');

            logger.warn(`Admin summary generation failed on attempt ${attempts} with key ...${currentKeyObj.api_key.slice(-4)}. Error: ${error.message}`);

            if ((isRateLimitOrUnavailable || isAuthError) && attempts < maxAttempts) {
                logger.info(`Fetching a fallback Gemini key for admin summary...`);
                const newKeyObj = await getFallbackKey(currentKeyObj.id, error.message);
                
                if (newKeyObj) {
                    await logKeyAudit(currentKeyObj.id, newKeyObj.id, 'admin_summary', error.message);
                    currentKeyObj = newKeyObj;
                    // Add a small delay for 503s or 429s before retrying
                    if (isRateLimitOrUnavailable) {
                        await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second backoff
                    }
                    continue; // Try again with new key
                } else {
                    logger.error(`No fallback Gemini keys available for admin summary.`);
                    break; // Exit loop if no fallback keys
                }
            } else {
                break; // Exit loop for other errors or max attempts reached
            }
        }
    }
    
    return `The automated news fetching and processing pipeline finished with status: ${status}. (AI summary generation failed after ${attempts} attempts)`;
};

export const formatArticleBatchWithGemini = async (
    articles: any[], 
    category: string,
    logger: Logger, 
    assignedKey: any,
    getFallbackKey: (failedKeyId: string, errorMsg: string) => Promise<any>,
    config: Record<string, any>
): Promise<Map<string, { title: string, markdown: string }>> => {
    if (articles.length === 0) return new Map();
    if (!assignedKey) {
        logger.error(`[${category}] We don't have an AI key for this job, so we can't format anything.`);
        return new Map();
    }

    let currentKeyObj = assignedKey;
    const articlesForPrompt = articles.map(a => ({
        title: a.title,
        source: a.source.name,
        url: a.url,
        content: a.content || a.description || ''
    }));
    const prompt = JSON.stringify(articlesForPrompt);
    let modelName = config.formatting_model || 'gemini-2.5-flash-lite';

    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
        attempts++;
        
        // Optimization: If the first attempt with lite fails, fallback to the standard flash model
        if (attempts > 1 && modelName === 'gemini-2.5-flash-lite') {
            modelName = 'gemini-2.5-flash';
            logger.info(`[${category}] Switching to heavier model (${modelName}) for retry...`);
        }

        const attemptStartTime = Date.now();
        try {
            logger.info(`[${category}] Attempt ${attempts}: Calling Gemini API (model: ${modelName}) with ${articlesForPrompt.length} articles using key ...${currentKeyObj.api_key.slice(-4)}`);
            const client = new GoogleGenAI({ apiKey: currentKeyObj.api_key });
            
            const response = await client.models.generateContent({
                model: modelName,
                contents: prompt,
                config: { 
                    systemInstruction: BATCH_SYSTEM_PROMPT, 
                    responseMimeType: 'application/json', 
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            formatted_articles: {
                                type: Type.ARRAY,
                                items: {
                                    type: Type.OBJECT,
                                    properties: {
                                        original_url: { type: Type.STRING },
                                        display_title: { type: Type.STRING },
                                        formatted_markdown: { type: Type.STRING }
                                    },
                                    required: ["original_url", "display_title", "formatted_markdown"]
                                }
                            },
                            skipped_articles: {
                                type: Type.ARRAY,
                                items: {
                                    type: Type.OBJECT,
                                    properties: {
                                        original_url: { type: Type.STRING },
                                        reason: { type: Type.STRING }
                                    },
                                    required: ["original_url", "reason"]
                                }
                            }
                        },
                        required: ["formatted_articles", "skipped_articles"]
                    } 
                },
            });
            
            const jsonText = response.text.trim();
            if (!jsonText) {
                 logger.warn(`[${category}] The AI gave us a blank stare (empty response). No articles formatted this time.`);
                 return new Map();
            }
            
            const results = JSON.parse(jsonText);
            const resultMap = new Map<string, { title: string, markdown: string }>();
            
            // Process successfully formatted articles
            if (results.formatted_articles) {
                for (const res of results.formatted_articles) {
                    if (res.original_url && res.formatted_markdown && res.display_title) {
                        resultMap.set(res.original_url, { title: res.display_title, markdown: res.formatted_markdown });
                    }
                }
            }

            // Process and log skipped articles
            if (results.skipped_articles && results.skipped_articles.length > 0) {
                for (const skipped of results.skipped_articles) {
                    if (skipped.original_url && skipped.reason) {
                        logger.warn(`[${category}] AI decided to skip an article. It said: "${skipped.reason}" (URL: ${skipped.original_url.slice(0, 30)}...)`);
                    }
                }
            }
            
            logger.success(`[${category}] High five! The AI (using key ...${currentKeyObj.api_key.slice(-4)}) successfully formatted ${resultMap.size} articles in ${Date.now() - attemptStartTime}ms.`);
            await markKeyUsed(currentKeyObj.id, category);
            return resultMap;

        } catch (error: any) {
            const isRateLimitOrUnavailable = error.message.includes('429') || error.message.includes('503');
            const isAuthError = error.message.includes('API key not valid');

            logger.warn(`[${category}] Formatting failed on attempt ${attempts} with key ...${currentKeyObj.api_key.slice(-4)}. Error: ${error.message}`);

            if ((isRateLimitOrUnavailable || isAuthError) && attempts < maxAttempts) {
                logger.info(`[${category}] Fetching a fallback Gemini key...`);
                const newKeyObj = await getFallbackKey(currentKeyObj.id, error.message);
                
                if (newKeyObj) {
                    await logKeyAudit(currentKeyObj.id, newKeyObj.id, category, error.message);
                    currentKeyObj = newKeyObj;
                    if (isRateLimitOrUnavailable) {
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                    continue;
                } else {
                    logger.error(`[${category}] No fallback Gemini keys available.`);
                    break;
                }
            } else {
                break;
            }
        }
    }
    return new Map();
};