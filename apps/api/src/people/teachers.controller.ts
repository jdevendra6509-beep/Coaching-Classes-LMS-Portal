import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { Role } from "@lms/db";
import { Auth, InstituteId, Roles } from "../auth/decorators.js";
import type { AuthContext } from "../common/request.js";
import { CreateTeacherDto, PeopleQuery, UpdateTeacherDto } from "./dto.js";
import { TeachersService } from "./teachers.service.js";

@Roles(Role.INSTITUTE_ADMIN)
@Controller("teachers")
export class TeachersController {
  constructor(private readonly teachers: TeachersService) {}

  @Get()
  list(@InstituteId() iid: string, @Query() q: PeopleQuery) {
    return this.teachers.list(iid, q);
  }

  @Post()
  create(@InstituteId() iid: string, @Body() dto: CreateTeacherDto, @Auth() auth: AuthContext) {
    return this.teachers.create(iid, dto, auth);
  }

  @Get(":id")
  get(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string) {
    return this.teachers.get(iid, id);
  }

  @Patch(":id")
  update(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateTeacherDto, @Auth() auth: AuthContext) {
    return this.teachers.update(iid, id, dto, auth);
  }

  @Post(":id/deactivate")
  @HttpCode(200)
  deactivate(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.teachers.setActive(iid, id, false, auth);
  }

  @Post(":id/activate")
  @HttpCode(200)
  activate(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.teachers.setActive(iid, id, true, auth);
  }

  @Post(":id/resend-invite")
  @HttpCode(204)
  resendInvite(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string) {
    return this.teachers.resendInvite(iid, id);
  }
}
