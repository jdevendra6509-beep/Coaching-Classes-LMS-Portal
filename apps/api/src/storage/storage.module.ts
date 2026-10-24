import { Global, Module } from "@nestjs/common";
import { StorageService } from "./storage.service.js";
import { UploadTicketService } from "./upload-ticket.service.js";

@Global()
@Module({ providers: [StorageService, UploadTicketService], exports: [StorageService, UploadTicketService] })
export class StorageModule {}
