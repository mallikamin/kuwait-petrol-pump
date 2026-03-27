#!/bin/bash

# ============================================================
# Health Check Script
# Monitors all services and reports status
# ============================================================

set -e

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

DEPLOY_DIR="/opt/kuwaitpos"
BACKEND_URL="https://kuwaitpos.duckdns.org"

echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}Kuwait Petrol Pump POS - Health Check${NC}"
echo -e "${BLUE}================================================${NC}"
echo ""

# Check Docker service
echo -n "Docker Service: "
if systemctl is-active --quiet docker; then
    echo -e "${GREEN}Running${NC}"
else
    echo -e "${RED}Not Running${NC}"
fi

# Check containers
echo ""
echo -e "${BLUE}Container Status:${NC}"
cd "$DEPLOY_DIR"

containers=("kuwaitpos-postgres" "kuwaitpos-redis" "kuwaitpos-backend" "kuwaitpos-nginx")
for container in "${containers[@]}"; do
    echo -n "$container: "
    if docker ps --format '{{.Names}}' | grep -q "^${container}$"; then
        health=$(docker inspect --format='{{.State.Health.Status}}' "$container" 2>/dev/null || echo "no-healthcheck")
        if [ "$health" = "healthy" ]; then
            echo -e "${GREEN}Running (Healthy)${NC}"
        elif [ "$health" = "no-healthcheck" ]; then
            echo -e "${YELLOW}Running (No healthcheck)${NC}"
        else
            echo -e "${YELLOW}Running ($health)${NC}"
        fi
    else
        echo -e "${RED}Not Running${NC}"
    fi
done

# Check disk usage
echo ""
echo -e "${BLUE}Disk Usage:${NC}"
df -h /opt/kuwaitpos | tail -n1

# Check Docker disk usage
echo ""
echo -e "${BLUE}Docker Disk Usage:${NC}"
docker system df

# Check backend health endpoint
echo ""
echo -n "Backend API Health: "
if curl -f -s "${BACKEND_URL}/api/health" > /dev/null 2>&1; then
    echo -e "${GREEN}Healthy${NC}"
else
    echo -e "${RED}Unhealthy${NC}"
fi

# Check SSL certificate
echo ""
echo -e "${BLUE}SSL Certificate:${NC}"
if [ -f "/opt/kuwaitpos/nginx/ssl/live/kuwaitpos.duckdns.org/fullchain.pem" ]; then
    expiry=$(openssl x509 -enddate -noout -in /opt/kuwaitpos/nginx/ssl/live/kuwaitpos.duckdns.org/fullchain.pem | cut -d= -f2)
    echo "Expiry: $expiry"

    # Calculate days until expiry
    expiry_epoch=$(date -d "$expiry" +%s)
    current_epoch=$(date +%s)
    days_until_expiry=$(( ($expiry_epoch - $current_epoch) / 86400 ))

    if [ $days_until_expiry -lt 30 ]; then
        echo -e "${RED}WARNING: Certificate expires in $days_until_expiry days!${NC}"
    else
        echo -e "${GREEN}Valid for $days_until_expiry days${NC}"
    fi
else
    echo -e "${YELLOW}Certificate not found (using self-signed?)${NC}"
fi

# Check memory usage
echo ""
echo -e "${BLUE}Memory Usage:${NC}"
free -h | grep -E 'Mem|Swap'

# Check container resource usage
echo ""
echo -e "${BLUE}Container Resources:${NC}"
docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}"

# Check logs for errors
echo ""
echo -e "${BLUE}Recent Errors (last 10):${NC}"
docker compose -f "$DEPLOY_DIR/docker-compose.yml" logs --tail=100 backend 2>/dev/null | grep -i error | tail -n 10 || echo "No recent errors found"

echo ""
echo -e "${BLUE}================================================${NC}"
echo -e "${GREEN}Health check completed${NC}"
echo -e "${BLUE}================================================${NC}"
