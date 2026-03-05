import { Module } from '@nestjs/common';
import { ProcessPdfController } from './process-pdf.controller';
import { ProcessPdfService } from './process-pdf.service';
import { SiliconFlowOcrService } from './silicon-flow-ocr.service';

@Module({
  controllers: [ProcessPdfController],
  providers: [ProcessPdfService, SiliconFlowOcrService],
  exports: [ProcessPdfService],
})
export class ProcessPdfModule {}
