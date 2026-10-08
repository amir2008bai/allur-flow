# REQ-10 — План после импорта

**Verdict:** partial; severity medium/P2, с ограничениями из refutation.

**Цепочка:** ingest.py:166–175; findings.py:215–222; sim/kpi.py:162; journal.py:31–33. Backend-пути относительно backend/app, UI относительно frontend/src.

**Источник, paths walked, searched, counterexample:** [первичная проверка](../../reports/audit-delivery.md), finding F3.

**Независимое опровержение:** [refutation](../../reports/refutation-delivery.md), тот же finding. Его сужения определяют окончательный вывод.

Эта карточка — индекс, не самостоятельная новая проверка. Предпосылки, точные исходные требования и открытые вопросы сохранены в подробных evidence. [Итог и ограничения](../REPORT.md).
