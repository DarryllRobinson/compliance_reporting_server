# compliance_reporting_server

## Setup

### Environment Configuration

1. Create a `.env` file with the following values (adjust as needed):

   ```env
   DB_HOST=localhost
   DB_USER=myuser
   DB_PASSWORD=mypassword
   DB_NAME=compliance_reporting
   NODE_ENV=development
   PORT=4000
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. Start the development server (with auto-reload):

   ```bash
   npx nodemon server.js
   ```

   If `nodemon` is not installed globally, install it with:

   ```bash
   npm install --save-dev nodemon
   ```

4. Optional: Add a script to `package.json` for easier development:

   ```json
   "scripts": {
     "dev": "nodemon server.js"
   }
   ```

   Then run:

   ```bash
   npm run dev
   ```

## Multi-Tenancy with MySQL Views & Triggers

Create a per-table view using the connected username (format: tenant@host):

```sql
CREATE VIEW v_reports AS
SELECT * FROM tbl_reports
WHERE tenant_id = SUBSTRING_INDEX(USER(), '@', 1);
```

Set the tenant ID automatically on insert:

```sql
CREATE TRIGGER before_insert_reports
BEFORE INSERT ON tbl_reports
FOR EACH ROW
SET NEW.tenant_id = SUBSTRING_INDEX(USER(), '@', 1);
```
