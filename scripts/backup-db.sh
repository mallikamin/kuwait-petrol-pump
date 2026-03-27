#!/bin/bash

# ============================================================
# Database Backup Script
# Creates compressed PostgreSQL backups
# ============================================================

set -e

DEPLOY_DIR="/opt/kuwaitpos"
BACKUP_DIR="${DEPLOY_DIR}/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/postgres_${TIMESTAMP}.sql.gz"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}Starting database backup...${NC}"

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Load environment variables
if [ -f "${DEPLOY_DIR}/.env" ]; then
    source "${DEPLOY_DIR}/.env"
else
    echo -e "${RED}Error: .env file not found${NC}"
    exit 1
fi

# Check if PostgreSQL container is running
if ! docker ps | grep -q kuwaitpos-postgres; then
    echo -e "${RED}Error: PostgreSQL container is not running${NC}"
    exit 1
fi

# Create backup
echo "Creating backup: $BACKUP_FILE"
if docker exec kuwaitpos-postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "$BACKUP_FILE"; then
    BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo -e "${GREEN}Backup created successfully: $BACKUP_FILE ($BACKUP_SIZE)${NC}"

    # Keep only last 30 days of backups
    find "$BACKUP_DIR" -name "postgres_*.sql.gz" -mtime +30 -delete
    echo "Old backups cleaned up (kept last 30 days)"

    # List recent backups
    echo ""
    echo "Recent backups:"
    ls -lht "$BACKUP_DIR" | head -n 6
else
    echo -e "${RED}Error: Backup failed${NC}"
    exit 1
fi
