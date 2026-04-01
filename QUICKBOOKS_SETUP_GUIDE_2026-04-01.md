# QuickBooks Online Integration Setup
**Date**: 2026-04-01
**Status**: Backend ready, needs credentials

---

## ✅ **What's Already Built**

- ✅ OAuth 2.0 flow implemented
- ✅ Entity mapping (Sales → Invoices, Customers, Products → Items)
- ✅ Safety gates and validation
- ✅ Rate limiting and error handling
- ✅ Sync queue and retry logic

**Backend is 100% ready - just needs your QuickBooks app credentials.**

---

## 🔑 **What You Need to Provide**

### **Option A: Use Existing QuickBooks App** ✅ (Recommended)

If you already have a QuickBooks app in Intuit Developer Portal:

1. **Login**: https://developer.intuit.com/app/developer/dashboard

2. **Select Your App** (or create new one)

3. **Navigate**: Keys & OAuth tab

4. **Add Redirect URI**:
   ```
   https://kuwaitpos.duckdns.org/api/quickbooks/oauth/callback
   ```

   **Important**:
   - Use HTTPS (not HTTP)
   - Exact match required
   - Click "Save"

5. **Copy Credentials**:
   - **Client ID**: `ABxxxxxxxxxxxxxxxxxxxxx` (copy this)
   - **Client Secret**: `xxxxxxxxxxxxxxxxxxxxx` (copy this)

6. **Send me both** (I'll configure the server)

---

### **Option B: Create New QuickBooks App** (2-3 Days Approval)

**Only if you don't have an existing app**:

1. Go to: https://developer.intuit.com/app/developer/dashboard
2. Click "Create an App"
3. Select "QuickBooks Online and Payments"
4. Fill in app details:
   - **App Name**: Kuwait Petrol Pump POS
   - **Description**: Petrol pump point of sale system
5. Add scopes:
   - Accounting (required)
   - OpenID (required)
6. Add redirect URI: `https://kuwaitpos.duckdns.org/api/quickbooks/oauth/callback`
7. Submit for review (takes 2-3 business days)
8. Once approved, copy Client ID and Secret

---

## 🛠️ **What I'll Do (After You Provide Credentials)**

### **Step 1: Update Server Environment**

SSH to server and update `.env`:
```bash
ssh root@64.226.65.80
cd /root/kuwait-pos
nano .env
```

Add/update:
```env
QUICKBOOKS_CLIENT_ID=your_client_id_here
QUICKBOOKS_CLIENT_SECRET=your_client_secret_here
QUICKBOOKS_REDIRECT_URI=https://kuwaitpos.duckdns.org/api/quickbooks/oauth/callback
QUICKBOOKS_ENVIRONMENT=production
```

### **Step 2: Restart Backend**

```bash
docker compose -f docker-compose.prod.yml restart backend
```

### **Step 3: Verify Configuration**

```bash
curl http://localhost:3000/api/health
```

---

## 🔗 **How to Connect QuickBooks (After Setup)**

### **Step 1: Initiate OAuth**

1. Login to web app as admin
2. Go to "Admin" → "QuickBooks" or "Integrations"
3. Click "Connect to QuickBooks"
4. Browser redirects to Intuit login
5. Select your company
6. Approve permissions

### **Step 2: Verify Connection**

API endpoint shows connection status:
```bash
curl http://64.226.65.80/api/quickbooks/status \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

Expected response:
```json
{
  "connected": true,
  "companyName": "Your Company",
  "realmId": "xxxxx",
  "lastSync": "2026-04-01T..."
}
```

---

## 📊 **What Gets Synced**

### **Sales → QuickBooks Invoices**
- Fuel sales
- Non-fuel POS transactions
- Payment details
- Customer linkage

### **Customers → QuickBooks Customers**
- Customer name
- Contact info
- Credit terms
- Account balance

### **Products → QuickBooks Items**
- Fuel products (Petrol, Diesel, etc.)
- Non-fuel products (shop items)
- Prices
- SKU/barcode

---

## 🛡️ **Safety Features Built-In**

1. ✅ **Read-Only Mode** (default) - Only reads from QB, doesn't write
2. ✅ **Write Mode** - Requires admin approval before each sync
3. ✅ **Batch Approval** - Review changes before pushing to QB
4. ✅ **Kill Switch** - Emergency stop if issues detected
5. ✅ **Rate Limiting** - Respects QB API limits (500 req/min)
6. ✅ **Idempotency** - Prevents duplicate records
7. ✅ **Error Recovery** - Automatic retry with backoff

---

## 📋 **Configuration Checklist**

Before enabling sync, verify:

- [ ] QuickBooks app approved (if new)
- [ ] Redirect URI added to Intuit app settings
- [ ] Credentials added to server `.env`
- [ ] Backend restarted
- [ ] OAuth connection successful
- [ ] Test sync in read-only mode first
- [ ] Enable write mode only after verification

---

## 🚀 **Quick Start (If You Have Credentials Now)**

**Send me**:
```
QuickBooks Client ID: ABxxxxxxxxxxxxxxxxxxxxx
QuickBooks Client Secret: xxxxxxxxxxxxxxxxxxxxx
```

**I'll**:
1. SSH to server (2 min)
2. Update `.env` (1 min)
3. Restart backend (30 sec)
4. Test connection (1 min)
5. Give you OAuth URL to connect (30 sec)

**Total time**: ~5 minutes to full integration ✅

---

## ❓ **Questions?**

**Q: Do I need QuickBooks Desktop or Online?**
A: QuickBooks **Online** (not Desktop). This is a web-based integration.

**Q: Will it overwrite my QB data?**
A: No. Read-only mode by default. Write mode requires explicit admin approval per batch.

**Q: What if I don't have QB credentials yet?**
A: We can set this up later. UAT testing doesn't require QB integration.

**Q: Can I test without connecting to real QB?**
A: Yes. Use sandbox mode first (I'll configure test credentials).

---

**Ready to connect? Send me your QuickBooks credentials!** 🔗
