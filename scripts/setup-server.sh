#!/bin/bash

# ============================================================
# Kuwait Petrol Pump POS - Initial Server Setup Script
# Run this once on a fresh server to prepare for deployment
# ============================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}Kuwait Petrol Pump POS - Server Setup${NC}"
echo -e "${BLUE}================================================${NC}"
echo ""

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}This script must be run as root${NC}"
   exit 1
fi

# Update system
echo -e "${YELLOW}[1/10] Updating system packages...${NC}"
apt update && apt upgrade -y

# Install required packages
echo -e "${YELLOW}[2/10] Installing required packages...${NC}"
apt install -y curl wget git ufw fail2ban pwgen vim htop

# Install Docker
echo -e "${YELLOW}[3/10] Installing Docker...${NC}"
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm get-docker.sh
else
    echo "Docker already installed"
fi

# Install Docker Compose
echo -e "${YELLOW}[4/10] Installing Docker Compose...${NC}"
if ! docker compose version &> /dev/null; then
    apt install -y docker-compose-plugin
else
    echo "Docker Compose already installed"
fi

# Configure firewall
echo -e "${YELLOW}[5/10] Configuring firewall...${NC}"
ufw --force disable
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'
ufw --force enable

# Create deployment user
echo -e "${YELLOW}[6/10] Creating deployment user...${NC}"
if id "deployuser" &>/dev/null; then
    echo "User deployuser already exists"
else
    adduser --disabled-password --gecos "" deployuser
    usermod -aG docker deployuser
    usermod -aG sudo deployuser

    # Setup SSH directory
    mkdir -p /home/deployuser/.ssh
    chmod 700 /home/deployuser/.ssh
    touch /home/deployuser/.ssh/authorized_keys
    chmod 600 /home/deployuser/.ssh/authorized_keys
    chown -R deployuser:deployuser /home/deployuser/.ssh

    echo -e "${GREEN}User deployuser created${NC}"
    echo -e "${YELLOW}Please add SSH public key to /home/deployuser/.ssh/authorized_keys${NC}"
fi

# Create application directory
echo -e "${YELLOW}[7/10] Creating application directory...${NC}"
mkdir -p /opt/kuwaitpos
mkdir -p /opt/kuwaitpos/data/postgres
mkdir -p /opt/kuwaitpos/data/redis
mkdir -p /opt/kuwaitpos/backups
mkdir -p /opt/kuwaitpos/nginx/logs
mkdir -p /opt/kuwaitpos/nginx/cache
mkdir -p /opt/kuwaitpos/nginx/ssl
mkdir -p /opt/kuwaitpos/nginx/conf.d
mkdir -p /opt/kuwaitpos/scripts

chown -R deployuser:deployuser /opt/kuwaitpos
chmod -R 755 /opt/kuwaitpos

# Configure fail2ban
echo -e "${YELLOW}[8/10] Configuring fail2ban...${NC}"
cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5

[sshd]
enabled = true
port = 22
logpath = %(sshd_log)s
backend = %(sshd_backend)s
EOF

systemctl enable fail2ban
systemctl restart fail2ban

# Configure log rotation
echo -e "${YELLOW}[9/10] Configuring log rotation...${NC}"
cat > /etc/logrotate.d/kuwaitpos << 'EOF'
/opt/kuwaitpos/nginx/logs/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 deployuser deployuser
    sharedscripts
}
EOF

# Generate sample passwords
echo -e "${YELLOW}[10/10] Generating sample passwords...${NC}"
echo ""
echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}Setup completed successfully!${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""
echo -e "${BLUE}Sample passwords (save these securely):${NC}"
echo -e "POSTGRES_PASSWORD: ${GREEN}$(pwgen -s 32 1)${NC}"
echo -e "REDIS_PASSWORD:    ${GREEN}$(pwgen -s 32 1)${NC}"
echo -e "JWT_SECRET:        ${GREEN}$(pwgen -s 64 1)${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Add SSH public key to /home/deployuser/.ssh/authorized_keys"
echo "2. Configure DuckDNS (see DEPLOYMENT.md)"
echo "3. Copy deployment files to /opt/kuwaitpos/"
echo "4. Create .env file in /opt/kuwaitpos/ with above passwords"
echo "5. Setup SSL certificates (see DEPLOYMENT.md)"
echo "6. Run first deployment"
echo ""
echo -e "${BLUE}Server Information:${NC}"
echo "Docker version: $(docker --version)"
echo "Docker Compose: $(docker compose version)"
echo "UFW status: $(ufw status | head -n1)"
echo "Fail2ban status: $(systemctl is-active fail2ban)"
echo ""
