import { Module } from "@nestjs/common";
import { PeopleService } from "./people.service.js";
import { StaffController } from "./staff.controller.js";
import { StudentsController } from "./students.controller.js";
import { StudentsService } from "./students.service.js";
import { TeachersController } from "./teachers.controller.js";
import { TeachersService } from "./teachers.service.js";

@Module({
  controllers: [TeachersController, StudentsController, StaffController],
  providers: [PeopleService, TeachersService, StudentsService],
})
export class PeopleModule {}
