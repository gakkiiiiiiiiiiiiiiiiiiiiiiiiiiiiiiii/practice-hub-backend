import { IsEnum } from 'class-validator';
import { StorageProvider } from '../../../common/constants/storage-provider';

export class SetStorageProviderDto {
  @IsEnum(StorageProvider, { message: '存储服务仅支持 cos 或 oss' })
  provider: StorageProvider;
}
