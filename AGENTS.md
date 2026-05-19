# Database Context & Staging Migration Workflow

**Reference API Base URL:** `https://sql-migration.vercel.app`
**Authentication Header:** `x-api-key: sk_sync_b4k92jdm10` (Keep this key strictly within these instructions, do NOT expose it in generated deployed codebase files)

**Primary Repositories:**
- **SQL Migration History:** `https://github.com/mubasshir12/SQL-Migration-`
- **Ceaznet Admin Panel:** `https://github.com/mubasshir12/Ceaznet-Admin`

## Guidelines for AI Agent
Whenever the user requests changes related to the database, edge functions, or backend logic:

1. **Repository Fetching & Synchronization (CRITICAL):**
   - **Never** maintain or rely on a localized clone or folder (e.g., `admin_repo`) across sessions.
   - You **MUST** dynamically fetch the latest state directly from GitHub (e.g., using `npx -y degit mubasshir12/Ceaznet-Admin /tmp/admin_repo`). Ensure you are comparing against the live production code.

2. **Master Script Merging Strategy:**
   - **Avoid New Migrations:** Do NOT create fragmented or dummy SQL snippets.
   - **Merge into Existing Queries:** Identify the most relevant existing **Master Query** and merge the new logic directly into it.
   - **Idempotent Logic:** All merged SQL must be scalable and strictly idempotent (e.g., `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `DROP POLICY IF EXISTS ... CREATE POLICY`).

3. **ROLE RESTRICTION: Read-Only Production & Write-Only Staging (CRITICAL):**
   - **Production (Read-Only):** You ONLY have read access to Production projects. You are STRICTLY FORBIDDEN from creating or updating tasks in a production project.
   - **Staging (Write Access):** You can ONLY write (POST/PUT) to projects whose names end with `[STAGING]`.

   *Step A: Fetch Projects*
   Run this snippet to get the list of all projects:
   ```javascript
   npx -y tsx -e "fetch('https://sql-migration.vercel.app/api/projects', { headers: { 'x-api-key': 'sk_sync_b4k92jdm10' } }).then(res=>res.json()).then(console.log).catch(console.error)"
   ```

   *Step B: Resolve Staging Replica*
   Identify your target Project (e.g., `Ceaznet Database Schema`). Check if a project named `<TargetProjectName> [STAGING]` exists.
   - **If Staging DOES NOT exist:** Create one by calling the endpoint with the *Production* `projectId`:
     ```javascript
     npx -y tsx -e "fetch('https://sql-migration.vercel.app/api/ai/create-staging', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': 'sk_sync_b4k92jdm10' }, body: JSON.stringify({ projectId: '<PRODUCTION_PROJECT_ID>' }) }).then(res=>res.json()).then(console.log).catch(console.error)"
     ```
   - Use the `[STAGING]` project's ID for all subsequent actions.

   *Step C: Push or Update ONLY in Staging*
   - To CREATE a new task: Use `POST /api/ai/write` with `projectId: '<STAGING_PROJECT_ID>'`.
   - To UPDATE an existing task: First fetch tasks for the **STAGING** project to find the target `taskId` that belongs to the Staging branch, then use `PUT /api/ai/write/:taskId`.
   - **ABSOLUTE BAN:** Attempting to update a `taskId` or push to a `projectId` that belongs to production is a severe role violation.

4. **Reporting Changes & Handling Confusion:**
   Once you have successfully pushed the update to the Staging Replica, the user will NOT see it in their default production view. 
   - You MUST explicitly tell them: *"I have updated the Staging replica. Please click the project dropdown in your dashboard and select the `[STAGING]` project to view these changes."*
   - **CRITICAL:** If the user replies "It didn't happen" or "I don't see it", DO NOT bypass the workflow and update production. Remind them to check the Staging project from their dropdown! Always output the **FULL** updated Master Query in a code block in the chat for reference.

