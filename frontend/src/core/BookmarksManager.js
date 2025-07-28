export class BookmarksManager {
  constructor() {
    this.bookmarks = this.loadBookmarks();
    this.clusterConnectivity = new Map();
  }

  loadBookmarks() {
    try {
      const stored = localStorage.getItem("kubeplorer-bookmarks");
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      console.error("Error loading bookmarks:", error);
      return [];
    }
  }

  saveBookmarks() {
    try {
      localStorage.setItem(
        "kubeplorer-bookmarks",
        JSON.stringify(this.bookmarks),
      );
    } catch (error) {
      console.error("Error saving bookmarks:", error);
    }
  }

  addBookmark(cluster, namespace, apiResource) {
    const bookmark = {
      id: Date.now(),
      cluster,
      namespace,
      apiResource,
      name: `${cluster}/${namespace}/${apiResource}`,
      createdAt: new Date().toISOString(),
    };

    // Проверяем, нет ли уже такой закладки
    const exists = this.bookmarks.some(
      (b) =>
        b.cluster === cluster &&
        b.namespace === namespace &&
        b.apiResource === apiResource,
    );

    if (!exists) {
      this.bookmarks.unshift(bookmark);
      this.saveBookmarks();
      return true;
    }
    return false;
  }

  removeBookmark(id) {
    this.bookmarks = this.bookmarks.filter((b) => b.id !== id);
    this.saveBookmarks();
  }

  getBookmarks() {
    return [...this.bookmarks];
  }

  setClusterConnectivity(cluster, isConnected) {
    if (!this.clusterConnectivity) {
      this.clusterConnectivity = new Map();
    }
    this.clusterConnectivity.set(cluster, isConnected);
  }

  getClusterConnectivity(cluster) {
    if (!this.clusterConnectivity) {
      return null;
    }
    return this.clusterConnectivity.get(cluster) ?? null;
  }

  // Получить закладки с информацией о подключении из кэша
  getBookmarksWithConnectivity() {
    return this.bookmarks.map((bookmark) => ({
      ...bookmark,
      isConnected: this.getClusterConnectivity(bookmark.cluster) ?? true,
    }));
  }
}
