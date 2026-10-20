import { Module } from '@nestjs/common';
import { PageModule } from '../page/page.module';
import { DatabaseController } from './database.controller';
import { DatabaseService } from './services/database.service';

@Module({
  imports: [PageModule],
  controllers: [DatabaseController],
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseViewsModule {}
