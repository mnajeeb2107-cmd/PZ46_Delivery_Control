const list = document.querySelector("#parcel-list");
const status = document.querySelector("#status");
const summary = document.querySelector("#summary");
const scenario = document.querySelector("#scenario");
const loadButton = document.querySelector("#load-button");
const cancelButton = document.querySelector("#cancel-button");

let activeController = null;
let serial = 0;

// Убеждаемся, что при старте страницы кнопка отмены заблокирована
cancelButton.disabled = true;

function setStatus(message, kind = "info") {
  status.textContent = message;
  status.dataset.kind = kind;
}

function renderParcels(items) {
  list.innerHTML = "";
  summary.textContent = `Найдено доставок: ${items.length}`;

  if (items.length === 0) {
    const emptyMessage = document.createElement("li");
    emptyMessage.className = "empty-state";
    emptyMessage.textContent = "Список доставок пуст.";
    list.appendChild(emptyMessage);
    return;
  }

  items.forEach((item) => {
    const li = document.createElement("li");
    li.className = "parcel-card";

    const title = document.createElement("strong");
    // Поддержка разных возможных названий полей с бэкенда
    title.textContent = item.title || item.name || `Посылка #${item.id ?? "без номера"}`;

    const details = document.createElement("span");
    const statusText = item.status ? `Статус: ${item.status}` : "";
    const cityText = item.city || item.destination ? ` • Куда: ${item.city || item.destination}` : "";
    details.textContent = `${statusText}${cityText}`;

    li.appendChild(title);
    if (details.textContent) {
      li.appendChild(document.createElement("br"));
      li.appendChild(details);
    }

    list.appendChild(li);
  });
}

async function loadParcels() {
  // 1. Отменяем предыдущий активный запрос (защита от гонки)
  if (activeController) {
    activeController.abort("SUPERSEDED");
  }

  // 2. Фиксируем номер текущей попытки
  const currentSerial = ++serial;

  // 3. Создаём новый контроллер и запускаем таймер на 2500 мс
  const controller = new AbortController();
  activeController = controller;

  const timeoutId = setTimeout(() => {
    controller.abort("TIMEOUT");
  }, 2500);

  // Обновляем интерфейс перед стартом запроса
  cancelButton.disabled = false;
  setStatus("Загрузка данных...", "loading");

  try {
    const mode = scenario ? scenario.value : "ok";
    const response = await fetch(`/api/parcels?mode=${encodeURIComponent(mode)}`, {
      signal: controller.signal,
    });

    // Игнорируем ответ, если уже запущен более новый запрос
    if (currentSerial !== serial) return;

    // 4. Проверяем HTTP-статусы
    if (!response.ok) {
      if (response.status === 503) {
        throw new Error("HTTP_503");
      }
      throw new Error(`HTTP_${response.status}`);
    }

    // 5. Разбираем JSON и проверяем структуру данных
    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error("INVALID_JSON");
    }

    if (currentSerial !== serial) return;

    // Извлекаем массив (на случай если сервер возвращает { items: [...] } или сразу [...])
    const items = Array.isArray(data) ? data : data?.items;
    if (!Array.isArray(items)) {
      throw new Error("INVALID_FORMAT");
    }

    // Успешный рендер
    renderParcels(items);
    setStatus(`Успешно загружено элементов: ${items.length}`, "success");

  } catch (err) {
    // Если запрос был вытеснен новым кликом по кнопке "Отправить запрос", молча выходим
    if (controller.signal.reason === "SUPERSEDED" || currentSerial !== serial) {
      return;
    }

    // 6. Различаем причины ошибок для пользователя
    if (err.name === "AbortError" || controller.signal.aborted) {
      if (controller.signal.reason === "TIMEOUT") {
        setStatus("Ошибка: превышено время ожидания (тайм-аут 2500 мс).", "error");
      } else {
        setStatus("Запрос отменён пользователем.", "warning");
      }
    } else if (err.message === "HTTP_503") {
      setStatus("Сервис временно недоступен (HTTP 503). Попробуйте позже.", "error");
    } else if (err.message === "INVALID_JSON" || err.message === "INVALID_FORMAT") {
      setStatus("Ошибка обработки данных: сервер вернул некорректный JSON.", "error");
    } else if (err.message.startsWith("HTTP_")) {
      setStatus(`Ошибка сервера: ${err.message.replace("_", " ")}.`, "error");
    } else {
      setStatus("Сетевая ошибка: проверьте подключение к серверу.", "error");
    }
  } finally {
    // 7. Очищаем таймер в любом случае
    clearTimeout(timeoutId);

    // Возвращаем кнопку "Отменить" в исходное состояние только если это всё ещё актуальный запрос
    if (activeController === controller) {
      activeController = null;
      cancelButton.disabled = true;
    }
  }
}

loadButton.addEventListener("click", loadParcels);

cancelButton.addEventListener("click", () => {
  if (activeController) {
    activeController.abort("MANUAL");
  }
});
