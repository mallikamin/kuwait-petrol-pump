# Kuwait Petrol Pump POS - Quick Start Deployment

**DEPRECATED**: Use VERIFIED_DEPLOYMENT_PLAN.md instead (gate-based protocol).

This is a condensed guide for experienced DevOps engineers. For detailed instructions, see VERIFIED_DEPLOYMENT_PLAN.md.

## Prerequisites

- Server: Ubuntu 22.04+ (see .env.server:DROPLET_IP for target host)
- Domain: kuwaitpos.duckdns.org (configured)
- Docker & Docker Compose installed
- SSH access as root or sudo user

**Note**: Old docs hardcoded wrong IP (72.255.51.78). Current droplet is in .env.server.

## 1. Initial Server Setup (First Time Only)

```bash
# SSH to server
ssh root@64.226.65.80

# Run setup script
curl -o setup-server.sh https://raw.githubusercontent.com/YOUR_ORG/kuwait-petrol-pump/main/scripts/setup-server.sh
chmod +x setup-server.sh
sudo bash setup-server.sh

# Copy SSH public key to deployuser
nano /home/deployuser/.ssh/authorized_keys
# Paste your public key, save and exit
```

## 2. Configure DuckDNS

```bash
mkdir -p /opt/duckdns
cd /opt/duckdns

# Create update script
cat > duck.sh << 'EOF'
#!/bin/bash
echo url="https://www.duckdns.org/update?domains=kuwaitpos&token=YOUR_DUCKDNS_TOKEN&ip=" | curl -k -o /opt/duckdns/duck.log -K -
EOF

chmod +x duck.sh
./duck.sh
cat duck.log  # Should show "OK"

# Add to crontab
(crontab -l 2>/dev/null; echo "*/5 * * * * /opt/duckdns/duck.sh >/dev/null 2>&1") | crontab -
```

## 3. Deploy Application Files

```bash
# Switch to deployuser
su - deployuser
cd /opt/kuwaitpos

# Clone repository or copy files
git clone https://github.com/YOUR_ORG/kuwait-petrol-pump.git .
# OR manually copy: docker-compose.prod.yml, nginx/, scripts/

# Rename docker-compose file
mv docker-compose.prod.yml docker-compose.yml
```

## 4. Create Environment File

```bash
cd /opt/kuwaitpos

# Generate passwords
apt install -y pwgen
POSTGRES_PWD=$(pwgen -s 32 1)
REDIS_PWD=$(pwgen -s 32 1)
JWT_SECRET=$(pwgen -s 64 1)
JWT_REFRESH=$(pwgen -s 64 1)

# Create .env file
cat > .env << EOF
NODE_ENV=production
PORT=3000

# Database
DATABASE_URL=postgresql://petrolpump_prod:${POSTGRES_PWD}@postgres:5432/petrolpump_production
POSTGRES_USER=petrolpump_prod
POSTGRES_PASSWORD=${POSTGRES_PWD}
POSTGRES_DB=petrolpump_production

# Redis
REDIS_URL=redis://:${REDIS_PWD}@redis:6379
REDIS_PASSWORD=${REDIS_PWD}

# JWT
JWT_SECRET=${JWT_SECRET}
JWT_REFRESH_SECRET=${JWT_REFRESH}
JWT_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

# CORS
CORS_ORIGIN=https://kuwaitpos.duckdns.org

# QuickBooks
QUICKBOOKS_CLIENT_ID=your-qb-client-id
QUICKBOOKS_CLIENT_SECRET=your-qb-client-secret
QUICKBOOKS_REDIRECT_URI=https://kuwaitpos.duckdns.org/api/quickbooks/callback
QUICKBOOKS_ENVIRONMENT=production

# Docker
DOCKER_IMAGE=ghcr.io/YOUR_ORG/kuwaitpos-backend:latest
EOF

# Secure the file
chmod 600 .env

# Save passwords securely!
echo "SAVE THESE PASSWORDS SECURELY:"
echo "POSTGRES_PASSWORD: ${POSTGRES_PWD}"
echo "REDIS_PASSWORD: ${REDIS_PWD}"
echo "JWT_SECRET: ${JWT_SECRET}"
echo "JWT_REFRESH_SECRET: ${JWT_REFRESH}"
```

## 5. Setup SSL Certificate

```bash
cd /opt/kuwaitpos

# Start nginx temporarily for ACME challenge
docker run -d --name nginx-temp \
  -p 80:80 \
  -v $(pwd)/nginx/certbot:/var/www/html \
  nginx:1.25-alpine

# Generate certificate
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

# Fix SSL path in nginx.conf (if using self-signed initially)
# Update lines 75-77 to point to your certificate location
```

## 6. First Deployment

```bash
cd /opt/kuwaitpos

# Make scripts executable
chmod +x scripts/*.sh

# Pull images
docker compose pull

# Create directories
mkdir -p data/postgres data/redis backups

# Start database and redis first
docker compose up -d postgres redis

# Wait for health checks
sleep 10

# Run migrations
docker compose run --rm backend sh -c "cd /app/packages/database && pnpm exec prisma migrate deploy"

# Start all services
docker compose up -d

# Check status
docker compose ps

# Check logs
docker compose logs -f

# Test health endpoint
curl https://kuwaitpos.duckdns.org/api/health
```

## 7. Setup GitHub Actions (CI/CD)

In your GitHub repository → Settings → Secrets and Variables → Actions, add:

```
SSH_PRIVATE_KEY=<your-deployment-key>
SSH_USER=deployuser
POSTGRES_USER=petrolpump_prod
POSTGRES_PASSWORD=<from-step-4>
POSTGRES_DB=petrolpump_production
REDIS_PASSWORD=<from-step-4>
JWT_SECRET=<from-step-4>
JWT_REFRESH_SECRET=<from-step-4>
QUICKBOOKS_CLIENT_ID=<from-quickbooks>
QUICKBOOKS_CLIENT_SECRET=<from-quickbooks>
```

## 8. Setup Automated Tasks

```bash
# Edit crontab
crontab -e

# Add these lines:
0 2 * * * /opt/kuwaitpos/scripts/backup-db.sh >> /opt/kuwaitpos/logs/backup.log 2>&1
0 3 * * * docker run --rm -v /opt/kuwaitpos/nginx/ssl:/etc/letsencrypt certbot/certbot renew && docker compose -f /opt/kuwaitpos/docker-compose.prod.yml exec nginx nginx -s reload
0 */6 * * * /opt/kuwaitpos/scripts/health-check.sh >> /opt/kuwaitpos/logs/health-check.log 2>&1
```

## Common Commands

```bash
# View logs
docker compose logs -f backend

# Restart service
docker compose restart backend

# Deploy new version (manual)
sudo bash scripts/deploy.sh

# Rollback
sudo bash scripts/deploy.sh rollback

# Backup database
bash scripts/backup-db.sh

# Restore database
sudo bash scripts/restore-db.sh /opt/kuwaitpos/backups/postgres_YYYYMMDD_HHMMSS.sql.gz

# Health check
bash scripts/health-check.sh

# Check SSL certificate expiry
openssl x509 -enddate -noout -in /opt/kuwaitpos/nginx/ssl/live/kuwaitpos.duckdns.org/fullchain.pem
```

## Troubleshooting

```bash
# Container won't start
docker compose logs <service-name>
docker compose ps
docker compose config

# Database connection error
docker compose exec postgres psql -U petrolpump_prod -d petrolpump_production -c "SELECT 1;"

# Redis connection error
docker compose exec redis redis-cli -a YOUR_REDIS_PASSWORD ping

# Nginx 502 error
docker compose logs nginx
curl http://localhost:3000/api/health

# SSL certificate issues
docker compose logs nginx | grep -i ssl
ls -la /opt/kuwaitpos/nginx/ssl/live/kuwaitpos.duckdns.org/

# Rollback to previous version
sudo bash scripts/deploy.sh rollback
```

## Security Checklist

- [ ] Strong passwords generated (32+ characters)
- [ ] .env file has 600 permissions
- [ ] Firewall configured (UFW)
- [ ] fail2ban enabled
- [ ] SSL certificate installed
- [ ] GitHub Actions secrets configured
- [ ] Database backups scheduled
- [ ] DuckDNS auto-update configured
- [ ] Health checks working

## Next Steps

1. Test all API endpoints
2. Configure QuickBooks integration
3. Setup monitoring/alerting (optional)
4. Configure backup to remote storage
5. Test disaster recovery procedure
6. Document any custom configurations

## Support

- Full documentation: [DEPLOYMENT.md](./DEPLOYMENT.md)
- DevOps review: [DEVOPS_REVIEW.md](./DEVOPS_REVIEW.md)
- Scripts documentation: [scripts/README.md](./scripts/README.md)
