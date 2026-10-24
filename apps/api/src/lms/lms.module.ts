import { Module } from "@nestjs/common";
import { BrandingController } from "./branding.controller.js";
import { MaterialsController, StudentMaterialsController } from "./materials.controller.js";
import { MaterialsService } from "./materials.service.js";

@Module({
  controllers: [MaterialsController, StudentMaterialsController, BrandingController],
  providers: [MaterialsService],
})
export class LmsModule {}
