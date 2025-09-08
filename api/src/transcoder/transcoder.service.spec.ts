import { Test, TestingModule } from '@nestjs/testing';
import { TranscoderService } from './transcoder.service';

describe('TranscoderService', () => {
  let service: TranscoderService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TranscoderService],
    }).compile();

    service = module.get<TranscoderService>(TranscoderService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
