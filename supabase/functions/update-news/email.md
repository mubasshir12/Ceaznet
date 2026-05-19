// supabase/functions/update-news/email.ts: Service for sending email reports.
// @ts-nocheck - This is a Deno file and should not be type-checked by the frontend's TypeScript compiler.
/// <reference types="https://esm.sh/@supabase/functions-js@2/src/edge-runtime.d.ts" />

import { Logger } from './logger.ts';

import { generateAdminSummary } from './gemini.ts';
import { markKeyUsed, markKeyFailed } from './supabase.ts';

const LOG_RECIPIENT_EMAIL = Deno.env.get('LOG_RECIPIENT_EMAIL');
const LOG_SENDER_EMAIL = Deno.env.get('LOG_SENDER_EMAIL');

/**
 * Creates a simple HTML report with a summary table of the news update process.
 * @param logger The logger instance with all execution data.
 * @param status The overall status of the function run.
 * @returns A simple HTML string for the email body.
 */
function createSimpleHtmlReport(logger: Logger, status: 'SUCCESS' | 'FAILURE', adminMessage: string, triggerType: string): string {
    const summary = logger.getSummary();
    const statusColor = status === 'SUCCESS' ? '#10b981' : '#ef4444'; // Tailwind colors: emerald-500, red-500
    const generatedDate = new Date().toUTCString();

    let totalArticlesUpdated = 0;
    const categoryStats: Record<string, { fetched: number, duplicates: number, sentToAi: number, formatted: number, skipped: number }> = {};

    summary.forEach(line => {
        const totalMatch = line.match(/Total Articles Updated: (\d+)/);
        if (totalMatch) {
            totalArticlesUpdated = parseInt(totalMatch[1], 10);
        }

        // Parse the new robust summary format
        const categoryMatch = line.match(/\[(.*?)\] Fetched: (\d+) \| Duplicates: (\d+) \| Sent to AI: (\d+) \| AI Formatted: (\d+) \| AI Skipped: (\d+)/);
        if (categoryMatch) {
            const [, category, fetched, duplicates, sentToAi, formatted, skipped] = categoryMatch;
            categoryStats[category] = {
                fetched: parseInt(fetched, 10),
                duplicates: parseInt(duplicates, 10),
                sentToAi: parseInt(sentToAi, 10),
                formatted: parseInt(formatted, 10),
                skipped: parseInt(skipped, 10),
            };
        }
    });

    const tableRows = Object.entries(categoryStats).map(([category, stats]) => `
        <tr>
            <td style="padding: 12px 4px; border-bottom: 1px dashed #eaeaea; text-transform: uppercase; font-weight: 400; color: #333; letter-spacing: 1px; font-size: 11px; text-align: left;">${category}</td>
            <td style="padding: 12px 4px; border-bottom: 1px dashed #eaeaea; text-align: center; color: #666; font-family: 'JetBrains Mono', monospace; font-size: 13px; font-weight: 300;">${stats.fetched}</td>
            <td style="padding: 12px 4px; border-bottom: 1px dashed #eaeaea; text-align: center; color: #aaa; font-family: 'JetBrains Mono', monospace; font-size: 13px; font-weight: 300;">${stats.duplicates}</td>
            <td style="padding: 12px 4px; border-bottom: 1px dashed #eaeaea; text-align: center; color: #666; font-family: 'JetBrains Mono', monospace; font-size: 13px; font-weight: 300;">${stats.sentToAi}</td>
            <td style="padding: 12px 4px; border-bottom: 1px dashed #eaeaea; text-align: center; color: #10b981; font-family: 'JetBrains Mono', monospace; font-size: 13px; font-weight: 400;">${stats.formatted}</td>
            <td style="padding: 12px 4px; border-bottom: 1px dashed #eaeaea; text-align: center; color: ${stats.skipped > 0 ? '#ef4444' : '#aaa'}; font-family: 'JetBrains Mono', monospace; font-size: 13px; font-weight: 400;">${stats.skipped}</td>
        </tr>
    `).join('');

    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Ceaznet News Update Report</title>
        <style>
            @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400&family=JetBrains+Mono:wght@300;400&display=swap');
            
            body { 
                font-family: 'Outfit', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; 
                color: #444; 
                line-height: 1.5; 
                background-color: #ffffff; 
                margin: 0;
                padding: 15px 10px;
                font-weight: 300;
            }
            .wrapper { 
                max-width: 600px; 
                margin: 0 auto; 
            }
            h1 { 
                font-size: 22px; 
                margin: 0 0 15px 0; 
                font-weight: 400; 
                letter-spacing: -0.5px;
                color: #111;
                text-align: left;
            }
            .admin-message {
                font-size: 13px;
                color: #555;
                line-height: 1.6;
                margin-bottom: 25px;
                padding: 15px;
                background-color: #fcfcfc;
                border-left: 3px solid ${statusColor};
            }
            
            /* Meta Table (replaces flexbox) */
            .meta-table {
                width: 100%;
                border-collapse: collapse;
                margin-bottom: 20px;
                border-bottom: 1px solid #eee;
                padding-bottom: 15px;
            }
            .meta-table td {
                padding: 4px 0;
            }
            .meta-label {
                font-size: 10px;
                color: #888;
                text-transform: uppercase;
                letter-spacing: 1px;
                width: 80px;
                text-align: left;
            }
            .meta-value {
                font-family: 'JetBrains Mono', monospace;
                font-size: 12px;
                color: #333;
                text-align: right;
            }
            
            /* Main Data Table */
            .data-table { 
                width: 100%; 
                border-collapse: collapse; 
            }
            .data-table th { 
                text-align: center; 
                padding: 8px 2px; 
                border-bottom: 1px solid #ddd; 
                color: #aaa; 
                font-weight: 400; 
                font-size: 9px;
                text-transform: uppercase;
                letter-spacing: 1px;
            }
            .data-table th:first-child { text-align: left; }
            
            /* Footer Table (replaces flexbox) */
            .footer-table {
                width: 100%;
                border-collapse: collapse;
                margin-top: 30px;
                border-top: 1px solid #eee;
                padding-top: 15px;
            }
            .footer-table td {
                padding: 4px 0;
            }
            .footer-label {
                font-size: 10px;
                color: #888;
                text-transform: uppercase;
                letter-spacing: 0.5px;
                text-align: left;
            }
            .footer-val {
                font-size: 10px;
                font-family: 'JetBrains Mono', monospace;
                color: #555;
                text-align: right;
            }
        </style>
    </head>
    <body>
        <div class="wrapper">
            <h1>System Update</h1>
            
            <div class="admin-message">
                ${adminMessage}
            </div>
            
            <table class="meta-table">
                <tr>
                    <td class="meta-label">Status</td>
                    <td class="meta-value" style="color: ${statusColor};">${status.toUpperCase()}</td>
                </tr>
                <tr>
                    <td class="meta-label">Updated</td>
                    <td class="meta-value">${totalArticlesUpdated} Articles</td>
                </tr>
                <tr>
                    <td class="meta-label">Time</td>
                    <td class="meta-value">${generatedDate}</td>
                </tr>
            </table>
            
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Category</th>
                        <th>Fetch</th>
                        <th>Dupe</th>
                        <th>To AI</th>
                        <th>Done</th>
                        <th>Skip</th>
                    </tr>
                </thead>
                <tbody>
                    ${tableRows}
                </tbody>
            </table>
            
            <table class="footer-table">
                <tr>
                    <td class="footer-label">Execution Environment</td>
                    <td class="footer-val">Supabase Edge Function</td>
                </tr>
                <tr>
                    <td class="footer-label">Database</td>
                    <td class="footer-val">Supabase PostgreSQL</td>
                </tr>
                <tr>
                    <td class="footer-label">AI Model</td>
                    <td class="footer-val">Gemini 2.5 Flash</td>
                </tr>
                <tr>
                    <td class="footer-label">News Source</td>
                    <td class="footer-val">GNews API</td>
                </tr>
                <tr>
                    <td class="footer-label">Trigger Type</td>
                    <td class="footer-val">${triggerType}</td>
                </tr>
                <tr>
                    <td class="footer-label">System Version</td>
                    <td class="footer-val">Ceaznet v2.8</td>
                </tr>
            </table>
        </div>
    </body>
    </html>
    `;
}


export async function sendEmailLog(
  logger: Logger, 
  status: 'SUCCESS' | 'FAILURE', 
  brevoKeyObj: any, 
  geminiKeyObj: any,
  getGeminiFallbackKey: (failedKeyId: string, errorMsg: string) => Promise<any>,
  config: Record<string, any>,
  triggerType: string
) {
  if (!LOG_RECIPIENT_EMAIL || !LOG_SENDER_EMAIL) {
    logger.error('Email service env vars not set. Skipping email.');
    return;
  }
  if (!brevoKeyObj) {
    logger.error('No Brevo API key available in the database. Skipping email.');
    return;
  }

  // Generate AI Summary
  logger.info('Generating AI summary for the email report...');
  const adminMessage = await generateAdminSummary(logger, status, geminiKeyObj, getGeminiFallbackKey, config);

  const subject = \`Ceaznet News Update Report: \${status.toUpperCase()}\`;
  const htmlContent = createSimpleHtmlReport(logger, status, adminMessage, triggerType);

  const emailPayload = {
    sender: { name: 'Ceaznet Bot', email: LOG_SENDER_EMAIL },
    to: [{ email: LOG_RECIPIENT_EMAIL }],
    subject,
    htmlContent: htmlContent,
  };

  try {
    const emailStartTime = Date.now();
    logger.info(`Sending email via Brevo API using key ...${brevoKeyObj.api_key.slice(-4)}`);
    
    // Log a sanitized version of the payload
    const sanitizedPayload = { ...emailPayload, htmlContent: '[HTML CONTENT HIDDEN FOR LOGS]' };
    logger.info(`Email Payload: ${JSON.stringify(sanitizedPayload)}`);

    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'accept': 'application/json', 'api-key': brevoKeyObj.api_key, 'content-type': 'application/json' },
      body: JSON.stringify(emailPayload),
    });
    
    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Brevo API Error: ${response.status} ${response.statusText} - ${errorBody}`);
    }
    
    const responseData = await response.json();
    logger.success(`Successfully sent email report in ${Date.now() - emailStartTime}ms. Status: ${response.status} ${response.statusText}. Receipt (Message ID): ${responseData.messageId}`);
    await markKeyUsed(brevoKeyObj.id, 'email_report');
  } catch (error) {
    logger.error(`Email send failed: ${error.message}`);
    await markKeyFailed(brevoKeyObj.id, error.message, 3);
  }
}
