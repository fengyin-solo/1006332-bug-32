/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string
  readonly VITE_APP_NAME?: string
  // 廊内能耗计量：仅“环境差异”可注入，缺省走固化默认值。
  readonly VITE_OPERATOR_NAME?: string
  readonly VITE_OPERATOR_POST?: string
  readonly VITE_OPERATOR_UNIT?: string
  readonly VITE_OPERATOR_UNIT_CODE?: string
  readonly VITE_READONLY_CROSS_UNIT?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
