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
import { ModalWindow } from "../windows/ModalWindow.js";

export class ResourcesPanel extends Panel {
  constructor(name, cluster, container, tab) {
    super(name, cluster, container, tab);
    this.namespacesPanel = null;
    this.apiResourcesPanel = null;
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
    document.body.append(this.deleteBtn);
    this.deleteBtn.dataset.title = Utils.translate("Delete selected");
    this.toggleCheckboxes = this.panelEl.querySelector(".toggleCheckboxes");
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
      this.deleteBtn.style.display = "none";
      const allCheckboxItems = document.querySelectorAll(".checkboxItem");
      for (const checkboxEl of allCheckboxItems) {
        if (checkboxEl.checked) {
          await DeleteResource(
            this.cluster,
            this.namespacesPanel.selectedEl.textContent,
            this.apiResourcesPanel.selectedEl.textContent,
            checkboxEl.nextElementSibling.textContent,
          );
          checkboxEl.checked = false;
        }
      }
      this.toggleCheckboxes.checked = false;
      alert(`Resources deleted successfully.`);
    });
    this.toggleCheckboxes.addEventListener("change", (event) => {
      const allCheckboxItems = document.querySelectorAll(".checkboxItem");
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
    this.deleteBtn.remove();
    this.cleanup();
  }

  cleanup() {
    if (this.updateInterval) {
      console.log("Clearing interval: ", this.updateInterval);
      clearInterval(this.updateInterval);
      this.updateInterval = undefined;
    }
    if (this.currentUpdateAbortController) {
      this.currentUpdateAbortController.abort();
    }
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
    const apiResource = this.apiResourcesPanel.selectedEl.textContent;
    const selectedNamespace = this.namespacesPanel.selectedEl.textContent;

    this.apiResourcesPanel.header2ValueEl.textContent = apiResource;
    this.header1ValueEl.textContent = apiResource;
    this.updateHeader(apiResource);

    this.cleanup();
    // Show loading state
    this.listEl.innerHTML = `<div class="no-resources">Loading ${apiResource} in namespace ${selectedNamespace}...</div>`;

    await this.updateHtml();

    // Set up the interval to try updating every 1 second
    this.updateInterval = setInterval(() => {
      if (!this.isUpdating) {
        this.updateWithTimeout();
      }
    }, 1000);
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
      const selectedNamespace = this.namespacesPanel.selectedEl.textContent;
      const apiResource = this.apiResourcesPanel.selectedEl.textContent;

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
        console.error(
          `Error fetching ${this.apiResourcesPanel.selectedEl.textContent}:`,
          error,
        );
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
        return new PodResource(this.tab, cluster, namespace, apiResource, resource);
      case "secrets":
        return new SecretResource(this.tab, cluster, namespace, apiResource, resource);
      default:
        return new Resource(this.tab, cluster, namespace, apiResource, resource);
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

    // Define columns based on resource type
    const columns = {
      pods: ["Ready", "Status", "Restarts"],
      services: ["Type", "clusterIP", "loadBalancerIP"],
      deployments: ["Ready", "UpToDate", "Available"],
    };

    const columnTitles = columns[apiResource] || [];

    columnTitles.forEach((title) => {
      const column = Utils.createEl(
        title.toLowerCase().replace(/\s+/g, "-"),
        Utils.translate(title),
      );
      this.optColumns.appendChild(column);
    });
  }
}
