# QuickBooks Integration - Client Setup Guide

**Simple 3-Step Setup for Kuwait Petrol Pump POS**

Your QuickBooks integration is already installed and ready to connect. Just follow these steps:

---

## Step 1: Update Your Intuit Developer App (5 minutes)

You already have QuickBooks credentials configured. You just need to add one redirect URL:

1. **Log in to Intuit Developer Portal**
   - Go to https://developer.intuit.com
   - Log in with your Intuit account (the one that created your QuickBooks app)

2. **Find Your QuickBooks App**
   - Click **Dashboard** (top menu)
   - You should see your app in the list
   - Click on your app name

3. **Add Redirect URI**
   - Click **Keys & OAuth** in the left sidebar
   - Scroll down to **Redirect URIs** section
   - Click **Add URI** button
   - Enter this EXACT URL:
     ```
     https://kuwaitpos.duckdns.org/api/quickbooks/oauth/callback
     ```
   - Click **Save**

**That's it!** Your Intuit app is now configured.

---

## Step 2: Connect QuickBooks to POS (2 minutes)

1. **Log in to POS Dashboard**
   - Go to https://kuwaitpos.duckdns.org
   - Use your admin username and password

2. **Go to QuickBooks Settings**
   - Click **Settings** menu (top right or sidebar)
   - Click **QuickBooks** or **Integrations**

3. **Connect QuickBooks**
   - Click the **"Connect QuickBooks"** button
   - You'll be redirected to Intuit's authorization page
   - Click **Authorize** to allow POS to access your QuickBooks company
   - You'll be redirected back to POS
   - You should see: ✅ **Connected to [Your Company Name]**

---

## Step 3: Set Up Entity Mappings (15 minutes)

QuickBooks needs to know how to match POS data to QuickBooks data. Your developer will help you create these mappings.

### What Needs to Be Mapped?

1. **Walk-In Customer** (for cash sales)
   - POS uses "walk-in" for customers who pay cash
   - Must map to a QuickBooks customer (like "Cash Customer")

2. **Payment Methods**
   - Cash → QuickBooks "Cash" payment method
   - Card → QuickBooks "Credit Card" payment method

3. **Fuel Types**
   - PMG (Petrol) → QuickBooks item for Petrol/Gasoline
   - HSD (Diesel) → QuickBooks item for Diesel

### How to Find QuickBooks IDs

Your developer needs these IDs from your QuickBooks account:

**For Customers:**
1. Log in to QuickBooks Online
2. Go to **Sales** → **Customers**
3. Click on "Cash Customer" (or your walk-in customer)
4. Look at the URL in your browser:
   ```
   https://app.qbo.intuit.com/app/customerdetail?nameId=123
   ```
   The number after `nameId=` is the customer ID (e.g., `123`)

**For Items (Fuel Products):**
1. Go to **Settings** (gear icon) → **Products and Services**
2. Click on "Petrol" or "Gasoline"
3. Look at the URL:
   ```
   https://app.qbo.intuit.com/app/itemdetail?nameId=456
   ```
   The number after `nameId=` is the item ID (e.g., `456`)

**For Payment Methods:**
- Payment methods usually match by name (Cash, Credit Card, etc.)
- Your developer will map these using QuickBooks API

### Mapping Creation (Developer Task)

Send these IDs to your developer:
- Walk-in customer ID: `____`
- Cash payment method: `____` (usually just "Cash")
- Card payment method: `____` (usually "Credit Card")
- Petrol/PMG item ID: `____`
- Diesel/HSD item ID: `____`

Developer will create mappings using API calls (see QB_DEPLOYMENT_CHECKLIST.md).

---

## Step 4: Test Your Integration (10 minutes)

### DRY RUN Test (No Real Data Sent)

Your developer will:
1. Enable **DRY_RUN** mode (test mode — no data sent to QuickBooks)
2. Ask you to create a test fuel sale in POS
3. Verify the sale is formatted correctly (but not sent to QB)

If this works, proceed to real sync.

### FULL SYNC Test (Real QuickBooks Writes)

Your developer will:
1. Enable **FULL_SYNC** mode (production mode — real data)
2. Ask you to create a test fuel sale
3. You verify it appears in QuickBooks:
   - Log in to QuickBooks Online
   - Go to **Sales** → **Sales Receipts**
   - Find the receipt with note: "Kuwait POS Sale #[sale ID]"
   - Verify line items, customer, amount are correct

**If everything looks good, your integration is live!** 🎉

---

## What Happens Next?

Once enabled, every fuel sale in POS will automatically:
1. Create a queue job to sync to QuickBooks
2. Wait for admin approval (if enabled)
3. Send to QuickBooks within 10 seconds
4. Create a Sales Receipt in QuickBooks
5. Log success/failure in audit trail

You can monitor sync status:
- **Dashboard**: Shows sync health and recent activity
- **Reports**: View all synced sales
- **Audit Log**: See detailed sync history

---

## Troubleshooting

### "QuickBooks connection failed"
- Check that redirect URI is added to Intuit app (Step 1)
- Verify you authorized the app (Step 2)
- Contact your developer to check server logs

### "Walk-in customer mapping not found"
- Entity mappings not created yet (Step 3)
- Contact your developer to create mappings

### "Sales not syncing to QuickBooks"
- Check if DRY_RUN mode is still enabled (ask developer)
- Check if kill switch is active (ask developer)
- Check if batch approval is required (ask developer)

---

## Safety Controls

Your integration has multiple safety controls:

1. **Sync Mode**
   - **READ_ONLY**: No writes to QuickBooks (safe default)
   - **DRY_RUN**: Test mode (validates data but doesn't write)
   - **FULL_SYNC**: Production mode (writes real data)

2. **Kill Switch**
   - Emergency stop button
   - Immediately blocks ALL syncs
   - Use if you see ANY data issues

3. **Batch Approval**
   - Admin can review sync jobs before they run
   - Optional safety layer for peace of mind

Your developer controls these settings.

---

## Support

If you need help:
1. Check this guide first
2. Contact your developer
3. Check server logs: `ssh root@64.226.65.80 "docker logs kuwaitpos-backend --tail 100 | grep QB"`

---

**Setup Time**: 30 minutes total
**Cost**: $0 (uses existing QuickBooks subscription)
**Technical Skill**: Basic (just copy/paste URLs)

**Last Updated**: 2026-04-02
**Server**: kuwaitpos.duckdns.org
