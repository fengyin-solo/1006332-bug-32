# 与本地同一条构建链路：npm ci（只认锁文件）-> npm run build -> npm run serve。
# 环境差异只走 .env.* 配置，镜像里不再单独装依赖。
FROM node:20-alpine
WORKDIR /srv/web
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build
EXPOSE 5173
CMD ["npm", "run", "serve"]
