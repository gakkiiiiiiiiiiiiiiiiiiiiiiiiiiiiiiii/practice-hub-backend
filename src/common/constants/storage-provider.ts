export const STORAGE_PROVIDER_CONFIG_KEY = 'storage_provider';

export enum StorageProvider {
  COS = 'cos',
  OSS = 'oss',
}

export const DEFAULT_STORAGE_PROVIDER = StorageProvider.COS;
