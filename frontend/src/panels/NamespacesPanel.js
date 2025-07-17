import { GetNamespaces, GetDefaultNamespace } from "../../wailsjs/go/main/App";
import { Panel } from "./Panel";

export class NamespacesPanel extends Panel {
  constructor(name, cluster, container, tab, stateManager = null) {
    super(name, cluster, container, tab, stateManager);
    this.currentPanelId = null;
  }

  select(event) {
    const newSelection = super.select(event);
    if (!newSelection) {
      return;
    }
    if (this.stateManager) {
      this.stateManager.setState("selectedNamespace", newSelection.textContent);
    }
    this.header2ValueEl.textContent = newSelection.textContent;
  }
  async update() {
    const searchValue = this.searchBoxEl ? this.searchBoxEl.value : "";
    const currentSelection = this.stateManager
      ? this.stateManager.getState("selectedNamespace")
      : this.selectedElText;
    // Fetch namespaces from the API
    const namespaces = await GetNamespaces(this.cluster);

    if (!Array.isArray(namespaces) && !(namespaces.length > 0)) {
      console.error("Invalid namespaces response:", namespaces);
      return;
    }
    const options = [];

    let selectedNamespace = currentSelection;
    if (!selectedNamespace || !namespaces.includes(selectedNamespace)) {
      selectedNamespace = await GetDefaultNamespace(this.cluster);

      // Обновляем StateManager если выбор изменился:
      if (this.stateManager && selectedNamespace !== currentSelection) {
        this.stateManager.setState("selectedNamespace", selectedNamespace);
      }
    }

    this.selectedElText = selectedNamespace;
    // Add all namespaces
    options.push(
      ...namespaces.map(
        (namespace) =>
          `<div class="${this.listItemClass} ${namespace === this.selectedElText ? "selected" : ""}">${namespace}</div>`,
      ),
    );
    this.listEl.innerHTML = options.join("");
    this.header2ValueEl.textContent = this.selectedElText;
    this.selectedEl = this.listEl.querySelector(".selected");
    if (searchValue && this.searchBoxEl) {
      this.searchBoxEl.value = searchValue;
      this.search();
    }
    if (this.stateManager) {
      const updateManager = this.stateManager.getUpdateManager();
      const panelId = `namespaces-${this.cluster}`;

      if (this.currentPanelId !== panelId) {
        if (this.currentPanelId) {
          updateManager.unregister(this.currentPanelId);
        }

        updateManager.register(
          panelId,
          () => {
            this.update();
          },
          5000,
        ); // Обновляем каждые 5 секунд

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
  }

  clear() {
    super.clear();
    this.cleanup();
  }
}
