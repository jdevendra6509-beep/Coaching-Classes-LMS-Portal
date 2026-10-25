import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { Role } from "@lms/db";
import { Auth, InstituteId, Roles } from "../auth/decorators.js";
import type { AuthContext } from "../common/request.js";
import { CreateStudentDto, ImportStudentsDto, StudentsQuery, UpdateStudentDto } from "./dto.js";
import { StudentsService } from "./students.service.js";

@Roles(Role.INSTITUTE_ADMIN)
@Controller("students")
export class StudentsController {
  constructor(private readonly students: StudentsService) {}

  @Roles(Role.INSTITUTE_ADMIN, Role.ACCOUNTANT, Role.TEACHER)
  @Get()
  list(@InstituteId() iid: string, @Query() q: StudentsQuery, @Auth() auth: AuthContext) {
    return this.students.list(iid, q, auth);
  }

  @Post()
  create(@InstituteId() iid: string, @Body() dto: CreateStudentDto, @Auth() auth: AuthContext) {
    return this.students.create(iid, dto, auth);
  }

  /** Bulk import from CSV. Send `dryRun: true` first to see every problem without importing. */
  @Post("import")
  @HttpCode(200)
  import(@InstituteId() iid: string, @Body() dto: ImportStudentsDto, @Auth() auth: AuthContext) {
    return this.students.import(iid, dto, auth);
  }

  @Roles(Role.INSTITUTE_ADMIN, Role.ACCOUNTANT, Role.TEACHER)
  @Get(":id")
  get(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.students.get(iid, id, auth);
  }

  @Patch(":id")
  update(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateStudentDto, @Auth() auth: AuthContext) {
    return this.students.update(iid, id, dto, auth);
  }

  @Post(":id/deactivate")
  @HttpCode(200)
  deactivate(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.students.setActive(iid, id, false, auth);
  }

  @Post(":id/activate")
  @HttpCode(200)
  activate(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.students.setActive(iid, id, true, auth);
  }

  @Post(":id/resend-invite")
  @HttpCode(204)
  resendInvite(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string) {
    return this.students.resendInvite(iid, id);
  }
}
