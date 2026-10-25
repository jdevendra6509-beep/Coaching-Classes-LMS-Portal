import { Module } from "@nestjs/common";
import { CertificatesController, StudentCertificatesController, VerifyController } from "./certificates.controller.js";
import { CertificatesService } from "./certificates.service.js";

@Module({
  controllers: [CertificatesController, StudentCertificatesController, VerifyController],
  providers: [CertificatesService],
  exports: [CertificatesService],
})
export class CertificatesModule {}
