import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from "@nestjs/common";
import { Role } from "@lms/db";
import { Auth, InstituteId, Roles } from "../auth/decorators.js";
import type { AuthContext } from "../common/request.js";
import { CreateMaterialDto, DownloadQuery, ModuleDto, OrderMaterialsDto, OrderModulesDto, UpdateMaterialDto, UploadRequestDto } from "./dto.js";
import { MaterialsService } from "./materials.service.js";

/** Course content management, for admins and the teachers of each course. */
@Roles(Role.INSTITUTE_ADMIN, Role.TEACHER)
@Controller()
export class MaterialsController {
  constructor(private readonly materials: MaterialsService) {}

  @Get("courses/:courseId/materials")
  list(@InstituteId() iid: string, @Param("courseId", ParseUUIDPipe) courseId: string, @Auth() auth: AuthContext) {
    return this.materials.listForStaff(iid, courseId, auth);
  }

  /** Step 1: get a URL to PUT the file to. Step 2: POST …/materials with the uploadToken. */
  @Post("courses/:courseId/materials/upload-url")
  @HttpCode(200)
  uploadUrl(@InstituteId() iid: string, @Param("courseId", ParseUUIDPipe) courseId: string, @Body() dto: UploadRequestDto, @Auth() auth: AuthContext) {
    return this.materials.requestUpload(iid, courseId, dto, auth);
  }

  @Post("courses/:courseId/materials")
  create(@InstituteId() iid: string, @Param("courseId", ParseUUIDPipe) courseId: string, @Body() dto: CreateMaterialDto, @Auth() auth: AuthContext) {
    return this.materials.create(iid, courseId, dto, auth);
  }

  @Put("courses/:courseId/materials/order")
  order(@InstituteId() iid: string, @Param("courseId", ParseUUIDPipe) courseId: string, @Body() dto: OrderMaterialsDto, @Auth() auth: AuthContext) {
    return this.materials.order(iid, courseId, dto, auth);
  }

  @Patch("materials/:id")
  update(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateMaterialDto, @Auth() auth: AuthContext) {
    return this.materials.update(iid, id, dto, auth);
  }

  @Delete("materials/:id")
  @HttpCode(204)
  remove(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.materials.remove(iid, id, auth);
  }

  @Get("materials/:id/download")
  download(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string, @Query() q: DownloadQuery, @Auth() auth: AuthContext) {
    return this.materials.downloadForStaff(iid, id, q.inline ?? false, auth);
  }

  @Post("courses/:courseId/modules")
  createModule(@InstituteId() iid: string, @Param("courseId", ParseUUIDPipe) courseId: string, @Body() dto: ModuleDto, @Auth() auth: AuthContext) {
    return this.materials.createModule(iid, courseId, dto, auth);
  }

  @Put("courses/:courseId/modules/order")
  orderModules(@InstituteId() iid: string, @Param("courseId", ParseUUIDPipe) courseId: string, @Body() dto: OrderModulesDto, @Auth() auth: AuthContext) {
    return this.materials.orderModules(iid, courseId, dto.moduleIds, auth);
  }

  @Patch("modules/:id")
  renameModule(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string, @Body() dto: ModuleDto, @Auth() auth: AuthContext) {
    return this.materials.renameModule(iid, id, dto, auth);
  }

  @Delete("modules/:id")
  @HttpCode(204)
  deleteModule(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string, @Auth() auth: AuthContext) {
    return this.materials.deleteModule(iid, id, auth);
  }
}

/** What an enrolled student sees. The student comes from the session; there is no student id parameter. */
@Roles(Role.STUDENT)
@Controller("me")
export class StudentMaterialsController {
  constructor(private readonly materials: MaterialsService) {}

  @Get("courses/:courseId/materials")
  list(@InstituteId() iid: string, @Param("courseId", ParseUUIDPipe) courseId: string, @Auth() auth: AuthContext) {
    return this.materials.listForStudent(iid, courseId, auth);
  }

  @Get("materials/:id/download")
  download(@InstituteId() iid: string, @Param("id", ParseUUIDPipe) id: string, @Query() q: DownloadQuery, @Auth() auth: AuthContext) {
    return this.materials.downloadForStudent(iid, id, q.inline ?? false, auth);
  }
}
