import { Module } from "@nestjs/common";
import { AccountsService } from "./accounts.service.js";
import { FinanceController, StudentFeesController } from "./finance.controller.js";
import { InvoicesService } from "./invoices.service.js";
import { LedgerService } from "./ledger.service.js";
import { PayablesService } from "./payables.service.js";
import { ReportsService } from "./reports.service.js";

@Module({
  controllers: [FinanceController, StudentFeesController],
  providers: [LedgerService, InvoicesService, PayablesService, AccountsService, ReportsService],
  exports: [InvoicesService],
})
export class FinanceModule {}
