import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from "@nestjs/common";
import { Role } from "@lms/db";
import { Auth, InstituteId, Roles } from "../auth/decorators.js";
import type { AuthContext } from "../common/request.js";
import { BatchesService } from "./batches.service.js";
import { BatchesQuery, CreateBatchDto, StudentIdsDto, TeacherIdsDto, UpdateBatchDto } from "./dto.js";

@Roles(Role.INSTITUTE_ADMIN)
@Controller("batches")
export class BatchesController {
  constructor(private readonly batches: BatchesService) {}

  /** Admins see every batch; teachers see the batches they're assigned to. */
  @Roles(Role.INSTITUTE_ADMIN, Role.TEACHER)
  @Get()
  list(@InstituteId() iid: string, @Query() q: BatchesQuery, @Auth() auth: AuthContext) {
    return this.batches.list(iid, q, auth);
  }

  @Post()
  create(@InstituteId() iid: string, @Body() dto: CreateBatchDto, @Auth() auth: AuthContext) {
    return this.batches.create(iid, dto, auth);
  }

  @Roles(Role.INSTITUTE_ADMIN, Role.TEACHER)
  @Get(":id")
  get(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.batches.get(iid, id, auth);
  }

  @Patch(":id")
  update(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateBatchDto, @Auth() auth: AuthContext) {
    return this.batches.update(iid, id, dto, auth);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.batches.remove(iid, id, auth);
  }

  @Put(":id/teachers")
  setTeachers(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string, @Body() dto: TeacherIdsDto, @Auth() auth: AuthContext) {
    return this.batches.setTeachers(iid, id, dto.teacherIds, auth);
  }

  @Roles(Role.INSTITUTE_ADMIN, Role.TEACHER)
  @Get(":id/students")
  roster(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.batches.roster(iid, id, auth);
  }

  @Post(":id/enrollments")
  enrollMany(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string, @Body() dto: StudentIdsDto, @Auth() auth: AuthContext) {
    return this.batches.enrollMany(iid, id, dto.studentIds, auth);
  }
}
