import { Role } from "@lms/db";
import { enrollmentFeesCleared } from "../src/finance/invoices.service.js";
import { PrismaService } from "../src/prisma/prisma.service.js";
import { acceptInviteAndLogin, createTestApp, createUser, login, setupInstitute, unique, type TestContext } from "./helpers.js";

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(() => ctx.close());

const email = () => `${unique("f")}@example.in`;
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

/** Institute with a ₹50,000 course, a batch and one enrolled student (with a guardian email). */
async function world() {
  const s = await setupInstitute(ctx);
  const h = s.authed();
  const course = (await ctx.http().post("/courses").set(h).send({ code: "JEE", name: "JEE Advanced", fee: 50000 })).body;
  const batch = (await ctx.http().post("/batches").set(h).send({ courseId: course.id, name: "Morning", startDate: day(-100) })).body;
  const studentEmail = email();
  const guardianEmail = email();
  const student = (await ctx.http().post("/students").set(h).send({ name: "Riya Sen", email: studentEmail, guardianEmail, batchId: batch.id })).body;
  const enrollmentId = student.enrollments[0].id as string;
  const accounts = (await ctx.http().get("/accounts").set(h)).body as { id: string; code: string }[];
  const acc = (code: string) => accounts.find((a) => a.code === code)!.id;
  return { ...s, h, course, batch, student, studentEmail, guardianEmail, enrollmentId, acc };
}

async function trialBalance(h: Record<string, string>) {
  const tb = (await ctx.http().get("/reports/trial-balance").set(h)).body;
  expect(tb.totalDebit).toBe(tb.totalCredit); // the books always balance
  const bal = (code: string) => {
    const a = tb.accounts.find((x: { code: string }) => x.code === code);
    return a ? (Number(a.debit) - Number(a.credit)).toFixed(2) : "0.00";
  };
  return { tb, bal };
}

describe("billing an enrollment", () => {
  it("applies a % discount before 18% GST, splits into instalments and posts to the ledger", async () => {
    const { h, course, enrollmentId } = await world();
    const rule = (await ctx.http().post("/discounts").set(h).send({ name: "Early bird", type: "PERCENT", value: 10, courseId: course.id })).body;

    const res = await ctx.http().post("/invoices/from-enrollment").set(h).send({
      enrollmentId,
      taxRate: 18,
      discounts: [{ discountId: rule.id }],
      installments: [{ dueDate: day(10), amount: 26550 }, { dueDate: day(40), amount: 26550 }],
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      number: "INV-00001", status: "ISSUED", subtotal: "50000", discountTotal: "5000", taxTotal: "8100", total: "53100", outstanding: "53100.00", overdue: "0.00",
    });
    expect(res.body.discounts[0].description).toBe("Early bird (10%)");
    expect(res.body.installments).toHaveLength(2);
    expect(res.body.lines[0].description).toBe("Course fee: JEE Advanced (Morning)");

    const { bal } = await trialBalance(h);
    expect(bal("1100")).toBe("53100.00"); // receivable
    expect(bal("4000")).toBe("-45000.00"); // fee income (credit)
    expect(bal("2100")).toBe("-8100.00"); // GST payable (credit)

    expect((await ctx.http().post("/invoices/from-enrollment").set(h).send({ enrollmentId })).status).toBe(409);
  });

  it("validates discounts and instalment plans", async () => {
    const { h, enrollmentId } = await world();
    const other = (await ctx.http().post("/courses").set(h).send({ code: "NEET", name: "NEET", fee: 1 })).body;
    const expired = (await ctx.http().post("/discounts").set(h).send({ name: "Old", type: "FLAT", value: 100, validTo: day(-1) })).body;
    const foreign = (await ctx.http().post("/discounts").set(h).send({ name: "NEET only", type: "FLAT", value: 100, courseId: other.id })).body;
    const bill = (body: object) => ctx.http().post("/invoices/from-enrollment").set(h).send({ enrollmentId, ...body });

    expect((await bill({ discounts: [{ discountId: expired.id }] })).status).toBe(400);
    expect((await bill({ discounts: [{ discountId: foreign.id }] })).status).toBe(400);
    expect((await bill({ discounts: [{ amount: 60000, description: "Too generous" }] })).status).toBe(400);
    expect((await bill({ discounts: [{ amount: 500 }] })).status).toBe(400); // ad-hoc needs a reason
    expect((await bill({ installments: [{ dueDate: day(5), amount: 20000 }, { dueDate: day(9), amount: 20000 }] })).status).toBe(400);
    expect((await bill({ installments: [{ dueDate: day(9), amount: 25000 }, { dueDate: day(5), amount: 25000 }] })).status).toBe(400);
    expect((await ctx.http().post("/discounts").set(h).send({ name: "Silly", type: "PERCENT", value: 150 })).status).toBe(400);

    const ok = await bill({ discounts: [{ amount: 2500, description: "Sibling concession" }] });
    expect(ok.status).toBe(201);
    expect(ok.body.total).toBe("47500");
  });

  it("drafts get no number and no ledger entry until issued; only drafts can be deleted", async () => {
    const { h, enrollmentId } = await world();
    const draft = (await ctx.http().post("/invoices/from-enrollment").set(h).send({ enrollmentId, issue: false })).body;
    expect(draft.number).toMatch(/^DRAFT-/);
    expect((await trialBalance(h)).bal("1100")).toBe("0.00");
    expect((await ctx.http().post(`/invoices/${draft.id}/payments`).set(h).send({ amount: 1, method: "CASH" })).status).toBe(400);

    const issued = await ctx.http().post(`/invoices/${draft.id}/issue`).set(h);
    expect(issued.body.number).toBe("INV-00001");
    expect((await trialBalance(h)).bal("1100")).toBe("50000.00");
    expect((await ctx.http().delete(`/invoices/${draft.id}`).set(h)).status).toBe(400);
  });
});

describe("collecting fees", () => {
  it("records part payments with receipts (emailed to student and guardian) until paid in full", async () => {
    const { h, enrollmentId, studentEmail, guardianEmail } = await world();
    const inv = (await ctx.http().post("/invoices/from-enrollment").set(h).send({ enrollmentId })).body;

    const r1 = await ctx.http().post(`/invoices/${inv.id}/payments`).set(h).send({ amount: 20000, method: "CASH" });
    expect(r1.status).toBe(201);
    expect(r1.body).toMatchObject({ receiptNo: "RCT-00001", amount: "20000.00", amountInWords: "Rupees Twenty Thousand Only", invoice: { status: "PARTIALLY_PAID", balance: "30000.00" } });
    expect(ctx.mail.last(studentEmail)!.subject).toContain("RCT-00001");
    expect(ctx.mail.last(guardianEmail)!.text).toContain("Balance due on this invoice: 30000.00");

    expect((await ctx.http().post(`/invoices/${inv.id}/payments`).set(h).send({ amount: 30000.01, method: "UPI" })).status).toBe(400);
    const r2 = await ctx.http().post(`/invoices/${inv.id}/payments`).set(h).send({ amount: 30000, method: "UPI", reference: "UTR123" });
    expect(r2.body.invoice.status).toBe("PAID");
    expect((await ctx.http().post(`/invoices/${inv.id}/payments`).set(h).send({ amount: 1, method: "CASH" })).status).toBe(400);

    const { bal } = await trialBalance(h);
    expect(bal("1000")).toBe("20000.00"); // cash
    expect(bal("1010")).toBe("30000.00"); // bank (UPI)
    expect(bal("1100")).toBe("0.00");

    const fees = await ctx.http().get(`/students/${inv.student.id}/fees`).set(h);
    expect(fees.body).toMatchObject({ billed: "50000.00", paid: "50000.00", outstanding: "0.00" });
    const col = await ctx.http().get("/reports/collections").set(h);
    expect(col.body.total).toBe("50000.00");
    expect(col.body.byMethod.map((m: { method: string }) => m.method).sort()).toEqual(["CASH", "UPI"]);
  });

  it("two payments entered at the same moment can't together exceed the balance", async () => {
    const { h, enrollmentId } = await world();
    const inv = (await ctx.http().post("/invoices/from-enrollment").set(h).send({ enrollmentId })).body;
    const pay = () => ctx.http().post(`/invoices/${inv.id}/payments`).set(h).send({ amount: 30000, method: "BANK_TRANSFER", sendReceipt: false });
    const results = await Promise.all([pay(), pay()]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
    expect((await ctx.http().get(`/invoices/${inv.id}`).set(h)).body.amountPaid).toBe("30000");
  });

  it("a bounced cheque is reversed: the invoice is owed again and the bank entry cancelled", async () => {
    const { h, enrollmentId } = await world();
    const inv = (await ctx.http().post("/invoices/from-enrollment").set(h).send({ enrollmentId })).body;
    const paid = (await ctx.http().post(`/invoices/${inv.id}/payments`).set(h).send({ amount: 50000, method: "CHEQUE", reference: "CHQ 004512" })).body;
    expect(paid.invoice.status).toBe("PAID");

    const rev = await ctx.http().post(`/payments/${paid.id}/reverse`).set(h).send({ reason: "Cheque bounced" });
    expect(rev.status).toBe(200);
    expect(rev.body).toMatchObject({ reversed: true, invoice: { status: "ISSUED", balance: "50000.00" } });
    expect((await ctx.http().post(`/payments/${paid.id}/reverse`).set(h).send({ reason: "again" })).status).toBe(400);

    const { bal } = await trialBalance(h);
    expect(bal("1010")).toBe("0.00");
    expect(bal("1100")).toBe("50000.00");
    expect((await ctx.http().get("/reports/collections").set(h)).body.total).toBe("0.00");
  });

  it("voiding needs no payments, reverses the posting, and lets the enrollment be billed again", async () => {
    const { h, enrollmentId } = await world();
    const inv = (await ctx.http().post("/invoices/from-enrollment").set(h).send({ enrollmentId })).body;
    const p = (await ctx.http().post(`/invoices/${inv.id}/payments`).set(h).send({ amount: 100, method: "CASH", sendReceipt: false })).body;
    expect((await ctx.http().post(`/invoices/${inv.id}/void`).set(h).send({ reason: "Wrong fee" })).status).toBe(400);
    await ctx.http().post(`/payments/${p.id}/reverse`).set(h).send({ reason: "Refunded at desk" }).expect(200);

    const v = await ctx.http().post(`/invoices/${inv.id}/void`).set(h).send({ reason: "Wrong fee" });
    expect(v.body.status).toBe("VOID");
    const { bal } = await trialBalance(h);
    expect(bal("1100")).toBe("0.00");
    expect(bal("4000")).toBe("0.00");

    const again = await ctx.http().post("/invoices/from-enrollment").set(h).send({ enrollmentId });
    expect(again.status).toBe(201);
    expect(again.body.number).toBe("INV-00002"); // the voided number stays used
  });

  it("ages what's owed by instalment due dates and flags overdue invoices", async () => {
    const { h, enrollmentId } = await world();
    const inv = (
      await ctx.http().post("/invoices/from-enrollment").set(h).send({
        enrollmentId,
        issueDate: day(-50),
        installments: [{ dueDate: day(-40), amount: 20000 }, { dueDate: day(20), amount: 30000 }],
      })
    ).body;
    await ctx.http().post(`/invoices/${inv.id}/payments`).set(h).send({ amount: 5000, method: "CASH", sendReceipt: false }).expect(201);

    const got = (await ctx.http().get(`/invoices/${inv.id}`).set(h)).body;
    expect(got.overdue).toBe("15000.00");
    const overdueList = await ctx.http().get("/invoices").query({ overdue: true }).set(h);
    expect(overdueList.body.items.map((i: { id: string }) => i.id)).toEqual([inv.id]);

    const ageing = (await ctx.http().get("/reports/receivables-ageing").set(h)).body;
    expect(ageing.rows[0]).toMatchObject({ name: "Riya Sen", total: "45000.00", buckets: { current: "30000.00", "31-60": "15000.00" } });
    expect(ageing.total).toBe("45000.00");
  });
});

describe("payables, journals and statements", () => {
  it("vendor bills post to expenses and payables; the P&L and balance sheet reflect everything", async () => {
    const { h, enrollmentId, acc } = await world();
    const inv = (await ctx.http().post("/invoices/from-enrollment").set(h).send({ enrollmentId })).body;
    await ctx.http().post(`/invoices/${inv.id}/payments`).set(h).send({ amount: 50000, method: "BANK_TRANSFER", sendReceipt: false }).expect(201);

    const vendor = (await ctx.http().post("/vendors").set(h).send({ name: "Sharma Properties", gstin: "27aapfu0939f1zv" })).body;
    const bill = await ctx.http().post("/bills").set(h).send({ vendorId: vendor.id, billNumber: "SP/OCT", billDate: day(-5), dueDate: day(-1), expenseAccountId: acc("5100"), total: 15000 });
    expect(bill.status).toBe(201);
    expect((await ctx.http().post("/bills").set(h).send({ vendorId: vendor.id, billNumber: "SP/OCT", billDate: day(-5), expenseAccountId: acc("5100"), total: 1 })).status).toBe(409);
    expect((await ctx.http().post("/bills").set(h).send({ vendorId: vendor.id, billNumber: "X", billDate: day(-5), expenseAccountId: acc("1000"), total: 1 })).status).toBe(400);

    expect((await ctx.http().get("/reports/payables-ageing").set(h)).body.rows[0]).toMatchObject({ name: "Sharma Properties", total: "15000.00", buckets: { "1-30": "15000.00" } });
    const paid = await ctx.http().post(`/bills/${bill.body.id}/payments`).set(h).send({ amount: 15000, method: "BANK_TRANSFER" });
    expect(paid.body.status).toBe("PAID");
    expect((await ctx.http().post(`/bills/${bill.body.id}/void`).set(h).send({ reason: "nope" })).status).toBe(400);

    // Salaries paid in cash, by manual journal.
    const salary = await ctx.http().post("/journals").set(h).send({
      date: day(0), memo: "October salaries", lines: [{ accountId: acc("5000"), debit: 12000 }, { accountId: acc("1010"), credit: 12000 }],
    });
    expect(salary.status).toBe(201);

    const pl = (await ctx.http().get("/reports/profit-and-loss").query({ from: day(-60), to: day(0) }).set(h)).body;
    expect(pl).toMatchObject({ totalIncome: "50000.00", totalExpenses: "27000.00", netProfit: "23000.00" });

    const bs = (await ctx.http().get("/reports/balance-sheet").set(h)).body;
    expect(bs.balanced).toBe(true);
    expect(bs.totalAssets).toBe("23000.00"); // 50,000 in − 15,000 rent − 12,000 salaries
    expect(bs.totalLiabilities).toBe("0.00");

    const ledger = (await ctx.http().get(`/accounts/${acc("1010")}/ledger`).query({ from: day(-60), to: day(0) }).set(h)).body;
    expect(ledger.opening).toBe("0.00");
    expect(ledger.movements.map((m: { balance: string }) => m.balance)).toEqual(["50000.00", "35000.00", "23000.00"]);
    expect(ledger.closing).toBe("23000.00");
  });

  it("manual journals must balance; reversing is once-only and only for manual entries", async () => {
    const { h, acc, enrollmentId } = await world();
    const bad = await ctx.http().post("/journals").set(h).send({ date: day(0), memo: "Oops", lines: [{ accountId: acc("1000"), debit: 100 }, { accountId: acc("3000"), credit: 99 }] });
    expect(bad.status).toBe(400);
    const both = await ctx.http().post("/journals").set(h).send({ date: day(0), memo: "Both", lines: [{ accountId: acc("1000"), debit: 1, credit: 1 }, { accountId: acc("3000"), credit: 0 }] });
    expect(both.status).toBe(400);

    const capital = (await ctx.http().post("/journals").set(h).send({ date: day(0), memo: "Owner's capital", lines: [{ accountId: acc("1010"), debit: 100000 }, { accountId: acc("3000"), credit: 100000 }] })).body;
    await ctx.http().post(`/journals/${capital.id}/reverse`).set(h).expect(200);
    expect((await ctx.http().post(`/journals/${capital.id}/reverse`).set(h)).status).toBe(400);
    expect((await trialBalance(h)).bal("1010")).toBe("0.00");

    await ctx.http().post("/invoices/from-enrollment").set(h).send({ enrollmentId }).expect(201);
    const auto = (await ctx.http().get("/journals").query({ accountId: acc("1100") }).set(h)).body.items[0];
    expect((await ctx.http().post(`/journals/${auto.id}/reverse`).set(h)).status).toBe(400);
  });

  it("system accounts can't be switched off; custom accounts can be added", async () => {
    const { h, acc } = await world();
    expect((await ctx.http().patch(`/accounts/${acc("1100")}`).set(h).send({ isActive: false })).status).toBe(400);
    const custom = await ctx.http().post("/accounts").set(h).send({ code: "1020", name: "HDFC Current A/c", type: "ASSET" });
    expect(custom.status).toBe(201);
    expect((await ctx.http().post("/accounts").set(h).send({ code: "1020", name: "Dup", type: "ASSET" })).status).toBe(409);
    expect((await ctx.http().post("/accounts").set(h).send({ code: "1021", name: "Child", type: "INCOME", parentId: custom.body.id })).status).toBe(400);
  });
});

describe("ledger integrity in the database", () => {
  it("rejects an unbalanced entry at commit, and the app role can't edit the ledger", async () => {
    const { inst, h, enrollmentId, acc } = await world();
    await ctx.http().post("/invoices/from-enrollment").set(h).send({ enrollmentId }).expect(201);
    const prisma = ctx.app.get(PrismaService);
    const member = await ctx.db.membership.findFirstOrThrow({ where: { instituteId: inst.id, role: Role.INSTITUTE_ADMIN } });

    // Bypassing the service entirely (as the platform role) still can't write a lopsided entry.
    await expect(
      ctx.db.$transaction(async (tx) => {
        const e = await tx.journalEntry.create({ data: { instituteId: inst.id, date: new Date(), postedById: member.id } });
        await tx.journalLine.createMany({
          data: [
            { instituteId: inst.id, entryId: e.id, accountId: acc("1000"), debit: 100 },
            { instituteId: inst.id, entryId: e.id, accountId: acc("4000"), credit: 99 },
          ],
        });
      }),
    ).rejects.toThrow(/does not balance/);

    await expect(prisma.tenant(inst.id, (tx) => tx.journalLine.updateMany({ data: { debit: 0 } }))).rejects.toThrow();
    await expect(prisma.tenant(inst.id, (tx) => tx.journalEntry.deleteMany({}))).rejects.toThrow();
  });
});

describe("access", () => {
  it("only admins and accountants handle money; students see only their own fees", async () => {
    const w = await world();
    const accEmail = email();
    await ctx.http().post("/staff").set(w.h).send({ name: "Accountant", email: accEmail, role: Role.ACCOUNTANT }).expect(201);
    const accH = w.authed(await acceptInviteAndLogin(ctx, accEmail, w.inst.slug));
    const inv = await ctx.http().post("/invoices/from-enrollment").set(accH).send({ enrollmentId: w.enrollmentId });
    expect(inv.status).toBe(201);
    const p = (await ctx.http().post(`/invoices/${inv.body.id}/payments`).set(accH).send({ amount: 1000, method: "CASH" })).body;

    const teacher = await createUser(ctx.db, { instituteId: w.inst.id, roles: [Role.TEACHER] });
    const tH = w.authed((await login(ctx, teacher.email, w.inst.slug)).token);
    expect((await ctx.http().get("/invoices").set(tH)).status).toBe(403);
    expect((await ctx.http().get("/reports/trial-balance").set(tH)).status).toBe(403);

    const sH = w.authed(await acceptInviteAndLogin(ctx, w.studentEmail, w.inst.slug));
    const mine = (await ctx.http().get("/me/fees").set(sH)).body;
    expect(mine).toMatchObject({ billed: "50000.00", paid: "1000.00", outstanding: "49000.00" });
    expect((await ctx.http().get(`/me/payments/${p.id}/receipt`).set(sH)).body.receiptNo).toBe("RCT-00001");
    expect((await ctx.http().get("/invoices").set(sH)).status).toBe(403);

    // Another student of the same institute can't read this receipt.
    const otherEmail = email();
    await ctx.http().post("/students").set(w.h).send({ name: "Other Kid", email: otherEmail }).expect(201);
    const oH = w.authed(await acceptInviteAndLogin(ctx, otherEmail, w.inst.slug));
    expect((await ctx.http().get(`/me/payments/${p.id}/receipt`).set(oH)).status).toBe(404);
  });

  it("no institute can touch another's invoices, accounts or reports", async () => {
    const a = await world();
    const b = await world();
    const inv = (await ctx.http().post("/invoices/from-enrollment").set(a.h).send({ enrollmentId: a.enrollmentId })).body;
    expect((await ctx.http().get(`/invoices/${inv.id}`).set(b.h)).status).toBe(404);
    expect((await ctx.http().post(`/invoices/${inv.id}/payments`).set(b.h).send({ amount: 1, method: "CASH" })).status).toBe(404);
    const own = (await ctx.http().post("/invoices/from-enrollment").set(b.h).send({ enrollmentId: b.enrollmentId })).body;
    // B can't route its money into A's bank account.
    expect((await ctx.http().post(`/invoices/${own.id}/payments`).set(b.h).send({ amount: 1, method: "CASH", accountId: a.acc("1000") })).status).toBe(404);
    expect((await ctx.http().post("/invoices/from-enrollment").set(b.h).send({ enrollmentId: a.enrollmentId })).status).toBe(404);
    expect((await trialBalance(b.h)).bal("1100")).toBe("50000.00");
  });
});

describe("fees-cleared rule for certificates", () => {
  it("needs every invoice for the enrollment paid; an unbilled course with a fee doesn't count", async () => {
    const { inst, h, enrollmentId } = await world();
    const prisma = ctx.app.get(PrismaService);
    const cleared = () => prisma.tenant(inst.id, (tx) => enrollmentFeesCleared(tx, enrollmentId));

    expect(await cleared()).toBe(false); // not billed yet
    const inv = (await ctx.http().post("/invoices/from-enrollment").set(h).send({ enrollmentId })).body;
    expect(await cleared()).toBe(false);
    await ctx.http().post(`/invoices/${inv.id}/payments`).set(h).send({ amount: 49999, method: "CASH", sendReceipt: false });
    expect(await cleared()).toBe(false);
    await ctx.http().post(`/invoices/${inv.id}/payments`).set(h).send({ amount: 1, method: "CASH", sendReceipt: false });
    expect(await cleared()).toBe(true);

    const free = (await ctx.http().post("/courses").set(h).send({ code: "DEMO", name: "Free demo", fee: 0 })).body;
    const batch = (await ctx.http().post("/batches").set(h).send({ courseId: free.id, name: "Demo", startDate: day(0) })).body;
    const s = (await ctx.http().post("/students").set(h).send({ name: "Free Learner", email: email(), batchId: batch.id })).body;
    expect(await prisma.tenant(inst.id, (tx) => enrollmentFeesCleared(tx, s.enrollments[0].id))).toBe(true);
  });
});
