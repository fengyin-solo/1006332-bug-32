# 本地与容器共用同一条链路：npm ci -> npm run build -> npm run serve。
# 依赖版本只认 frontend/package-lock.json，装依赖一律走 npm ci。

.PHONY: install frontend dev build serve start typecheck selfcheck docker-build docker-up docker-down

install:
	cd frontend && npm ci

frontend: dev

dev:
	cd frontend && npm run dev

build:
	cd frontend && npm run build

serve:
	cd frontend && npm run serve

start: install build serve

typecheck:
	cd frontend && npm run typecheck

# 自检：锁文件可复现安装 + 类型检查 + 生产构建 + 能耗数据自检，一条链路跑通才算过。
selfcheck: install typecheck build
	cd frontend && npm run selfcheck
	@echo "自检通过：锁文件、类型、构建链路、能耗数据一致"

docker-build:
	docker compose build

docker-up:
	docker compose up --build

docker-down:
	docker compose down
