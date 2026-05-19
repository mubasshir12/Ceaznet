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

// Advanced Helper functions for updating key stats and logging
export const markKeyUsed = async (keyId: string, category: string) => {
  await supabaseAdmin.rpc('mark_news_key_used', { key_id: keyId, cat: category });
  // Ensure failure count is completely reset on success to fix the 24-hour exhaust loop
  await supabaseAdmin.from('news_api_keys').update({ failure_count: 0, status: 'active', cooldown_until: null }).eq('id', keyId);
};

export const markKeyFailed = async (keyId: string, errorMsg: string, maxFailures: number = 3) => {
  await supabaseAdmin.rpc('mark_news_key_failed', { key_id: keyId, err_msg: errorMsg, max_failures: maxFailures });
};

export const logKeyAudit = async (failedId: string, fallbackId: string, category: string, errorMsg: string) => {
  await supabaseAdmin.rpc('log_api_key_audit', { failed_id: failedId, fallback_id: fallbackId, cat: category, err: errorMsg });
};

export const getNewsSystemConfig = async () => {
  const { data, error } = await supabaseAdmin.from('news_system_config').select('*');
  if (error) {
    console.error("Error fetching news_system_config:", error);
    return {};
  }
  const config: Record<string, any> = {};
  data?.forEach(row => {
    config[row.config_key] = row.config_value;
  });
  return config;
};
