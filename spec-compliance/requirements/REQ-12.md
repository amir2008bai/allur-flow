# REQ-12 — Автоподгонка после перезапуска

**Verdict:** partial; severity medium/P2, с ограничениями из refutation.

**Цепочка:** dataset.py:38–46,68–74,87–130; sim/params.py:78–85; main.py:52–78. Backend-пути относительно backend/app, UI относительно frontend/src.

**Источник, paths walked, searched, counterexample:** [первичная проверка](../../reports/audit-data-paths.md), finding 2.

**Независимое опровержение:** [refutation](../../reports/refutation-data-paths.md), тот же finding. Его сужения определяют окончательный вывод.

Эта карточка — индекс, не самостоятельная новая проверка. Предпосылки, точные исходные требования и открытые вопросы сохранены в подробных evidence. [Итог и ограничения](../REPORT.md).
