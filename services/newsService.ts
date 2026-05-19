import { NewsArticle } from '../types';
import { supabase } from './supabaseClient';

export const fetchNews = async (category: string): Promise<NewsArticle[]> => {
    try {
        // Optimized Egress: Direct database queries replaced with cached backend API
        // which uses Vercel Edge Cache via GET requests.
        const response = await fetch(`/api/news?category=${encodeURIComponent(category)}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || 'Failed to fetch from cache api');
        }

        const json = await response.json();
        const data = json.data;

        // Add a filter to prevent errors from malformed data with null article_data
        return data
            ? data
                .filter(item => item && item.article_data)
                .map(item => ({
                    ...(item.article_data as NewsArticle),
                    category: item.category,
                    formattedContent: item.formatted_content_md,
                    views: item.views || 0,
                    likes: item.likes || 0,
                    bookmarks: item.bookmarks || 0,
                }))
            : [];
    } catch (error: any) {
        // Log a more descriptive error, which directly fixes the "[object Object]" problem.
        const descriptiveError = error.message ? `${error.message}${error.details ? ` | Details: ${error.details}`: ''}` : JSON.stringify(error);
        console.error(`Error fetching news for category "${category}": ${descriptiveError}`);
        // Re-throw a standard Error to be handled by the UI.
        throw new Error(error.message || `Failed to fetch news for ${category}.`);
    }
};