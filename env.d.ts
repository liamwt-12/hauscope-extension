/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_EXTENSION_API_KEY: string;
  readonly VITE_API_BASE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
