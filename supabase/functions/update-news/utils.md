// supabase/functions/update-news/utils.ts: Contains shared utility functions.
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));