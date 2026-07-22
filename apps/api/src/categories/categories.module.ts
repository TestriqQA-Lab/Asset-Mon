import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { CategoriesController, CategoryImagePublicController } from './categories.controller';
import { CategoriesService } from './categories.service';

@Module({
  imports: [MulterModule.register({})],
  controllers: [CategoriesController, CategoryImagePublicController],
  providers: [CategoriesService],
})
export class CategoriesModule {}
