import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query } from "@nestjs/common";
import { Role } from "@lms/db";
import { Auth, InstituteId, Roles } from "../auth/decorators.js";
import { ParseDatePipe } from "../common/date.pipe.js";
import type { AuthContext } from "../common/request.js";
import { AttendanceService } from "./attendance.service.js";
import { DateRangeQuery, MarkAttendanceDto, StudentAttendanceQuery } from "./dto.js";

@Controller()
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Roles(Role.INSTITUTE_ADMIN, Role.TEACHER)
  @Get("batches/:id/attendance")
  history(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string, @Query() q: DateRangeQuery, @Auth() auth: AuthContext) {
    return this.attendance.history(iid, id, q, auth);
  }

  @Roles(Role.INSTITUTE_ADMIN, Role.TEACHER)
  @Get("batches/:id/attendance/:date")
  register(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string, @Param("date", ParseDatePipe) date: Date, @Auth() auth: AuthContext) {
    return this.attendance.register(iid, id, date, auth);
  }

  @Roles(Role.INSTITUTE_ADMIN, Role.TEACHER)
  @Put("batches/:id/attendance/:date")
  mark(
    @InstituteId() iid: string,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("date", ParseDatePipe) date: Date,
    @Body() dto: MarkAttendanceDto,
    @Auth() auth: AuthContext,
  ) {
    return this.attendance.mark(iid, id, date, dto.records, auth);
  }

  @Roles(Role.INSTITUTE_ADMIN, Role.ACCOUNTANT, Role.TEACHER)
  @Get("students/:id/attendance")
  student(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string, @Query() q: StudentAttendanceQuery, @Auth() auth: AuthContext) {
    return this.attendance.studentSummary(iid, id, q, auth);
  }
}
