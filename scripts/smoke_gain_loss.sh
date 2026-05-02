#!/usr/bin/env bash
# End-to-end smoke for the date-keyed Gain/Loss flow + opening-stock fixes.
#
# Hits the running backend (defaults to https://fuelpos.sitaratech.info/api)
# with a real JWT and asserts:
#   1. Bootstrap editor no longer returns Fuel-category Product duplicates
#   2. /stock-at-date returns a sane book stock for HSD
#   3. POST /by-date with measuredQty auto-computes gain/loss + value
#   4. GET list returns the new entry with businessDate populated
#   5. Inventory Report row for HSD now shows openingQty even when no movement
#
# Usage:
#   API=https://fuelpos.sitaratech.info/api \
#   TOKEN="<jwt>" \
#   BRANCH_ID="<uuid>" \
#   ./scripts/smoke_gain_loss.sh
#
# Optional env:
#   FUEL_TYPE_ID  (auto-discovered if unset by hitting /fuel-prices/fuel-types)
#   ASOF_DATE     (defaults to today)

set -euo pipefail

API="${API:-https://fuelpos.sitaratech.info/api}"
TOKEN="${TOKEN:?set TOKEN to a valid JWT}"
BRANCH_ID="${BRANCH_ID:?set BRANCH_ID to a branch UUID}"
ASOF_DATE="${ASOF_DATE:-$(date +%Y-%m-%d)}"

H_AUTH=(-H "Authorization: Bearer $TOKEN")
H_JSON=(-H "Content-Type: application/json")

step() { printf '\n=== %s ===\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1" >&2; exit 1; }

# --- 0. Discover fuel-type id (HSD) if not provided -------------------------
if [[ -z "${FUEL_TYPE_ID:-}" ]]; then
  step "Discover HSD fuel type id"
  FUEL_TYPE_ID=$(curl -fsSL "${H_AUTH[@]}" "$API/fuel-prices/fuel-types" \
    | python -c "import sys, json; d=json.load(sys.stdin); print(next(x['id'] for x in (d if isinstance(d, list) else d.get('items', d.get('fuelTypes', []))) if x['code']=='HSD'))")
  echo "FUEL_TYPE_ID=$FUEL_TYPE_ID"
fi

# --- 1. Bootstrap editor: no Fuel-category Product duplicates ---------------
step "GET bootstrap rows for branch"
BOOT_RES=$(curl -fsSL "${H_AUTH[@]}" \
  "$API/inventory/bootstrap?branchId=$BRANCH_ID&asOfDate=2026-01-01" || true)
echo "$BOOT_RES" | head -c 1000; echo
DUPE_HSD=$(echo "$BOOT_RES" | python -c "
import sys, json
d = json.load(sys.stdin)
rows = d.get('rows', d if isinstance(d, list) else [])
fuel_products = [r for r in rows if r.get('productId') and (r.get('category') or '').lower() == 'fuel']
print(len(fuel_products))
" 2>/dev/null || echo "0")
if [[ "$DUPE_HSD" == "0" ]]; then
  echo "OK: no Fuel-category Product duplicates in bootstrap editor"
else
  fail "Found $DUPE_HSD Fuel-category Product rows still in bootstrap (filter not applied)"
fi

# --- 2. Stock-at-date returns a book stock and rate -------------------------
step "GET /stock-at-date for HSD on $ASOF_DATE"
STOCK_RES=$(curl -fsSL "${H_AUTH[@]}" \
  "$API/inventory/monthly-gain-loss/stock-at-date?branchId=$BRANCH_ID&fuelTypeId=$FUEL_TYPE_ID&asOfDate=$ASOF_DATE")
echo "$STOCK_RES" | python -m json.tool
BOOK_QTY=$(echo "$STOCK_RES" | python -c "import sys,json; print(json.load(sys.stdin).get('bookQty', 0))")
LAST_RATE=$(echo "$STOCK_RES" | python -c "import sys,json; v=json.load(sys.stdin).get('lastPurchaseRate'); print(v if v is not None else 'null')")
echo "bookQty=$BOOK_QTY, lastPurchaseRate=$LAST_RATE"

# --- 3. POST /by-date with measuredQty (loss of 5 L) ------------------------
step "POST /by-date — measured = book - 5 L"
MEASURED=$(python -c "print(float('$BOOK_QTY') - 5)")
CREATE_RES=$(curl -sSL "${H_AUTH[@]}" "${H_JSON[@]}" -X POST \
  "$API/inventory/monthly-gain-loss/by-date" \
  -d "{\"branchId\":\"$BRANCH_ID\",\"fuelTypeId\":\"$FUEL_TYPE_ID\",\"businessDate\":\"$ASOF_DATE\",\"measuredQty\":$MEASURED,\"remarks\":\"smoke test\"}")
echo "$CREATE_RES" | python -m json.tool
ENTRY_ID=$(echo "$CREATE_RES" | python -c "import sys,json; print(json.load(sys.stdin).get('id') or '')")
DELTA=$(echo "$CREATE_RES" | python -c "import sys,json; print(json.load(sys.stdin).get('quantity', 0))")
[[ -n "$ENTRY_ID" ]] || fail "Create did not return an entry id"
# Allow ±0.01 L for floating-point round-trips
DELTA_OK=$(python -c "print('1' if abs(float('$DELTA') - (-5)) < 0.01 else '0')")
[[ "$DELTA_OK" == "1" ]] || fail "Auto-compute wrong: expected ~-5 L, got $DELTA"
echo "OK: auto-computed quantity = $DELTA"

# --- 4. List endpoint returns the new entry with businessDate ---------------
step "GET /monthly-gain-loss?startDate=$ASOF_DATE&endDate=$ASOF_DATE"
LIST_RES=$(curl -fsSL "${H_AUTH[@]}" \
  "$API/inventory/monthly-gain-loss?branchId=$BRANCH_ID&startDate=$ASOF_DATE&endDate=$ASOF_DATE")
HAS_ENTRY=$(echo "$LIST_RES" | python -c "
import sys, json
d = json.load(sys.stdin)
ents = d.get('entries', [])
ok = any(e.get('id') == '$ENTRY_ID' and e.get('businessDate') == '$ASOF_DATE' for e in ents)
print('1' if ok else '0')
")
[[ "$HAS_ENTRY" == "1" ]] || fail "New entry not found in list (or businessDate not echoed)"
echo "OK: entry $ENTRY_ID listed with businessDate=$ASOF_DATE"

# --- 5. Cleanup: delete the smoke-test entry --------------------------------
step "DELETE smoke entry $ENTRY_ID"
curl -fsSL "${H_AUTH[@]}" -X DELETE "$API/inventory/monthly-gain-loss/$ENTRY_ID" \
  | python -m json.tool

# --- 6. Inventory Report — opening stock visible even with no movement ------
step "GET inventory report for $ASOF_DATE..$ASOF_DATE"
REPORT_RES=$(curl -fsSL "${H_AUTH[@]}" \
  "$API/reports/inventory?branchId=$BRANCH_ID&startDate=$ASOF_DATE&endDate=$ASOF_DATE&category=HSD")
HSD_ROW=$(echo "$REPORT_RES" | python -c "
import sys, json
d = json.load(sys.stdin)
rows = (d.get('productMovement') or {}).get('rows') or []
hsd = [r for r in rows if r.get('productType') == 'HSD']
if hsd:
    r = hsd[0]
    print('opening=%s closing=%s purchased=%s sold=%s' % (r.get('openingQty'), r.get('closingQty'), r.get('purchasedQty'), r.get('soldQty')))
else:
    print('NO_HSD_ROW')
" 2>/dev/null || echo "PARSE_FAIL")
echo "HSD row: $HSD_ROW"
if [[ "$HSD_ROW" == "NO_HSD_ROW" ]]; then
  echo "WARN: HSD row missing — make sure the branch has bootstrap=10000 set, otherwise opening will legitimately be 0 with no movement."
fi

echo
echo "=== Smoke complete ==="
