import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { Role } from "@lms/db";
import { Auth, InstituteId, Roles } from "../auth/decorators.js";
import type { AuthContext } from "../common/request.js";
import { CoursesService } from "./courses.service.js";
import { CoursesQuery, CreateCourseDto, UpdateCourseDto } from "./dto.js";

@Roles(Role.INSTITUTE_ADMIN)
@Controller("courses")
export class CoursesController {
  constructor(private readonly courses: CoursesService) {}

  @Roles(Role.INSTITUTE_ADMIN, Role.ACCOUNTANT, Role.TEACHER)
  @Get()
  list(@InstituteId() iid: string, @Query() q: CoursesQuery) {
    return this.courses.list(iid, q);
  }

  @Post()
  create(@InstituteId() iid: string, @Body() dto: CreateCourseDto, @Auth() auth: AuthContext) {
    return this.courses.create(iid, dto, auth);
  }

  @Roles(Role.INSTITUTE_ADMIN, Role.ACCOUNTANT, Role.TEACHER)
  @Get(":id")
  get(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string) {
    return this.courses.get(iid, id);
  }

  @Patch(":id")
  update(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateCourseDto, @Auth() auth: AuthContext) {
    return this.courses.update(iid, id, dto, auth);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.courses.remove(iid, id, auth);
  }
}
