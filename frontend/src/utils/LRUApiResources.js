// frontend/src/utils/LRUApiResources.js
export class LRUApiResources {
  constructor(maxSize = 5, minAccessCount = 5) {
    this.maxSize = maxSize;
    this.minAccessCount = minAccessCount;
    this.items = this.loadFromStorage();
    this.accessCounts = this.loadAccessCounts();
  }

  loadFromStorage() {
    try {
      const stored = localStorage.getItem("lru-api-resources");
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error("Error loading LRU API resources:", error);
      return [];
    }
  }

  loadAccessCounts() {
    try {
      const stored = localStorage.getItem("lru-api-access-counts");
      return stored ? JSON.parse(stored) : {};
    } catch (error) {
      console.error("Error loading access counts:", error);
      return {};
    }
  }

  saveToStorage() {
    try {
      localStorage.setItem("lru-api-resources", JSON.stringify(this.items));
      localStorage.setItem(
        "lru-api-access-counts",
        JSON.stringify(this.accessCounts),
      );
    } catch (error) {
      console.error("Error saving LRU API resources:", error);
    }
  }

  add(apiResource) {
    if (!apiResource) return;

    // Увеличиваем счетчик обращений
    this.accessCounts[apiResource] = (this.accessCounts[apiResource] || 0) + 1;

    // Проверяем, достиг ли ресурс минимального количества обращений
    if (this.accessCounts[apiResource] >= this.minAccessCount) {
      // Удаляем если уже существует в LRU
      this.items = this.items.filter((item) => item !== apiResource);

      // Добавляем в начало LRU
      this.items.unshift(apiResource);

      // Ограничиваем размер LRU
      if (this.items.length > this.maxSize) {
        this.items = this.items.slice(0, this.maxSize);
      }
    }

    this.saveToStorage();
  }

  getItems() {
    return [...this.items];
  }

  getAccessCount(apiResource) {
    return this.accessCounts[apiResource] || 0;
  }

  clear() {
    this.items = [];
    this.accessCounts = {};
    this.saveToStorage();
  }

  // Метод для очистки только счетчиков (если нужно)
  clearAccessCounts() {
    this.accessCounts = {};
    localStorage.removeItem("lru-api-access-counts");
  }
}
