-- CreateEnum
CREATE TYPE "DocStatus" AS ENUM ('DRAFT', 'VALIDATED', 'APPROVED', 'POSTED', 'PARTIALLY_SETTLED', 'SETTLED', 'REVERSED');

-- CreateEnum
CREATE TYPE "ControlState" AS ENUM ('NONE', 'DISPUTED', 'ON_HOLD');

-- CreateEnum
CREATE TYPE "SupplierStatus" AS ENUM ('ACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "ReceiptKind" AS ENUM ('GOODS', 'SERVICE');

-- CreateEnum
CREATE TYPE "ApDocKind" AS ENUM ('INVOICE', 'CREDIT_NOTE');

-- CreateEnum
CREATE TYPE "MatchType" AS ENUM ('TWO_WAY', 'THREE_WAY', 'NON_PO');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('PENDING', 'MATCHED', 'EXCEPTION', 'OVERRIDDEN');

-- CreateEnum
CREATE TYPE "ExceptionType" AS ENUM ('QTY', 'PRICE', 'TAX', 'TOTAL', 'CURRENCY', 'NO_RECEIPT', 'NO_PO_LINE', 'NON_PO_APPROVAL', 'DUPLICATE_SUSPECT', 'SUPPLIER_BLOCKED');

-- CreateEnum
CREATE TYPE "ExceptionStatus" AS ENUM ('OPEN', 'OVERRIDDEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "PaymentRunStatus" AS ENUM ('DRAFT', 'APPROVED', 'EXECUTING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('BANK_TRANSFER', 'MPESA', 'CHEQUE');

-- CreateEnum
CREATE TYPE "PaymentItemStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AllocationSource" AS ENUM ('PAYMENT', 'CREDIT_NOTE');

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "source_system" TEXT NOT NULL DEFAULT 'SUPPLYTRACK',
    "source_supplier_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tax_pin" TEXT,
    "currency" CHAR(3) NOT NULL,
    "payment_terms_days" INTEGER NOT NULL DEFAULT 30,
    "withholding_rate" DECIMAL(7,6) NOT NULL DEFAULT 0,
    "payee_ref" TEXT,
    "status" "SupplierStatus" NOT NULL DEFAULT 'ACTIVE',
    "source_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "po_number" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "order_date" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'APPROVED',
    "source_version" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" UUID NOT NULL,
    "po_id" UUID NOT NULL,
    "line_ref" TEXT NOT NULL,
    "item_ref" TEXT,
    "description" TEXT NOT NULL,
    "qty_ordered" DECIMAL(20,4) NOT NULL,
    "unit_price" DECIMAL(20,4) NOT NULL,
    "tax_rate" DECIMAL(7,6) NOT NULL DEFAULT 0,
    "qty_received" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "qty_invoiced" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "expense_key" TEXT,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "po_id" UUID NOT NULL,
    "grn_number" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "kind" "ReceiptKind" NOT NULL DEFAULT 'GOODS',
    "received_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_lines" (
    "id" UUID NOT NULL,
    "receipt_id" UUID NOT NULL,
    "po_line_id" UUID NOT NULL,
    "qty_accepted" DECIMAL(20,4) NOT NULL,

    CONSTRAINT "goods_receipt_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ap_tolerances" (
    "company_id" UUID NOT NULL,
    "qty_pct" DECIMAL(7,6) NOT NULL DEFAULT 0,
    "price_pct" DECIMAL(7,6) NOT NULL DEFAULT 0.02,
    "price_abs" DECIMAL(20,4) NOT NULL DEFAULT 500,
    "tax_abs" DECIMAL(20,4) NOT NULL DEFAULT 1,
    "auto_post_matched" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ap_tolerances_pkey" PRIMARY KEY ("company_id")
);

-- CreateTable
CREATE TABLE "ap_invoices" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "facility_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "po_id" UUID,
    "kind" "ApDocKind" NOT NULL DEFAULT 'INVOICE',
    "invoice_number" TEXT NOT NULL,
    "normalized_number" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "invoice_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "subtotal" DECIMAL(20,4) NOT NULL,
    "tax_amount" DECIMAL(20,4) NOT NULL,
    "total" DECIMAL(20,4) NOT NULL,
    "withholding_amount" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "retention_amount" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "amount_settled" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "status" "DocStatus" NOT NULL DEFAULT 'DRAFT',
    "control_state" "ControlState" NOT NULL DEFAULT 'NONE',
    "match_type" "MatchType" NOT NULL,
    "match_status" "MatchStatus" NOT NULL DEFAULT 'PENDING',
    "credit_for_id" UUID,
    "journal_id" UUID,
    "source_system" TEXT NOT NULL DEFAULT 'SUPPLYTRACK',
    "source_entity_id" TEXT NOT NULL,
    "source_version" INTEGER NOT NULL,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "posted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ap_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ap_invoice_lines" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "po_line_id" UUID,
    "description" TEXT NOT NULL,
    "qty" DECIMAL(20,4) NOT NULL,
    "unit_price" DECIMAL(20,4) NOT NULL,
    "net_amount" DECIMAL(20,4) NOT NULL,
    "tax_amount" DECIMAL(20,4) NOT NULL,
    "expense_key" TEXT,

    CONSTRAINT "ap_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ap_match_exceptions" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "line_no" INTEGER,
    "type" "ExceptionType" NOT NULL,
    "message" TEXT NOT NULL,
    "expected" TEXT,
    "actual" TEXT,
    "status" "ExceptionStatus" NOT NULL DEFAULT 'OPEN',
    "resolved_by" UUID,
    "resolved_at" TIMESTAMPTZ(6),
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ap_match_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ap_payment_runs" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "run_no" TEXT NOT NULL,
    "payment_date" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'BANK_TRANSFER',
    "bank_mapping_key" TEXT NOT NULL DEFAULT 'BANK:DEFAULT',
    "status" "PaymentRunStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by" UUID NOT NULL,
    "approved_by" UUID,
    "approved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ap_payment_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ap_payment_run_items" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "withholding" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "net_paid" DECIMAL(20,4) NOT NULL,
    "status" "PaymentItemStatus" NOT NULL DEFAULT 'PENDING',
    "bank_reference" TEXT,
    "failure_reason" TEXT,
    "journal_id" UUID,
    "allocation_id" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ap_payment_run_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ap_allocations" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "source_type" "AllocationSource" NOT NULL,
    "source_id" UUID NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "journal_id" UUID,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversed_at" TIMESTAMPTZ(6),

    CONSTRAINT "ap_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_company_id_source_system_source_supplier_id_key" ON "suppliers"("company_id", "source_system", "source_supplier_id");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_company_id_code_key" ON "suppliers"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_company_id_source_id_key" ON "purchase_orders"("company_id", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_company_id_po_number_key" ON "purchase_orders"("company_id", "po_number");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_lines_po_id_line_ref_key" ON "purchase_order_lines"("po_id", "line_ref");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_company_id_source_id_key" ON "goods_receipts"("company_id", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "ap_invoices_journal_id_key" ON "ap_invoices"("journal_id");

-- CreateIndex
CREATE INDEX "ap_invoices_company_id_supplier_id_fingerprint_idx" ON "ap_invoices"("company_id", "supplier_id", "fingerprint");

-- CreateIndex
CREATE INDEX "ap_invoices_company_id_status_due_date_idx" ON "ap_invoices"("company_id", "status", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "ap_invoices_company_id_supplier_id_normalized_number_kind_key" ON "ap_invoices"("company_id", "supplier_id", "normalized_number", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "ap_invoices_company_id_source_system_source_entity_id_key" ON "ap_invoices"("company_id", "source_system", "source_entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "ap_invoice_lines_invoice_id_line_no_key" ON "ap_invoice_lines"("invoice_id", "line_no");

-- CreateIndex
CREATE INDEX "ap_match_exceptions_status_type_idx" ON "ap_match_exceptions"("status", "type");

-- CreateIndex
CREATE UNIQUE INDEX "ap_payment_runs_company_id_run_no_key" ON "ap_payment_runs"("company_id", "run_no");

-- CreateIndex
CREATE UNIQUE INDEX "ap_payment_run_items_allocation_id_key" ON "ap_payment_run_items"("allocation_id");

-- CreateIndex
CREATE INDEX "ap_payment_run_items_invoice_id_status_idx" ON "ap_payment_run_items"("invoice_id", "status");

-- CreateIndex
CREATE INDEX "ap_allocations_invoice_id_idx" ON "ap_allocations"("invoice_id");

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "goods_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_lines" ADD CONSTRAINT "goods_receipt_lines_po_line_id_fkey" FOREIGN KEY ("po_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_invoices" ADD CONSTRAINT "ap_invoices_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_invoices" ADD CONSTRAINT "ap_invoices_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_invoices" ADD CONSTRAINT "ap_invoices_credit_for_id_fkey" FOREIGN KEY ("credit_for_id") REFERENCES "ap_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_invoice_lines" ADD CONSTRAINT "ap_invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "ap_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_invoice_lines" ADD CONSTRAINT "ap_invoice_lines_po_line_id_fkey" FOREIGN KEY ("po_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_match_exceptions" ADD CONSTRAINT "ap_match_exceptions_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "ap_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_payment_run_items" ADD CONSTRAINT "ap_payment_run_items_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ap_payment_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_payment_run_items" ADD CONSTRAINT "ap_payment_run_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "ap_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ap_allocations" ADD CONSTRAINT "ap_allocations_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "ap_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── AP controls enforced by PostgreSQL ──
-- A payable can never be settled beyond its gross amount (over-allocation guard of last resort).
ALTER TABLE ap_invoices
  ADD CONSTRAINT ap_invoices_amounts_non_negative CHECK (subtotal >= 0 AND tax_amount >= 0 AND total >= 0 AND withholding_amount >= 0 AND retention_amount >= 0),
  ADD CONSTRAINT ap_invoices_total_consistent CHECK (total = subtotal + tax_amount),
  ADD CONSTRAINT ap_invoices_settled_bounds CHECK (amount_settled >= 0 AND amount_settled <= total);
ALTER TABLE ap_allocations ADD CONSTRAINT ap_allocations_positive CHECK (amount > 0);
ALTER TABLE ap_payment_run_items
  ADD CONSTRAINT ap_items_positive CHECK (amount > 0 AND withholding >= 0 AND net_paid = amount - withholding);
ALTER TABLE purchase_order_lines
  ADD CONSTRAINT po_lines_non_negative CHECK (qty_ordered > 0 AND unit_price >= 0 AND qty_received >= 0 AND qty_invoiced >= 0);
