# Deployment Scripts

This directory contains scripts for managing the Kuwait Petrol Pump POS production deployment.

## Scripts Overview

### setup-server.sh
**Purpose**: Initial server setup and configuration

**Usage**:
```bash
sudo bash setup-server.sh
```

**What it does**:
- Updates system packages
- Installs Docker and Docker Compose
- Configures firewall (UFW)
- Creates deployment user
- Sets up directory structure
- Configures fail2ban
- Generates sample passwords

**When to use**: Once, on a fresh server before first deployment.

---

### deploy.sh
**Purpose**: Main deployment script with zero-downtime deployment

**Usage**:
```bash
# Normal deployment
sudo bash deploy.sh

# Rollback to previous version
sudo bash deploy.sh rollback

# Create manual backup
sudo bash deploy.sh backup

# Check health
bash deploy.sh health
```

**What it does**:
- Creates database backup
- Pulls latest Docker images
- Runs database migrations
- Deploys new version
- Performs health checks
- Auto-rollback on failure

**When to use**: Every time you deploy a new version (usually automated via GitHub Actions).

---

### backup-db.sh
**Purpose**: Create PostgreSQL database backup

**Usage**:
```bash
bash backup-db.sh
```

**What it does**:
- Creates compressed SQL dump
- Stores in /opt/kuwaitpos/backups/
- Keeps last 30 days of backups
- Shows backup size and recent backups

**When to use**:
- Manually before risky operations
- Via cron for scheduled backups
- Automatically called by deploy.sh

---

### restore-db.sh
**Purpose**: Restore database from backup

**Usage**:
```bash
# List available backups
bash restore-db.sh

# Restore specific backup
sudo bash restore-db.sh /opt/kuwaitpos/backups/postgres_20260326_120000.sql.gz
```

**What it does**:
- Creates safety backup before restore
- Stops backend service
- Restores database from backup file
- Restarts backend service

**When to use**:
- After data corruption
- To restore from backup
- During disaster recovery

---

### health-check.sh
**Purpose**: Comprehensive system health check

**Usage**:
```bash
bash health-check.sh
```

**What it does**:
- Checks Docker service status
- Checks all container status
- Verifies backend API health
- Shows disk usage
- Checks SSL certificate expiry
- Shows resource usage
- Displays recent errors

**When to use**:
- During troubleshooting
- Regular monitoring
- After deployment
- Via cron for scheduled checks

---

## Scheduled Tasks (Cron)

### Recommended Crontab Configuration

```bash
# Edit crontab
crontab -e

# Add these lines:

# Daily database backup at 2 AM
0 2 * * * /opt/kuwaitpos/scripts/backup-db.sh >> /opt/kuwaitpos/logs/backup.log 2>&1

# SSL certificate renewal check daily at 3 AM
0 3 * * * /opt/kuwaitpos/scripts/renew-cert.sh >> /opt/kuwaitpos/logs/cert-renew.log 2>&1

# Health check every 6 hours
0 */6 * * * /opt/kuwaitpos/scripts/health-check.sh >> /opt/kuwaitpos/logs/health-check.log 2>&1

# DuckDNS IP update every 5 minutes
*/5 * * * * /opt/duckdns/duck.sh >/dev/null 2>&1
```

---

## Script Permissions

All scripts should be executable:

```bash
chmod +x /opt/kuwaitpos/scripts/*.sh
```

---

## Logging

Scripts write logs to:
- `/opt/kuwaitpos/deploy.log` - Deployment logs
- `/opt/kuwaitpos/logs/backup.log` - Backup logs
- `/opt/kuwaitpos/logs/health-check.log` - Health check logs
- `/opt/kuwaitpos/logs/cert-renew.log` - Certificate renewal logs

View logs:
```bash
# View deployment log
tail -f /opt/kuwaitpos/deploy.log

# View recent backups
tail -n 50 /opt/kuwaitpos/logs/backup.log

# View health checks
tail -n 100 /opt/kuwaitpos/logs/health-check.log
```

---

## Emergency Procedures

### Quick Rollback
```bash
sudo bash /opt/kuwaitpos/scripts/deploy.sh rollback
```

### Restore Last Backup
```bash
LATEST_BACKUP=$(ls -t /opt/kuwaitpos/backups/postgres_*.sql.gz | head -n1)
sudo bash /opt/kuwaitpos/scripts/restore-db.sh "$LATEST_BACKUP"
```

### Restart All Services
```bash
cd /opt/kuwaitpos
docker compose restart
```

### Check Service Health
```bash
bash /opt/kuwaitpos/scripts/health-check.sh
```

---

## Security Notes

1. **Never commit these scripts with production credentials**
2. **Scripts require sudo for deployment operations**
3. **Backup files contain sensitive data - secure them**
4. **Review logs regularly for suspicious activity**
5. **Test restore procedures regularly**

---

## Troubleshooting

### Script Permission Denied
```bash
chmod +x /opt/kuwaitpos/scripts/*.sh
```

### Environment Variables Not Found
```bash
# Ensure .env file exists
ls -la /opt/kuwaitpos/.env

# Check permissions
chmod 600 /opt/kuwaitpos/.env
```

### Docker Command Not Found
```bash
# Ensure user is in docker group
sudo usermod -aG docker $USER
# Log out and back in
```

### Backup Failed
```bash
# Check PostgreSQL container
docker ps | grep postgres

# Check disk space
df -h /opt/kuwaitpos/backups

# Check container logs
docker logs kuwaitpos-postgres
```
