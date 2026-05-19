# Kalina AI - Edge Function: `image-proxy`

This directory contains the files for the `image-proxy` Supabase Edge Function. Its purpose is to act as a server-side proxy to fetch images from external URLs. This is necessary to bypass client-side CORS (Cross-Origin Resource Sharing) restrictions that prevent JavaScript running in the browser from directly accessing image data from other domains.

The function takes a URL as a query parameter, fetches the image, converts it to a Base64-encoded data URL, and returns it as a JSON payload. The client-side application can then load this data URL without any CORS issues.

**Instructions for Myself (the AI):**
- I will refer to this file when asked to view, modify, or explain the image proxy logic.

---

## File Structure

The function consists of a single file:

-   `index.md`: Contains the main entry point logic.
-   `index.ts`: An empty file that Supabase serves.

## Required Secrets

This function does not require any environment variables or secrets.

## Code for Each File

### `index.md` (Main Entry Point)
```typescript
// supabase/functions/image-proxy/index.ts
import { serve } from "https://deno.land/std/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const toBase64 = (buffer: ArrayBuffer) => {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const imageUrl = url.searchParams.get('url');

    if (!imageUrl) {
      return new Response(JSON.stringify({ error: "URL parameter is required." }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      });
    }

    const imageResponse = await fetch(imageUrl);

    if (!imageResponse.ok) {
      throw new Error(`Failed to fetch image with status: ${imageResponse.status}`);
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    const imageBase64 = toBase64(imageBuffer);
    const mimeType = imageResponse.headers.get('Content-Type') || 'image/jpeg';

    return new Response(JSON.stringify({ dataUrl: `data:${mimeType};base64,${imageBase64}` }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error('Error in image-proxy function:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
```