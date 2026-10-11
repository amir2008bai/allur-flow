# Сторонние библиотеки, данные и идеи

Allur Flow использует открытые библиотеки (точные версии — `backend/requirements.txt`, `frontend/package-lock.json`). Чужой код не копировался; ниже — что используется и под какой лицензией.

## Сервер (Python)
| Библиотека | Для чего | Лицензия |
|---|---|---|
| FastAPI, Pydantic | сервер API, проверка входных данных | MIT |
| Uvicorn | веб-сервер | BSD-3-Clause |
| SimPy | дискретно-событийная симуляция линии | MIT |
| NumPy, SciPy | расчёты, статистика (Beta, t-интервалы, тест долей) | BSD-3-Clause |
| LightGBM | прогноз выпуска на 2 ч и риск провала | MIT |
| River | онлайн-модели и детектор дрейфа (Page-Hinkley) | BSD-3-Clause |
| python-docx, openpyxl | чтение данных заказчика (Word, Excel) | MIT |
| python-multipart, httpx | загрузка файлов, запросы к LLM | Apache-2.0 / BSD-3-Clause |
| pytest | тесты | MIT |

## Интерфейс (JavaScript)
| Библиотека | Для чего | Лицензия |
|---|---|---|
| React, React DOM | интерфейс | MIT |
| three.js, @react-three/fiber, @react-three/drei, @react-three/postprocessing | 3D-двойник и 3D-архитектура | MIT |
| postprocessing | эффекты 3D | Zlib |
| @xyflow/react | Схема потока, поток данных архитектуры | MIT |
| ECharts, echarts-for-react | графики | Apache-2.0 / MIT |
| Zustand, Motion | состояние, анимации | MIT |
| lucide-react | иконки | ISC |
| qrcode | QR-код страницы ответов | MIT |
| Vite, TypeScript, Tailwind CSS | сборка | MIT / Apache-2.0 / MIT |

## Модели и данные
| Что | Для чего | Лицензия / условия |
|---|---|---|
| Тестовые данные кейса (DOCX) и ТЗ | факты, нормы, план | материалы организаторов хакатона |
| UCI 597 «Productivity Prediction of Garment Employees» | проверка прогноза на реальной фабрике | CC BY 4.0 |
| TimesFM (Google), Chronos (Amazon) | претенденты прогноза (результаты в `data/tsfm_results.json`) | Apache-2.0 |
| Модели через OpenRouter (NVIDIA Nemotron, Qwen) | ИИ-помощник | по карточкам моделей; ключ пользователя, в репозиторий не входит |

## Методы (по публикациям)
- Узкое место — метод активных периодов (C. Roser).
- Контрольные карты — W. Shewhart; правила Western Electric.
- Адаптивный конформный интервал — I. Gibbs, E. Candès (2021).
- Разбор брака 8D, OEE, теория ограничений (DBR) — общепринятые практики производства.

## Инструменты разработки
ECC (github.com/affaan-m/ECC, MIT) и hackathon-forge использовались как чек-листы для ревью и аудита; в продукт не входят.
