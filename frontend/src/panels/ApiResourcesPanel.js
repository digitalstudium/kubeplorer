import { GetApiResources } from "../../wailsjs/go/main/App";
import { StatefulPanel } from "./StatefulPanel.js";
import { ApiResourcesModalHandler } from "../components/ApiResourcesModalHandler.js";
import { ApiResourcesRenderer } from "../components/ApiResourcesRenderer.js";
import { LRUApiResources } from "../utils/LRUApiResources.js";
import { defaultApiResourcesGroups } from "../utils/Config";

export let apiResourcesGroups = defaultApiResourcesGroups;
const storedGroups = localStorage.getItem("resourceGroups");
if (storedGroups) {
  apiResourcesGroups = JSON.parse(storedGroups);
}

export class ApiResourcesPanel extends StatefulPanel {
  constructor(name, container, tab, stateManager = null) {
    super(name, container, tab, stateManager);
    this.currentPanelId = null;
    this.selectedElText = "pods";
    this.buttonEl = document.querySelector(".create-group-btn");
    this.buttonFunction = () => this.showCreateGroupModal();
    this.lruApiResources = new LRUApiResources();
    this.PANEL_STATES = {
      ...this.PANEL_STATES,
      GROUPS_CHANGED: "GROUPS_CHANGED",
    };
    this.modalHandler = new ApiResourcesModalHandler(
      this.tab,
      apiResourcesGroups,
    );

    this.renderer = new ApiResourcesRenderer(
      this.listEl,
      this.listItemClass,
      (action, groupName) => this[action](groupName),
    );

    // Подписываемся на изменения selectedApiResource
    if (this.stateManager) {
      this.stateManager.subscribe("selectedApiResource", (newApiResource) => {
        this.updateSelectedApiResource(newApiResource);
      });
    }
  }

  // === ОБРАБОТКА СОСТОЯНИЙ ===
  onStateChange(oldState, newState, newData, oldData) {
    switch (newState) {
      case this.PANEL_STATES.LOADING:
        this.handleLoadingState();
        break;

      case this.PANEL_STATES.LOADED:
        this.handleLoadedState(newData);
        break;

      case this.PANEL_STATES.SELECTED:
        this.handleSelectedState(newData, oldState, oldData);
        break;

      case this.PANEL_STATES.UPDATING:
        this.handleUpdatingState();
        break;

      case this.PANEL_STATES.GROUPS_CHANGED:
        this.handleGroupsChangedState(newData);
        break;

      case this.PANEL_STATES.ERROR:
        this.handleErrorState(newData);
        break;
    }
  }

  // === ОБРАБОТЧИКИ СОСТОЯНИЙ ===
  handleLoadingState() {
    this.listEl.innerHTML = `<div class="no-resources">Loading API resources...</div>`;
    this.header2ValueEl.textContent = "Loading...";
    this.listEl.style.pointerEvents = "none";
    this.cleanup();
  }

  handleLoadedState(newData) {
    this.listEl.style.pointerEvents = "auto";

    if (newData?.apiResources) {
      this.updateUI(
        newData.selectedApiResource,
        newData.apiResources,
        newData.searchValue,
      );
    }
  }

  handleSelectedState(newData, oldState, oldData) {
    this.listEl.style.pointerEvents = "auto";

    if (newData?.selectedApiResource) {
      this.updateUI(newData.selectedApiResource);
      this.updateStateManager(newData.selectedApiResource);
    }

    if (
      oldState === this.PANEL_STATES.LOADED ||
      (oldState === this.PANEL_STATES.SELECTED &&
        newData?.selectedApiResource !== oldData?.selectedApiResource)
    ) {
      this.scrollToSelected();
    } else {
      console.log("No scroll needed");
    }

    if (!this.currentPanelId) {
      this.registerForUpdates(
        `apiresources-${this.cluster}`,
        () => this.update(),
        10000,
      );
    }
  }

  handleGroupsChangedState(newData) {
    // Обновляем только UI групп, не загружая данные заново
    if (newData && newData.apiResources) {
      this.rebuildGroupedList(
        newData.selectedApiResource,
        newData.apiResources,
      );
      if (newData.searchValue && this.searchBoxEl) {
        this.searchBoxEl.value = newData.searchValue;
        this.search();
      }
    }
    // Возвращаемся в SELECTED
    this.setState(this.PANEL_STATES.SELECTED, newData);
  }

  handleErrorState(newData) {
    this.listEl.innerHTML = `<div class="no-resources">Error loading API resources</div>`;
    this.header2ValueEl.textContent = "Error";
    this.listEl.style.pointerEvents = "none";
    this.cleanup();

    if (newData?.error) {
      console.error("API resources panel error:", newData.error);
    }
  }

  handleUpdatingState() {
    this.showUpdateIndicator();
  }

  // === UI МЕТОДЫ ===
  showUpdateIndicator() {
    // Опционально: показать тонкий индикатор обновления
  }

  updateUI(selectedApiResource, apiResources = null, searchValue = null) {
    this.selectedElText = selectedApiResource;
    this.header2ValueEl.textContent = selectedApiResource;

    // Если переданы apiResources, перерендериваем весь список
    if (apiResources) {
      this.renderer.rebuildGroupedList(
        selectedApiResource,
        apiResources,
        apiResourcesGroups,
      );
    } else {
      // Иначе просто обновляем выделение
      this.renderer.updateSelection(selectedApiResource);
    }

    this.selectedEl = this.listEl.querySelector(".selected");

    if (searchValue && this.searchBoxEl) {
      this.searchBoxEl.value = searchValue;
      this.search();
    }

    this.lruApiResources.updateFrequentApiResources(
      this.selectedElText,
      (resource, addToLRU) => this.selectApiResourceByName(resource, addToLRU),
    );
  }

  // === ЛОГИКА ДАННЫХ ===
  async fetchApiResources() {
    const apiResourcesMap = await GetApiResources(this.cluster);

    if (!apiResourcesMap || typeof apiResourcesMap !== "object") {
      throw new Error("Invalid API resources response");
    }

    // Initialize a Set to store all unique resource apiResources
    let allApiResources = new Set();

    // Iterate over the API resources map
    Object.values(apiResourcesMap).forEach((group) => {
      // Add each api resource to the allApiResources Set
      group.forEach((resource) => allApiResources.add(resource.Name));
    });

    return Array.from(allApiResources);
  }

  resolveSelectedApiResource(apiResources) {
    const currentSelection = this.stateManager?.getState("selectedApiResource");

    if (currentSelection && apiResources.includes(currentSelection)) {
      return currentSelection;
    }

    // Fallback to pods or first available
    return apiResources.includes("pods") ? "pods" : apiResources[0] || "pods";
  }

  updateStateManager(selectedApiResource) {
    const currentSelection = this.stateManager?.getState("selectedApiResource");
    if (this.stateManager && selectedApiResource !== currentSelection) {
      this.stateManager.setState("selectedApiResource", selectedApiResource);
    }
  }

  // === ОСНОВНОЙ МЕТОД ===
  async update() {
    const searchValue = this.searchBoxEl ? this.searchBoxEl.value : "";

    if (!this.cluster) {
      console.log("No cluster selected, skipping update");
      return;
    }

    const wasSelected = this.isSelected();
    const wasUpdating = this.isUpdating();

    if (this.isSelected()) {
      this.setState(this.PANEL_STATES.UPDATING);
    }

    try {
      const apiResources = await this.fetchApiResources();
      const selectedApiResource = this.resolveSelectedApiResource(apiResources);

      // Проверяем, изменились ли данные
      const currentApiResources = this.getAllCurrentApiResources();
      const hasDataChanged = !this.arraysEqual(
        currentApiResources.sort(),
        apiResources.sort(),
      );

      // Передаем данные в состояние
      const stateData = {
        apiResources,
        selectedApiResource,
        searchValue,
        hasDataChanged,
      };

      if (wasSelected || wasUpdating) {
        this.setState(this.PANEL_STATES.SELECTED, stateData);
      } else {
        this.setState(this.PANEL_STATES.LOADED, stateData);
        this.setState(this.PANEL_STATES.SELECTED, stateData);
      }
    } catch (error) {
      this.setState(this.PANEL_STATES.ERROR, { error });
    }
  }

  // === ВЗАИМОДЕЙСТВИЕ ===
  select(event) {
    const newSelection = super.select(event);
    if (!newSelection) {
      return;
    }

    const selectedApiResource = newSelection.textContent;

    this.lruApiResources.addAndUpdate(
      selectedApiResource,
      this.selectedElText,
      (resource, addToLRU) => this.selectApiResourceByName(resource, addToLRU),
    );

    if (this.stateManager) {
      this.stateManager.setState("selectedApiResource", selectedApiResource);
    }
    this.header2ValueEl.textContent = selectedApiResource;
    this.setState(this.PANEL_STATES.SELECTED);
  }

  updateSelectedApiResource(newApiResource) {
    this.setState(this.PANEL_STATES.SELECTED, {
      ...(this.currentData || {}),
      selectedApiResource: newApiResource,
    });
  }

  // === ОСТАЛЬНЫЕ МЕТОДЫ (без изменений) ===

  // Получает все текущие API ресурсы из DOM
  getAllCurrentApiResources() {
    const items = this.getAllListElements();
    return items.map((item) => item.textContent);
  }

  // Сравнивает два массива
  arraysEqual(a, b) {
    return a.length === b.length && a.every((val, i) => val === b[i]);
  }

  selectApiResourceByName(apiResourceName, addToLRU = true) {
    // Находим элемент в списке и выбираем его
    const items = this.getAllListElements();
    const targetItem = items.find(
      (item) => item.textContent === apiResourceName,
    );

    if (targetItem) {
      // Снимаем выделение с текущего элемента
      if (this.selectedEl) {
        this.selectedEl.classList.remove("selected");
      }

      // Выделяем новый элемент
      targetItem.classList.add("selected");
      this.selectedEl = targetItem;
      this.selectedElText = apiResourceName;

      // Добавляем в LRU только если это требуется
      if (addToLRU) {
        this.lruApiResources.addAndUpdate(
          apiResourceName,
          this.selectedElText,
          (resource, addToLRU) =>
            this.selectApiResourceByName(resource, addToLRU),
        );
      } else {
        this.lruApiResources.updateFrequentApiResources(
          this.selectedElText,
          (resource, addToLRU) =>
            this.selectApiResourceByName(resource, addToLRU),
        );
      }

      // Обновляем StateManager
      if (this.stateManager) {
        this.stateManager.setState("selectedApiResource", apiResourceName);
      }

      this.header2ValueEl.textContent = apiResourceName;

      // Разворачиваем группу если ресурс свернут
      this.expandGroupForResource(apiResourceName);
    }
  }

  expandGroupForResource(apiResourceName) {
    // Находим группу, содержащую этот ресурс
    const groupSections = this.listEl.querySelectorAll(".group-section");

    groupSections.forEach((section) => {
      const items = section.querySelectorAll(`.${this.listItemClass}`);
      const hasResource = Array.from(items).some(
        (item) => item.textContent === apiResourceName,
      );

      if (hasResource) {
        const header = section.querySelector(".group-header");
        const content = section.querySelector(".group-content");

        if (header && content) {
          header.classList.remove("collapsed");
          content.classList.remove("collapsed");
        }
      }
    });
  }

  search() {
    super.search();
    // так как список api ресурсов сгруппирован, названия групп нужно скрывать если в ней ничего не нашлось
    const groups = document.querySelectorAll(".group-section");
    Array.from(groups).forEach((group) => {
      const items = group.getElementsByClassName(this.listItemClass);
      let hasVisibleItem = false;
      Array.from(items).forEach((item) => {
        if (item.style.display !== "none") hasVisibleItem = true;
      });
      group.style.display = hasVisibleItem ? "block" : "none";
      if (this.searchBoxEl.value) {
        if (hasVisibleItem) {
          group.querySelector(".group-header").classList.remove("collapsed");
          group.querySelector(".group-content").classList.remove("collapsed");
        }
      } else {
        group.querySelector(".group-header").classList.add("collapsed");
        group.querySelector(".group-content").classList.add("collapsed");
      }
    });
  }

  showCreateGroupModal() {
    this.modalHandler.showCreateGroupModal(() => {
      const currentData = this.getStateData();
      this.setState(this.PANEL_STATES.GROUPS_CHANGED, currentData);
    });
  }

  showEditGroupModal(groupName) {
    this.modalHandler.showEditGroupModal(groupName, () => {
      const currentData = this.getStateData();
      this.setState(this.PANEL_STATES.GROUPS_CHANGED, currentData);
    });
  }

  deleteGroup(groupName) {
    this.modalHandler.deleteGroup(groupName, () => {
      const currentData = this.getStateData();
      this.setState(this.PANEL_STATES.GROUPS_CHANGED, currentData);
    });
  }

  scrollToSelected() {
    if (this.selectedEl) {
      // Сначала разворачиваем группу
      this.expandGroupForResource(this.selectedElText);

      // Затем скроллим
      this.selectedEl.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }

  clear() {
    super.clear();
    this.cleanup();
  }
}
