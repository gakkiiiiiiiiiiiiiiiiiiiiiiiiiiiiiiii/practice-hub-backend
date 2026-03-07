import { Module } from '@nestjs/common';
import { ProcessPdfController } from './process-pdf.controller';
import { ProcessPdfService } from './process-pdf.service';
import { SiliconFlowOcrService } from './silicon-flow-ocr.service';
import { PdfExtractQueueService } from './pdf-extract-queue.service';
import { UploadModule } from '../upload/upload.module';

@Module({
  imports: [UploadModule],
  controllers: [ProcessPdfController],
  providers: [ProcessPdfService, SiliconFlowOcrService, PdfExtractQueueService],
  exports: [ProcessPdfService],
})
export class ProcessPdfModule {}
