import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { UploadModule } from "../upload/upload.module";
import { StorageCleanupService } from "./storage-cleanup.service";

@Module({
  imports: [DatabaseModule, UploadModule],
  providers: [StorageCleanupService],
  exports: [StorageCleanupService],
})
export class StorageCleanupModule {}
