# 城市地下综合管廊运行维护管理平台

面向管廊主体台账、入廊管线登记、廊内环境监测、通风排水消防、结构沉降与渗漏处置、巡检检修与隐患整改、入廊作业审批和运维值班的一体化城市地下综合管廊运行维护管理工作台。

这是一个**纯前端**管理平台：Vue 3 + Vite + TypeScript，仓库里没有后端服务。业务数据由
`frontend/src/data/` 下的本地数据层提供：首次打开用示例数据播种，之后的登记、筛选与状态流转
结果都持久化在浏览器 `localStorage` 里，刷新或重开浏览器都还在。dev server 已关掉自动打开页面，
启动后按终端打印的地址手工打开。

## 目录结构

```text
.
├── frontend/                 Vue 3 + Vite + TypeScript 前端（唯一运行单元）
│   ├── src/views/            每个业务模块一个页面
│   ├── src/api/local-service.ts   本地数据服务：列表、筛选、动作流转、导出
│   ├── src/data/             模块元数据 / 示例数据 / localStorage 持久化
│   ├── src/stores/           会话与筛选状态
│   ├── src/energy/           廊内能耗计量：固化流水线（fixtures + core 单一事实源 + 页面服务）
│   ├── scripts/              ci-build.sh（唯一构建链路）与 energy:* 自检/迁移/对账脚本
│   ├── package-lock.json     钉死的依赖版本（npm ci 安装）
│   └── vite.config.ts        dev server 配置（open: false，无 /api 代理）
├── .gitignore
└── docker-compose.yml
```

## 启动

```bash
cd frontend
npm ci          # 严格按 package-lock.json 安装，版本钉死、可复现
npm run dev
```

前端默认监听 `http://127.0.0.1:5173/`，dev server 不会自动打开浏览器，需要自己访问。

## 一条流水线（本地与容器同源）

依赖、构建、部署不再各走各的：本地 `make build` 与容器镜像构建执行的是**同一个脚本**
`frontend/scripts/ci-build.sh`，顺序固定为：

```text
npm ci                 # 版本只认 package-lock.json，锁与清单不一致直接失败
npm run energy:verify  # 存量迁移 → 落库前校验 → 自检 → 对账（对不上值班台账即失败）
npm run build          # vue-tsc 类型检查 + vite 产出 dist（本地/容器同一份产物）
```

- 依赖版本钉在 `frontend/package-lock.json`（lockfileVersion 3，含 `resolved`/`integrity`），
  `package.json` 全部写精确版本；镜像用 `npm ci` 而不是 `npm install`。
- 容器用 `vite preview` 提供 `dist`（端口 4173，`--strictPort`），`docker compose up --build`
  与本地跑的是同一条链路。
- 环境差异**只留在配置里**：仅当前岗位/单位（`VITE_OPERATOR_*`）允许注入，缺省即固化默认值；
  计量口径（时区、补水量、优先级）写死在 `src/energy/core/config.mjs`，环境变量改不动。

## 廊内能耗计量（固化口径）

能耗计量不再读浏览器里会漂移的散数据，列表 / 详情 / 卡片 / 自检 / 对账全部取自
`frontend/src/energy/core/pipeline.mjs` 这**单一事实源**，样例一并固化在
`src/energy/fixtures/`（点位册、存量台账、2026-10 抄表批次、值班台账），本地与容器读到的
用电量与用水量因此完全一致。

拍板口径（另一种取值只留作对照、不进合计）：

- **统计周期**：一律按 `Asia/Shanghai`（+08:00）归账，自然月 `YYYY-MM`；不使用会随容器时区
  漂移的 `Date` 解析。抄表日期必须落在统计周期所在自然月，否则记「统计周期与抄表日期矛盾」。
- **存量迁移**：按抄表日期升序迁移；既有台账沿用原编号；编号冲突时**最早抄表那份保留原号**，
  后到的另起 `ENER-LEGACY-xxx`，原编号/原读数仅作对照；点位不在点位册的另起 `ENER-UNREG-xxx`
  一行说明。
- **早年只有用电量、没用水量**：生效口径为**用水量补 0（保守口径，不虚构）**并打
  `waterBackfilled`；「装表后月均用水量」只写入 `waterAlternative` 作对照，永不参与合计。
- **重复录入**：同计量编号只认第一次（按提交顺序），后到的**整条退回、条数不叠加**，其读数
  只作为第一条的对照值。
- **跨单位**：外单位点位**只读**，越权提交一律拒绝；记录归属（`ownerUnitCode`/岗位）不因
  操作改变，改动的记录仍归原岗位。
- **落库前校验**：依赖缺失、周期/抄表日期矛盾的记录仍落库但置「数据异常」；重复、越权则硬
  退回不落地。
- **对账**：每条「数据异常」生成一条 `RECON-xxx` 待办，条数与编号和 `duty-ledger.json`
  值班台账逐条一致。

命令（均可单独运行，产物写到 `frontend/reports/`）：

```bash
npm run energy:migrate    # 存量迁移 + 落库前校验
npm run energy:check      # 自检：列依赖缺失/编号冲突/周期矛盾并断言条数一致
npm run energy:reconcile  # 对账并与值班台账逐条核对
npm run energy:verify     # 以上三步串起来（构建闸门）
```

当前固化结果（账期 2026-10，当前单位 UNIT-A 运维一处）：落库 21 条（待抄表 1 / 已核对 15 /
数据异常 5），自检 5 条（依赖缺失 2、计量编号冲突 1、周期与抄表日期矛盾 2）＝对账待办 5 条
＝值班台账 5 条；硬退回 2 条（重复录入 1、越权提交 1）。

## 业务模块

| 模块 | 目录 | 业务对象 | 主要字段 |
| --- | --- | --- | --- |
| 管廊主体台账 | `tunnel` | 综合管廊 | 管廊编号、管廊名称、所属片区 |
| 入廊管线登记 | `pipeline` | 入廊管线 | 管线编号、所属舱室、管线类型 |
| 廊内环境监测 | `envmonitor` | 环境监测记录 | 监测编号、监测点位、环境温度 |
| 通风系统运维 | `ventilation` | 通风机组 | 机组编号、所属舱室、风机型号 |
| 廊内排水运维 | `drainage` | 排水泵坑 | 泵坑编号、所属舱室、集水坑容积 |
| 消防系统运维 | `firecontrol` | 消防设施 | 设施编号、所属舱室、消防类型 |
| 廊内照明运维 | `lighting` | 照明灯具 | 灯具编号、所属舱室、灯具类型 |
| 门禁安防运维 | `access` | 安防点位 | 点位编号、所属出入口、门禁类型 |
| 廊内巡检任务 | `patrol` | 巡检任务 | 巡检编号、巡检路线、巡检班组 |
| 结构沉降监测 | `settlement` | 沉降监测点 | 监测编号、监测断面、累计沉降量 |
| 渗漏水处置 | `leak` | 渗漏处置单 | 处置编号、渗漏点位、渗漏程度 |
| 设施检修管理 | `maintenance` | 检修记录 | 检修编号、检修对象、检修类别 |
| 隐患整改管理 | `hazard` | 隐患记录 | 隐患编号、隐患部位、隐患等级 |
| 应急演练管理 | `emergency` | 应急演练 | 演练编号、演练场景、参与班组 |
| 廊内能耗计量 | `energy` | 能耗计量记录 | 计量编号、计量点位、用电量 |
| 设备台账管理 | `device` | 管廊设备 | 设备编号、设备名称、设备型号 |
| 入廊作业审批 | `entryapprove` | 作业申请 | 申请编号、申请单位、作业舱室 |
| 运维值班交接 | `duty` | 值班交接记录 | 交接编号、值班班组、值班日期 |

## 约定

- 每个模块的页面在 `frontend/src/views/<模块>/index.vue`，页面只负责渲染，读写统一走
  `frontend/src/api/local-service.ts`。
- 字段、状态、动作与流转目标集中在 `frontend/src/data/modules.ts`；示例数据在
  `frontend/src/data/seed.ts`。
- 状态流转只允许在 `local-service.ts` 里改，页面组件不做业务判断。
- 想回到初始数据：清掉浏览器里 `urban-utility-tunnel:entries` 这一项，或调用 `resetModule(模块)`。
