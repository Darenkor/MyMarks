---
description: How to connect a new WordPress site via MCP
---

# Add a New WordPress Site to MCP

This workflow connects a new WordPress site so it can be managed remotely via MCP.

## Prerequisites
- WordPress 5.6+ with HTTPS enabled
- Admin access to the WordPress site

## Steps

### 1. Install the `wordpress-mcp` plugin on the WordPress site
- Download `wordpress-mcp.zip` from https://github.com/Automattic/wordpress-mcp/releases/
- Upload via **Plugins > Add New > Upload Plugin**
- Activate the plugin
- Go to **Settings > WordPress MCP** and enable:
  - MCP Functionality ✅
  - REST API CRUD Tools ✅
  - Enable Create Tools ✅
  - Enable Update Tools ✅
  - Enable Delete Tools ✅

### 2. Create an Application Password
- Go to **Users > Your Profile**
- Scroll to "Application Passwords"
- Enter name: `MCP Server`
- Click "Add New Application Password"
- **Copy the password** (won't be shown again)

### 3. Add the site to `mcp_config.json`

Edit `C:\Users\USUARIO\.gemini\antigravity\mcp_config.json` and add a new entry inside `mcpServers`:

```json
"wordpress-SITENAME": {
  "command": "npx",
  "args": ["-y", "@automattic/mcp-wordpress-remote@latest"],
  "env": {
    "WP_API_URL": "https://your-site.com",
    "WP_API_USERNAME": "your-username",
    "WP_API_PASSWORD": "xxxx xxxx xxxx xxxx",
    "OAUTH_ENABLED": "false",
    "LOG_FILE": "C:\\Users\\USUARIO\\.gemini\\antigravity\\logs\\wordpress-SITENAME.log"
  }
}
```

Replace:
- `SITENAME` → a short alias for this site (e.g., `darenkor`, `clouris`)
- `WP_API_URL` → the site URL (with https://)
- `WP_API_USERNAME` → your WordPress username
- `WP_API_PASSWORD` → the Application Password from step 2

### 4. (Optional) Add WooCommerce support

If the site uses WooCommerce, generate API keys at **WooCommerce > Settings > Advanced > REST API**, then add:

```json
"WOO_CUSTOMER_KEY": "ck_your-key",
"WOO_CUSTOMER_SECRET": "cs_your-secret"
```

### 5. Restart Antigravity

Restart the editor so the new MCP server is loaded. Then ask the AI to test the connection by listing posts from the site.
