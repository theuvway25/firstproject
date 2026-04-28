import json
import re
import logging
from datetime import datetime
from difflib import SequenceMatcher

logger = logging.getLogger("ledgerai.validation_service")


# ══════════════════════════════════════════════════════════
# HELPERS
# ══════════════════════════════════════════════════════════

def normalize_date(date_str):
    if not date_str:
        return None
    clean_str = str(date_str).strip()
    for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d", "%d %b %Y", "%d-%b-%Y", "%d-%b-%y"):
        try:
            return datetime.strptime(clean_str, fmt).strftime("%Y-%m-%d")
        except (ValueError, TypeError):
            continue
    return clean_str


def extract_json_from_response(response_text: str) -> list:
    """Parse a JSON array from raw LLM response text."""
    cleaned = response_text.replace("```json", "").replace("```", "").strip()
    match = re.search(r"\[.*\]", cleaned, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except (json.JSONDecodeError, ValueError):
            logger.warning("Failed to parse JSON from LLM response.")
            return []
    return []


def calculate_similarity(a, b) -> float:
    return SequenceMatcher(None, str(a).lower(), str(b).lower()).ratio()


# ══════════════════════════════════════════════════════════
# PROPRIETY CHECK  (15% tolerance gate)
# ══════════════════════════════════════════════════════════

NOISE_PATTERNS = [
    r'page\s*[\d\s/]+of', r'statement\s*summary', r'opening\s*balance',
    r'closing\s*balance', r'total\s*debit', r'total\s*credit',
    r'generated\s*on', r'computer\s*generated', r'branch\s*:',
    r'ifsc', r'account\s*no', r'balance\s*as\s*on', r'carried\s*forward',
    r'statement\s*of\s*account', r'customer\s*id', r'micr', r'rtgs',
    r'date\s*particulars', r'debit\s*credit', r'value\s*date',
]


def is_transaction_proper(txn: dict) -> bool:
    """Check if a single transaction object looks valid and clean."""
    if not txn:
        return False

    desc = str(txn.get("details") or "").strip()
    if not desc or len(desc) < 3:
        return False

    desc_lower = desc.lower()
    for pat in NOISE_PATTERNS:
        if re.search(pat, desc, re.IGNORECASE):
            # Check exceptions (using the same list as strict gate)
            pat_key = pat.lstrip(r'\s*').split(r'\s*')[0].replace('\\', '')
            exceptions = _NOISE_EXCEPTIONS.get(pat_key, None)
            if exceptions is not None:
                if any(exc in desc_lower for exc in exceptions):
                    continue  # Legitimate use — skip this noise check
                    
            return False

    if desc.count('|') > 3 or desc.count('-') > 10:
        return False

    date = txn.get("date")
    if not date or date == "null" or date == "None":
        return False

    if txn.get("debit") is None and txn.get("credit") is None:
        return False

    return True


def validate_extraction_propriety(txns: list) -> bool:
    """
    Check if the entire set of transactions looks proper.
    Fails if more than 15% of transactions are improper.
    """
    if not txns:
        return False

    improper_count = sum(1 for t in txns if not is_transaction_proper(t))
    if len(txns) > 0 and (improper_count / len(txns)) > 0.15:
        logger.info(
            "Propriety check FAILED: %d/%d transactions improper (%.0f%%)",
            improper_count, len(txns), (improper_count / len(txns)) * 100,
        )
        return False

    return True


# Patterns that are noise EXCEPT when part of legitimate transaction names
_NOISE_EXCEPTIONS = {
    "balance":  ["charge", "fee", "minimum", "average"],
    "date":     [],  # 'date' in details is always noise
    "statement":["instalment", "emi"],  # "statement instalment" is a real CC txn
}


# ══════════════════════════════════════════════════════════
# USER DISPLAY GATE  (100% exact match — BUG-05)
# ══════════════════════════════════════════════════════════

def should_display_code(code_txns: list, llm_txns: list) -> bool:
    """
    Determines whether the UI should show CODE transactions or LLM transactions.

    Rule: 100% of code transactions must have an EXACT match in the LLM set.
    Exact match = same normalized date + same amount + same transaction direction
    (debit/credit). Description is NOT required to match exactly.

    Called by the API layer / review endpoint, NOT by processing_engine.
    processing_engine uses the 90% weighted accuracy for the ACTIVE decision.
    This gate is for the UI display decision only.

    Returns:
        True  → show CODE transactions to user
        False → show LLM transactions to user
    """
    if not code_txns or not llm_txns:
        return False

    matched_llm = set()

    for code in code_txns:
        code_date   = normalize_date(code.get("date"))
        code_debit  = round(float(code.get("debit")  or 0), 2)
        code_credit = round(float(code.get("credit") or 0), 2)
        # Direction: True = debit transaction, False = credit transaction
        code_is_debit = code_debit > 0

        found = False
        for idx, llm in enumerate(llm_txns):
            if idx in matched_llm:
                continue

            llm_date   = normalize_date(llm.get("date"))
            llm_debit  = round(float(llm.get("debit")  or 0), 2)
            llm_credit = round(float(llm.get("credit") or 0), 2)
            llm_is_debit = llm_debit > 0

            # Exact match: date + amount + direction
            amount_match    = abs(code_debit - llm_debit) < 0.01 and abs(code_credit - llm_credit) < 0.01
            date_match      = code_date == llm_date
            direction_match = code_is_debit == llm_is_debit

            if date_match and amount_match and direction_match:
                matched_llm.add(idx)
                found = True
                break

        if not found:
            logger.info(
                "Display gate: CODE txn not matched in LLM set — "
                "date=%s debit=%.2f credit=%.2f → showing LLM to user",
                code.get("date"), code_debit, code_credit
            )
            return False

    return True




# ══════════════════════════════════════════════════════════
# PER-TRANSACTION CONFIDENCE SCORING
# Uses LLM transactions as ground truth to compute how
# accurately CODE extracted each transaction.
# ══════════════════════════════════════════════════════════

def compute_code_confidence(code_txns: list, llm_txns: list) -> list:
    
    if not llm_txns:
        return code_txns  # no ground truth — return as-is

    updated = []
    matched_llm = set()

    for code in code_txns:
        code_date    = normalize_date(code.get("date"))
        code_debit   = round(float(code.get("debit")  or 0), 2)
        code_credit  = round(float(code.get("credit") or 0), 2)
        code_balance = round(float(code.get("balance") or 0), 2)
        code_desc    = str(code.get("details") or "").strip()

        best_score  = 0.0
        best_idx    = None

        for idx, llm in enumerate(llm_txns):
            if idx in matched_llm:
                continue

            llm_date    = normalize_date(llm.get("date"))
            llm_debit   = round(float(llm.get("debit")  or 0), 2)
            llm_credit  = round(float(llm.get("credit") or 0), 2)
            llm_balance = round(float(llm.get("balance") or 0), 2)
            llm_desc    = str(llm.get("details") or "").strip()

            # Quick reject: date must match or be very close
            if code_date != llm_date:
                continue

            # Compute field-level scores
            date_score    = 1.0  # already matched above
            amount_score  = 1.0 if (abs(code_debit - llm_debit) < 0.01 and
                                     abs(code_credit - llm_credit) < 0.01) else 0.0
            balance_score = 1.0 if abs(code_balance - llm_balance) < 0.05 else (
                            0.5 if abs(code_balance - llm_balance) < 1.0 else 0.0)
            details_score = calculate_similarity(code_desc, llm_desc)

            score = (date_score    * 0.25 +
                     amount_score  * 0.35 +
                     balance_score * 0.25 +
                     details_score * 0.15)

            if score > best_score:
                best_score = score
                best_idx   = idx

        if best_idx is not None:
            matched_llm.add(best_idx)
            confidence = round(best_score, 2)
        else:
            confidence = 0.70  # no LLM match found — uncertain

        updated.append({**code, "confidence": confidence})

    return updated

# ══════════════════════════════════════════════════════════
# WEIGHTED VALIDATION METRICS
# (90% threshold used for CODE→ACTIVE decision)
# ══════════════════════════════════════════════════════════

def validate_transactions(code_txns: list, llm_txns: list) -> dict:
    """
    Compare CODE vs LLM transactions using weighted bipartite matching.

    Returns metrics dict with:
      matched_transactions, date_accuracy, amount_accuracy,
      balance_accuracy, description_accuracy, overall_accuracy,
      transaction_count_match

    Used by processing_engine for the CODE→ACTIVE threshold (90%).
    The 100% exact-match gate for user display is in should_display_code().
    """
    if not code_txns or not llm_txns:
        return None

    matched_llm_indexes  = set()
    date_matches         = 0
    amount_matches       = 0
    balance_matches      = 0
    description_scores   = []
    total                = 0

    for code in code_txns:
        code_date    = normalize_date(code.get("date"))
        code_amount  = float(code.get("debit") or code.get("credit") or 0)
        code_balance = float(code.get("balance") or 0)
        code_desc    = str(code.get("details") or "").strip()

        best_match_index = None
        best_match_score = 0

        for idx, llm in enumerate(llm_txns):
            if idx in matched_llm_indexes:
                continue

            llm_date    = normalize_date(llm.get("date"))
            llm_amount  = float(llm.get("debit") or llm.get("credit") or 0)
            llm_balance = float(llm.get("balance") or 0)
            llm_desc    = str(llm.get("details") or "").strip()

            score = 0

            if code_date and llm_date and code_date == llm_date:
                score += 3  # strong
            if abs(code_amount - llm_amount) < 1:
                score += 3  # strong
            if abs(code_balance - llm_balance) < 1:
                score += 2  # medium
            if calculate_similarity(code_desc, llm_desc) > 0.7:
                score += 2  # soft

            if score > best_match_score:
                best_match_score = score
                best_match_index = idx

        if best_match_index is not None and best_match_score >= 3:
            matched_llm_indexes.add(best_match_index)
            llm   = llm_txns[best_match_index]
            total += 1

            if normalize_date(code.get("date")) == normalize_date(llm.get("date")):
                date_matches += 1
            if abs(code_amount - float(llm.get("debit") or llm.get("credit") or 0)) < 1:
                amount_matches += 1
            if abs(code_balance - float(llm.get("balance") or 0)) < 1:
                balance_matches += 1
            description_scores.append(
                calculate_similarity(code_desc, llm.get("details", ""))
            )

    if total == 0:
        return None

    date_accuracy        = (date_matches        / total) * 100
    amount_accuracy      = (amount_matches      / total) * 100
    balance_accuracy     = (balance_matches     / total) * 100
    description_accuracy = (sum(description_scores) / total) * 100

    # ── ACCURACY RATIO (Total Expected vs Matches) ──
    # If LLM found 13 and Code found 5, count_accuracy is 38%.
    count_accuracy = (total / len(llm_txns)) * 100
    
    # Weighted final score
    # We now factor in the count_accuracy to punish missing rows
    overall_accuracy = (
          (date_accuracy        * 0.20)
        + (amount_accuracy    * 0.30)
        + (description_accuracy * 0.20)
        + (count_accuracy       * 0.30)  # High penalty for missing rows
    )

    return {
        "matched_transactions":   total,
        "code_count":             len(code_txns),
        "llm_count":              len(llm_txns),
        "transaction_count_match": len(code_txns) == len(llm_txns),
        "date_accuracy":          round(date_accuracy, 2),
        "amount_accuracy":        round(amount_accuracy, 2),
        "balance_accuracy":       round(balance_accuracy, 2),
        "description_accuracy":   round(description_accuracy, 2),
        "overall_accuracy":       round(overall_accuracy, 2),
    }