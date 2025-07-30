import { GetNamespaces, GetDefaultNamespace } from "../../wailsjs/go/main/App";
import { StatefulPanel } from "./StatefulPanel.js";

export class NamespacesPanel extends StatefulPanel {
  constructor(name, container, tab, stateManager = null) {
    super(name, container, tab, stateManager);
    this.currentPanelId = null;
    this.cluster = stateManager?.getState("selectedCluster") || null;

    // Подписываемся на изменения selectedNamespace
    if (this.stateManager) {
      this.stateManager.subscribe("selectedNamespace", (newNamespace) => {
        this.updateSelectedNamespace(newNamespace);
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
        this.handleSelectedState(newData);

        // Сравниваем старые и новые данные
        if (
          oldState === this.PANEL_STATES.LOADED ||
          (oldState === this.PANEL_STATES.SELECTED &&
            newData?.selectedNamespace !== oldData?.selectedNamespace)
        ) {
          this.scrollToSelected();
        }
        break;

      case this.PANEL_STATES.UPDATING:
        this.handleUpdatingState();
        break;

      case this.PANEL_STATES.ERROR:
        this.handleErrorState(newData);
        break;
    }
  }

  // === ОБРАБОТЧИКИ СОСТОЯНИЙ ===
  handleLoadingState() {
    this.listEl.innerHTML = `<div class="no-resources">Loading namespaces...</div>`;
    this.header2ValueEl.textContent = "Loading...";

    // Отключаем взаимодействие
    this.listEl.style.pointerEvents = "none";

    // Очищаем автообновление
    this.cleanup();
  }

  handleLoadedState(newData) {
    this.listEl.style.pointerEvents = "auto";

    if (newData?.namespaces) {
      this.updateUI(
        newData.selectedNamespace,
        newData.namespaces,
        newData.searchValue,
      );
    }
  }

  handleSelectedState(newData) {
    this.listEl.style.pointerEvents = "auto";

    if (newData?.selectedNamespace) {
      this.updateUI(newData.selectedNamespace);
      this.updateStateManager(newData.selectedNamespace);
    }

    if (!this.currentPanelId) {
      this.registerForUpdates(
        `namespaces-${this.cluster}`,
        () => this.update(),
        5000,
      );
    }
  }

  handleErrorState(newData) {
    this.listEl.innerHTML = `<div class="no-resources">Error loading namespaces</div>`;
    this.header2ValueEl.textContent = "Error";

    this.listEl.style.pointerEvents = "none";
    this.cleanup();

    if (newData?.error) {
      console.error("Namespace panel error:", newData.error);
    }
  }

  handleUpdatingState() {
    // Показываем тонкий индикатор обновления (опционально)
    this.showUpdateIndicator();
  }

  // === UI МЕТОДЫ ===
  showUpdateIndicator() {
    // Опционально: показать тонкий индикатор обновления
    // Например, добавить класс или показать маленький спиннер
  }

  updateUI(selectedNamespace, namespaces = null, searchValue = null) {
    this.selectedElText = selectedNamespace;
    this.header2ValueEl.textContent = selectedNamespace;

    // Если переданы namespaces, перерендериваем весь список
    if (namespaces) {
      const options = namespaces.map(
        (namespace) =>
          `<div class="${this.listItemClass} ${namespace === selectedNamespace ? "selected" : ""}">${namespace}</div>`,
      );
      this.listEl.innerHTML = options.join("");
    } else {
      // Иначе просто обновляем выделение
      const allItems = this.listEl.querySelectorAll(`.${this.listItemClass}`);
      allItems.forEach((item) => {
        item.classList.toggle(
          "selected",
          item.textContent === selectedNamespace,
        );
      });
    }

    this.selectedEl = this.listEl.querySelector(".selected");

    if (searchValue && this.searchBoxEl) {
      this.searchBoxEl.value = searchValue;
      this.search();
    }
  }

  // === ЛОГИКА ДАННЫХ ===
  async fetchNamespaces() {
    const namespaces = await GetNamespaces(this.cluster);

    if (!Array.isArray(namespaces) || namespaces.length === 0) {
      throw new Error("Invalid namespaces response");
    }

    return namespaces;
  }

  async resolveSelectedNamespace(namespaces) {
    const currentSelection = this.stateManager.getState("selectedNamespace");

    if (currentSelection && namespaces.includes(currentSelection)) {
      return currentSelection;
    }

    return await GetDefaultNamespace(this.cluster);
  }

  updateStateManager(selectedNamespace) {
    const currentSelection = this.stateManager.getState("selectedNamespace");
    if (this.stateManager && selectedNamespace !== currentSelection) {
      this.stateManager.setState("selectedNamespace", selectedNamespace);
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
      const namespaces = await this.fetchNamespaces();
      const selectedNamespace = await this.resolveSelectedNamespace(namespaces);

      // Передаем данные в состояние
      const stateData = {
        namespaces,
        selectedNamespace,
        searchValue,
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
    if (!newSelection) return;

    this.stateManager?.setState("selectedNamespace", newSelection.textContent);
    this.header2ValueEl.textContent = newSelection.textContent;
    this.setState(this.PANEL_STATES.SELECTED);
  }

  updateSelectedNamespace(newNamespace) {
    this.setState(this.PANEL_STATES.SELECTED, {
      ...(this.currentData || {}), // сохраняем все предыдущие данные
      selectedNamespace: newNamespace, // обновляем только namespace
    });
  }

  clear() {
    super.clear();
    this.cleanup();
  }
}
