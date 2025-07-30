import { Utils } from "../utils/Utils";

export class Panel {
  constructor(name, container, tab, stateManager = null) {
    this.container = container;
    this.tab = tab;
    this.stateManager = stateManager;
    this.cluster = stateManager?.getState("selectedCluster") || null;
    this.currentPanelId = null;
    this.header1ValueEl = container.querySelector(`.${name} .header1Value`);
    this.header2ValueEl = container.querySelector(`.${name} .header2Value`);
    this.panelEl = container.querySelector(`.${name}`);
    this.searchWrapper = Utils.createEl("search-wrapper");
    this.clearSearchBoxEl = Utils.createIconEl("fa-times search-clear");
    this.clearSearchBoxEl.style.display = "none";
    this.searchBoxEl = Utils.createInputEl(
      "search-input searchBox",
      Utils.translate("Search") + "...",
    );
    this.searchWrapper.append(this.searchBoxEl, this.clearSearchBoxEl);
    this.listEl = Utils.createEl(`list`);
    this.panelEl.append(this.searchWrapper, this.listEl);
    this.listItemClass = "item";
    this.selectedElText = null;
    this.selectedEl = null; // must be assigned after populating list
    this.buttonEl = null;
    this.buttonFunction = null;
    this.debouncedSearch = Utils.debounce(() => this.search(), 300);
  }

  getAllListElements() {
    return Array.from(this.listEl.getElementsByClassName(this.listItemClass));
  }

  setupEventListeners() {
    // input handler
    this.searchBoxEl.addEventListener("input", () => this.debouncedSearch());
    // Utility function to clear the search box and trigger search
    const clearAndSearch = () => {
      this.searchBoxEl.value = "";
      this.search();
    };
    // Clear search box handlers
    this.clearSearchBoxEl.addEventListener("click", clearAndSearch);
    this.searchBoxEl.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        clearAndSearch();
      }
    });
    // List item click handler
    this.listEl.addEventListener("click", (event) => this.select(event));
    // Button click handler with a default function if buttonFunction is not defined
    this.buttonEl?.addEventListener("click", this.buttonFunction || (() => {}));
  }

  select(event) {
    const newSelectedElement = event.target.closest(`.${this.listItemClass}`);
    if (!newSelectedElement) return null;
    // если клик по уже выбранному элементу, не обрабатываем его
    if (newSelectedElement === this.selectedEl) return null;
    if (this.selectedEl) {
      this.selectedEl.classList.remove("selected");
    }
    newSelectedElement.classList.add("selected");
    this.selectedEl = newSelectedElement;
    this.selectedElText = newSelectedElement.textContent;
    return newSelectedElement;
  }

  scrollToSelected() {
    this.selectedEl?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }

  registerForUpdates(panelId, updateCallback, intervalMs) {
    if (this.stateManager) {
      const updateManager = this.stateManager.getUpdateManager();

      if (this.currentPanelId !== panelId) {
        if (this.currentPanelId) {
          updateManager.unregister(this.currentPanelId);
        }
        updateManager.register(
          panelId,
          () => {
            if (this.cluster) {
              updateCallback();
            }
          },
          intervalMs,
        );
        this.currentPanelId = panelId;
      }
    }
  }

  cleanup() {
    if (this.currentPanelId && this.stateManager) {
      const updateManager = this.stateManager.getUpdateManager();
      updateManager.unregister(this.currentPanelId);
      this.currentPanelId = null;
    }
    if (this.currentUpdateAbortController) {
      this.currentUpdateAbortController.abort();
    }
  }

  clear() {
    this.listEl.remove();
    console.log("listEl has been removed");
    this.searchWrapper.remove();
    this.header1ValueEl.textContent = "";
    this.header2ValueEl.textContent = "";
    this.cluster = null;
    if (this.buttonEl) {
      this.buttonEl.removeEventListener("click", this.buttonFunction);
    }
  }

  search() {
    const searchValue = this.searchBoxEl.value.toLowerCase();
    // скрываем или показываем кнопку очистки поиска
    this.clearSearchBoxEl.style.display = searchValue ? "block" : "none";
    const items = this.getAllListElements();
    // скрываем или показываем элементы списка
    items.forEach((item) => {
      item.style.display = item.textContent.toLowerCase().includes(searchValue)
        ? "flex"
        : "none";
    });
    // если нет видимых элементов списка, пишем что ничего не найдено
    const noResources = this.listEl.querySelector(".no-resources");
    if (noResources) {
      noResources.remove();
    }
    if (!searchValue && this.clearSearchBoxEl.style.display == "none") {
      return;
    }
    let hasVisibleItem = false;
    Array.from(items).forEach((item) => {
      if (item.style.display !== "none") hasVisibleItem = true;
    });
    if (!hasVisibleItem) {
      const noResourcesEl = Utils.createEl(
        "no-resources",
        `${Utils.translate("No items found for search query")} "${searchValue}"`,
      );
      this.listEl.prepend(noResourcesEl);
    }
  }
}
