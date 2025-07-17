export class UpdateManager {
  constructor() {
    this.intervals = new Map(); // Хранит все активные интервалы
    this.updateCallbacks = new Map(); // Хранит колбэки для обновления
  }

  // Регистрирует панель для обновления
  register(panelId, updateCallback, intervalMs = 1000) {
    // Если уже есть интервал для этой панели - очищаем его
    this.unregister(panelId);
    
    // Создаем новый интервал
    const intervalId = setInterval(() => {
      if (!updateCallback.isUpdating) {
        updateCallback();
      }
    }, intervalMs);
    
    this.intervals.set(panelId, intervalId);
    this.updateCallbacks.set(panelId, updateCallback);
    
    console.log(`UpdateManager: Registered panel ${panelId} with ${intervalMs}ms interval`);
  }

  // Отменяет регистрацию панели
  unregister(panelId) {
    const intervalId = this.intervals.get(panelId);
    if (intervalId) {
      clearInterval(intervalId);
      this.intervals.delete(panelId);
      this.updateCallbacks.delete(panelId);
      console.log(`UpdateManager: Unregistered panel ${panelId}`);
    }
  }

  // Очищает все интервалы
  cleanup() {
    for (const [panelId, intervalId] of this.intervals) {
      clearInterval(intervalId);
      console.log(`UpdateManager: Cleaned up panel ${panelId}`);
    }
    this.intervals.clear();
    this.updateCallbacks.clear();
  }

  // Получить информацию о зарегистрированных панелях
  getRegisteredPanels() {
    return Array.from(this.intervals.keys());
  }
}
