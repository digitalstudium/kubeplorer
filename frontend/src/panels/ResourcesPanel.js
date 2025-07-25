import {
  GetResourcesInNamespace,
  ApplyResource,
  DeleteResource,
} from "../../wailsjs/go/main/App";
import { DependencyGraph } from "../components/DependencyGraph.js";
import { SecretResource } from "../resources/SecretResource";
import { PodResource } from "../resources/PodResource";
import { Resource } from "../resources/Resource";
import { Panel } from "./Panel";
import { Utils } from "../utils/Utils";
import { RESOURCE_COLUMNS } from "../utils/Config.js";
import { ModalWindow } from "../windows/ModalWindow.js";

export class ResourcesPanel extends Panel {
  constructor(name, container, tab, stateManager = null) {
    super(name, container, tab, stateManager);

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
          this.hideDependencyGraph();
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
          this.hideDependencyGraph();
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
    this.dependencyContainer = Utils.createEl("dependency-container");
    this.dependencyContainer.style.display = "none";
    this.panelEl.appendChild(this.dependencyContainer); // Добавляем к panelEl, не к tab

    this.currentDependencyGraph = null;
    this.selectedResource = null;
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
      const cluster = this.stateManager.getState("selectedCluster");

      const allCheckboxItems = this.tab.querySelectorAll(".checkboxItem");
      for (const checkboxEl of allCheckboxItems) {
        if (checkboxEl.checked) {
          await DeleteResource(
            cluster,
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

    this.listEl.addEventListener("click", (event) => {
      const resourceItem = event.target.closest(".item");
      if (
        resourceItem &&
        !event.target.closest(".action-button") &&
        !event.target.closest("input[type='checkbox']")
      ) {
        this.selectResourceForGraph(resourceItem);
      }
    });
  }

  selectResourceForGraph(resourceItem) {
    // Снять выделение с предыдущего ресурса
    if (this.selectedResource) {
      this.selectedResource.classList.remove("selected-for-graph");
    }

    // Выделить новый ресурс
    resourceItem.classList.add("selected-for-graph");
    this.selectedResource = resourceItem;

    // Показать dependency graph
    this.showDependencyGraph(resourceItem.dataset.resourceName);
  }

  async showDependencyGraph(resourceName) {
    // Очистить предыдущий граф
    if (this.currentDependencyGraph) {
      this.currentDependencyGraph.clear();
    }

    // Показать контейнер
    this.dependencyContainer.style.display = "block";
    this.dependencyContainer.innerHTML = `
      <div class="dependency-header">
        <h3>Dependencies for ${resourceName}</h3>
        <button class="close-dependency-btn">×</button>
      </div>
      <div class="dependency-content"></div>
    `;

    // Добавить обработчик закрытия
    this.dependencyContainer
      .querySelector(".close-dependency-btn")
      .addEventListener("click", () => this.hideDependencyGraph());

    const navigationCallback = (resource, targetCluster = null) => {
      this.navigateToResource(resource, targetCluster);
    };

    // Создать и отобразить граф
    const contentContainer = this.dependencyContainer.querySelector(
      ".dependency-content",
    );
    this.currentDependencyGraph = new DependencyGraph(
      contentContainer,
      this.stateManager.getState("selectedCluster"),
      this.stateManager.getState("selectedNamespace"),
      this.stateManager.getState("selectedApiResource"),
      resourceName,
      navigationCallback,
    );

    await this.currentDependencyGraph.render();
  }

  hideDependencyGraph() {
    this.dependencyContainer.style.display = "none";
    if (this.selectedResource) {
      this.selectedResource.classList.remove("selected-for-graph");
      this.selectedResource = null;
    }
    if (this.currentDependencyGraph) {
      this.currentDependencyGraph.clear();
      this.currentDependencyGraph = null;
    }
  }

  clear() {
    super.clear();
    this.listHeadersEl.remove();
    if (this.deleteBtn && this.deleteBtn.parentNode) {
      this.deleteBtn.remove();
    }
    this.hideDependencyGraph();
    if (this.dependencyContainer) {
      this.dependencyContainer.remove();
    }
    this.cleanup();
  }

  showCreateResourceModal() {
    const cluster = this.stateManager.getState("selectedCluster");
    const modalContent = `<div class="editor"></div>`;
    new ModalWindow(
      this.tab,
      modalContent,
      "yaml-content",
      Utils.translate("Resource creation") +
        " (" +
        Utils.translate("cluster") +
        " " +
        cluster +
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
      const cluster = this.stateManager.getState("selectedCluster");
      const yamlContent = this.monacoModal.getValue(); // Get content from Monaco
      await ApplyResource(cluster, yamlContent);
      alert(`Resource created successfully.`);
    } catch (error) {
      console.error(`Failed to create resource:`, error);
      alert(`Failed to create resource:`, error.message);
    }
  }

  async update() {
    console.log("ResourcesPanel update called");
    const apiResource = this.stateManager.getState("selectedApiResource");
    const selectedNamespace = this.stateManager.getState("selectedNamespace");
    const cluster = this.stateManager.getState("selectedCluster");
    console.log("Update params:", { cluster, selectedNamespace, apiResource });
    if (!cluster) {
      console.log("No cluster selected, skipping update");
      return;
    }
    const panelId = `${cluster}-${selectedNamespace}-${apiResource}`;
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
      const cluster = this.stateManager.getState("selectedCluster"); // добавляем эту строку

      if (!cluster) {
        console.log("No cluster in updateHtml, aborting");
        return;
      }

      // Pass the signal to cancellable operations (e.g., fetch)
      const resources = await GetResourcesInNamespace(
        cluster,
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

  processResources(namespace, apiResource, resources, existingItems, signal) {
    for (const resource of resources) {
      this.checkAbort(signal);

      const existingItem = existingItems.find(
        (item) => item.dataset.resourceName === resource.name,
      );

      if (existingItem) {
        this.updateExistingResource(existingItem, resource, apiResource);
      } else {
        this.addNewResource(namespace, apiResource, resource);
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

  addNewResource(namespace, apiResource, resource) {
    const newItem = this.createResource(namespace, apiResource, resource);
    newItem.fill();
    this.listEl.prepend(newItem.htmlEl);
  }

  createResource(namespace, apiResource, resource) {
    const cluster = this.stateManager.getState("selectedCluster");
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

  navigateToResource(targetResource, targetCluster = null) {
    console.log("Navigating to resource:", targetResource);

    // Если это application с другим кластером, используем goToApplication
    if (targetCluster && targetResource.kind === "Application") {
      const app = window.app;
      if (app) {
        app.goToApplication(targetResource);
        this.hideDependencyGraph();
        return;
      }
    }

    // Существующая логика для ресурсов в том же кластере
    const currentApiResource = this.stateManager.getState(
      "selectedApiResource",
    );
    const targetApiResourceName = this.kindToApiResourceName(
      targetResource.kind,
    );

    console.log("Current API resource:", currentApiResource);
    console.log("Target API resource:", targetApiResourceName);

    if (currentApiResource !== targetApiResourceName) {
      console.log("Switching API resource type...");
      this.stateManager.setState("selectedApiResource", targetApiResourceName);
      this.waitForResourceAndClick(targetResource.name);
    } else {
      console.log("Same API resource, clicking directly...");
      this.clickResourceInList(targetResource.name);
    }

    this.hideDependencyGraph();
  }

  waitForResourceAndClick(resourceName, maxAttempts = 10, attemptDelay = 300) {
    let attempts = 0;

    const checkAndClick = () => {
      attempts++;
      console.log(`Attempt ${attempts}: Looking for resource ${resourceName}`);

      const resourceItem = this.listEl.querySelector(
        `[data-resource-name="${resourceName}"]`,
      );
      console.log("Found resource item:", resourceItem);

      if (resourceItem) {
        console.log("Resource found, clicking...");
        this.clickResourceInList(resourceName);
        return;
      }

      if (attempts >= maxAttempts) {
        console.warn(
          `Resource ${resourceName} not found after ${maxAttempts} attempts`,
        );
        // Попробуем найти все ресурсы для отладки
        const allItems = this.listEl.querySelectorAll(".item");
        console.log(
          "All available resources:",
          Array.from(allItems).map((item) => item.dataset.resourceName),
        );
        return;
      }

      setTimeout(checkAndClick, attemptDelay);
    };

    setTimeout(checkAndClick, attemptDelay);
  }

  // Простой метод для клика по ресурсу
  clickResourceInList(resourceName) {
    const resourceItem = this.listEl.querySelector(
      `[data-resource-name="${resourceName}"]`,
    );

    if (resourceItem) {
      // Прокручиваем к элементу
      resourceItem.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });

      // Симулируем клик
      setTimeout(() => {
        resourceItem.click();
      }, 200);
    }
  }
  kindToApiResourceName(kind) {
    // Получаем панель API ресурсов через app
    if (window.app && window.app.panels && window.app.panels[1]) {
      const apiResourcesPanel = window.app.panels[1]; // Панель 2 - это API ресурсы
      const allApiResources = apiResourcesPanel.getAllCurrentApiResources();

      // Ищем соответствующий ресурс
      const matchingResource = allApiResources.find((resource) => {
        const resourceSingular = resource.endsWith("s")
          ? resource.slice(0, -1)
          : resource;
        return resourceSingular.toLowerCase() === kind.toLowerCase();
      });

      return matchingResource || kind.toLowerCase() + "s";
    }

    // Fallback
    return kind.toLowerCase() + "s";
  }
}
