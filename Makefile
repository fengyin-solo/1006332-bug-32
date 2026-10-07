# 廊内能耗计量 · 唯一入口。本地与容器都走 frontend/scripts/ci-build.sh 这一条链路：
# npm ci（锁文件）→ energy:verify（迁移/落库校验/自检/对账）→ vite build。
.PHONY: install ci build verify selfcheck reconcile migrate frontend image up clean

install:
	cd frontend && npm ci

# 完整构建链路（= 容器镜像内执行的同一条）
ci build:
	cd frontend && scripts/ci-build.sh

# 能耗流水线各闸门（也可单独跑）
migrate:
	cd frontend && npm run energy:migrate
selfcheck:
	cd frontend && npm run energy:check
reconcile:
	cd frontend && npm run energy:reconcile
verify:
	cd frontend && npm run energy:verify

# 本地开发：依赖仍来自锁文件
frontend:
	cd frontend && npm ci && npm run dev

# 容器与本地同源构建
image:
	docker build -t utility-tunnel-frontend:pinned ./frontend
up:
	docker compose up --build

clean:
	rm -rf frontend/dist frontend/reports
