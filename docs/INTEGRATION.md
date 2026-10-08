# Подключение Allur Flow к заводу

## Путь данных

```
PLC линий (Siemens / Omron / ABB)      камера ЛКП        MES / учёт производства
        │ OPC UA или MQTT                   │ HTTP              │ выгрузка Excel/CSV или API
        ▼                                   ▼                   ▼
  шлюз (Node-RED / Kepware / скрипт) → POST /api/live/events   «Факты → Загрузить данные»
                                        POST /api/learn/camera/event
        ▼
  Allur Flow: журнал событий (SQLite → TimescaleDB) → двойник (SimPy) → прогнозы (LightGBM) → интерфейс / ИИ-помощник
```

- **Оперативные события** (что работает или стоит, сколько годных) — каждую минуту через шлюз на `/api/live/events`.
- **История** (выпуск по сменам, журнал простоев, брак) — выгрузкой из MES, раз в сутки. По ней двойник сам подгоняет надёжность участков.
- **Линия** — участки, оборудование, циклы, накопители — описана в `data/line.json`, программист не нужен.

## Формат события

`POST /api/live/events`, тело — пачка до 500 событий:

```json
{"events": [
  {"ts": 1791300000, "asset_id": "Камера-02", "type": "state", "value": "down", "source": "kepware"},
  {"ts": 1791300060, "station": "qc", "type": "good", "value": 1, "source": "kepware"}
]}
```

| Поле | Что это |
|---|---|
| `ts` | Время события, unix-секунды. Если не указано — время приёма |
| `station` или `asset_id` | Участок (`welding`, `paint`, `assembly`, `qc`) или оборудование из `data/line.json` (`ABB-01`, `Камера-02`, `Конвейер-03`) |
| `type` | `state` — состояние участка; `good` — годные машины на выходе ОТК; `defect` — дефект |
| `value` | Для `state`: `working`, `starved` (ждёт кузов), `blocked` (некуда отдать), `down` (стоит). Для `good` — количество |
| `source` | Имя шлюза, попадает в происхождение данных |

Ответ: `{"accepted": N, "rejected": M}`. Неизвестное оборудование или состояние не ломает приём: такое событие просто пропускается.

## Сопоставление тегов OPC UA (пример)

| Тег PLC (OPC UA) | Событие Allur Flow |
|---|---|
| `ns=2;s=Weld.ABB01.Running` = true | `{"asset_id": "ABB-01", "type": "state", "value": "working"}` |
| `ns=2;s=Weld.ABB01.Fault` = true | `{"asset_id": "ABB-01", "type": "state", "value": "down"}` |
| `ns=2;s=Paint.Booth02.InfeedEmpty` = true | `{"asset_id": "Камера-02", "type": "state", "value": "starved"}` |
| `ns=2;s=QC.GoodCounter` +1 | `{"station": "qc", "type": "good", "value": 1}` |

## Проверка без завода

Во вкладке «Факты» → «Живые данные» → «Запустить эмулятор PLC». Эмулятор проигрывает смену событиями в тот же вход,
что и настоящий шлюз: так видно, что путь данных работает целиком.

Пример шлюза на Python (отправить одно событие):

```python
import httpx
httpx.post("http://localhost:8000/api/live/events", json={"events": [
    {"asset_id": "Конвейер-03", "type": "state", "value": "down", "source": "мой-шлюз"}]})
```

## Следующий шаг на заводе
- брокер MQTT (EMQX) и TimescaleDB вместо SQLite — при потоке с нескольких линий;
- PIN или вход администратора на изменение данных, лимит вопросов к ИИ — перед публикацией в сети завода.
