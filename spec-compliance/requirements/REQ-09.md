# REQ-09 — Суточный простой оборудования

**Verdict:** partial; severity medium/P2, с ограничениями из refutation.

**Цепочка:** findings.py:125–153; fact_days.py:144–151 → journal.py:157. Backend-пути относительно backend/app, UI относительно frontend/src.

**Источник, paths walked, searched, counterexample:** [первичная проверка](../../reports/audit-delivery.md), finding F1.

**Независимое опровержение:** [refutation](../../reports/refutation-delivery.md), тот же finding. Его сужения определяют окончательный вывод.

Эта карточка — индекс, не самостоятельная новая проверка. Предпосылки, точные исходные требования и открытые вопросы сохранены в подробных evidence. [Итог и ограничения](../REPORT.md).
