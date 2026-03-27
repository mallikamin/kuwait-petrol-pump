# Deployment Guide - Kuwait Petrol Pump Web Admin

## Pre-Deployment Checklist

- [ ] Backend API is deployed and accessible
- [ ] Database is set up and migrated
- [ ] Environment variables are configured
- [ ] SSL certificates are ready (for HTTPS)
- [ ] Domain/subdomain is configured
- [ ] Build passes locally (`pnpm build`)

## Deployment Options

### Option 1: Docker Deployment (Recommended)

#### Create Dockerfile

```dockerfile
# apps/web/Dockerfile
FROM node:18-alpine as builder

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install pnpm and dependencies
RUN npm install -g pnpm && pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build the application
RUN pnpm build

# Production image
FROM nginx:alpine

# Copy built files
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
```

#### Create nginx.conf

```nginx
# apps/web/nginx.conf
server {
    listen 80;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    # Compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # API proxy
    location /api {
        proxy_pass http://backend:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # SPA routing - serve index.html for all routes
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Cache static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

#### Build and Run

```bash
# Build Docker image
docker build -t kuwait-petrol-pump-web:latest .

# Run container
docker run -d \
  -p 3000:80 \
  --name kpp-web \
  --env-file .env.production \
  kuwait-petrol-pump-web:latest
```

#### Docker Compose

```yaml
# docker-compose.yml (add to root)
version: '3.8'

services:
  web:
    build:
      context: ./apps/web
      dockerfile: Dockerfile
    ports:
      - "3000:80"
    environment:
      - VITE_API_URL=${API_URL}
      - VITE_WS_URL=${WS_URL}
    depends_on:
      - backend
    restart: unless-stopped

  backend:
    # Your backend service configuration
    ...
```

### Option 2: Vercel Deployment

#### Install Vercel CLI

```bash
npm install -g vercel
```

#### Deploy

```bash
cd apps/web
vercel
```

#### Configure Environment Variables

In Vercel Dashboard:
- Settings → Environment Variables
- Add `VITE_API_URL` and `VITE_WS_URL`

#### vercel.json

```json
{
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://your-backend-api.com/api/:path*"
    },
    {
      "source": "/:path*",
      "destination": "/index.html"
    }
  ]
}
```

### Option 3: Netlify Deployment

#### netlify.toml

```toml
[build]
  command = "pnpm build"
  publish = "dist"

[[redirects]]
  from = "/api/*"
  to = "https://your-backend-api.com/api/:splat"
  status = 200

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200

[build.environment]
  NODE_VERSION = "18"
```

#### Deploy

```bash
# Install Netlify CLI
npm install -g netlify-cli

# Deploy
cd apps/web
netlify deploy --prod
```

### Option 4: Traditional Server (VPS/AWS EC2)

#### 1. Install Node.js and pnpm

```bash
# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install pnpm
npm install -g pnpm
```

#### 2. Clone and Build

```bash
# Clone repository
git clone <your-repo-url>
cd kuwait-petrol-pump/apps/web

# Install dependencies
pnpm install

# Build for production
pnpm build
```

#### 3. Install Nginx

```bash
sudo apt-get update
sudo apt-get install nginx
```

#### 4. Configure Nginx

```nginx
# /etc/nginx/sites-available/kpp-web
server {
    listen 80;
    server_name your-domain.com;

    root /var/www/kpp-web;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api {
        proxy_pass http://localhost:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/kpp-web /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx

# Copy build files
sudo cp -r dist/* /var/www/kpp-web/
```

#### 5. SSL with Let's Encrypt

```bash
sudo apt-get install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

## Environment Variables for Production

Create `.env.production`:

```env
VITE_API_URL=https://api.yourpetrolpump.com
VITE_WS_URL=wss://api.yourpetrolpump.com
```

## Build Configuration

### Optimize for Production

In `vite.config.ts`:

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
      },
    },
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          ui: ['@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu'],
          charts: ['recharts'],
        },
      },
    },
  },
});
```

## Performance Optimization

### 1. Enable Compression

Nginx configuration already includes gzip compression.

### 2. CDN Setup

Upload static assets to CDN:
- CloudFront (AWS)
- CloudFlare
- Fastly

Update `vite.config.ts`:

```typescript
base: process.env.CDN_URL || '/',
```

### 3. Caching Strategy

```nginx
# Cache static assets for 1 year
location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}

# Cache HTML for 5 minutes
location ~* \.html$ {
    expires 5m;
    add_header Cache-Control "public, must-revalidate";
}
```

## Monitoring & Analytics

### 1. Add Error Tracking (Sentry)

```bash
pnpm add @sentry/react
```

```typescript
// src/main.tsx
import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: "YOUR_SENTRY_DSN",
  environment: import.meta.env.MODE,
});
```

### 2. Add Analytics (Google Analytics)

```typescript
// src/main.tsx
import ReactGA from 'react-ga4';

if (import.meta.env.PROD) {
  ReactGA.initialize('G-XXXXXXXXXX');
}
```

## Health Checks

### Create health check endpoint

```nginx
location /health {
    access_log off;
    return 200 "healthy\n";
    add_header Content-Type text/plain;
}
```

## Backup Strategy

### Automated Backups

```bash
#!/bin/bash
# backup.sh

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backups/kpp-web"

# Create backup
tar -czf $BACKUP_DIR/kpp-web-$DATE.tar.gz /var/www/kpp-web

# Keep only last 30 days
find $BACKUP_DIR -type f -mtime +30 -delete
```

Add to crontab:
```bash
0 2 * * * /path/to/backup.sh
```

## SSL/TLS Configuration

### Nginx SSL Configuration

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # ... rest of configuration
}

# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}
```

## CI/CD Pipeline

### GitHub Actions

```yaml
# .github/workflows/deploy.yml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install pnpm
        run: npm install -g pnpm

      - name: Install dependencies
        run: pnpm install
        working-directory: ./apps/web

      - name: Build
        run: pnpm build
        working-directory: ./apps/web
        env:
          VITE_API_URL: ${{ secrets.VITE_API_URL }}

      - name: Deploy to server
        uses: easingthemes/ssh-deploy@v2
        env:
          SSH_PRIVATE_KEY: ${{ secrets.SSH_PRIVATE_KEY }}
          REMOTE_HOST: ${{ secrets.REMOTE_HOST }}
          REMOTE_USER: ${{ secrets.REMOTE_USER }}
          SOURCE: "apps/web/dist/"
          TARGET: "/var/www/kpp-web/"
```

## Post-Deployment

### 1. Verify Deployment

```bash
# Check site loads
curl -I https://your-domain.com

# Check API proxy
curl https://your-domain.com/api/v1/health

# Check SSL
curl -vI https://your-domain.com 2>&1 | grep -i ssl
```

### 2. Test Core Functionality

- [ ] Login works
- [ ] Dashboard loads
- [ ] All pages accessible
- [ ] API calls succeed
- [ ] Dark mode works
- [ ] Role-based access works
- [ ] Export functions work

### 3. Performance Testing

```bash
# Lighthouse audit
npm install -g lighthouse
lighthouse https://your-domain.com --view
```

### 4. Security Scan

```bash
# SSL Labs
# Visit: https://www.ssllabs.com/ssltest/

# Security headers
curl -I https://your-domain.com
```

## Rollback Plan

### Quick Rollback

```bash
# Docker
docker stop kpp-web
docker run -d -p 3000:80 --name kpp-web kuwait-petrol-pump-web:previous

# Traditional
sudo cp -r /var/www/kpp-web.backup/* /var/www/kpp-web/
sudo systemctl reload nginx
```

## Scaling Considerations

### Horizontal Scaling

Use load balancer:
```nginx
upstream kpp_web {
    server web1:80;
    server web2:80;
    server web3:80;
}

server {
    location / {
        proxy_pass http://kpp_web;
    }
}
```

### Caching Layer

Add Redis/Varnish for caching API responses.

## Support & Maintenance

### Log Locations

- Nginx access: `/var/log/nginx/access.log`
- Nginx error: `/var/log/nginx/error.log`
- Application logs: Browser console + Sentry

### Monitoring

Set up monitoring for:
- Server uptime
- Response times
- Error rates
- CPU/Memory usage
- Disk space

---

**Deployment Status**: Ready
**Estimated Time**: 1-2 hours
**Difficulty**: Medium
