import { Module } from "@nestjs/common";
import { CertificatesModule } from "../certificates/certificates.module.js";
import { AttendanceController } from "./attendance.controller.js";
import { AttendanceService } from "./attendance.service.js";
import { BatchesController } from "./batches.controller.js";
import { BatchesService } from "./batches.service.js";
import { CoursesController } from "./courses.controller.js";
import { CoursesService } from "./courses.service.js";
import { EnrollmentsController } from "./enrollments.controller.js";

@Module({
  imports: [CertificatesModule],
  controllers: [CoursesController, BatchesController, EnrollmentsController, AttendanceController],
  providers: [CoursesService, BatchesService, AttendanceService],
})
export class AcademicsModule {}
