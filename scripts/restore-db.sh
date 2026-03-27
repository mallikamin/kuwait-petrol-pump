#!/bin/bash

# ============================================================
# Database Restore Script
# Restores PostgreSQL database from backup
# ============================================================

set -e

DEPLOY_DIR="/opt/kuwaitpos"
BACKUP_DIR="${DEPLOY_DIR}/backups"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check if backup file is provided
if [ -z "$1" ]; then
    echo -e "${YELLOW}Available backups:${NC}"
    ls -lht "$BACKUP_DIR"/*.sql.gz 2>/dev/null || echo "No backups found"
    echo ""
    echo -e "${BLUE}Usage: $0 <backup-file>${NC}"
    echo "Example: $0 ${BACKUP_DIR}/postgres_20260326_120000.sql.gz"
    exit 1
fi

BACKUP_FILE="$1"

# Validate backup file exists
if [ ! -f "$BACKUP_FILE" ]; then
    echo -e "${RED}Error: Backup file not found: $BACKUP_FILE${NC}"
    exit 1
fi

# Load environment variables
if [ -f "${DEPLOY_DIR}/.env" ]; then
    source "${DEPLOY_DIR}/.env"
else
    echo -e "${RED}Error: .env file not found${NC}"
    exit 1
fi

# Warning
echo -e "${RED}WARNING: This will replace the current database!${NC}"
echo -e "${YELLOW}Restoring from: $BACKUP_FILE${NC}"
echo ""
read -p "Are you sure you want to continue? (yes/no): " -r
if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
    echo "Restore cancelled"
    exit 0
fi

# Check if PostgreSQL container is running
if ! docker ps | grep -q kuwaitpos-postgres; then
    echo -e "${RED}Error: PostgreSQL container is not running${NC}"
    exit 1
fi

# Create a safety backup before restore
echo -e "${BLUE}Creating safety backup before restore...${NC}"
SAFETY_BACKUP="${BACKUP_DIR}/safety_backup_$(date +%Y%m%d_%H%M%S).sql.gz"
docker exec kuwaitpos-postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "$SAFETY_BACKUP"
echo -e "${GREEN}Safety backup created: $SAFETY_BACKUP${NC}"

# Stop backend to prevent connections
echo -e "${BLUE}Stopping backend service...${NC}"
docker compose -f "${DEPLOY_DIR}/docker-compose.yml" stop backend

# Restore database
echo -e "${BLUE}Restoring database...${NC}"
if gunzip -c "$BACKUP_FILE" | docker exec -i kuwaitpos-postgres psql -U "$POSTGRES_USER" "$POSTGRES_DB"; then
    echo -e "${GREEN}Database restored successfully${NC}"

    # Start backend
    echo -e "${BLUE}Starting backend service...${NC}"
    docker compose -f "${DEPLOY_DIR}/docker-compose.yml" start backend

    echo -e "${GREEN}Restore completed successfully!${NC}"
else
    echo -e "${RED}Error: Restore failed${NC}"
    echo -e "${YELLOW}Restoring from safety backup...${NC}"
    gunzip -c "$SAFETY_BACKUP" | docker exec -i kuwaitpos-postgres psql -U "$POSTGRES_USER" "$POSTGRES_DB"
    docker compose -f "${DEPLOY_DIR}/docker-compose.yml" start backend
    exit 1
fi
