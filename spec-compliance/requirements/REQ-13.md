# REQ-13 — Валидация live-пакета

**Verdict:** partial; severity medium/P2, с ограничениями из refutation.

**Цепочка:** live.py:43–44,61–97. Backend-пути относительно backend/app, UI относительно frontend/src.

**Источник, paths walked, searched, counterexample:** [первичная проверка](../../reports/audit-data-paths.md), finding 3.

**Независимое опровержение:** [refutation](../../reports/refutation-data-paths.md), тот же finding. Его сужения определяют окончательный вывод.

Эта карточка — индекс, не самостоятельная новая проверка. Предпосылки, точные исходные требования и открытые вопросы сохранены в подробных evidence. [Итог и ограничения](../REPORT.md).
