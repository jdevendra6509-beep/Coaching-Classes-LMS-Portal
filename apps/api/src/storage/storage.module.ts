import { Global, Module } from "@nestjs/common";
import { env } from "../config/env.js";
import { DevStorageController } from "./dev-storage.controller.js";
import { LocalStorageService } from "./local-storage.service.js";
import { StorageService } from "./storage.service.js";
import { UploadTicketService } from "./upload-ticket.service.js";

const local = process.env.STORAGE_DRIVER === "local";

@Global()
@Module({
  controllers: local ? [DevStorageController] : [],
  providers: [{ provide: StorageService, useClass: local ? LocalStorageService : StorageService }, UploadTicketService],
  exports: [StorageService, UploadTicketService],
})
export class StorageModule {
  constructor() {
    if (local) env(); // validates, and LocalStorageService refuses to run in production
  }
}
