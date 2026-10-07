#!/usr/bin/env bash
# 廊内能耗计量 · 唯一构建链路（本地 Make 与容器镜像共用，谁都不许另起一条）。
# 步骤：
#   1) npm ci        —— 严格按 package-lock.json 安装，锁文件与 package.json 不一致直接失败；
#   2) energy:verify —— 存量迁移 + 落库前校验 + 自检 + 对账（与值班台账对不上就失败，阻止带病镜像）；
#   3) build         —— vue-tsc 类型检查 + vite 产出 dist（本地与容器是同一份产物）。
set -euo pipefail

cd "$(dirname "$0")/.."

echo "== [1/3] 按锁文件安装依赖（npm ci）=="
npm ci

echo "== [2/3] 能耗计量流水线：迁移 / 落库前校验 / 自检 / 对账 =="
npm run energy:verify

echo "== [3/3] 类型检查并构建生产产物 dist =="
npm run build

echo "构建链路完成：dist 已生成，自检与对账均通过。"
