// Архитектура Allur Flow: одна модель — три вида (3D-слои, поток данных, цикл решения).
// Статус честный: ready — работает и проверено; demo — работает на эмуляторе или тестовых данных; plan — описано, не запущено.

export type Status = 'ready' | 'demo' | 'plan'
export type LayerId = 'plant' | 'ingest' | 'store' | 'core' | 'api' | 'ui'

export interface Layer { id: LayerId; name: string; short: string; hex: string; about: string }
export interface Comp {
  id: string; layer: LayerId; name: string; short: string; what: string; tech: string; code?: string; status: Status
  to?: string[]          // куда идут данные
}

export const STATUS_RU: Record<Status, { label: string; cls: string; hex: string }> = {
  ready: { label: 'работает', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200', hex: '#10b981' },
  demo: { label: 'на эмуляторе', cls: 'bg-sky-50 text-sky-700 ring-sky-200', hex: '#0ea5e9' },
  plan: { label: 'следующий этап', cls: 'bg-slate-50 text-slate-500 ring-slate-200', hex: '#94a3b8' },
}

// снизу вверх: завод → интерфейс
export const LAYERS: Layer[] = [
  { id: 'plant', name: 'Завод', short: 'Завод', hex: '#64748b', about: 'Откуда берутся данные: оборудование, учёт производства, люди.' },
  { id: 'ingest', name: 'Приём данных', short: 'Приём', hex: '#0ea5e9', about: 'Данные проверяются и приводятся к одному виду, у каждого числа — метка источника.' },
  { id: 'store', name: 'Хранение', short: 'Хранение', hex: '#14b8a6', about: 'История смен, прогнозы «до факта», ответы людей, версии моделей.' },
  { id: 'core', name: 'Ядро двойника', short: 'Ядро', hex: '#7c3aed', about: 'Двойник линии и модели ИИ: что происходит, что будет, что сделать.' },
  { id: 'api', name: 'Сервисы', short: 'Сервисы', hex: '#f59e0b', about: 'Один сервер отдаёт расчёты экранам и ИИ-помощнику.' },
  { id: 'ui', name: 'Экраны', short: 'Экраны', hex: '#0f172a', about: 'Что видит начальник смены и руководитель.' },
]
export const LAYER_BY: Record<LayerId, Layer> = Object.fromEntries(LAYERS.map((l) => [l.id, l])) as Record<LayerId, Layer>

export const COMPS: Comp[] = [
  // Завод
  { id: 'plc', layer: 'plant', name: 'Оборудование линии', short: 'Оборудование', what: 'Роботы ABB, камера окраски, конвейер: состояния «работает / стоит», годные, дефекты.', tech: 'PLC → OPC UA или MQTT', status: 'demo', to: ['live'] },
  { id: 'mes', layer: 'plant', name: 'Учёт производства', short: 'Учёт MES', what: 'Выпуск по сменам, журнал простоев, брак, план по моделям — таблицы как в ТЗ.', tech: 'Excel · Word · CSV (выгрузка MES)', status: 'ready', to: ['upload'] },
  { id: 'people', layer: 'plant', name: 'Люди', short: 'Люди', what: 'Мастер отвечает «да / нет» на тревоги (с телефона — по QR страницы ответов), вводит брак смены, записывает действия по браку.', tech: 'телефон · экран', status: 'ready', to: ['feedback'] },
  // Приём
  { id: 'live', layer: 'ingest', name: 'Живые события', short: 'События', what: 'Вход для событий с линии пачками до 500; неизвестный участок или состояние пропускается. Сейчас события сохраняются и видны в панели «Живые данные» на вкладке «Факты», но в расчёты двойника пока не идут. Эмулятор PLC проигрывает смену событиями.', tech: 'POST /api/live/events', code: 'backend/app/live.py, frontend/src/LivePanel.tsx', status: 'demo', to: ['db'] },
  { id: 'upload', layer: 'ingest', name: 'Загрузка файлов', short: 'Файлы', what: 'Excel, Word или CSV → факты с меткой источника (файл, таблица, строка). Непонятные строки не ломают загрузку — о них пишется предупреждение.', tech: 'Pydantic', code: 'backend/app/ingest.py', status: 'ready', to: ['facts', 'calib'] },
  { id: 'dq', layer: 'ingest', name: 'Проверка качества данных', short: 'Качество данных', what: 'Находит пропуски связи, дубли, залипшие датчики, невозможные значения, сбой часов, выбросы. Сейчас работает в «Испытаниях» (поймано 6 из 6); к живому потоку — следующий шаг.', tech: 'правила + очистка', code: 'backend/app/data_quality.py', status: 'demo', to: ['stress'] },
  { id: 'feedback', layer: 'ingest', name: 'Ответы людей', short: 'Ответы людей', what: 'Ответы «да / нет», ввод брака, события камеры ЛКП — каждый урок записывается в журнал обучения.', tech: 'POST /api/learn/*', code: 'backend/app/learn/api.py', status: 'ready', to: ['db'] },
  { id: 'gateway', layer: 'ingest', name: 'Шлюз завода', short: 'Шлюз PLC', what: 'Связь PLC с Allur Flow: теги OPC UA → события. Инструкция и сопоставление тегов готовы.', tech: 'Node-RED / Kepware · EMQX', code: 'docs/INTEGRATION.md', status: 'plan', to: ['live'] },
  // Хранение
  { id: 'db', layer: 'store', name: 'База журналов', short: 'База', what: 'Журнал смен (запись дня один раз), прогнозы смен, записанные до их начала, ответы людей и брак окраски для обучения (переживают перезапуск), разборы брака, прогоны, живые события.', tech: 'SQLite (дальше — TimescaleDB)', code: 'backend/app/db.py, journal.py, capa.py', status: 'ready', to: ['twin', 'quality'] },
  { id: 'line', layer: 'store', name: 'Описание линии', short: 'Линия файлом', what: 'Участки, оборудование, циклы, накопители, надёжность — файлом: параметры линии меняются без программиста. Линия с другим набором участков потребует доработки моделей.', tech: 'data/line.json', code: 'data/line.json', status: 'ready', to: ['twin'] },
  { id: 'registry', layer: 'store', name: 'Реестр моделей', short: 'Модели', what: 'Версии модели прогноза: новая становится основной, только если точнее текущей на 3% на отложенных сменах, которых не видела.', tech: 'файлы моделей + registry.json', code: 'data/models/', status: 'ready', to: ['models'] },
  // Ядро
  { id: 'facts', layer: 'core', name: 'Выводы по фактам', short: 'Выводы', what: 'Брак против нормы (байес), несогласованность плана, почему OEE не считается по данным, сверка журналов.', tech: 'Python · SciPy', code: 'backend/app/findings.py', status: 'ready', to: ['apis'] },
  { id: 'twin', layer: 'core', name: 'Двойник линии', short: 'Двойник', what: 'Склад → сварка → окраска → сборка → ОТК → склад: накопители, отказы, переделка окраски. На нём считаются «что если», прогноз к концу смены и месяца, цена минуты простоя; дни с данными завода — по фактам.', tech: 'SimPy 4.1 · одинаковые случайные события', code: 'backend/app/sim/, journal.py, fact_days.py', status: 'ready', to: ['models', 'apis'] },
  { id: 'calib', layer: 'core', name: 'Подгонка двойника', short: 'Подгонка', what: 'По журналу простоев двойник подбирает надёжность участков; брак окраски уточняется ответами людей и камерой.', tech: 'байес (Beta) · калибровка по симуляции', code: 'backend/app/twin_calib.py, learn/calib.py', status: 'ready', to: ['twin'] },
  { id: 'models', layer: 'core', name: 'Прогноз и тревоги (ИИ)', short: 'Прогноз ИИ', what: 'Выпуск на 2 часа, риск провала (порог по цене ошибки), коридор 90%, тревоги, которые учатся на «да / нет». Сейчас учатся на эмуляторе завода; на данных завода — после выгрузки истории MES.', tech: 'LightGBM · River · ACI', code: 'backend/app/learn/', status: 'demo', to: ['apis'] },
  { id: 'quality', layer: 'core', name: 'Качество', short: 'Качество', what: 'Контрольная карта брака, разбор 8D с проверкой эффекта действия, каскад потерь OEE.', tech: 'SPC (Шухарт) · тест долей', code: 'backend/app/spc.py, capa.py, sim/kpi.py', status: 'ready', to: ['apis'] },
  { id: 'stress', layer: 'core', name: 'Испытания', short: 'Испытания', what: '7 сбоев завода и «беспредел» (среднее по 40 сменам), сбои данных: что заметит двойник и что сделает.', tech: 'SimPy · проверка данных', code: 'backend/app/stress.py, stress_api.py', status: 'ready', to: ['apis'] },
  { id: 'workorders', layer: 'core', name: 'Наряды на ремонт', short: 'Наряды', what: 'Тревога → причина → наряд: кому, что сделать, срок, цена простоя участка; статус наряда хранится в базе.', tech: 'правила + цена минуты из двойника', code: 'backend/app/workorders.py', status: 'ready', to: ['apis'] },
  // Сервисы
  { id: 'apis', layer: 'api', name: 'Сервер расчётов', short: 'Сервер', what: 'Один адрес для экранов и данных. Тяжёлые расчёты прогреваются при запуске.', tech: 'FastAPI · Python 3.12', code: 'backend/app/main.py', status: 'ready', to: ['briefing', 'twin3d', 'learnui', 'copilot'] },
  { id: 'guard', layer: 'api', name: 'Защита демо', short: 'Защита', what: 'PIN администратора на все изменения (если задан), лимит вопросов к ИИ с одного адреса.', tech: 'middleware FastAPI', code: 'backend/app/guard.py', status: 'ready' },
  { id: 'copilot', layer: 'api', name: 'ИИ-помощник', short: 'ИИ-помощник', what: 'Отвечает словами, а числа берёт из функций двойника; каждое число сверяется с расчётом, неподтверждённое помечается «не проверено». Без интернета — быстрые ответы. Открывается на любом экране.', tech: 'LLM через OpenRouter · вызов функций', code: 'backend/app/copilot/', status: 'ready' },
  // Экраны
  { id: 'briefing', layer: 'ui', name: 'Брифинг смены', short: 'Брифинг', what: 'В 8:00 на одной странице: сколько сделаем, что мешает, что сделать.', tech: 'React 19', code: 'frontend/src/BriefingPage.tsx', status: 'ready' },
  { id: 'twin3d', layer: 'ui', name: 'Двойник: 3D · План · Схема', short: '3D · План', what: 'Линия в 3D и 2D, машина времени, прогноз к концу смены, журнал, действия, брак.', tech: 'three.js · React Three Fiber · React Flow · ECharts', code: 'frontend/src/twin/', status: 'ready' },
  { id: 'learnui', layer: 'ui', name: 'Обучение и испытания', short: 'Обучение', what: 'Почему верить прогнозу, как система учится, что будет при сбоях завода и данных.', tech: 'React · ECharts', code: 'frontend/src/learn/, frontend/src/stress/', status: 'ready' },
  { id: 'pwa', layer: 'ui', name: 'Телефон и офлайн', short: 'Телефон', what: 'Устанавливается как приложение. Без сети работают «Двойник» на записанных прогонах и «Испытания»; остальное требует сервера. QR ведёт на страницу ответов «да / нет».', tech: 'PWA · service worker', code: 'frontend/vite.config.ts, frontend/pwa/', status: 'ready' },
]
export const COMP_BY: Record<string, Comp> = Object.fromEntries(COMPS.map((c) => [c.id, c]))

// Цикл решения: то, ради чего всё устроено
export const CYCLE = [
  { id: 'see', title: 'Видим', text: 'Данные учёта и события с линии — в одном месте, с меткой источника.', comps: ['upload', 'live', 'db'] },
  { id: 'understand', title: 'Понимаем', text: 'Двойник показывает, где узкое место и куда уходят машины.', comps: ['twin', 'facts', 'quality'] },
  { id: 'predict', title: 'Прогнозируем', text: 'Сколько будет к концу смены и месяца, где простой и узкое место, где провал выпуска.', comps: ['models', 'twin'] },
  { id: 'act', title: 'Предлагаем', text: 'Какое действие даст больше машин и сколько это в тенге.', comps: ['twin', 'apis', 'briefing'] },
  { id: 'decide', title: 'Человек решает', text: 'Мастер отвечает «да / нет», записывает действие.', comps: ['people', 'feedback'] },
  { id: 'learn', title: 'Учимся', text: 'Проверяем эффект, уточняем двойник и тревоги — следующий прогноз точнее.', comps: ['calib', 'models', 'registry'] },
]
