import {
  GetResourcesInNamespace,
  ApplyResource,
  DeleteResource,
} from "../../wailsjs/go/main/App";
import { SecretResource } from "../resources/SecretResource";
import { PodResource } from "../resources/PodResource";
import { Resource } from "../resources/Resource";
import { Panel } from "./Panel";
import { Utils } from "../utils/Utils";
import { RESOURCE_COLUMNS } from "../utils/Config.js";
import { ModalWindow } from "../windows/ModalWindow.js";

export class ResourcesPanel extends Panel {
  constructor(name, cluster, container, tab, stateManager = null) {
    super(name, cluster, container, tab, stateManager);

    // Добавьте подписки на изменения:
    if (this.stateManager) {
      this.stateManager.subscribe("selectedNamespace", () => {
        if (
          this.isActiveTab() &&
          this.stateManager.getState("selectedApiResource")
        ) {
          this.scheduleUpdate();
          this.deleteBtn.style.display = "none";
          this.toggleCheckboxes.checked = false;
        }
      });

      this.stateManager.subscribe("selectedApiResource", () => {
        if (
          this.isActiveTab() &&
          this.stateManager.getState("selectedNamespace")
        ) {
          this.scheduleUpdate();
          this.deleteBtn.style.display = "none";
          this.toggleCheckboxes.checked = false;
        }
      });
    }
    this.currentUpdateAbortController = null;
    this.updateInterval = null;
    this.buttonEl = container.querySelector(".create-resource-btn");
    this.buttonFunction = () => this.showCreateResourceModal();
    this.listHeadersEl = null;
    this.optColumns = null;
    this.createListHeaders();
    this.monacoModal = null;
    this.deleteBtn = Utils.createEl("floating-btn", "", "button");
    this.deleteBtn.append(Utils.createIconEl("fa-trash"));
    this.tab.append(this.deleteBtn);
    this.deleteBtn.dataset.title = Utils.translate("Delete selected");
    this.toggleCheckboxes = this.panelEl.querySelector(".toggleCheckboxes");
    this.currentPanelId = null;
  }

  isActiveTab() {
    return this.tab && this.tab.classList.contains("active");
  }

  scheduleUpdate() {
    clearTimeout(this.updateTimeout);
    this.updateTimeout = setTimeout(() => this.update(), 100);
  }

  createListHeaders() {
    this.listHeadersEl = Utils.createEl("listHeaders");
    this.panelEl.insertBefore(
      this.listHeadersEl,
      this.searchWrapper.nextSibling,
    );
    const resourceHeader = Utils.createEl("resourceItemHeader");
    this.listHeadersEl.append(resourceHeader);
    const nameContainerEl = Utils.createEl("name");
    nameContainerEl.style.display = "flex";
    const checkboxEl = Utils.createInputEl("toggleCheckboxes", "", "checkbox");
    const nameEl = Utils.createEl("nameText", Utils.translate("Name"));
    nameContainerEl.append(checkboxEl, nameEl);
    this.optColumns = Utils.createEl("optional-columns");
    const ageAndActionsEl = Utils.createEl("age-and-actions");
    const ageEl = Utils.createEl("age", Utils.translate("Age"));
    const actionsEl = Utils.createEl("actions", Utils.translate("Actions"));
    ageAndActionsEl.append(ageEl, actionsEl);
    resourceHeader.append(nameContainerEl, this.optColumns, ageAndActionsEl);
  }

  setupEventListeners() {
    super.setupEventListeners();

    this.deleteBtn.addEventListener("click", async () => {
      if (!confirm(`Are you sure you want to delete selected resources?`)) {
        return;
      }

      // Добавьте индикатор загрузки:
      Utils.showLoadingIndicator("Deleting resources", this.tab);

      this.deleteBtn.style.display = "none";

      const selectedNamespace = this.stateManager.getState("selectedNamespace");
      const apiResource = this.stateManager.getState("selectedApiResource");

      const allCheckboxItems = this.tab.querySelectorAll(".checkboxItem");
      for (const checkboxEl of allCheckboxItems) {
        if (checkboxEl.checked) {
          await DeleteResource(
            this.cluster,
            selectedNamespace,
            apiResource,
            checkboxEl.nextElementSibling.textContent,
          );
          checkboxEl.checked = false;
        }
      }
      this.toggleCheckboxes.checked = false;

      // Скройте индикатор и покажите результат:
      Utils.hideLoadingIndicator(this.tab);
      if (this.tab.classList.contains("active")) {
        alert(`Resources deleted successfully.`);
      }
    });

    this.toggleCheckboxes.addEventListener("change", (event) => {
      // Было: document.querySelectorAll(".checkboxItem")
      // Стало: ищем только в текущей вкладке
      const allCheckboxItems = this.tab.querySelectorAll(".checkboxItem");

      allCheckboxItems.forEach((checkboxItem) => {
        checkboxItem.checked = event.target.checked;
      });
      const anyChecked = Array.from(allCheckboxItems).some((c) => c.checked);
      this.deleteBtn.style.display = anyChecked ? "block" : "none";
    });
  }

  clear() {
    super.clear();
    this.listHeadersEl.remove();
    if (this.deleteBtn && this.deleteBtn.parentNode) {
      this.deleteBtn.remove();
    }
    this.cleanup();
  }

  showCreateResourceModal() {
    const modalContent = `<div class="editor"></div>`;
    new ModalWindow(
      this.tab,
      modalContent,
      "yaml-content",
      Utils.translate("Resource creation") +
        " (" +
        Utils.translate("cluster") +
        " " +
        this.cluster +
        ")",
      Utils.translate("Create resource"),
      () => this.createNewResource(),
    );

    const container = document.querySelector(".editor");
    if (this.monacoModal) {
      this.monacoModal.dispose();
      this.monacoModal = null;
    }
    this.monacoModal = Utils.createMonaco(
      container,
      "# " + Utils.translate("Input yaml here"),
      "yaml",
      true,
    );
  }

  async createNewResource() {
    try {
      const yamlContent = this.monacoModal.getValue(); // Get content from Monaco
      await ApplyResource(this.cluster, yamlContent);
      alert(`Resource created successfully.`);
    } catch (error) {
      console.error(`Failed to create resource:`, error);
      alert(`Failed to create resource:`, error.message);
    }
  }

  async update() {
    const apiResource = this.stateManager.getState("selectedApiResource");
    const selectedNamespace = this.stateManager.getState("selectedNamespace");
    const panelId = `${this.cluster}-${selectedNamespace}-${apiResource}`;
    if (this.currentPanelId === panelId) return;

    this.header1ValueEl.textContent = apiResource;
    this.updateHeader(apiResource);

    this.cleanup();
    // Show loading state
    this.listEl.innerHTML = `<div class="no-resources">Loading ${apiResource} in namespace ${selectedNamespace}...</div>`;

    await this.updateHtml();

    // Set up the interval to try updating every 1 second
    this.registerForUpdates(panelId, () => this.updateWithTimeout(), 1000);

    // Сохраняем panelId для последующей очистки
    this.currentPanelId = panelId;
  }

  updateWithTimeout() {
    this.isUpdating = true;

    // Create a promise that resolves after 10 seconds (timeout)
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => resolve("timeout"), 10000);
    });

    // Race between the actual update and the timeout
    Promise.race([
      this.updateHtml().then(() => "completed"),
      timeoutPromise,
    ]).finally(() => {
      this.isUpdating = false;
    });
  }

  async updateHtml() {
    // Abort any ongoing update
    if (this.currentUpdateAbortController) {
      this.currentUpdateAbortController.abort();
    }

    const abortController = new AbortController();
    this.currentUpdateAbortController = abortController;
    const signal = abortController.signal;

    try {
      const selectedNamespace = this.stateManager.getState("selectedNamespace");
      const apiResource = this.stateManager.getState("selectedApiResource");

      // Pass the signal to cancellable operations (e.g., fetch)
      const resources = await GetResourcesInNamespace(
        this.cluster,
        apiResource,
        selectedNamespace,
      );

      // Check for abort after async operations
      this.checkAbort(signal);

      if (!resources?.length) {
        this.listEl.innerHTML = `<div class="no-resources">No ${apiResource} in ${selectedNamespace}</div>`;
        this.updateStatistics();
        return;
      }

      this.removeNoResourcesElement();
      this.checkAbort(signal);

      const resourceItems = this.getAllListElements();
      this.removeStaleResources(resourceItems, resources, signal);
      this.checkAbort(signal);

      this.processResources(
        this.cluster,
        selectedNamespace,
        apiResource,
        resources,
        resourceItems,
        signal,
      );
      this.checkAbort(signal);

      this.search();
      this.updateStatistics();
    } catch (error) {
      if (error.name !== "AbortError") {
        const apiResource = this.stateManager.getState("selectedApiResource");
        console.error(`Error fetching ${apiResource || "resources"}:`, error);
      }
    } finally {
      if (this.currentUpdateAbortController === abortController) {
        this.currentUpdateAbortController = null;
      }
    }
  }

  // Helper method to check for abort
  checkAbort(signal) {
    if (signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
  }

  removeNoResourcesElement() {
    const noResources = this.listEl.querySelector(".no-resources");
    if (noResources) noResources.remove();
  }

  removeStaleResources(resourceItems, resources, signal) {
    if (!resourceItems) return;

    const toRemove = resourceItems.filter(
      (item) => !resources.some((r) => r.name === item.dataset.resourceName),
    );

    this.checkAbort(signal);
    toRemove.forEach((item) => item.remove());
  }

  processResources(
    cluster,
    namespace,
    apiResource,
    resources,
    existingItems,
    signal,
  ) {
    for (const resource of resources) {
      this.checkAbort(signal);

      const existingItem = existingItems.find(
        (item) => item.dataset.resourceName === resource.name,
      );

      if (existingItem) {
        this.updateExistingResource(existingItem, resource, apiResource);
      } else {
        this.addNewResource(cluster, namespace, apiResource, resource);
      }
    }
  }

  updateExistingResource(item, resource, apiResource) {
    // Simplified update logic
    if (apiResource === "pods") {
      this.updateElementContent(item, "readyStatus", resource.readyStatus);
      this.updateElementContent(item, "status", resource.status);
      this.updateElementContent(item, "restarts", resource.restarts);
    } else if (apiResource === "deployments") {
      this.updateElementContent(item, "ready", resource.ready);
      this.updateElementContent(item, "upToDate", resource.upToDate);
      this.updateElementContent(item, "available", resource.available);
    }
    this.updateElementContent(item, "age", resource.age);
  }

  updateElementContent(parent, selector, value) {
    const element = parent.querySelector(`.resource-${selector}`);
    if (element && element.textContent !== value) {
      element.textContent = value;
      element.dataset[selector] = value;
    }
  }

  addNewResource(cluster, namespace, apiResource, resource) {
    const newItem = this.createResource(
      cluster,
      namespace,
      apiResource,
      resource,
    );
    newItem.fill();
    this.listEl.prepend(newItem.htmlEl);
  }

  createResource(cluster, namespace, apiResource, resource) {
    switch (apiResource) {
      case "pods":
        return new PodResource(
          this.tab,
          cluster,
          namespace,
          apiResource,
          resource,
        );
      case "secrets":
        return new SecretResource(
          this.tab,
          cluster,
          namespace,
          apiResource,
          resource,
        );
      default:
        return new Resource(
          this.tab,
          cluster,
          namespace,
          apiResource,
          resource,
        );
    }
  }

  updateStatistics() {
    // Initialize an object to hold the status counts
    const statusCounts = {};

    // Iterate through all resource items in the resourcesList
    const items = this.listEl.getElementsByClassName(this.listItemClass);
    Array.from(items).forEach((item) => {
      const statusElement = item.querySelector(".resource-status");
      if (statusElement) {
        const status = statusElement.textContent.trim();
        if (status in statusCounts) {
          statusCounts[status]++;
        } else {
          statusCounts[status] = 1;
        }
      }
    });

    // Generate the statistics string
    let statisticsString = "";
    Object.entries(statusCounts).forEach(([status, count], index) => {
      statisticsString += `${count} ${status}`;
      if (index < Object.keys(statusCounts).length - 1) {
        statisticsString += ", ";
      }
    });

    // Update the statistics element
    this.header2ValueEl.textContent =
      statisticsString || Utils.translate("no statistics available");
  }

  updateHeader(apiResource) {
    this.optColumns.innerHTML = ""; // Clear existing columns

    const columns = RESOURCE_COLUMNS[apiResource] || [];

    columns.forEach((column) => {
      const columnEl = Utils.createEl(
        column.key.toLowerCase().replace(/([A-Z])/g, "-$1"),
        Utils.translate(column.title),
      );
      this.optColumns.appendChild(columnEl);
    });
  }
}
