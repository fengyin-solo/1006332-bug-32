# 廊内能耗计量 · 容器构建与本地 Make 共用 scripts/ci-build.sh 这一条链路。
# 镜像只钉大版本基线，真正的依赖可复现由 package-lock.json（npm ci）保证。
FROM node:20.19-alpine AS build
WORKDIR /srv/web

# 先拷清单，命中 Docker 层缓存；严格按锁文件安装，缺锁/漂移即失败。
COPY package.json package-lock.json ./
RUN npm ci

# 拷源码与固化样例，跑「同一条」构建链路（内含能耗迁移/自检/对账闸门）。
COPY . .
RUN chmod +x scripts/ci-build.sh && scripts/ci-build.sh

# 运行阶段：用 vite preview 提供构建产物（本地 npm run build && npm run preview 同源）。
FROM node:20.19-alpine AS runtime
WORKDIR /srv/web
ENV NODE_ENV=production
# 统计周期固定按上海时区归账；容器默认 UTC 也不会让账期漂移。
ENV TZ=Asia/Shanghai
COPY --from=build /srv/web/node_modules ./node_modules
COPY --from=build /srv/web/dist ./dist
COPY --from=build /srv/web/package.json ./package.json
COPY --from=build /srv/web/vite.config.ts ./vite.config.ts
COPY --from=build /srv/web/reports ./reports
EXPOSE 4173
# --strictPort：端口被占直接失败，绝不悄悄换端口造成「线上对不上」。
CMD ["npm", "run", "preview", "--", "--host", "0.0.0.0", "--port", "4173", "--strictPort"]
