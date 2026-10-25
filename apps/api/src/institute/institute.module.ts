import { Module } from "@nestjs/common";
import { InstituteController } from "./institute.controller.js";

@Module({ controllers: [InstituteController] })
export class InstituteModule {}
