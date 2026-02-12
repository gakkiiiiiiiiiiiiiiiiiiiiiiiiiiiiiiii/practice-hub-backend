import { Module } from '@nestjs/common';
import { ProcessPdfController } from './process-pdf.controller';
import { ProcessPdfService } from './process-pdf.service';

@Module({
  controllers: [ProcessPdfController],
  providers: [ProcessPdfService],
  exports: [ProcessPdfService],
})
export class ProcessPdfModule {}
