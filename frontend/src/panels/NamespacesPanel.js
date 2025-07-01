import { GetNamespaces, GetDefaultNamespace } from "../../wailsjs/go/main/App";
import { Panel } from "./Panel";

export class NamespacesPanel extends Panel {
  constructor(name, cluster, container, tab) {
    super(name, cluster, container, tab);
    this.apiResourcesPanel = null;
    this.resourcesPanel = null;
  }

  select(event) {
    const newSelection = super.select(event);
    if (!newSelection) {
      return;
    }
    this.header2ValueEl.textContent = newSelection.textContent;
    this.resourcesPanel.update(this.cluster);
    this.resourcesPanel.deleteBtn.style.display = "none";
    this.resourcesPanel.toggleCheckboxes.checked = false;
  }
  async update() {
    // Fetch namespaces from the API
    const namespaces = await GetNamespaces(this.cluster);

    if (!Array.isArray(namespaces) && !(namespaces.length > 0)) {
      console.error("Invalid namespaces response:", namespaces);
      return;
    }
    const options = [];
    this.selectedElText = await GetDefaultNamespace(this.cluster);
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
  }
}
