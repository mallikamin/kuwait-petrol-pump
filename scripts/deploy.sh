#!/bin/bash

# ============================================================
# Kuwait Petrol Pump POS - Production Deployment Script
# ============================================================

set -e  # Exit on error
set -u  # Exit on undefined variable

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DEPLOY_DIR="/opt/kuwaitpos"
BACKUP_DIR="${DEPLOY_DIR}/backups"
COMPOSE_FILE="${DEPLOY_DIR}/docker-compose.prod.yml"
ENV_FILE="${DEPLOY_DIR}/.env"
LOG_FILE="${DEPLOY_DIR}/deploy.log"

# Functions
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

success() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

warning() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

# Check if running as root or with sudo
check_privileges() {
    if [[ $EUID -ne 0 ]]; then
        error "This script must be run with sudo privileges"
        exit 1
    fi
}

# Backup database
backup_database() {
    log "Creating database backup..."

    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    BACKUP_FILE="${BACKUP_DIR}/postgres_${TIMESTAMP}.sql.gz"

    mkdir -p "$BACKUP_DIR"

    # Get database credentials from env file
    source "$ENV_FILE"

    # Create backup using docker exec
    if docker exec kuwaitpos-postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "$BACKUP_FILE"; then
        success "Database backup created: $BACKUP_FILE"

        # Keep only last 7 days of backups
        find "$BACKUP_DIR" -name "postgres_*.sql.gz" -mtime +7 -delete
        log "Old backups cleaned up (kept last 7 days)"
    else
        error "Database backup failed"
        return 1
    fi
}

# Health check
health_check() {
    log "Performing health check..."

    local MAX_RETRIES=30
    local RETRY_COUNT=0

    while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
        if curl -f -s http://localhost:3000/api/health > /dev/null 2>&1; then
            success "Health check passed"
            return 0
        fi

        RETRY_COUNT=$((RETRY_COUNT + 1))
        log "Health check attempt $RETRY_COUNT/$MAX_RETRIES..."
        sleep 2
    done

    error "Health check failed after $MAX_RETRIES attempts"
    return 1
}

# Rollback to previous version
rollback() {
    error "Rolling back to previous version..."

    # Restore database from latest backup
    LATEST_BACKUP=$(ls -t "${BACKUP_DIR}"/postgres_*.sql.gz | head -n1)

    if [ -n "$LATEST_BACKUP" ]; then
        log "Restoring database from: $LATEST_BACKUP"
        source "$ENV_FILE"

        gunzip -c "$LATEST_BACKUP" | docker exec -i kuwaitpos-postgres psql -U "$POSTGRES_USER" "$POSTGRES_DB"
        success "Database restored"
    else
        warning "No backup found for rollback"
    fi

    # Revert to previous docker image
    log "Reverting to previous Docker image..."
    docker-compose -f "$COMPOSE_FILE" down
    docker-compose -f "$COMPOSE_FILE" up -d --no-deps backend

    if health_check; then
        success "Rollback completed successfully"
    else
        error "Rollback failed - manual intervention required"
        exit 1
    fi
}

# Main deployment
deploy() {
    log "========================================"
    log "Starting deployment to production"
    log "========================================"

    cd "$DEPLOY_DIR"

    # Pre-deployment checks
    log "Running pre-deployment checks..."

    if [ ! -f "$ENV_FILE" ]; then
        error "Environment file not found: $ENV_FILE"
        exit 1
    fi

    if [ ! -f "$COMPOSE_FILE" ]; then
        error "Docker Compose file not found: $COMPOSE_FILE"
        exit 1
    fi

    # Load environment variables
    source "$ENV_FILE"

    # Create backup
    if ! backup_database; then
        error "Backup failed - aborting deployment"
        exit 1
    fi

    # Pull latest Docker images
    log "Pulling latest Docker images..."
    if ! docker-compose -f "$COMPOSE_FILE" pull backend; then
        error "Failed to pull Docker images"
        exit 1
    fi
    success "Docker images pulled successfully"

    # Run database migrations
    log "Running database migrations..."
    if ! docker-compose -f "$COMPOSE_FILE" run --rm backend sh -c "cd /app/packages/database && pnpm exec prisma migrate deploy"; then
        error "Database migration failed - rolling back"
        rollback
        exit 1
    fi
    success "Database migrations completed"

    # Deploy new version
    log "Deploying new version..."
    if ! docker-compose -f "$COMPOSE_FILE" up -d --no-deps backend; then
        error "Deployment failed - rolling back"
        rollback
        exit 1
    fi
    success "New version deployed"

    # Wait for services to be healthy
    log "Waiting for services to be healthy..."
    sleep 5

    # Health check
    if ! health_check; then
        error "Health check failed - rolling back"
        rollback
        exit 1
    fi

    # Cleanup old images
    log "Cleaning up old Docker images..."
    docker image prune -f

    # Show running containers
    log "Current running containers:"
    docker-compose -f "$COMPOSE_FILE" ps

    success "========================================"
    success "Deployment completed successfully!"
    success "========================================"

    # Show deployment info
    log ""
    log "Deployment Information:"
    log "- Time: $(date)"
    log "- Image: ${DOCKER_IMAGE:-kuwaitpos-backend:latest}"
    log "- Backend URL: https://kuwaitpos.duckdns.org/api"
    log "- Logs: docker-compose -f $COMPOSE_FILE logs -f backend"
    log ""
}

# Handle script arguments
case "${1:-}" in
    rollback)
        log "Manual rollback requested"
        rollback
        ;;
    backup)
        log "Manual backup requested"
        backup_database
        ;;
    health)
        health_check
        ;;
    *)
        check_privileges
        deploy
        ;;
esac
