import { Module } from '@nestjs/common';
import { TranscoderService } from './transcoder.service';

@Module({
  providers: [TranscoderService],
  exports: [TranscoderService],
})
export class TranscoderModule {}