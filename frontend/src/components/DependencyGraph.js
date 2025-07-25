import { GetResourceDependencies } from "../../wailsjs/go/main/App.js";
import { Utils } from "../utils/Utils.js";

export class DependencyGraph {
  constructor(
    container,
    cluster,
    namespace,
    apiResource,
    resourceName,
    navigationCallback,
  ) {
    this.container = container;
    this.cluster = cluster;
    this.namespace = namespace;
    this.apiResource = apiResource;
    this.resourceName = resourceName;
    this.graphContainer = null;
    this.navigationCallback = navigationCallback;
  }

  async render() {
    try {
      // Показываем индикатор загрузки
      this.showLoadingIndicator();

      console.log(
        `Loading dependencies for ${this.apiResource}/${this.resourceName} in ${this.namespace}`,
      );

      const dependencyChain = await GetResourceDependencies(
        this.cluster,
        this.apiResource,
        this.namespace,
        this.resourceName,
      );

      console.log("Received dependency chain:", dependencyChain);

      // Скрываем индикатор и показываем результат
      this.hideLoadingIndicator();
      this.createChainHTML(dependencyChain);
    } catch (error) {
      console.error("Error loading dependency chain:", error);
      this.hideLoadingIndicator();
      this.showError("Failed to load dependency chain: " + error.message);
    }
  }

  showLoadingIndicator() {
    this.graphContainer = Utils.createEl("dependency-graph");
    const loadingEl = Utils.createEl("dependency-loading");
    loadingEl.innerHTML = `
      <div class="dependency-spinner"></div>
      <div class="dependency-loading-text">Loading dependency chain...</div>
    `;
    this.graphContainer.appendChild(loadingEl);
    this.container.appendChild(this.graphContainer);
  }

  hideLoadingIndicator() {
    if (this.graphContainer) {
      this.graphContainer.remove();
      this.graphContainer = null;
    }
  }

  createChainHTML(chain) {
    this.graphContainer = Utils.createEl("dependency-graph");

    // Безопасно обрабатываем массивы
    const ancestors = Array.isArray(chain.ancestors) ? chain.ancestors : [];
    const descendants = Array.isArray(chain.descendants)
      ? chain.descendants
      : [];
    const applications = Array.isArray(chain.applications)
      ? chain.applications
      : [];
    const current = chain.current || {};

    // Создаем полную цепочку: applications + предки + текущий + потомки
    const fullChain = [
      ...applications.map((app) => ({
        name: app.name,
        kind: "Application",
        namespace: app.namespace,
        uid: `app-${app.name}`,
        cluster: app.cluster, // Добавляем информацию о кластере
      })),
      ...ancestors,
      current,
      ...descendants,
    ].filter((item) => item && item.name);

    if (fullChain.length <= 1) {
      const noDepMsg = Utils.createEl(
        "no-dependencies",
        "No dependency chain found",
      );
      this.graphContainer.appendChild(noDepMsg);
    } else {
      // Создаем контейнер для цепочки
      const chainContainer = Utils.createEl("dependency-chain");

      fullChain.forEach((resource, index) => {
        const nodeContainer = Utils.createEl("chain-node-container");

        const isCurrent =
          resource.uid === current.uid ||
          (resource.name === current.name && resource.kind === current.kind);
        const node = this.createChainNode(resource, isCurrent);
        nodeContainer.appendChild(node);

        // Добавляем стрелку, если это не последний элемент
        if (index < fullChain.length - 1) {
          const arrow = Utils.createEl("chain-arrow");
          arrow.innerHTML = '<i class="fas fa-arrow-down"></i>';
          nodeContainer.appendChild(arrow);
        }

        chainContainer.appendChild(nodeContainer);
      });

      this.graphContainer.appendChild(chainContainer);
      this.addChainInfo({ ancestors, descendants, current, applications });
    }

    this.container.appendChild(this.graphContainer);
  }

  createChainNode(resource, isCurrent = false) {
    const node = Utils.createEl(
      `dependency-node ${isCurrent ? "current" : ""}`,
    );

    // Безопасно получаем данные ресурса
    const name = resource.name || "Unknown";
    const kind = resource.kind || "Unknown";
    const namespace = resource.namespace || "";

    // Определяем иконку по типу ресурса
    const icon = this.getResourceIcon(kind);

    node.innerHTML = `
      <div class="node-icon">
        <i class="fas ${icon}"></i>
      </div>
      <div class="node-info">
        <div class="node-name">${name}</div>
        <div class="node-type">${kind}</div>
        ${namespace ? `<div class="node-namespace">${namespace}</div>` : ""}
        ${resource.cluster ? `<div class="node-cluster">${resource.cluster}</div>` : ""}
      </div>
      ${isCurrent ? '<div class="current-indicator"><i class="fas fa-star"></i></div>' : ""}
    `;

    // Добавить клик для навигации к ресурсу или кластеру
    if (!isCurrent && resource.name) {
      node.addEventListener("click", () => {
        // Если это Application и кластер отличается от текущего
        if (resource.kind === "Application" && resource.cluster) {
          console.log("Calling navigateToResource with cluster:", resource.cluster);
          this.navigationCallback(resource, resource.cluster);
        } else {
          // Обычная навигация к ресурсу
          this.navigationCallback(resource);
        }
      });
    }

    return node;
  }

  getResourceIcon(kind) {
    const iconMap = {
      Application: "fa-rocket",
      Pod: "fa-cube",
      Deployment: "fa-rocket",
      ReplicaSet: "fa-clone",
      Service: "fa-network-wired",
      ConfigMap: "fa-file-code",
      Secret: "fa-key",
      Ingress: "fa-globe",
      StatefulSet: "fa-database",
      DaemonSet: "fa-server",
      Job: "fa-tasks",
      CronJob: "fa-clock",
      PersistentVolumeClaim: "fa-hdd",
      ServiceAccount: "fa-user-shield",
      Application: "fa-layer-group",
      HelmRelease: "fa-helm",
      Kustomization: "fa-puzzle-piece",
    };

    return iconMap[kind] || "fa-cube";
  }

  addChainInfo(chain) {
    const infoContainer = Utils.createEl("chain-info");

    const ancestors = Array.isArray(chain.ancestors) ? chain.ancestors : [];
    const descendants = Array.isArray(chain.descendants)
      ? chain.descendants
      : [];

    const stats = Utils.createEl("chain-stats");
    stats.innerHTML = `
      <div class="stat-item">
        <span class="stat-label">Ancestors:</span>
        <span class="stat-value">${ancestors.length}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">Descendants:</span>
        <span class="stat-value">${descendants.length}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">Total chain:</span>
        <span class="stat-value">${ancestors.length + 1 + descendants.length}</span>
      </div>
    `;

    infoContainer.appendChild(stats);
    this.graphContainer.appendChild(infoContainer);
  }

  showError(message) {
    this.graphContainer = Utils.createEl("dependency-graph");
    const errorEl = Utils.createEl("dependency-error", message);
    this.graphContainer.appendChild(errorEl);
    this.container.appendChild(this.graphContainer);
  }

  clear() {
    if (this.graphContainer) {
      this.graphContainer.remove();
      this.graphContainer = null;
    }
  }
}
