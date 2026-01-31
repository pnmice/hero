# Hero API Server Makefile
# Common commands for development, testing, and Docker operations

.PHONY: help install build build-dist clean lint test test-coverage \
        docker-build docker-run docker-stop docker-logs docker-shell \
        docker-compose-up docker-compose-down docker-compose-logs \
        docker-compose-build docker-compose-restart docker-clean

# Default target
help:
	@echo "Hero API Server - Available Commands"
	@echo ""
	@echo "Development:"
	@echo "  make install          - Install dependencies"
	@echo "  make build            - Build TypeScript (development)"
	@echo "  make build-dist       - Build TypeScript (production)"
	@echo "  make clean            - Clean build artifacts"
	@echo "  make watch            - Watch mode for TypeScript"
	@echo ""
	@echo "Testing & Linting:"
	@echo "  make lint             - Run ESLint"
	@echo "  make lint-fix         - Run ESLint with auto-fix"
	@echo "  make test             - Run all tests"
	@echo "  make test-coverage    - Run tests with coverage report"
	@echo "  make test-docker      - Run docker-server tests only"
	@echo ""
	@echo "Docker (standalone):"
	@echo "  make docker-build     - Build Docker image"
	@echo "  make docker-run       - Run Docker container"
	@echo "  make docker-stop      - Stop Docker container"
	@echo "  make docker-logs      - View container logs"
	@echo "  make docker-shell     - Open shell in container"
	@echo ""
	@echo "Docker Compose:"
	@echo "  make up               - Start services (docker-compose up -d)"
	@echo "  make down             - Stop services (docker-compose down)"
	@echo "  make logs             - View service logs"
	@echo "  make restart          - Restart services"
	@echo "  make docker-clean     - Remove all containers and volumes"
	@echo ""

# ============================================
# Development Commands
# ============================================

install:
	yarn install --frozen-lockfile

build:
	yarn build

build-dist:
	yarn build:dist

clean:
	yarn clean
	rm -rf build build-dist

watch:
	yarn watch

# ============================================
# Testing & Linting Commands
# ============================================

lint:
	yarn lint

lint-fix:
	yarn lint --fix

test:
	yarn test

test-coverage:
	cd build && cross-env ULX_DATA_DIR=.data-test NODE_ENV=test \
		jest --coverage --coverageReporters=text --coverageReporters=lcov

test-docker:
	cd build && cross-env ULX_DATA_DIR=.data-test NODE_ENV=test \
		jest --testPathPattern="docker-server" --coverage --coverageReporters=text

# ============================================
# Docker Standalone Commands
# ============================================

DOCKER_IMAGE_NAME ?= hero-api
DOCKER_CONTAINER_NAME ?= hero-api
DOCKER_PORT ?= 1337

docker-build: build-dist
	docker build -t $(DOCKER_IMAGE_NAME) .

docker-run:
	docker run -d \
		--name $(DOCKER_CONTAINER_NAME) \
		-p $(DOCKER_PORT):1337 \
		-v hero-data:/data \
		-v /dev/shm:/dev/shm \
		--shm-size=2g \
		--security-opt seccomp=unconfined \
		$(DOCKER_IMAGE_NAME)

docker-stop:
	docker stop $(DOCKER_CONTAINER_NAME) || true
	docker rm $(DOCKER_CONTAINER_NAME) || true

docker-logs:
	docker logs -f $(DOCKER_CONTAINER_NAME)

docker-shell:
	docker exec -it $(DOCKER_CONTAINER_NAME) /bin/bash

# ============================================
# Docker Compose Commands
# ============================================

up: docker-compose-up
docker-compose-up:
	docker-compose up -d

down: docker-compose-down
docker-compose-down:
	docker-compose down

logs: docker-compose-logs
docker-compose-logs:
	docker-compose logs -f

docker-compose-build:
	docker-compose build --no-cache

restart: docker-compose-restart
docker-compose-restart:
	docker-compose restart

docker-clean:
	docker-compose down -v --rmi local
	docker volume rm hero-data 2>/dev/null || true

# ============================================
# CI/CD Commands
# ============================================

ci-lint:
	yarn lint

ci-test:
	yarn test

ci-coverage:
	cd build && cross-env ULX_DATA_DIR=.data-test NODE_ENV=test \
		jest --coverage --coverageReporters=json-summary --coverageReporters=lcov

ci-docker:
	make docker-build
	docker run --rm $(DOCKER_IMAGE_NAME) node -e "console.log('Docker image works!')"
