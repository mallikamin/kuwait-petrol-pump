# Kuwait Petrol Pump POS - Production Deployment Guide

**DEPRECATED**: Use VERIFIED_DEPLOYMENT_PLAN.md instead (gate-based protocol).

This guide provides complete instructions for deploying the Kuwait Petrol Pump POS backend to production on `kuwaitpos.duckdns.org`.

**Target host**: See .env.server line 7 (DROPLET_IP) - DO NOT hardcode IPs in docs.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Server Setup](#server-setup)
3. [SSL Certificate Setup](#ssl-certificate-setup)
4. [Environment Configuration](#environment-configuration)
5. [GitHub Actions Setup](#github-actions-setup)
6. [Manual Deployment](#manual-deployment)
7. [Monitoring & Logging](#monitoring--logging)
8. [Backup Strategy](#backup-strategy)
9. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Required Software on Server

- Ubuntu Server 22.04 LTS or newer
- Docker Engine 24.x or newer
- Docker Compose v2.x or newer
- Git
- curl, wget, certbot

### Server Requirements

- Minimum 2 CPU cores
- Minimum 4GB RAM
- Minimum 50GB disk space
- IP: See .env.server line 7 (DROPLET_IP = 64.226.65.80)
- Domain: kuwaitpos.duckdns.org

---

## Server Setup

### 1. Initial Server Configuration

```bash
# SSH into server (use DROPLET_IP from .env.server)
ssh root@64.226.65.80

# Update system
apt update && apt upgrade -y

# Install required packages
apt install -y curl wget git ufw fail2ban

# Configure firewall
ufw allow 22/tcp     # SSH
ufw allow 80/tcp     # HTTP
ufw allow 443/tcp    # HTTPS
ufw enable

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Install Docker Compose
apt install -y docker-compose-plugin

# Verify installation
docker --version
docker compose version
```

### 2. Create Deployment User

```bash
# Create deployment user
adduser deployuser
usermod -aG docker deployuser
usermod -aG sudo deployuser

# Setup SSH key for deployuser
mkdir -p /home/deployuser/.ssh
chmod 700 /home/deployuser/.ssh

# Copy your public SSH key to authorized_keys
nano /home/deployuser/.ssh/authorized_keys
chmod 600 /home/deployuser/.ssh/authorized_keys
chown -R deployuser:deployuser /home/deployuser/.ssh
```

### 3. Create Application Directory

```bash
# Create application directory
mkdir -p /opt/kuwaitpos
mkdir -p /opt/kuwaitpos/data/postgres
mkdir -p /opt/kuwaitpos/data/redis
mkdir -p /opt/kuwaitpos/backups
mkdir -p /opt/kuwaitpos/nginx/logs
mkdir -p /opt/kuwaitpos/nginx/cache
mkdir -p /opt/kuwaitpos/nginx/ssl

# Set permissions
chown -R deployuser:deployuser /opt/kuwaitpos
chmod -R 755 /opt/kuwaitpos
```

### 4. Configure DuckDNS

```bash
# Install DuckDNS update script
mkdir -p /opt/duckdns
cd /opt/duckdns

# Create update script
cat > duck.sh << 'EOF'
#!/bin/bash
echo url="https://www.duckdns.org/update?domains=kuwaitpos&token=YOUR_DUCKDNS_TOKEN&ip=" | curl -k -o /opt/duckdns/duck.log -K -
EOF

chmod +x duck.sh

# Add to crontab (update every 5 minutes)
crontab -e
# Add: */5 * * * * /opt/duckdns/duck.sh >/dev/null 2>&1

# Test DuckDNS
./duck.sh
cat duck.log  # Should show "OK"
```

---

## SSL Certificate Setup

### Option 1: Using Let's Encrypt with Certbot (Recommended)

```bash
# Switch to deployuser
su - deployuser
cd /opt/kuwaitpos

# Create temporary nginx config for ACME challenge
mkdir -p nginx/conf.d
cat > nginx/conf.d/default.conf << 'EOF'
server {
    listen 80;
    server_name kuwaitpos.duckdns.org;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
        allow all;
    }

    location / {
        return 301 https://$server_name$request_uri;
    }
}
EOF

# Start nginx for certificate generation
docker run -d --name nginx-temp \
  -p 80:80 \
  -v $(pwd)/nginx/conf.d:/etc/nginx/conf.d:ro \
  -v $(pwd)/nginx/certbot:/var/www/html \
  nginx:1.25-alpine

# Generate SSL certificate
docker run --rm \
  -v $(pwd)/nginx/ssl:/etc/letsencrypt \
  -v $(pwd)/nginx/certbot:/var/www/html \
  certbot/certbot certonly \
  --webroot \
  --webroot-path=/var/www/html \
  --email admin@kuwaitpos.duckdns.org \
  --agree-tos \
  --no-eff-email \
  -d kuwaitpos.duckdns.org

# Stop temporary nginx
docker stop nginx-temp
docker rm nginx-temp

# Verify certificate
ls -la nginx/ssl/live/kuwaitpos.duckdns.org/
```

### Certificate Auto-Renewal

```bash
# Create renewal script
cat > /opt/kuwaitpos/scripts/renew-cert.sh << 'EOF'
#!/bin/bash
cd /opt/kuwaitpos
docker compose run --rm certbot renew
docker compose exec nginx nginx -s reload
EOF

chmod +x /opt/kuwaitpos/scripts/renew-cert.sh

# Add to crontab (renew at 2am daily)
crontab -e
# Add: 0 2 * * * /opt/kuwaitpos/scripts/renew-cert.sh >> /opt/kuwaitpos/cert-renew.log 2>&1
```

### Option 2: Using Self-Signed Certificate (Development/Testing)

```bash
cd /opt/kuwaitpos/nginx/ssl

# Generate self-signed certificate
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout kuwaitpos.key \
  -out kuwaitpos.crt \
  -subj "/C=KW/ST=Kuwait/L=Kuwait/O=KuwaitPOS/CN=kuwaitpos.duckdns.org"

# Create symbolic links to match Let's Encrypt structure
mkdir -p live/kuwaitpos.duckdns.org
cd live/kuwaitpos.duckdns.org
ln -s ../../kuwaitpos.crt fullchain.pem
ln -s ../../kuwaitpos.key privkey.pem
ln -s ../../kuwaitpos.crt chain.pem
```

---

## Environment Configuration

### 1. Create Production Environment File

```bash
cd /opt/kuwaitpos

# Create .env file
cat > .env << 'EOF'
# Environment
NODE_ENV=production
PORT=3000

# Database
DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}
POSTGRES_USER=petrolpump_prod
POSTGRES_PASSWORD=CHANGE_ME_STRONG_PASSWORD_HERE
POSTGRES_DB=petrolpump_production

# Redis
REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379
REDIS_PASSWORD=CHANGE_ME_REDIS_PASSWORD_HERE

# JWT
JWT_SECRET=CHANGE_ME_VERY_STRONG_JWT_SECRET_AT_LEAST_32_CHARS
JWT_EXPIRY=24h

# CORS
CORS_ORIGIN=https://kuwaitpos.duckdns.org

# QuickBooks
QUICKBOOKS_CLIENT_ID=your-production-qb-client-id
QUICKBOOKS_CLIENT_SECRET=your-production-qb-client-secret
QUICKBOOKS_REDIRECT_URI=https://kuwaitpos.duckdns.org/api/quickbooks/callback
QUICKBOOKS_ENVIRONMENT=production

# Docker Image (will be set by GitHub Actions)
DOCKER_IMAGE=ghcr.io/YOUR_GITHUB_ORG/kuwaitpos-backend:latest
EOF

# Generate strong passwords
apt install -y pwgen
echo "Suggested POSTGRES_PASSWORD: $(pwgen -s 32 1)"
echo "Suggested REDIS_PASSWORD: $(pwgen -s 32 1)"
echo "Suggested JWT_SECRET: $(pwgen -s 64 1)"

# Edit the .env file with generated passwords
nano .env

# Secure the env file
chmod 600 .env
```

### 2. Environment Variable Checklist

Before deployment, ensure these variables are properly set:

- [ ] `POSTGRES_PASSWORD` - Strong password (32+ characters)
- [ ] `REDIS_PASSWORD` - Strong password (32+ characters)
- [ ] `JWT_SECRET` - Strong secret (64+ characters)
- [ ] `QUICKBOOKS_CLIENT_ID` - From QuickBooks Developer Portal
- [ ] `QUICKBOOKS_CLIENT_SECRET` - From QuickBooks Developer Portal
- [ ] `CORS_ORIGIN` - Set to `https://kuwaitpos.duckdns.org`

---

## GitHub Actions Setup

### 1. GitHub Secrets Configuration

Go to your GitHub repository → Settings → Secrets and Variables → Actions

Add the following secrets:

#### SSH Configuration
- `SSH_PRIVATE_KEY` - Private key for deployment user
- `SSH_USER` - Username (deployuser)

#### Database Secrets
- `POSTGRES_USER` - Same as in .env
- `POSTGRES_PASSWORD` - Same as in .env
- `POSTGRES_DB` - Same as in .env

#### Redis Secrets
- `REDIS_PASSWORD` - Same as in .env

#### Application Secrets
- `JWT_SECRET` - Same as in .env

#### QuickBooks Secrets
- `QUICKBOOKS_CLIENT_ID` - From QuickBooks Developer Portal
- `QUICKBOOKS_CLIENT_SECRET` - From QuickBooks Developer Portal

### 2. Generate SSH Key for GitHub Actions

```bash
# On your local machine
ssh-keygen -t ed25519 -C "github-actions@kuwaitpos" -f ~/.ssh/kuwaitpos-deploy

# Copy public key to server
ssh-copy-id -i ~/.ssh/kuwaitpos-deploy.pub deployuser@64.226.65.80

# Copy private key content and add to GitHub Secrets as SSH_PRIVATE_KEY
cat ~/.ssh/kuwaitpos-deploy
```

### 3. Container Registry Authentication

```bash
# On the server, login to GitHub Container Registry
echo $GITHUB_TOKEN | docker login ghcr.io -u YOUR_GITHUB_USERNAME --password-stdin
```

---

## Manual Deployment

### First Time Deployment

```bash
# SSH to server
ssh deployuser@64.226.65.80

# Navigate to app directory
cd /opt/kuwaitpos

# Clone repository (if not done by GitHub Actions)
# git clone https://github.com/YOUR_ORG/kuwait-petrol-pump.git .

# Copy deployment files (should be done by GitHub Actions)
# Ensure you have:
# - docker-compose.yml (renamed from docker-compose.prod.yml)
# - nginx/nginx.conf
# - scripts/deploy.sh
# - .env

# Make deploy script executable
chmod +x scripts/deploy.sh

# Pull Docker images
docker compose pull

# Generate Prisma Client and run migrations
docker compose run --rm backend sh -c "cd /app/packages/database && pnpm exec prisma generate && pnpm exec prisma migrate deploy"

# Start services
docker compose up -d

# Check logs
docker compose logs -f

# Verify services are running
docker compose ps

# Test health endpoint
curl http://localhost:3000/api/health
curl https://kuwaitpos.duckdns.org/api/health
```

### Subsequent Deployments

```bash
# SSH to server
ssh deployuser@64.226.65.80

# Run deployment script
cd /opt/kuwaitpos
sudo bash scripts/deploy.sh
```

### Manual Rollback

```bash
cd /opt/kuwaitpos
sudo bash scripts/deploy.sh rollback
```

---

## Monitoring & Logging

### Docker Logs

```bash
# View all logs
docker compose logs -f

# View specific service logs
docker compose logs -f backend
docker compose logs -f postgres
docker compose logs -f redis
docker compose logs -f nginx

# View last 100 lines
docker compose logs --tail=100 backend

# View logs since specific time
docker compose logs --since 30m backend
```

### Nginx Logs

```bash
# Access logs
tail -f /opt/kuwaitpos/nginx/logs/access.log

# Error logs
tail -f /opt/kuwaitpos/nginx/logs/error.log
```

### Application Logs

```bash
# Backend container logs
docker exec -it kuwaitpos-backend sh
cd /app/apps/backend
# View application logs
```

### System Monitoring

```bash
# Check disk usage
df -h

# Check Docker disk usage
docker system df

# Check container resource usage
docker stats

# Check container health
docker compose ps
```

### Setting Up Log Rotation

```bash
# Create logrotate configuration
sudo cat > /etc/logrotate.d/kuwaitpos << 'EOF'
/opt/kuwaitpos/nginx/logs/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 deployuser deployuser
    sharedscripts
    postrotate
        docker compose -f /opt/kuwaitpos/docker-compose.prod.yml exec nginx nginx -s reload > /dev/null 2>&1 || true
    endscript
}
EOF
```

---

## Backup Strategy

### Automated Database Backups

Backups are automatically created before each deployment by the deploy script.

### Manual Database Backup

```bash
# Create backup
cd /opt/kuwaitpos
sudo bash scripts/deploy.sh backup

# Backups are stored in /opt/kuwaitpos/backups/
ls -lh /opt/kuwaitpos/backups/
```

### Database Restore

```bash
# List available backups
ls -lh /opt/kuwaitpos/backups/

# Restore from backup
BACKUP_FILE="/opt/kuwaitpos/backups/postgres_20260326_120000.sql.gz"
gunzip -c $BACKUP_FILE | docker exec -i kuwaitpos-postgres psql -U petrolpump_prod petrolpump_production
```

### Backup to Remote Storage

```bash
# Install rclone for cloud backups
curl https://rclone.org/install.sh | sudo bash

# Configure rclone (follow interactive setup)
rclone config

# Create backup script
cat > /opt/kuwaitpos/scripts/backup-to-cloud.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/opt/kuwaitpos/backups"
REMOTE_NAME="your-remote-name"
REMOTE_PATH="kuwaitpos-backups"

# Find backups from today
TODAY=$(date +%Y%m%d)
find $BACKUP_DIR -name "postgres_${TODAY}_*.sql.gz" -exec rclone copy {} ${REMOTE_NAME}:${REMOTE_PATH}/ \;
EOF

chmod +x /opt/kuwaitpos/scripts/backup-to-cloud.sh

# Add to crontab (daily at 3am)
crontab -e
# Add: 0 3 * * * /opt/kuwaitpos/scripts/backup-to-cloud.sh >> /opt/kuwaitpos/backup-cloud.log 2>&1
```

---

## Troubleshooting

### Service Won't Start

```bash
# Check Docker service status
sudo systemctl status docker

# Check container logs
docker compose logs backend

# Check environment variables
docker compose config

# Verify .env file
cat /opt/kuwaitpos/.env
```

### Database Connection Issues

```bash
# Check if PostgreSQL is running
docker compose ps postgres

# Check PostgreSQL logs
docker compose logs postgres

# Test database connection
docker exec -it kuwaitpos-postgres psql -U petrolpump_prod -d petrolpump_production -c "SELECT 1;"

# Verify DATABASE_URL
docker compose exec backend printenv DATABASE_URL
```

### Redis Connection Issues

```bash
# Check if Redis is running
docker compose ps redis

# Test Redis connection
docker exec -it kuwaitpos-redis redis-cli -a YOUR_REDIS_PASSWORD ping

# Check Redis logs
docker compose logs redis
```

### SSL Certificate Issues

```bash
# Check certificate expiry
docker run --rm -v /opt/kuwaitpos/nginx/ssl:/etc/letsencrypt certbot/certbot certificates

# Test SSL configuration
curl -vI https://kuwaitpos.duckdns.org

# Check nginx error logs
docker compose logs nginx | grep -i ssl
```

### High Memory/CPU Usage

```bash
# Check resource usage
docker stats

# Restart specific service
docker compose restart backend

# Check for memory leaks in logs
docker compose logs backend | grep -i "memory\|heap"
```

### Nginx 502 Bad Gateway

```bash
# Check if backend is running
docker compose ps backend

# Check backend health
curl http://localhost:3000/api/health

# Check nginx upstream
docker compose exec nginx cat /etc/nginx/nginx.conf | grep upstream

# Restart services
docker compose restart nginx backend
```

### Deployment Failures

```bash
# Check deploy script logs
cat /opt/kuwaitpos/deploy.log

# Manually run deployment steps
cd /opt/kuwaitpos
docker compose pull backend
docker compose run --rm backend sh -c "cd /app/packages/database && pnpm exec prisma migrate deploy"
docker compose up -d --no-deps backend

# Rollback if needed
sudo bash scripts/deploy.sh rollback
```

---

## Security Best Practices

1. **Firewall**: Only allow necessary ports (22, 80, 443)
2. **SSH**: Use key-based authentication, disable password login
3. **Secrets**: Never commit .env file to Git
4. **Updates**: Regularly update system packages and Docker images
5. **Fail2ban**: Configure to prevent brute force attacks
6. **Monitoring**: Set up alerts for failed login attempts
7. **Backups**: Test restore procedures regularly
8. **SSL**: Keep certificates up to date

---

## Useful Commands

```bash
# Quick health check
curl https://kuwaitpos.duckdns.org/api/health

# View all containers
docker compose ps

# Restart all services
docker compose restart

# Stop all services
docker compose down

# Start all services
docker compose up -d

# View environment variables
docker compose config

# Clean up unused resources
docker system prune -a

# Export database
docker exec kuwaitpos-postgres pg_dump -U petrolpump_prod petrolpump_production > backup.sql

# Check disk space
du -sh /opt/kuwaitpos/*
```

---

## Support & Maintenance

For issues or questions:
- Check logs first: `docker compose logs -f`
- Review this guide's troubleshooting section
- Contact development team

Regular maintenance tasks:
- Weekly: Review logs and disk usage
- Monthly: Update Docker images
- Quarterly: Review and rotate secrets
- Yearly: Review security configurations
