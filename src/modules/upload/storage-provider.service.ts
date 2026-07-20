import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  DEFAULT_STORAGE_PROVIDER,
  STORAGE_PROVIDER_CONFIG_KEY,
  StorageProvider,
} from '../../common/constants/storage-provider';
import { SystemConfig } from '../../database/entities/system-config.entity';

@Injectable()
export class StorageProviderService {
  constructor(
    @InjectRepository(SystemConfig)
    private readonly systemConfigRepository: Repository<SystemConfig>,
  ) {}

  async getProvider(): Promise<StorageProvider> {
    const config = await this.systemConfigRepository.findOne({
      where: { configKey: STORAGE_PROVIDER_CONFIG_KEY },
    });
    if (!config?.configValue) return DEFAULT_STORAGE_PROVIDER;
    try {
      const value = JSON.parse(config.configValue);
      return Object.values(StorageProvider).includes(value)
        ? (value as StorageProvider)
        : DEFAULT_STORAGE_PROVIDER;
    } catch {
      return DEFAULT_STORAGE_PROVIDER;
    }
  }
}
