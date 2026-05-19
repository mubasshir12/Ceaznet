// supabase/functions/update-news/index.ts: Main entry point for the news update function.
import { serve } from "https://deno.land/std/http/server.ts";
import { Logger } from './logger.ts';
import { corsHeaders } from './utils.ts';
import { processNewsCategory } from './news.ts';
import { sendEmailLog } from './email.ts';
import { supabaseAdmin, markKeyFailed, getNewsSystemConfig } from './supabase.ts';

const CATEGORIES = ['technology', 'business', 'science', 'health', 'sports', 'entertainment'];
const BATCH_SIZE = 6; // Process all 6 categories in parallel since we have dedicated keys for each

// Helper function to split an array into smaller chunks
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunkedArr: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunkedArr.push(array.slice(i, i + size));
  }
  return chunkedArr;
}

// KeyManager handles dynamic assignment, load balancing, cooldowns, and fallback logic
class KeyManager {
    private gnewsKeys: any[];
    private geminiKeys: any[];
    private brevoKeys: any[];

    constructor(keys: any[]) {
        const now = new Date().getTime();

        // Filter out exhausted keys UNLESS their cooldown period has expired (Self-Healing)
        const availableKeys = keys.filter(k => {
            if (k.status === 'active') return true;
            if (k.status === 'exhausted' && k.cooldown_until) {
                const cooldownTime = new Date(k.cooldown_until).getTime();
                return now > cooldownTime; // Cooldown is over, we can try using it again
            }
            return false;
        });

        // Sort keys by calls_count ascending (least used first), then by last_used_at ascending (longest idle)
        const sortedKeys = availableKeys.sort((a, b) => {
            if (a.calls_count !== b.calls_count) return a.calls_count - b.calls_count;
            const timeA = a.last_used_at ? new Date(a.last_used_at).getTime() : 0;
            const timeB = b.last_used_at ? new Date(b.last_used_at).getTime() : 0;
            return timeA - timeB;
        });

        this.gnewsKeys = sortedKeys.filter(k => k.provider === 'gnews');
        this.geminiKeys = sortedKeys.filter(k => k.provider === 'gemini');
        this.brevoKeys = sortedKeys.filter(k => k.provider === 'brevo');
    }

    // Assigns a dedicated key based on the category index
    getInitialKey(provider: 'gnews' | 'gemini' | 'brevo', categoryIndex: number) {
        const pool = provider === 'gnews' ? this.gnewsKeys : provider === 'gemini' ? this.geminiKeys : this.brevoKeys;
        if (pool.length === 0) return null;
        // Distribute load: assign a unique key to each category if enough keys exist
        return pool[categoryIndex % pool.length];
    }

    // Finds the least used key that isn't the one that just failed
    getFallbackKey(provider: 'gnews' | 'gemini' | 'brevo', failedKeyId: string) {
        const pool = provider === 'gnews' ? this.gnewsKeys : provider === 'gemini' ? this.geminiKeys : this.brevoKeys;
        // Filter out the failed key
        const validPool = pool.filter(k => k.id !== failedKeyId);
        if (validPool.length === 0) return null;
        
        // Re-sort to ensure we get the absolute least used key available
        validPool.sort((a, b) => a.calls_count - b.calls_count);
        return validPool[0];
    }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const logger = new Logger();
  let overallStatus: 'SUCCESS' | 'FAILURE' = 'SUCCESS';
  const startTime = Date.now();
  let keyManager: KeyManager | null = null;
  let systemConfig: Record<string, any> = {};
  
  // Determine trigger type (manual vs cron)
  let triggerType = 'cron';
  try {
    if (req.body) {
      const body = await req.json();
      if (body && body.trigger) {
        triggerType = body.trigger;
      }
    }
  } catch (e) {
    // Ignore JSON parse errors if body is empty
  }

  try {
    logger.info(`🚀 Waking up the news bot! Starting the update process... (Trigger: ${triggerType})`);
    
    // Set running status to true in DB
    await supabaseAdmin
      .from('news_system_config')
      .upsert({ 
          config_key: 'is_news_updating', 
          config_value: true, 
          updated_at: new Date() 
      }, { onConflict: 'config_key' });
      
    // Store the trigger type for the frontend to know how it was started
    await supabaseAdmin
      .from('news_system_config')
      .upsert({ 
          config_key: 'last_run_trigger', 
          config_value: `"${triggerType}"`, 
          updated_at: new Date() 
      }, { onConflict: 'config_key' });

    logger.info('Checking our API keys to see which ones are rested and ready to work...');
    
    // Fetch ALL API keys to check for cooldowns
    const { data: keysData, error: keysError } = await supabaseAdmin
      .from('news_api_keys')
      .select('*');

    if (keysError || !keysData) {
        throw new Error(`Failed to fetch keys from the database: ${keysError?.message}`);
    }

    keyManager = new KeyManager(keysData);
    logger.info(`Loaded keys from DB: ${keysData.filter(k => k.provider === 'gnews').length} GNews, ${keysData.filter(k => k.provider === 'gemini').length} Gemini, ${keysData.filter(k => k.provider === 'brevo').length} Brevo.`);

    systemConfig = await getNewsSystemConfig();
    logger.info(`Loaded system config: Formatting Model = ${systemConfig.formatting_model || 'default'}, Summary Model = ${systemConfig.summary_model || 'default'}`);

    // Circuit Breaker: If no keys are available (all exhausted and on cooldown), abort early.
    if (!keyManager.getInitialKey('gnews', 0) || !keyManager.getInitialKey('gemini', 0)) {
        logger.error('🛑 CIRCUIT BREAKER TRIPPED: All API keys for either GNews or Gemini are currently exhausted and on cooldown. Please wait or add new keys.');
        throw new Error('No available API keys. System is on cooldown.');
    }

    logger.info('🧹 Sweeping away yesterday\'s news to make room for the fresh stuff...');
    const cleanupStartTime = Date.now();
    await Promise.all([
      supabaseAdmin.from('article_conversations').delete().neq('id', '00000000-0000-0000-0000-000000000000'),
      supabaseAdmin.from('public_article_cache').delete().neq('article_url', 'dummy_url_to_avoid_empty_delete'),
      supabaseAdmin.from('user_article_interactions').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    ]);
    logger.success(`✅ All clean! Database cleanup took ${Date.now() - cleanupStartTime}ms.`);
    
    const categoryBatches = chunkArray(CATEGORIES, BATCH_SIZE);
    const allResults = [];

    logger.info(`Handing out assignments! Giving each of the ${CATEGORIES.length} categories its own API key and getting to work...`);

    let batchNumber = 1;
    for (const batch of categoryBatches) {
      logger.info(`Starting processing for Batch ${batchNumber}/${categoryBatches.length} (Categories: ${batch.join(', ')})`);
      const batchStartTime = Date.now();
      const batchResults = await Promise.all(
        batch.map(async (category) => {
            const globalIndex = CATEGORIES.indexOf(category);
            
            // Stagger parallel execution by 1500ms per index to strictly avoid GNews rate limits (1 req/sec)
            await new Promise(resolve => setTimeout(resolve, globalIndex * 1500));

            // Assign dedicated, least-used keys to this specific category
            const assignedGnewsKey = keyManager.getInitialKey('gnews', globalIndex);
            const assignedGeminiKey = keyManager.getInitialKey('gemini', globalIndex);
            
            logger.info(`[${category}] Assigned GNews Key: ...${assignedGnewsKey?.api_key.slice(-4) || 'NONE'}, Gemini Key: ...${assignedGeminiKey?.api_key.slice(-4) || 'NONE'}`);

            return processNewsCategory(
                category, 
                logger, 
                assignedGnewsKey, 
                assignedGeminiKey,
                // Fallback callback for GNews
                async (failedKeyId, errorMsg) => {
                    await markKeyFailed(failedKeyId, errorMsg, 3);
                    return keyManager.getFallbackKey('gnews', failedKeyId);
                },
                // Fallback callback for Gemini
                async (failedKeyId, errorMsg) => {
                    await markKeyFailed(failedKeyId, errorMsg, 3);
                    return keyManager.getFallbackKey('gemini', failedKeyId);
                },
                systemConfig
            );
        })
      );
      allResults.push(...batchResults);
      logger.info(`Completed Batch ${batchNumber}/${categoryBatches.length} in ${Date.now() - batchStartTime}ms.`);
      batchNumber++;
    }
    
    let totalArticlesUpdated = 0;
    allResults.forEach(result => {
      if (result.success) {
        totalArticlesUpdated += result.articlesUpdated;
      } else {
        overallStatus = 'FAILURE';
      }
    });

    logger.info('✅ Phew! The news update is all done.');
    logger.addSummary(`Total Articles Updated: ${totalArticlesUpdated}`);
    
    return new Response(JSON.stringify({ message: 'News update completed successfully.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    overallStatus = 'FAILURE';
    logger.error(`🚨 Uh oh! Something big broke: ${error.message}`);
    
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  } finally {
    const duration_ms = Date.now() - startTime;
    logger.info(`We finished everything in ${(duration_ms / 1000).toFixed(2)} seconds`);
    
    // Log the run to the database for the admin panel.
    const { error: logError } = await supabaseAdmin
      .from('update_news_logs')
      .insert({
          status: overallStatus,
          duration_ms,
          summary: [`Trigger Type: ${triggerType}`, ...logger.getSummary()],
          details: logger.getLogs().join('\n')
      });
      
    if (logError) {
        console.error("Failed to save the log to the database:", logError.message);
    }

    // CRITICAL: Always reset the status, even if the function fails
    await supabaseAdmin
      .from('news_system_config')
      .upsert({ 
          config_key: 'is_news_updating', 
          config_value: false, 
          updated_at: new Date() 
      }, { onConflict: 'config_key' });
      
    console.log('✅ Status reset to false.');

    logger.info('📤 Sending the boss an email with the summary...');
    const brevoKey = keyManager ? keyManager.getInitialKey('brevo', 0) : null;
    const geminiKey = keyManager ? keyManager.getInitialKey('gemini', 0) : null;
    
    const geminiFallbackCallback = async (failedKeyId: string, errorMsg: string) => {
        await markKeyFailed(failedKeyId, errorMsg, 3);
        return keyManager ? keyManager.getFallbackKey('gemini', failedKeyId) : null;
    };

    await sendEmailLog(logger, overallStatus, brevoKey, geminiKey, geminiFallbackCallback, systemConfig, triggerType);
    logger.info("Email sent. System shutting down.");
  }
});