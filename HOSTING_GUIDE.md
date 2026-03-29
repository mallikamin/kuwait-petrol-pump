# Kuwait Petrol Pump - Complete Hosting Guide

**DEPRECATED**: Use VERIFIED_DEPLOYMENT_PLAN.md instead (gate-based protocol).

**Domain**: kuwaitpos.duckdns.org
**Target host**: See .env.server line 7 (DROPLET_IP)
**Date**: March 26, 2026

**Note**: Old docs hardcoded wrong IP (72.255.51.78). Current droplet is in .env.server.

---

## 📊 Hosting Options Comparison

| Feature | Your VPS | DigitalOcean | Render | Railway |
|---------|----------|--------------|--------|---------|
| **Monthly Cost** | **$0** ✅ | $34 | $24 | $25 |
| **Setup Time** | 15 min | 30 min | 10 min | 10 min |
| **Control Level** | Full | Full | Limited | Limited |
| **Auto-Deploy** | ✅ (GitHub Actions) | ✅ | ✅ | ✅ |
| **SSL Certificate** | ✅ (Let's Encrypt) | ✅ | ✅ | ✅ |
| **Backups** | Manual (scripted) | Automated | Automated | Automated |
| **Performance** | Excellent | Excellent | Good | Good |
| **Scalability** | Manual | Easy | Auto | Auto |

---

## RECOMMENDED: Deploy on Your Droplet (64.226.65.80)

### Why Use Your VPS?
- ✅ **$0/month** - You already own it
- ✅ **All scripts ready** - One command deployment
- ✅ **Domain configured** - kuwaitpos.duckdns.org
- ✅ **Full control** - Root access
- ✅ **Best performance** - Dedicated resources

---

## 🚀 Quick Deploy to Your VPS (15 Minutes)

### Prerequisites
- SSH access to 64.226.65.80 (password in .env.server line 14)
- Domain kuwaitpos.duckdns.org pointing to 64.226.65.80
- Git repository (GitHub/GitLab)

### Step 1: Connect to Server
```bash
ssh root@64.226.65.80
```

### Step 2: Run Setup Script (One-Time)
```bash
# Clone your repository
git clone https://github.com/yourusername/kuwait-petrol-pump.git
cd kuwait-petrol-pump

# Run automated setup
bash scripts/setup-server.sh
```

**This script will:**
- Install Docker & Docker Compose
- Setup firewall (UFW)
- Configure fail2ban
- Create deployment user
- Install nginx
- Setup log rotation

### Step 3: Configure Environment
```bash
# Copy example env file
cp .env.production.example .env

# Edit with your values
nano .env
```

**Required Variables:**
```env
# Database
POSTGRES_USER=petrolpump
POSTGRES_PASSWORD=<generate-strong-password>
POSTGRES_DB=petrolpump_prod

# Redis
REDIS_PASSWORD=<generate-strong-password>

# JWT
JWT_SECRET=<generate-64-char-secret>
JWT_REFRESH_SECRET=<generate-64-char-secret>

# Domain
DOMAIN=kuwaitpos.duckdns.org

# Claude API
CLAUDE_API_KEY=your-claude-api-key-here
```

**Generate Secrets:**
```bash
# Generate strong passwords
openssl rand -base64 48

# Generate JWT secrets
openssl rand -base64 64
```

### Step 4: Setup SSL Certificate
```bash
# Install certbot
sudo apt install certbot python3-certbot-nginx

# Get certificate for kuwaitpos.duckdns.org
sudo certbot --nginx -d kuwaitpos.duckdns.org

# Auto-renewal (already configured)
sudo certbot renew --dry-run
```

### Step 5: Deploy!
```bash
# First deployment
sudo bash scripts/deploy.sh
```

**The script will:**
- Build Docker images
- Run database migrations
- Start all services
- Run health checks

### Step 6: Verify Deployment
```bash
# Check services
docker ps

# Check logs
docker logs kuwait-backend -f

# Test API
curl https://kuwaitpos.duckdns.org/health
```

**Expected Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-03-26T10:00:00.000Z",
  "uptime": 123.45
}
```

### Step 7: Setup GitHub Actions (Optional - Auto Deploy)

1. **Add GitHub Secrets**:
   Go to GitHub repo → Settings → Secrets → Actions → New secret

   Add these secrets:
   ```
   SSH_PRIVATE_KEY=<your-private-key>
   SSH_USER=root
   SSH_HOST=64.226.65.80
   POSTGRES_USER=petrolpump
   POSTGRES_PASSWORD=<your-db-password>
   POSTGRES_DB=petrolpump_prod
   REDIS_PASSWORD=<your-redis-password>
   JWT_SECRET=<your-jwt-secret>
   JWT_REFRESH_SECRET=<your-refresh-secret>
   CLAUDE_API_KEY=sk-ant-api03-...
   ```

2. **Push to GitHub**:
   ```bash
   git add .
   git commit -m "Initial deployment"
   git push origin main
   ```

3. **Auto-Deploy on Push**:
   Every push to `main` branch will automatically deploy to your server!

---

## 🗄️ Storage Options for Meter Images

### Option 1: Local Storage (Simplest) ✅
**Current Config** - Already set up!

```env
IMAGE_STORAGE=local
UPLOAD_DIR=/opt/kuwaitpos/uploads
IMAGE_BASE_URL=https://kuwaitpos.duckdns.org/uploads
```

**Pros:**
- ✅ Free
- ✅ Fast
- ✅ No external dependencies

**Cons:**
- ❌ Limited by server disk space
- ❌ Lost if server crashes (use backups!)

**Recommended for:** Small to medium operations (< 10,000 images)

---

### Option 2: DigitalOcean Spaces (Recommended for Production) ⭐

**Cost:** $5/month (250GB storage + 1TB transfer)

**Setup:**
```bash
# 1. Create Spaces bucket on DigitalOcean
# 2. Get Access Key & Secret Key
# 3. Update .env:
IMAGE_STORAGE=s3
AWS_REGION=nyc3
AWS_ENDPOINT=https://nyc3.digitaloceanspaces.com
AWS_ACCESS_KEY_ID=<your-key>
AWS_SECRET_ACCESS_KEY=<your-secret>
S3_BUCKET_NAME=kuwaitpos-images
IMAGE_BASE_URL=https://kuwaitpos-images.nyc3.digitaloceanspaces.com
```

**Pros:**
- ✅ Unlimited scalability
- ✅ CDN included (fast worldwide)
- ✅ 99.9% uptime SLA
- ✅ Automatic backups

**Cons:**
- ❌ $5/month additional cost

---

### Option 3: Cloudflare R2 (Cheapest) 💰

**Cost:** $0.015/GB/month (no egress fees!)

**Setup:** Similar to S3, use Cloudflare R2 credentials

**Pros:**
- ✅ Cheapest option
- ✅ No egress fees (free downloads)
- ✅ S3-compatible API

**Cons:**
- ❌ Requires Cloudflare account
- ❌ Slightly more complex setup

---

## 📊 Storage Recommendations by Scale

| Scale | Images/Month | Recommendation | Cost/Month |
|-------|--------------|----------------|------------|
| **Small** | < 1,000 | Local Storage | $0 |
| **Medium** | 1,000 - 10,000 | DigitalOcean Spaces | $5 |
| **Large** | 10,000+ | Cloudflare R2 | $1-3 |

---

## 🔧 Alternative Hosting Options

### If You Don't Want to Manage a Server

#### Option A: Render.com (Easiest)

**Setup:**
1. Create Render account
2. Connect GitHub repo
3. Create services:
   - **Web Service** (Backend): `apps/backend/`
   - **PostgreSQL** database
   - **Redis** instance
   - **Static Site** (Web Dashboard): `apps/web/dist/`

**Cost:** ~$24/month

**Pros:**
- Zero DevOps
- Auto-deploy on push
- Managed databases

**Cons:**
- More expensive
- Less control

---

#### Option B: DigitalOcean App Platform

**Setup:**
1. Create DO account
2. Connect GitHub
3. Auto-detect apps
4. Deploy

**Cost:** ~$12/month (app) + $7/month (database) = **$19/month**

**Pros:**
- Easy setup
- DigitalOcean quality
- Cheaper than Render

**Cons:**
- Limited resources on basic tier

---

#### Option C: Railway.app

**Setup:**
1. Connect GitHub
2. Deploy with one click
3. Add PostgreSQL & Redis

**Cost:** ~$20-30/month (pay per resource)

**Pros:**
- Modern platform
- Great DX
- $5/month free credit

**Cons:**
- Can get expensive
- Pricing can be unpredictable

---

## 📱 Mobile & Desktop App Distribution

### Desktop App (Electron)

**Option 1: GitHub Releases** (Free) ✅
```bash
cd apps/desktop
npm run build
# Upload .exe/.dmg/.AppImage to GitHub Releases
```

**Option 2: Auto-Updates**
- Use electron-updater
- Host updates on GitHub Releases
- Auto-download new versions

### Mobile App (React Native)

**iOS:**
1. Apple Developer Account ($99/year)
2. Build with Expo EAS: `eas build --platform ios`
3. Submit to App Store

**Android:**
1. Google Play Developer ($25 one-time)
2. Build with Expo EAS: `eas build --platform android`
3. Submit to Play Store

**OR: Distribute APK directly** (Free)
```bash
eas build --platform android --profile preview
# Share .apk file directly
```

---

## 🎯 Final Recommendation

### For Your Setup: **Use Your VPS!** 🏆

**Why:**
1. ✅ **You already have it** (64.226.65.80 from .env.server)
2. ✅ **Domain configured** (kuwaitpos.duckdns.org)
3. ✅ **All scripts ready** (15-min setup)
4. ✅ **$0/month** hosting cost
5. ✅ **Full control**

**Storage:**
- Start with **local storage** (free, simple)
- Upgrade to **DigitalOcean Spaces** ($5/month) when you hit ~5,000 images

**Total Monthly Cost:**
- **VPS hosting**: $0 (you own it)
- **Storage**: $0-5 (start free, upgrade later)
- **Domain**: $0 (DuckDNS is free)
- **SSL**: $0 (Let's Encrypt)

**Grand Total: $0-5/month** for entire system! 🎉

---

## 🆘 Need Help?

### Deployment Issues?
1. Check logs: `docker logs kuwait-backend -f`
2. Check health: `curl https://kuwaitpos.duckdns.org/health`
3. Restart services: `docker-compose restart`

### SSL Issues?
1. Verify domain points to IP: `nslookup kuwaitpos.duckdns.org`
2. Renew certificate: `sudo certbot renew`
3. Check nginx: `sudo nginx -t`

### Database Issues?
1. Backup: `bash scripts/backup-db.sh`
2. Restore: `bash scripts/restore-db.sh <backup-file>`
3. Check connection: `docker exec -it kuwait-postgres psql -U petrolpump`

---

## 📚 Documentation

- **Deployment Guide**: `DEPLOYMENT.md` (complete 15,000-word guide)
- **Quick Start**: `DEPLOYMENT_QUICK_START.md`
- **Scripts Reference**: `scripts/README.md`
- **API Documentation**: `API_DOCUMENTATION.md`

---

## ✅ Pre-Flight Checklist

Before deployment:

- [ ] Server accessible at 64.226.65.80 (see .env.server:DROPLET_IP)
- [ ] Domain kuwaitpos.duckdns.org points to IP
- [ ] SSH access configured
- [ ] Strong passwords generated
- [ ] .env file configured
- [ ] SSL certificate obtained
- [ ] GitHub Actions secrets configured (if using)
- [ ] Backup strategy planned

---

**Ready to deploy?** Run this:

```bash
ssh root@64.226.65.80
git clone https://github.com/yourusername/kuwait-petrol-pump.git
cd kuwait-petrol-pump
bash scripts/setup-server.sh
cp .env.production.example .env
nano .env  # Edit with your values
sudo certbot --nginx -d kuwaitpos.duckdns.org
bash scripts/deploy.sh
```

**You'll be live in 15 minutes!** 🚀

---

**Last Updated**: March 26, 2026
**Status**: ✅ Production Ready
**Total Cost**: **$0-5/month**
