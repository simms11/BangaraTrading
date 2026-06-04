import { sql, type MigrateUpArgs, type MigrateDownArgs } from '@payloadcms/db-postgres'

/**
 * Phase 5.25 (audit M12) — DB-level refund cumulative-cap enforcement.
 *
 * The app-level cap check (Refunds.beforeChange) reads the existing refund
 * sum BEFORE the in-flight row commits; on the no-`req` fallback path the
 * M9 advisory lock brackets the READ but not the COMMIT, so two concurrent
 * writers can both pass the check and both land — committed refunds
 * exceeding the order total. This trigger closes that window below the
 * ORM: `SELECT … FOR UPDATE` on the parent order row serialises every
 * refund write for that order across all connections — the second writer
 * blocks until the first commits, then (READ COMMITTED takes a fresh
 * snapshot per statement after the lock is granted) sees the committed
 * sum and rejects. The app check stays for friendlier error messages;
 * this is the backstop no code path can bypass.
 *
 * Counted statuses mirror the app check exactly, including K3's
 * cancelled-with-processorRef rule (a refund that actually succeeded at
 * the processor but was marked cancelled by ops cleanup must keep
 * consuming cap): pending / processing / completed, plus cancelled rows
 * holding a processor_ref. Rows whose NEW state doesn't count (failed;
 * cancelled without processor_ref) skip the check entirely, so e.g. an
 * admin annotating a failed refund row is never rejected just because
 * the order's counted refunds are at cap.
 *
 * Exported as raw SQL string arrays so the regression test
 * (tests/integration/access/m12-refund-cap-trigger.test.ts) applies the
 * exact shipped artifact — same rationale as the baseline migration test,
 * without the regex extraction.
 */
export const name = '20260604_phase_5_25_refund_cap_trigger'

export const UP_SQL: string[] = [
  `CREATE OR REPLACE FUNCTION public.refunds_enforce_cap() RETURNS trigger AS $fn$
DECLARE
  order_total numeric;
  existing numeric;
BEGIN
  -- Rows that don't count toward the cap can never violate it; skip
  -- (also avoids taking the order-row lock for failure transitions).
  IF NOT (NEW.status IN ('pending', 'processing', 'completed')
          OR (NEW.status = 'cancelled' AND NEW.processor_ref IS NOT NULL)) THEN
    RETURN NEW;
  END IF;

  -- Row-level exclusive lock on the parent order: serialises ALL refund
  -- writes for this order until this transaction commits or rolls back.
  SELECT total_minor INTO order_total
  FROM public.orders
  WHERE id = NEW.order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NEW; -- FK enforces existence; defensive only.
  END IF;

  SELECT COALESCE(SUM(amount_minor), 0) INTO existing
  FROM public.refunds
  WHERE order_id = NEW.order_id
    AND id IS DISTINCT FROM NEW.id
    AND (status IN ('pending', 'processing', 'completed')
         OR (status = 'cancelled' AND processor_ref IS NOT NULL));

  IF existing + NEW.amount_minor > order_total THEN
    RAISE EXCEPTION 'refund_cap_exceeded order=% existing=% incoming=% total=%',
      NEW.order_id, existing, NEW.amount_minor, order_total;
  END IF;

  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS refunds_cap_check ON public.refunds`,
  `CREATE TRIGGER refunds_cap_check
BEFORE INSERT OR UPDATE ON public.refunds
FOR EACH ROW EXECUTE FUNCTION public.refunds_enforce_cap()`,
]

export const DOWN_SQL: string[] = [
  `DROP TRIGGER IF EXISTS refunds_cap_check ON public.refunds`,
  `DROP FUNCTION IF EXISTS public.refunds_enforce_cap()`,
]

export async function up({ db }: MigrateUpArgs): Promise<void> {
  for (const stmt of UP_SQL) {
    await db.execute(sql.raw(stmt))
  }
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  for (const stmt of DOWN_SQL) {
    await db.execute(sql.raw(stmt))
  }
}
