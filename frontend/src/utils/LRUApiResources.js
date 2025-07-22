// frontend/src/utils/LRUApiResources.js
export class LRUApiResources {
  constructor(maxSize = 5) {
    this.maxSize = maxSize;
    this.items = this.loadFromStorage();
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

  saveToStorage() {
    try {
      localStorage.setItem("lru-api-resources", JSON.stringify(this.items));
    } catch (error) {
      console.error("Error saving LRU API resources:", error);
    }
  }

  add(apiResource) {
    if (!apiResource) return;

    // Удаляем если уже существует
    this.items = this.items.filter((item) => item !== apiResource);

    // Добавляем в начало
    this.items.unshift(apiResource);

    // Ограничиваем размер
    if (this.items.length > this.maxSize) {
      this.items = this.items.slice(0, this.maxSize);
    }

    this.saveToStorage();
  }

  getItems() {
    return [...this.items];
  }

  clear() {
    this.items = [];
    this.saveToStorage();
  }
}
